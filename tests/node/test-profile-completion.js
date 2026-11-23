/* Build the simulator first. Java writes stdout only; fixtures use owned OS-temp directories. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const javaHome = process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin/java.exe'))
  ? process.env.JAVA_HOME : path.join(process.env.LOCALAPPDATA, 'EdgeVision/jdk-23.0.2+7');
const jars = path.join(root, 'simulation/vendor/iFogSim/jars');
const classpath = [path.join(root, 'simulation/target/classes'), path.join(jars, '*'), path.join(jars, 'commons-math3-3.5/*')].join(path.delimiter);

function fixture(t, count, fps) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'edgevision-drain-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('edgevision-drain-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const input = {
    jobId: randomUUID().replaceAll('-', ''), sourceClassification: 'synthetic_test',
    testPurpose: 'Configured finite demand for queue-drain regression; no inference or physical-video claim.',
    video: { durationSeconds: count / fps, sourceFps: fps, processedFrameCount: count, frameProcessingInterval: 1 },
    iFogSimWorkload: { virtualCameraSources: 1, frameBatching: { framesPerTuple: 1, tupleCount: count },
      proposedTupleGenerationIntervalSeconds: 1 / fps, effectiveTupleArrivalRatePerSecond: count / (count / fps),
      tuplePayloadBytes: null, tuplePayloadBasis: 'unavailable_not_serialized',
      cpuDemand: { status: 'unavailable', videoAnalyzerMI: null, eventDetectorMI: null } }
  };
  const filename = path.join(directory, 'profile.json');
  const run = scenario => {
    fs.writeFileSync(filename, JSON.stringify(input));
    return spawnSync(path.join(javaHome, 'bin/java.exe'), ['-cp', classpath, 'com.edgevision.simulation.EdgeVisionSimulation', scenario, filename],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  };
  return { input, run };
}

for (const [count, fps] of [[20, 10], [391, 25], [2298, 30]]) {
  test(`both placements drain all ${count} items with a matching horizon`, t => {
    const f = fixture(t, count, fps); const records = [];
    for (const scenario of ['cloud', 'edge']) {
      const result = f.run(scenario); assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
      const line = result.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT_JSON:')); assert.ok(line);
      const record = JSON.parse(line.slice(12)); records.push(record);
      assert.equal(record.metrics.processedTuples, count);
      assert.equal(record.workloadProfile.generatedTuples, count);
      assert.equal(record.workloadProfile.tupleCountFromProfile, count);
      assert.equal(record.workloadProfile.tupleIntervalsMatchProfile, true);
    }
    assert.equal(records[0].metrics.simulationTimeSeconds, records[1].metrics.simulationTimeSeconds);
    if (count === 20) assert.equal(records[0].metrics.simulationTimeSeconds, 2000);
    else assert.ok(records[0].metrics.simulationTimeSeconds > 2000);
  });
}

test('unsupported CPU demand is rejected instead of wrapping the horizon', t => {
  const f = fixture(t, 20, 10);
  f.input.iFogSimWorkload.cpuDemand = { status: 'estimated_from_configured_calibration',
    videoAnalyzerMI: 1e15, eventDetectorMI: 1e15, referenceHardware: 'test-only', calibrationMethod: 'overflow validation' };
  const result = f.run('cloud'); assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /supported simulation horizon/);
  assert.ok(!result.stdout.includes('RESULT_JSON:'));
});

/* Controlled Java profile checks; no inference accuracy or hardware calibration claims. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { combineProfiles } = require('./multi-video');
const root = path.resolve(__dirname, '..');
const id = () => randomUUID().replaceAll('-', '');
const template = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const javaHome = process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, 'bin/java.exe'))
  ? process.env.JAVA_HOME : path.join(process.env.LOCALAPPDATA, 'EdgeVision/jdk-23.0.2+7');
const java = path.join(javaHome, 'bin/java.exe');
const jars = path.join(root, 'simulation/vendor/iFogSim/jars');
const classpath = [path.join(root, 'simulation/target/classes'), path.join(jars, '*'), path.join(jars, 'commons-math3-3.5/*')].join(path.delimiter);
const output = path.join(root, 'results/validation');
fs.mkdirSync(output, { recursive: true });
const directory = fs.mkdtempSync(path.join(output, 'controlled-multi-'));
function camera(batchSize, configuredPayload = null) {
  const profile = structuredClone(template);
  profile.jobId = id();
  const workload = profile.iFogSimWorkload;
  workload.frameBatching.framesPerTuple = batchSize;
  workload.frameBatching.tupleCount = Math.ceil(profile.video.processedFrameCount / batchSize);
  workload.proposedTupleGenerationIntervalSeconds = batchSize * profile.video.frameProcessingInterval / profile.video.sourceFps;
  workload.effectiveTupleArrivalRatePerSecond = workload.frameBatching.tupleCount / profile.video.durationSeconds;
  workload.tuplePayloadBytes = configuredPayload;
  workload.tuplePayloadBasis = configuredPayload == null ? 'unavailable_not_serialized' : 'configured_assumption';
  return { cameraId: id(), jobId: profile.jobId, workloadProfile: profile };
}
function invoke(profile, scenario = 'cloud') {
  const filename = path.join(directory, `${id()}.json`);
  fs.writeFileSync(filename, JSON.stringify(profile));
  const result = spawnSync(java, ['-cp', classpath, 'com.edgevision.simulation.EdgeVisionSimulation', scenario, filename],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return result;
}
const a = camera(3);
const b = camera(5, 1000);
const countA = a.workloadProfile.iFogSimWorkload.frameBatching.tupleCount;
const countB = b.workloadProfile.iFogSimWorkload.frameBatching.tupleCount;
a.workloadProfile.iFogSimWorkload.cpuDemand = { videoAnalyzerMI: countA * 500, eventDetectorMI: countA * 1000,
  status: 'estimated_from_configured_calibration', referenceHardware: 'controlled test-only reference', calibrationMethod: 'Test values only; not a hardware calibration' };
const profile = combineProfiles(id(), [a, b]);
const records = {};
for (const scenario of ['cloud', 'edge']) {
  const run = invoke(profile, scenario);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const line = run.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT_JSON:'));
  records[scenario] = JSON.parse(line.slice('RESULT_JSON:'.length));
  const used = records[scenario].workloadProfile;
  assert.equal(used.sources[0].videoAnalyzerMIPerTupleUsed, 500);
  assert.equal(used.sources[0].eventDetectorMIPerTupleUsed, 1000);
  assert.equal(used.sources[1].videoAnalyzerMIPerTupleUsed, 1000);
  assert.equal(used.sources[1].cameraTuplePayloadBytesUsed, 1000);
  assert.equal(used.sources[0].generatedTuples, countA);
  assert.equal(used.sources[1].processedTuples, countB);
  assert.equal(used.sources[0].tupleIntervalSeconds, 0.3);
  assert.equal(used.sources[1].tupleIntervalSeconds, 0.5);
  assert.ok(used.tupleIntervalsMatchProfile);
}
assert.deepEqual(records.cloud.workloadProfile, records.edge.workloadProfile);
const bytes = countA * 20000 + countB * 1000;
assert.equal(records.cloud.metrics.networkUsageMb, bytes * 2 / 1000000);
assert.equal(records.edge.metrics.networkUsageMb, (bytes + (countA + countB) * 500) / 1000000);
console.log('PASS per-camera batching, intervals, configured CPU and payload assumptions retained by both placements');
const mutations = [
  p => { p.sources[1].cameraId = p.sources[0].cameraId; },
  p => { p.sources[0].jobId = id(); },
  p => { p.tupleCount += 1; },
  p => { p.cameraCount += 0.5; },
  p => { p.tupleCount += 0.5; },
  p => { p.durationSeconds += 1; },
  p => { p.sources[0].workloadProfile.iFogSimWorkload.frameBatching.tupleCount++; },
  p => { p.sources = []; },
  p => { p.sources[0].workloadProfile.iFogSimWorkload.cpuDemand.eventDetectorMI = null; }
];
for (const mutate of mutations) {
  const invalid = structuredClone(profile); mutate(invalid);
  const rejected = invoke(invalid);
  assert.notEqual(rejected.status, 0, 'Invalid combined profile was accepted.');
  assert.ok(!rejected.stdout.includes('RESULT_JSON:'));
}
console.log(`PASS ${mutations.length} malformed combined profiles rejected before simulation output`);
const tenSources = Array.from({ length: 10 }, () => camera(3));
const ten = combineProfiles(id(), tenSources);
const tenRun = invoke(ten, 'edge');
assert.equal(tenRun.status, 0, tenRun.stderr);
const record = JSON.parse(tenRun.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT_JSON:')).slice(12));
assert.equal(record.workloadProfile.sources.length, 10);
assert.equal(record.metrics.processedTuples, ten.tupleCount);
assert.ok(record.workloadProfile.sources.every(source => source.processedTuples === countA));
console.log('PASS ten distinct recording sources complete their exact individual tuple shares');

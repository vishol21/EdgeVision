/* Stage 2 real API matrix. Run against a dedicated server rooted in this project
   copy; existing standalone result bytes are restored in finally. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseUrl = process.argv[2] || 'http://127.0.0.1:4173';
const resultsDir = path.resolve(__dirname, '../results');
const outputPath = path.resolve(process.argv[3] || path.join(resultsDir, 'validation/camera-api.json'));
const originals = new Map(['cloud', 'edge'].map(scenario => {
  const filename = path.join(resultsDir, `${scenario}.json`);
  return [filename, fs.existsSync(filename) ? fs.readFileSync(filename) : null];
}));

async function post(action, cameraCount) {
  const response = await fetch(`${baseUrl}/api/simulate/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cameraCount })
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const health = await fetch(`${baseUrl}/api/health`).then(response => response.json());
  assert.equal(health.status, 'ok');
  assert.equal(health.simulationRunning, false, 'Use a dedicated idle server for this test.');
  assert.equal(health.videoAnalysisRunning, false);
  const rejected = [];
  for (const action of ['cloud', 'edge', 'both']) {
    for (const input of [0, 11, -1, 1.5, '5', null, true]) {
      const response = await post(action, input);
      assert.equal(response.status, 400, JSON.stringify({ action, input, response }));
      rejected.push({ action, input, httpStatus: response.status });
    }
  }
  console.log('PASS all three actions reject out-of-range, fractional and non-integer camera inputs');
  const cases = [];
  const seenIds = new Set();
  for (const count of [1, 2, 3, 5, 6, 10]) {
    const { status, body } = await post('both', count);
    assert.equal(status, 200, JSON.stringify(body));
    const expected = count * 150;
    const expectedIds = Array.from({ length: count }, (_, index) => `virtual-camera-${String(index + 1).padStart(2, '0')}`);
    for (const scenario of ['cloud', 'edge']) {
      const record = body[scenario];
      assert.equal(record.scenario, scenario);
      const profile = record.workloadProfile;
      assert.equal(profile.type, 'standalone_virtual_camera');
      assert.match(profile.workloadProfileId, /^[a-f0-9]{32}$/);
      assert.equal(profile.virtualCameraSources, count);
      assert.deepEqual(profile.sourceIds, expectedIds);
      assert.equal(new Set(profile.sourceIds).size, count);
      assert.equal(profile.durationSeconds, 15);
      assert.equal(profile.tupleIntervalMs, 100);
      assert.equal(profile.tuplesPerCamera, 150);
      assert.equal(profile.tupleCount, expected);
      assert.equal(record.metrics.processedTuples, expected);
    }
    assert.deepEqual(body.cloud.workloadProfile, body.edge.workloadProfile);
    assert.ok(!seenIds.has(body.cloud.workloadProfile.workloadProfileId), 'A new request reused a prior workload ID.');
    seenIds.add(body.cloud.workloadProfile.workloadProfileId);
    cases.push({ cameraCount: count, expectedTuples: expected,
      workloadProfile: body.cloud.workloadProfile,
      cloudProcessedTuples: body.cloud.metrics.processedTuples,
      edgeProcessedTuples: body.edge.metrics.processedTuples,
      profilesMatch: true, httpStatus: status });
    console.log(`PASS API ${count} cameras: ${expected} processed tuples in each scenario; matching profile and source IDs`);
  }
  const report = { schemaVersion: 1, completedAt: new Date().toISOString(),
    type: 'synthetic_virtual_camera_api_validation',
    method: 'Real paired Node/PowerShell/Java runs on an isolated project copy. Source construction and emission timing are independently checked by simulation/validate-cameras.ps1.',
    rejectedInputs: rejected, cases };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Saved API validation evidence to ${outputPath}`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  for (const [filename, bytes] of originals) {
    if (bytes === null) fs.rmSync(filename, { force: true });
    else fs.writeFileSync(filename, bytes);
  }
});

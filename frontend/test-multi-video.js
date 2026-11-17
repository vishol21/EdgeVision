/* Real Stage 4 integration checks. Use a dedicated NODE_ENV=test project copy/server. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:4173';
const project = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(project, 'video_analytics/tests/fixtures/synthetic_test_clip.avi'));
const second = process.env.EDGEVISION_SECOND_FIXTURE || path.join(project, 'video_analytics/tests/.runtime/second-camera.avi');
const corrupt = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI '), Buffer.alloc(32)]);
const json = async (route, options) => {
  const response = await fetch(new URL(route, base), options);
  return { status: response.status, body: await response.json() };
};
const post = (route, body) => json(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function create(files) {
  const result = await post('/api/video/batches', { cameras: files.map(file => ({ filename: file.name, sizeBytes: file.bytes.length })) });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}
async function upload(batch, index, file) {
  const result = await json(`/api/video/batches/${batch.batchId}/cameras/${batch.cameras[index].cameraId}`, {
    method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name), 'X-EdgeVision-Synthetic-Test': 'true', 'Content-Type': 'application/octet-stream' }, body: file.bytes
  });
  return result;
}
async function wait(batchId) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const result = await json(`/api/video/batches/${batchId}`);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    if (!['draft', 'processing', 'simulation_running'].includes(result.body.status)) return result.body;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Timed out waiting for the camera batch.');
}
function comparison(batch, expectedCounts, expectedIntervals) {
  assert.equal(batch.simulation.status, 'completed', JSON.stringify(batch));
  assert.equal(batch.simulation.workloadProfile.cameraCount, expectedCounts.length);
  assert.equal(batch.simulation.workloadProfile.tupleCount, expectedCounts.reduce((a, b) => a + b, 0));
  const actual = batch.simulation.cloud.workloadProfile;
  assert.deepEqual(actual, batch.simulation.edge.workloadProfile);
  assert.equal(actual.jobId, batch.batchId);
  assert.equal(actual.type, 'multi_video');
  assert.equal(actual.simulatedVideoFramesSent, false);
  assert.equal(new Set(actual.sources.map(source => source.cameraId)).size, expectedCounts.length);
  actual.sources.forEach((source, index) => {
    assert.equal(source.tupleCount, expectedCounts[index]);
    assert.equal(source.generatedTuples, expectedCounts[index]);
    assert.equal(source.processedTuples, expectedCounts[index]);
    assert.equal(source.tupleIntervalSeconds, expectedIntervals[index]);
    assert.equal(source.sourceClassification, 'synthetic_test');
    assert.equal(source.tupleIntervalsMatchProfile, true);
    assert.ok(source.maxIntervalDeviationSeconds < 1e-7);
  });
}
async function main() {
  if (process.argv[3] === '--recover') {
    const batchId = process.argv[4];
    const result = await json(`/api/video/batches/${batchId}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.status, 'completed', JSON.stringify(result.body));
    comparison(result.body, [20, 12], [0.1, 0.25]);
    for (const camera of result.body.cameras) {
      const report = await json(camera.reportUrl);
      assert.equal(report.status, 200); assert.equal(report.body.jobId, camera.jobId);
      assert.equal(report.body.batchId, batchId); assert.equal(report.body.cameraId, camera.cameraId);
      const status = await json(`/api/video/status/${camera.jobId}`);
      assert.equal(status.body.status, 'analysis_completed');
      assert.equal(status.body.simulationStatus, 'included_in_batch');
      assert.equal(status.body.batchId, batchId);
      const video = await fetch(new URL(`/api/video/output/${camera.jobId}`, base), { headers: { Range: 'bytes=0-31' } });
      assert.equal(video.status, 206); assert.equal((await video.arrayBuffer()).byteLength, 32);
    }
    console.log(`PASS restart recovery: batch ${batchId}, both camera reports/artifacts, unequal traces and paired results`);
    return;
  }
  if (!fs.existsSync(second)) {
    require('node:child_process').execFileSync(path.join(project, 'video_analytics/.venv/Scripts/python.exe'),
      [path.join(project, 'video_analytics/tests/make_multi_camera_fixture.py')], { cwd: project, windowsHide: true });
  }
  const config = await json('/api/video/batches/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.maxCameras, 10);
  assert.equal(config.body.maxCombinedTuples, 100000);
  for (const cameras of [[], [{ filename: 'one.avi', sizeBytes: 10 }], Array.from({ length: 11 }, () => ({ filename: 'x.avi', sizeBytes: 10 })),
    [{ filename: '../bad.avi', sizeBytes: 1 }, { filename: 'x.avi', sizeBytes: 1 }]]) {
    assert.equal((await post('/api/video/batches', { cameras })).status, 400);
  }
  assert.equal((await post('/api/video/batches', { cameras: [{ filename: 'a.avi', sizeBytes: 600 * 1024 * 1024 }, { filename: 'b.avi', sizeBytes: 600 * 1024 * 1024 }] })).status, 413);
  assert.equal((await json(`/api/video/batches/${'f'.repeat(32)}`)).status, 404);
  console.log('PASS batch limits, path/ID validation and all input count bounds');

  const files = [{ name: 'camera-one.avi', bytes: fixture }, { name: 'camera-two.avi', bytes: fs.readFileSync(second) }];
  const full = await create(files);
  assert.notEqual(full.cameras[0].cameraId, full.cameras[1].cameraId);
  assert.equal((await post(`/api/video/batches/${full.batchId}/run`, {})).status, 409);
  assert.equal((await upload(full, 0, files[0])).status, 201);
  assert.equal((await upload(full, 0, files[0])).status, 409);
  assert.equal((await upload(full, 1, files[1])).status, 201);
  assert.equal((await post(`/api/video/batches/${full.batchId}/run`, {})).status, 202);
  assert.equal((await post('/api/simulate/both', { cameraCount: 5 })).status, 409);
  assert.equal((await post('/api/video/batches', { cameras: files.map(file => ({ filename: file.name, sizeBytes: file.bytes.length })) })).status, 409);
  const complete = await wait(full.batchId);
  assert.equal(complete.status, 'completed', JSON.stringify(complete));
  comparison(complete, [20, 12], [0.1, 0.25]);
  assert.equal(complete.simulation.workloadProfile.durationSeconds, 3);
  assert.equal(complete.summary.crossCameraReIdentification, false);
  for (const camera of complete.cameras) {
    const report = await json(camera.reportUrl);
    assert.equal(report.status, 200);
    assert.equal(report.body.jobId, camera.jobId);
    assert.ok(report.body.ruleCoverage.note.includes('No regions'));
  }
  console.log('PASS two distinct camera reports, 20+12 independent tuples, 0.1/0.25 s timing, shared cloud/edge profile and busy locks');

  const partialFiles = [{ name: 'valid.avi', bytes: fixture }, { name: 'corrupt.avi', bytes: corrupt }, { name: 'wrong.txt', bytes: fixture }];
  const partial = await create(partialFiles);
  assert.equal((await upload(partial, 0, partialFiles[0])).status, 201);
  assert.equal((await upload(partial, 1, partialFiles[1])).status, 201);
  assert.equal((await upload(partial, 2, partialFiles[2])).status, 415);
  assert.equal((await post(`/api/video/batches/${partial.batchId}/run`, {})).status, 202);
  const partialDone = await wait(partial.batchId);
  assert.equal(partialDone.status, 'partial_success', JSON.stringify(partialDone));
  assert.deepEqual(partialDone.cameras.map(camera => camera.status), ['completed', 'analysis_failed', 'upload_failed']);
  comparison(partialDone, [20], [0.1]);
  assert.equal(partialDone.simulation.workloadProfile.requestedCameraCount, 3);
  console.log('PASS decode failure and unsupported file remain visible; only the successful camera enters the paired comparison');

  const failedFiles = partialFiles.slice(1);
  const failed = await create(failedFiles);
  await upload(failed, 0, failedFiles[0]); await upload(failed, 1, failedFiles[1]);
  assert.equal((await post(`/api/video/batches/${failed.batchId}/run`, {})).status, 202);
  const failedDone = await wait(failed.batchId);
  assert.equal(failedDone.status, 'failed');
  assert.equal(failedDone.simulation.workloadProfile, null);
  assert.equal(failedDone.simulation.cloud, null);
  assert.equal(failedDone.simulation.edge, null);
  assert.equal(fs.existsSync(path.join(project, 'results/video_batches', failed.batchId)), false);
  console.log('PASS all-invalid batch produces no combined simulation or stale fallback');

  const simulationFailure = await create(files);
  await upload(simulationFailure, 0, files[0]); await upload(simulationFailure, 1, files[1]);
  const script = path.join(project, 'simulation/run.ps1');
  const held = `${script}.stage3-test-held`;
  assert.equal(fs.existsSync(held), false, 'Another test is holding the simulation script.');
  fs.renameSync(script, held);
  let simulationFailed;
  try {
    assert.equal((await post(`/api/video/batches/${simulationFailure.batchId}/run`, {})).status, 202);
    simulationFailed = await wait(simulationFailure.batchId);
    assert.equal(simulationFailed.status, 'simulation_failed');
    assert.equal(simulationFailed.simulation.cloud, null); assert.equal(simulationFailed.simulation.edge, null);
    for (const camera of simulationFailed.cameras) {
      assert.equal(camera.status, 'completed');
      assert.equal((await json(camera.reportUrl)).status, 200);
    }
  } finally { fs.renameSync(held, script); }
  console.log('PASS forced combined simulation failure preserves both successful camera reports');
  const evidence = { completedAt: new Date().toISOString(), type: 'synthetic_multi_recording_validation',
    completeBatchId: complete.batchId, partialBatchId: partialDone.batchId, failedBatchId: failedDone.batchId,
    simulationFailureBatchId: simulationFailed.batchId,
    complete: { cameraCount: 2, tupleCounts: [20, 12], intervals: [0.1, 0.25], totalTuples: 32, maxDuration: 3 },
    partial: { selected: 3, included: 1, statuses: partialDone.cameras.map(camera => camera.status), totalTuples: 20 },
    detectionAccuracyValidated: false };
  const evidencePath = path.join(project, 'results/validation/stage4-integration.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`RECOVERY_BATCH_ID=${complete.batchId}`);
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

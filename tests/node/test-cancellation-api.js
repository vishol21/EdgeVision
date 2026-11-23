/* Run only against a server in the same disposable OS-temp project copy. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
assert.ok(root.startsWith(path.resolve(os.tmpdir()) + path.sep), 'Use an isolated OS-temp project copy.');
assert.equal(process.env.EDGEVISION_ISOLATED_TESTS, '1', 'Explicit isolated-test opt-in is required.');
const base = process.argv[2]; assert.ok(base);
const bytes = fs.readFileSync(path.join(root, 'video_analytics/tests/fixtures/synthetic_test_clip.avi'));
const id = () => randomUUID().replaceAll('-', '');
async function api(route, body) {
  const r = await fetch(base + route, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function upload() {
  const jobId = id();
  const r = await fetch(base + '/api/video/upload', { method: 'POST', headers: { 'X-Job-Id': jobId, 'X-File-Name': 'test.avi' }, body: bytes });
  assert.equal(r.status, 201); return jobId;
}
async function until(route, terminal) {
  for (let i = 0; i < 600; i++) {
    const result = await api(route); assert.equal(result.status, 200);
    if (terminal(result.body)) return result.body;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Timed out waiting for ' + route);
}
async function main() {
  assert.equal((await api('/api/video/cancel/' + id(), {})).status, 404);
  // A partially transferred upload can be stopped, not merely hidden in the UI.
  const uploading = id();
  const request = http.request(base + '/api/video/upload', { method: 'POST', headers: {
    'X-Job-Id': uploading, 'X-File-Name': 'test.avi', 'Content-Length': bytes.length
  } });
  request.on('error', () => {}); request.write(bytes.subarray(0, 16));
  try {
    await until('/api/video/status/' + uploading, result => result.status === 'uploading');
    assert.equal((await api('/api/video/cancel/' + uploading, {})).status, 202);
    await until('/api/video/status/' + uploading, result => result.status === 'cancelled');
    assert.equal(fs.existsSync(path.join(root, 'video_analytics/uploads', uploading + '.avi')), false);
  } finally { request.destroy(); }
  console.log('PASS interrupted upload cancellation and staged-file removal');

  const job = await upload();
  assert.equal((await api('/api/video/analyze', { jobId: job, frameInterval: 2 })).status, 400);
  assert.equal((await api('/api/video/analyze', { jobId: job, frameInterval: 3 })).status, 202);
  assert.equal((await api('/api/video/cancel/' + job, {})).status, 202);
  await until('/api/video/status/' + job, result => result.status === 'cancelled');
  assert.equal((await api('/api/health')).body.videoAnalysisRunning, false);
  assert.equal((await api('/api/video/analyze', { jobId: job })).status, 409);
  console.log('PASS active Python cancellation, sampling validation and compute-lock release');

  const cameras = [{ filename: 'one.avi', sizeBytes: bytes.length }, { filename: 'two.avi', sizeBytes: bytes.length }];
  const draft = (await api('/api/video/batches', { cameras })).body;
  assert.equal((await api('/api/video/batches/' + draft.batchId + '/cancel', {})).status, 202);
  assert.equal((await api('/api/video/batches/' + draft.batchId)).body.status, 'cancelled');
  assert.equal((await api('/api/video/batches/' + draft.batchId + '/run', {})).status, 409);
  const batch = (await api('/api/video/batches', { cameras, frameInterval: 3 })).body;
  for (const camera of batch.cameras) {
    const r = await fetch(base + `/api/video/batches/${batch.batchId}/cameras/${camera.cameraId}`, {
      method: 'POST', headers: { 'X-File-Name': camera.filename }, body: bytes });
    assert.equal(r.status, 201);
  }
  assert.equal((await api('/api/video/batches/' + batch.batchId + '/run', {})).status, 202);
  assert.equal((await api('/api/video/batches/' + batch.batchId + '/cancel', {})).status, 202);
  const stopped = await until('/api/video/batches/' + batch.batchId, result => result.status === 'cancelled');
  assert.ok(stopped.cameras.every(camera => ['cancelled', 'completed'].includes(camera.status)));
  assert.equal((await api('/api/health')).body.videoAnalysisRunning, false);
  assert.equal(fs.existsSync(path.join(root, 'results/video_batches', batch.batchId)), false);
  console.log('PASS draft and active batch cancellation without starting later cameras');

  // Delay only the disposable copy's simulation to make the phase deterministic.
  const script = path.join(root, 'simulation/run.ps1'); const original = fs.readFileSync(script);
  const held = path.join(root, 'simulation/test-original-run.ps1');
  fs.writeFileSync(held, original, { flag: 'wx' });
  fs.writeFileSync(script, "Start-Sleep -Seconds 12\n& (Join-Path $PSScriptRoot 'test-original-run.ps1') @args\n");
  try {
    const simulationJob = await upload();
    assert.equal((await api('/api/video/analyze', { jobId: simulationJob, frameInterval: 3 })).status, 202);
    const stage = await until('/api/video/status/' + simulationJob, result => result.status === 'simulation_running');
    assert.equal(stage.analysisStatus, 'completed');
    assert.equal((await api('/api/video/cancel/' + simulationJob, {})).status, 202);
    const cancelled = await until('/api/video/status/' + simulationJob, result => result.status === 'cancelled');
    assert.equal(cancelled.analysisStatus, 'completed');
    assert.equal((await api('/api/video/results/' + simulationJob)).status, 200);
    assert.equal((await api('/api/health')).body.simulationRunning, false);
    console.log('PASS simulation cancellation preserves analytics and releases the compute lock');
    fs.writeFileSync(script, original);
    const reportPath = path.join(root, 'video_analytics/outputs', simulationJob, 'report.json');
    const profilePath = path.join(root, 'video_analytics/outputs/workloads', simulationJob + '.json');
    const hash = name => createHash('sha256').update(fs.readFileSync(name)).digest('hex');
    const before = [hash(reportPath), hash(profilePath)];
    // Explicit invalid fixtures exercise byte-preserving retry history; these
    // are not represented as genuine simulation measurements.
    const resultDir = path.join(root, 'results/video_workloads', simulationJob);
    fs.mkdirSync(resultDir, { recursive: true });
    for (const scenario of ['cloud', 'edge']) fs.writeFileSync(path.join(resultDir, scenario + '.json'), JSON.stringify({ testFixture: 'incomplete ' + scenario }));
    assert.equal((await api('/api/video/simulation/' + simulationJob + '/retry', {})).status, 202);
    await until('/api/video/status/' + simulationJob, result => result.status === 'completed');
    const retried = (await api('/api/video/simulation/' + simulationJob)).body;
    assert.equal(retried.cloud.metrics.processedTuples, 7);
    assert.equal(retried.edge.metrics.processedTuples, 7);
    assert.deepEqual([hash(reportPath), hash(profilePath)], before);
    const histories = fs.readdirSync(path.join(resultDir, 'history')); assert.equal(histories.length, 1);
    for (const scenario of ['cloud', 'edge']) assert.deepEqual(JSON.parse(fs.readFileSync(path.join(resultDir, 'history', histories[0], scenario + '.json'))), { testFixture: 'incomplete ' + scenario });
    assert.equal((await api('/api/video/simulation/' + simulationJob + '/retry', {})).status, 409);
    assert.equal((await api('/api/video/simulation/' + id() + '/retry', {})).status, 404);
    console.log('PASS comparison-only retry, complete counts, unchanged analytics/profile, preserved failed files and retry guards');
  } finally { fs.writeFileSync(script, original); fs.unlinkSync(held); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

/* Integration checks for the existing EdgeVision server. Run while npm start is active.
   The synthetic clip checks processing plumbing only; it contains no labeled people/vehicles. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const baseUrl = process.argv[2] || 'http://127.0.0.1:4173';
const projectRoot = path.resolve(__dirname, '../..');
const fixturePath = path.join(projectRoot, 'video_analytics', 'tests', 'fixtures', 'synthetic_test_clip.avi');
const resultsDir = path.join(projectRoot, 'results');
const sourceResults = new Map(['cloud', 'edge'].map(scenario => [
  scenario,
  fs.existsSync(path.join(resultsDir, `${scenario}.json`))
    ? fs.readFileSync(path.join(resultsDir, `${scenario}.json`)) : null
]));

async function json(url, options) {
  const response = await fetch(new URL(url, baseUrl), options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function oversizedUpload(maxBytes) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL('/api/video/upload', baseUrl), {
      method: 'POST',
      headers: {
        'X-File-Name': 'oversized.avi',
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(maxBytes + 1)
      }
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body || '{}') }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function main() {
  const health = await json('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.videoAnalyticsAvailable, true);
  console.log('PASS health and Python environment availability');

  const recoveryJobId = process.env.EDGEVISION_RECOVERY_JOB_ID;
  if (recoveryJobId) {
    assert.match(recoveryJobId, /^[a-f0-9]{32}$/);
    const recoveredStatus = await json(`/api/video/status/${recoveryJobId}`);
    assert.equal(recoveredStatus.response.status, 200, JSON.stringify(recoveredStatus.body));
    assert.equal(recoveredStatus.body.status, 'completed');
    const recoveredAnalytics = await json(`/api/video/results/${recoveryJobId}`);
    const recoveredComparison = await json(`/api/video/simulation/${recoveryJobId}`);
    assert.equal(recoveredAnalytics.response.status, 200);
    assert.equal(recoveredComparison.response.status, 200);
    assert.equal(recoveredAnalytics.body.jobId, recoveryJobId);
    assert.equal(recoveredComparison.body.jobId, recoveryJobId);
    assert.equal(recoveredComparison.body.cloud.workloadProfile.jobId, recoveryJobId);
    assert.equal(recoveredComparison.body.edge.workloadProfile.jobId, recoveryJobId);
    assert.equal(recoveredComparison.body.cloud.workloadProfile.generatedTuples,
      recoveredComparison.body.edge.workloadProfile.generatedTuples);
    assert.equal(recoveredComparison.body.cloud.metrics.processedTuples,
      recoveredComparison.body.workloadProfile.tupleCount);
    assert.equal(recoveredComparison.body.edge.metrics.processedTuples,
      recoveredComparison.body.workloadProfile.tupleCount);
    for (const scenario of ['cloud', 'edge']) {
      const saved = JSON.parse(fs.readFileSync(path.join(resultsDir, 'video_workloads', recoveryJobId, `${scenario}.json`), 'utf8'));
      assert.deepEqual(recoveredComparison.body[scenario], saved);
    }
    const standalone = await json('/api/results');
    assert.equal(standalone.response.status, 200);
    assert.notEqual(standalone.body.cloud.workloadProfile?.jobId, recoveryJobId);
    assert.notEqual(standalone.body.edge.workloadProfile?.jobId, recoveryJobId);
    console.log(`PASS recovered completed video comparison ${recoveryJobId} from private job-scoped files`);
  }

  const indexResponse = await fetch(new URL('/', baseUrl));
  const indexHtml = await indexResponse.text();
  assert.equal((indexHtml.match(/class="nav-link(?: active)?"/g) || []).length, 3);
  assert.doesNotMatch(indexHtml, /href="#infrastructure"/);
  console.log('PASS three-section navigation');

  const fixture = fs.readFileSync(fixturePath);
  const badUpload = await json('/api/video/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'not-a-video.mp4' },
    body: fixture
  });
  assert.equal(badUpload.response.status, 415);
  console.log('PASS invalid container rejection');

  const settings = JSON.parse(fs.readFileSync(path.join(projectRoot, 'video_analytics', 'config', 'settings.json'), 'utf8'));
  const tooLarge = await oversizedUpload(settings.upload.max_file_size_bytes);
  assert.equal(tooLarge.status, 413);
  console.log('PASS declared file-size limit');

  const upload = await json('/api/video/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'synthetic_test_clip.avi', 'X-EdgeVision-Synthetic-Test': 'true' },
    body: fixture
  });
  assert.equal(upload.response.status, 201, JSON.stringify(upload.body));
  const { jobId } = upload.body;
  assert.match(jobId, /^[a-f0-9]{32}$/);
  console.log('PASS synthetic video upload');

  const started = await json('/api/video/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId })
  });
  assert.equal(started.response.status, 202, JSON.stringify(started.body));
  console.log('PASS analysis start (background Python process)');

  const concurrentSimulation = await json('/api/simulate/cloud', { method: 'POST' });
  assert.equal(concurrentSimulation.response.status, 409);
  console.log('PASS simulation is blocked during video processing');

  let status;
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = await json(`/api/video/status/${jobId}`);
    assert.equal(current.response.status, 200);
    status = current.body;
    assert.equal(status.progress, null);
    if (status.status === 'completed' || status.status === 'simulation_failed' || status.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  assert.equal(status?.status, 'completed', status?.simulationError || status?.analysisError || 'Analysis timed out.');
  assert.equal(status.analysisStatus, 'completed');
  assert.equal(status.simulationStatus, 'completed');
  console.log('PASS overall job completes only after analysis and both simulations');

  const workloadPath = path.join(projectRoot, 'video_analytics', 'outputs', 'workloads', `${jobId}.json`);
  assert.equal(JSON.parse(fs.readFileSync(workloadPath, 'utf8')).jobId, jobId);
  console.log('PASS Python workload profile is generated for the API job ID');

  const result = await json(`/api/video/results/${jobId}`);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'completed');
  assert.equal(result.body.jobId, jobId);
  assert.equal(typeof result.body.eventCount, 'number');
  assert.equal(result.body.video.outputUrl, `/api/video/output/${jobId}`);
  assert.doesNotMatch(JSON.stringify(result.body), /[A-Za-z]:\\Users\\/);
  console.log('PASS actual result retrieval and private-path filtering');

  const profileComparison = await json(`/api/video/simulation/${jobId}`);
  assert.equal(profileComparison.response.status, 200);
  assert.equal(profileComparison.body.status, 'completed');
  assert.equal(profileComparison.body.workloadProfile.sourceClassification, 'synthetic_test');
  assert.equal(profileComparison.body.workloadProfile.jobId, jobId);
  assert.equal(profileComparison.body.cloud.workloadProfile.jobId, jobId);
  assert.equal(profileComparison.body.edge.workloadProfile.jobId, jobId);
  assert.equal(profileComparison.body.cloud.workloadProfile.generatedTuples, profileComparison.body.edge.workloadProfile.generatedTuples);
  assert.equal(profileComparison.body.cloud.workloadProfile.generatedTuples, profileComparison.body.workloadProfile.tupleCount);
  assert.equal(profileComparison.body.cloud.metrics.processedTuples, profileComparison.body.edge.metrics.processedTuples);
  assert.equal(profileComparison.body.cloud.workloadProfile.simulatedVideoFramesSent, false);
  assert.ok(Number.isFinite(profileComparison.body.cloud.metrics.wallClockMillis));
  console.log('PASS job-scoped cloud/edge comparison uses the same profile and tuple count');

  const downloadedReport = await fetch(new URL(`/api/video/results/${jobId}?download=1`, baseUrl));
  assert.equal(downloadedReport.status, 200);
  assert.match(downloadedReport.headers.get('content-disposition') || '', /attachment/);
  assert.equal(JSON.parse(await downloadedReport.text()).jobId, result.body.jobId);
  console.log('PASS JSON report download');

  const playback = await fetch(new URL(`/api/video/output/${jobId}`, baseUrl), { headers: { Range: 'bytes=0-31' } });
  assert.equal(playback.status, 206);
  assert.equal((await playback.arrayBuffer()).byteLength, 32);
  console.log('PASS annotated video playback range');

  const invalidEvidence = await fetch(new URL(`/api/video/evidence/${jobId}/${'0'.repeat(32)}`, baseUrl));
  assert.equal(invalidEvidence.status, 404);
  console.log('PASS evidence route rejects IDs without a real report event (synthetic fixture produced none)');

  const invalidJob = await json(`/api/video/status/${'f'.repeat(32)}`);
  assert.equal(invalidJob.response.status, 404);
  const invalidSimulationJob = await json(`/api/video/simulation/${'f'.repeat(32)}`);
  assert.equal(invalidSimulationJob.response.status, 404);
  console.log('PASS invalid job IDs cannot access video or simulation results');

  const failedUpload = await json('/api/video/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'synthetic_test_clip.avi', 'X-EdgeVision-Synthetic-Test': 'true' },
    body: fixture
  });
  assert.equal(failedUpload.response.status, 201, JSON.stringify(failedUpload.body));
  const failedJobId = failedUpload.body.jobId;
  const scriptPath = path.join(projectRoot, 'simulation', 'run.ps1');
  const heldScriptPath = `${scriptPath}.stage3-test-held`;
  fs.renameSync(scriptPath, heldScriptPath);
  try {
    const failedStart = await json('/api/video/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: failedJobId })
    });
    assert.equal(failedStart.response.status, 202, JSON.stringify(failedStart.body));
    let failedStatus;
    const failureDeadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < failureDeadline) {
      const current = await json(`/api/video/status/${failedJobId}`);
      failedStatus = current.body;
      if (failedStatus.status === 'simulation_failed' || failedStatus.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    assert.equal(failedStatus?.status, 'simulation_failed', failedStatus?.analysisError || 'Simulation failure was not reported.');
    assert.equal(failedStatus.analysisStatus, 'completed');
    assert.equal(failedStatus.simulationStatus, 'failed');
    const preserved = await json(`/api/video/results/${failedJobId}`);
    assert.equal(preserved.response.status, 200);
    assert.equal(preserved.body.jobId, failedJobId);
    const failedComparison = await json(`/api/video/simulation/${failedJobId}`);
    assert.equal(failedComparison.response.status, 200);
    assert.equal(failedComparison.body.status, 'failed');
    assert.equal(failedComparison.body.cloud, null);
    assert.equal(failedComparison.body.edge, null);
    console.log('PASS simulation failure is separate and preserves successful video analytics');
  } finally {
    if (fs.existsSync(heldScriptPath)) fs.renameSync(heldScriptPath, scriptPath);
  }

  const indexAfter = await fetch(new URL('/', baseUrl)).then(response => response.text());
  assert.match(indexAfter, /profile-run-info/);
  assert.match(indexAfter, /SIMULATION RUN TIME \(WALL CLOCK\)/);
  assert.match(indexAfter, /id="camera-count" type="range" min="1" max="10" step="1" value="5"/);
  assert.match(indexAfter, /100 ms for 15 seconds/);
  const appSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'js', 'app.js'), 'utf8');
  assert.match(appSource, /Source video duration/);
  assert.match(appSource, /CAMERA_TUPLES_PER_SOURCE = CAMERA_DURATION_SECONDS \* 1000 \/ CAMERA_INTERVAL_MS/);
  assert.match(appSource, /count \* CAMERA_TUPLES_PER_SOURCE/);
  assert.match(appSource, /const cameraCount = Number\(cameraCountInput\.value\)/);
  assert.doesNotMatch(appSource, /simulationTimeSeconds/);
  console.log('PASS comparison UI has profile context and wall-clock labeling, without presenting stop time as duration');

  const bothResults = await json('/api/results');
  assert.equal(bothResults.response.status, 200);
  for (const scenario of ['cloud', 'edge']) {
    if (sourceResults.get(scenario) === null) assert.equal(bothResults.body[scenario], null);
    else assert.equal(bothResults.body[scenario].scenario, scenario);
  }
  console.log('PASS historical results API supports existing records or a fresh checkout');

  for (const scenario of ['cloud', 'edge']) {
    const run = await json(`/api/simulate/${scenario}`, { method: 'POST' });
    assert.equal(run.response.status, 200, JSON.stringify(run.body));
    assert.equal(run.body.scenario, scenario);
    assert.ok(Number.isFinite(run.body.metrics.loopLatencyMs));
    assert.equal(run.body.workloadProfile.virtualCameraSources, 5);
    assert.equal(run.body.workloadProfile.tupleCount, 750);
    assert.equal(run.body.workloadProfile.sourceIds.length, 5);
    console.log(`PASS existing ${scenario} simulation API uses the default five-camera workload`);
  }

  for (const cameraCount of [0, 11]) {
    const rejected = await json('/api/simulate/cloud', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameraCount })
    });
    assert.equal(rejected.response.status, 400);
  }
  console.log('PASS camera counts outside 1–10 are rejected');

  for (const cameraCount of [1, 5, 10]) {
    const expectedTupleCount = cameraCount * 150;
    const both = await json('/api/simulate/both', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameraCount })
    });
    assert.equal(both.response.status, 200, JSON.stringify(both.body));
    for (const scenario of ['cloud', 'edge']) {
      const result = both.body[scenario];
      assert.equal(result.scenario, scenario);
      assert.equal(result.workloadProfile.virtualCameraSources, cameraCount);
      assert.equal(result.workloadProfile.durationSeconds, 15);
      assert.equal(result.workloadProfile.tupleIntervalMs, 100);
      assert.equal(result.workloadProfile.tuplesPerCamera, 150);
      assert.equal(result.workloadProfile.tupleCount, expectedTupleCount);
      assert.equal(result.workloadProfile.sourceIds.length, cameraCount);
      assert.equal(new Set(result.workloadProfile.sourceIds).size, cameraCount);
      assert.equal(result.metrics.processedTuples, expectedTupleCount);
    }
    assert.match(both.body.cloud.workloadProfile.workloadProfileId, /^[a-f0-9]{32}$/);
    assert.deepEqual(both.body.cloud.workloadProfile, both.body.edge.workloadProfile);
    console.log(`PASS ${cameraCount} cameras produce ${expectedTupleCount} matching tuples in both scenarios`);
  }
}

main().catch(error => {
  console.error(`FAIL ${error.stack || error.message}`);
  process.exitCode = 1;
}).finally(() => {
  for (const [scenario, bytes] of sourceResults) {
    const resultPath = path.join(resultsDir, `${scenario}.json`);
    if (bytes === null) fs.rmSync(resultPath, { force: true });
    else fs.writeFileSync(resultPath, bytes);
  }
});

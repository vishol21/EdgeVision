'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMultiVideoApi } = require('../../backend/multi-video');

test('batch status exposes active camera progress without rewriting its saved manifest', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edgevision-progress-'));
  const jobs = new Map();
  let release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const api = createMultiVideoApi({
    outputsRoot: path.join(root, 'outputs'), resultsRoot: path.join(root, 'results'),
    settings: { upload: { max_file_size_bytes: 100 } },
    isBusy: () => false, setBusy() {}, safeError: message => message,
    readJsonBody: async req => req.body,
    sendJson: (res, status, body) => Object.assign(res, { status, body }),
    uploadVideo: async (req, res) => {
      const job = { jobId: String(jobs.size + 1).repeat(32), message: 'Processing frame 25 of about 100.',
        frameProgress: { decodedFrames: 25, sourceFrames: 100, processedFrames: 9 } };
      jobs.set(job.jobId, job);
      Object.assign(res, { status: 201, body: { jobId: job.jobId } });
      return job;
    },
    getVideoJob: async id => jobs.get(id),
    analyzeVideo: async () => { entered(); await held; return { analysisStatus: 'failed', error: 'Intentional test fixture failure.' }; }
  });
  const request = async (method, url, body, headers = {}) => {
    const res = {}; await api.handle({ method, body, headers }, res, url); return res;
  };
  const created = await request('POST', '/api/video/batches', { cameras: [{ filename: 'a.avi', sizeBytes: 1 }, { filename: 'b.avi', sizeBytes: 1 }] });
  assert.equal(created.status, 201);
  const id = created.body.batchId;
  try {
    for (const c of created.body.cameras) {
      assert.equal((await request('POST', `/api/video/batches/${id}/cameras/${c.cameraId}`, null,
        { 'x-file-name': c.filename, 'content-length': '1' })).status, 201);
    }
    assert.equal((await request('POST', `/api/video/batches/${id}/run`)).status, 202);
    await started;
    const filename = path.join(root, 'outputs/batches', id, 'batch.json');
    const before = fs.readFileSync(filename);
    const view = await request('GET', `/api/video/batches/${id}`);
    assert.equal(view.body.cameras[0].frameProgress.decodedFrames, 25);
    assert.match(view.body.message, /Recording 1\/2.*Processing frame 25/);
    assert.deepEqual(fs.readFileSync(filename), before);
  } finally {
    release();
    let finalized = false;
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      if ((await request('GET', `/api/video/batches/${id}`)).body.status === 'failed') { finalized = true; break; }
    }
    assert.ok(finalized, 'Wait for final persistence before removing owned fixtures.');
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edgevision-progress-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

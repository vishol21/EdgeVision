/* Run app.js against a small DOM harness to exercise response ordering and failure
   paths deterministically. Real browser and simulator checks remain separate. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  set innerHTML(value) { this._innerHTML = value; this.children = []; }
  get innerHTML() { return this._innerHTML || ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; this._innerHTML = ''; }
  querySelector() { return { textContent: 'ms' }; }
  emit(name, event = {}) { return this.listeners[name]?.(event); }
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const flush = () => new Promise(resolve => setImmediate(resolve));
function result(scenario, count = 5, id = 'a'.repeat(32)) {
  return {
    scenario,
    metrics: { loopLatencyMs: 12, analyticsLatencyMs: 3, networkUsageMb: 4, energyJoules: 5,
      processedTuples: count * 150, wallClockMillis: 6 },
    workloadProfile: { type: 'standalone_virtual_camera', workloadProfileId: id,
      virtualCameraSources: count, tupleCount: count * 150, durationSeconds: 15,
      tupleIntervalMs: 100, tuplesPerCamera: 150,
      sourceIds: Array.from({ length: count }, (_, i) => `camera-${i}`) }
  };
}

function harness(handler = async () => response({ status: 'ok' })) {
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const buttons = ['cloud', 'edge', 'both'].map(action => {
    const element = get(`[data-run="${action}"]`);
    element.dataset = { run: action };
    return element;
  });
  get('#camera-count').value = '5';
  const calls = [];
  const charts = [];
  class Chart {
    constructor(canvas, config) { this.data = config.data; charts.push(this); }
    update() {}
  }
  const context = {
    document: { querySelector: get, querySelectorAll: selector => selector === '[data-run]' ? buttons : [],
      createElement: () => new Element(), createTextNode: text => ({ textContent: text }) },
    window: { Chart }, Chart,
    fetch: async (url, options) => {
      calls.push(url);
      if (url === '/api/video/batches/config') return response({ maxCameras: 10, maxFileBytes: 524288000, maxTotalBytes: 1073741824, maxCombinedTuples: 100000 });
      return handler(url, options);
    },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout, console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'js/app.js'), 'utf8'), context);
  return { get, buttons, calls, charts,
    run: action => get(`[data-run="${action}"]`).emit('click'),
    empty() {
      assert.equal(get('[data-metric="latency"]').children[0].textContent, '—');
      assert.match(get('#results-table-body').innerHTML, /No simulation results yet/);
      assert.equal(get('#results-table-body').children.length, 0);
      for (const chart of charts) assert.ok(chart.data.datasets[0].data.every(value => value === null));
    }
  };
}

test('fresh page and refresh never request historical results; controls are neutral', async () => {
  for (let refresh = 0; refresh < 2; refresh++) {
    const ui = harness();
    await flush();
    ui.empty();
    assert.deepEqual(ui.calls, ['/api/health', '/api/video/batches/config']);
    ui.buttons.forEach(button => assert.equal(button.attributes['aria-pressed'], 'false'));
  }
});

test('a new run clears cards/charts/table; camera changes clear results and selection', async () => {
  let pending;
  const ui = harness(async url => url.endsWith('/health') ? response({ status: 'ok' }) : pending.promise);
  pending = deferred();
  const first = ui.run('cloud');
  ui.empty();
  assert.equal(ui.get('#run-status').textContent, 'Running');
  pending.resolve(response(result('cloud')));
  await first;
  assert.equal(ui.get('#run-status').textContent, 'Complete');
  assert.equal(ui.get('[data-metric="latency"]').children[0].textContent, '12');
  pending = deferred();
  const second = ui.run('edge');
  ui.empty();
  pending.resolve(response(result('edge')));
  await second;
  ui.get('#camera-count').value = '6';
  ui.get('#camera-count').emit('input');
  ui.empty();
  assert.equal(ui.get('#expected-camera-tuples').textContent, '900');
  assert.equal(ui.get('#run-status').textContent, 'Ready');
  ui.buttons.forEach(button => assert.equal(button.attributes['aria-pressed'], 'false'));
});

test('failed runs leave an empty Failed state without fetching saved results', async () => {
  const ui = harness(async url => url.endsWith('/health') ? response({ status: 'ok' }) : response({ message: 'Run failed' }, false));
  await ui.run('both');
  ui.empty();
  assert.equal(ui.get('#run-status').textContent, 'Failed');
  assert.equal(ui.get('#run-feedback').textContent, 'Run failed');
  assert.ok(!ui.calls.includes('/api/results'));
});

test('mismatched pair or wrong camera count publishes neither scenario', async () => {
  for (const edge of [result('edge', 5, 'b'.repeat(32)), result('edge', 6), { scenario: 'edge' }]) {
    const ui = harness(async url => url.endsWith('/health') ? response({ status: 'ok' }) : response({ cloud: result('cloud'), edge }));
    await ui.run('both');
    ui.empty();
    assert.equal(ui.get('#run-status').textContent, 'Failed');
  }
});

test('an obsolete run and delayed health response cannot overwrite a newer run', async () => {
  const health = deferred();
  const old = deferred();
  let runs = 0;
  const ui = harness(async url => url.endsWith('/health') ? health.promise : ++runs === 1 ? old.promise : response(result('edge', 6)));
  const first = ui.run('cloud');
  ui.get('#camera-count').value = '6';
  ui.get('#camera-count').emit('input');
  await ui.run('edge');
  old.resolve(response(result('cloud')));
  health.resolve(response({ message: 'Unavailable' }, false));
  await first;
  await flush();
  assert.equal(ui.get('#run-status').textContent, 'Complete');
  assert.equal(ui.buttons[1].attributes['aria-pressed'], 'true');
  assert.equal(ui.buttons[0].attributes['aria-pressed'], 'false');
  assert.equal(ui.get('#results-table-body').children[0].children[1].textContent, 'Not run');
});

test('video comparison stays selected until explicit switch; switching back restores only that job', async () => {
  const id = 'c'.repeat(32);
  const profile = { jobId: id, video: { durationSeconds: 1 }, virtualCameraSources: 1,
    tupleCount: 150, tupleGenerationIntervalSeconds: 0.1 };
  const simulation = { jobId: id, status: 'completed', workloadProfile: profile,
    cloud: result('cloud', 1), edge: result('edge', 1) };
  simulation.cloud.workloadProfile.jobId = id;
  simulation.edge.workloadProfile.jobId = id;
  const ui = harness(async url => {
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url.endsWith('/upload')) return response({ jobId: id });
    if (url.endsWith('/analyze')) return response({});
    if (url.includes('/status/')) return response({ status: 'completed', analysisStatus: 'completed' });
    if (url.includes('/results/')) return response({ jobId: id, processing: {}, eventCount: 0 });
    if (url.includes('/simulation/')) return response(simulation);
    return response(result('cloud'));
  });
  ui.get('#video-file').files = [{ name: 'fixture.avi', size: 100 }];
  ui.get('#video-file').emit('change');
  await ui.get('#analyze-button').emit('click');
  assert.match(ui.get('#results-note').textContent, new RegExp(id));
  assert.equal(ui.buttons[0].disabled, true);
  const requestCount = ui.calls.length;
  await ui.run('cloud');
  assert.equal(ui.calls.length, requestCount);
  ui.get('#camera-count').emit('input');
  assert.match(ui.get('#results-note').textContent, new RegExp(id));
  ui.get('#comparison-mode-button').emit('click');
  ui.empty();
  await ui.run('cloud');
  ui.get('#comparison-mode-button').emit('click');
  assert.match(ui.get('#results-note').textContent, new RegExp(id));
  assert.equal(ui.buttons[0].disabled, true);
  ui.buttons.forEach(button => assert.equal(button.attributes['aria-pressed'], 'false'));
});

test('batch response renders combined results only for the selected complete camera identities', async () => {
  for (const wrongIdentity of [false, true]) {
    const batchId = 'd'.repeat(32);
    const cameras = ['e', 'f'].map((character, index) => ({ cameraId: character.repeat(32), jobId: String(index + 1).repeat(32),
      filename: `camera-${index}.avi`, status: 'completed', reportUrl: `/api/video/results/${String(index + 1).repeat(32)}` }));
    const sources = cameras.map((camera, index) => ({ cameraId: camera.cameraId, jobId: camera.jobId, tupleCount: index ? 12 : 20 }));
    const simulation = { jobId: batchId, status: 'completed', workloadProfile: { type: 'multi_video', jobId: batchId,
      cameraCount: 2, requestedCameraCount: 2, durationSeconds: 3, tupleCount: 32, sources } };
    for (const scenario of ['cloud', 'edge']) {
      simulation[scenario] = result(scenario);
      simulation[scenario].metrics.processedTuples = 32;
      simulation[scenario].workloadProfile = { type: 'multi_video', jobId: batchId, virtualCameraSources: 2,
        tupleCountFromProfile: 32, generatedTuples: 32,
        sources: sources.map(source => ({ ...source, processedTuples: source.tupleCount })) };
    }
    if (wrongIdentity) simulation.edge.workloadProfile.sources[0].cameraId = 'a'.repeat(32);
    const batch = { batchId, status: 'completed', message: 'Camera analyses and comparison completed.', cameras,
      simulation, summary: { objectCountsByClass: {}, eventCount: 0, processingDurationSecondsSum: 1 } };
    const ui = harness(async url => {
      if (url.endsWith('/health')) return response({ status: 'ok' });
      if (url === '/api/video/batches') return response({ batchId, message: 'Upload cameras.', cameras: cameras.map(camera => ({ ...camera, status: 'awaiting_upload' })) });
      if (url.includes('/cameras/')) return response({ status: 'uploaded' });
      return response(batch);
    });
    ui.get('#batch-files').files = [{ name: 'a.avi', size: 100 }, { name: 'b.avi', size: 100 }];
    ui.get('#batch-files').emit('change');
    await ui.get('#analyze-batch-button').emit('click');
    assert.equal(ui.get('#run-status').textContent, wrongIdentity ? 'Failed' : 'Complete');
    if (wrongIdentity) {
      assert.equal(ui.get('[data-metric="latency"]').children[0].textContent, '—');
      assert.ok(ui.charts.every(chart => chart.data.datasets[0].data.every(value => value === null)));
    } else {
      assert.equal(ui.get('[data-metric="latency"]').children[0].textContent, '12');
      assert.match(ui.get('#batch-summary').textContent, /32 combined tuples/);
      assert.equal(ui.get('#batch-recovery-id').value, batchId);
      assert.equal(ui.buttons[0].disabled, true);
    }
  }
});

test('all-failed batch has neutral metrics, clear terminal context and no saved-result fallback', async () => {
  const batchId = 'b'.repeat(32);
  const cameras = ['c', 'd'].map((letter, index) => ({ cameraId: letter.repeat(32), jobId: null,
    filename: `bad-${index}.txt`, status: 'upload_failed', error: 'Unsupported video format.' }));
  const batch = { batchId, status: 'failed', message: 'No camera analysis succeeded. No combined simulation was run.', cameras,
    error: 'All selected camera inputs failed.', simulation: { jobId: batchId, status: 'not_started', workloadProfile: null, cloud: null, edge: null } };
  const ui = harness(async url => {
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url === '/api/video/batches') return response({ ...batch, status: 'draft', cameras: cameras.map(camera => ({ ...camera, status: 'awaiting_upload' })) });
    if (url.includes('/cameras/')) return response({ message: 'Unsupported video format.' }, false);
    return response(batch);
  });
  ui.get('#batch-recovery-id').value = batchId;
  await ui.get('#recover-batch-button').emit('click');
  assert.equal(ui.get('#run-status').textContent, 'Failed');
  assert.match(ui.get('#profile-run-info').textContent, /No camera analysis succeeded/);
  assert.equal(ui.get('[data-metric="latency"]').children[0].textContent, '—');
  assert.equal(ui.get('#results-table-body').children[0].children[1].textContent, 'Not run');
  assert.ok(!ui.calls.includes('/api/results'));
});

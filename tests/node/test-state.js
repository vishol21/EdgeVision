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
  removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; this._innerHTML = ''; }
  querySelector() { return { textContent: 'ms' }; }
  emit(name, event = {}) { return this.listeners[name]?.(event); }
  click() { return this.emit('click'); }
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

function harness(handler = async () => response({ status: 'ok' }), { chartsAvailable = true, reducedMotion = false } = {}) {
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
  const blobs = [];
  let submittedBatch = null;
  const charts = [];
  class Chart {
    constructor(canvas, config) { this.data = config.data; this.options = config.options; charts.push(this); }
    update() {}
  }
  const context = {
    document: { querySelector: get, querySelectorAll: selector => selector === '[data-run]' ? buttons : [],
      createElement: () => new Element(), createTextNode: text => ({ textContent: text }) },
    window: { Chart: chartsAvailable ? Chart : undefined, matchMedia: () => ({ matches: reducedMotion }) }, Chart,
    fetch: async (url, options) => {
      calls.push(url);
      if (submittedBatch && options?.method === 'POST') {
        if (url === '/api/video/batches') return response(submittedBatch);
        if (url.includes('/cameras/')) return response({ status: 'uploaded' });
        if (url.endsWith('/run')) return response({ status: 'processing' });
      }
      if (url === '/api/video/batches/config') return response({ maxCameras: 10, maxFileBytes: 524288000, maxTotalBytes: 1073741824, maxCombinedTuples: 100000 });
      return handler(url, options);
    },
    Blob,
    URL: { createObjectURL: value => { blobs.push(value); return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout, console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8'), context);
  return { get, buttons, calls, charts, blobs,
    showBatch: async id => {
      // Exercise the supported picker -> upload -> run -> poll flow.
      const example = recoveredBatch();
      submittedBatch = { ...example, batchId: id, status: 'draft', cameras: example.cameras.map(c => ({ ...c, status: 'awaiting_upload' })) };
      get('#batch-files').files = submittedBatch.cameras.map(c => ({ name: c.filename, size: 100 }));
      get('#batch-files').emit('change');
      await get('#analyze-batch-button').emit('click');
      submittedBatch = null;
    },
    run: action => get(`[data-run="${action}"]`).emit('click'),
    empty() {
      assert.equal(get('[data-metric="latency"]').children[0].textContent, '—');
      assert.match(get('#results-table-body').innerHTML, /No simulation results yet/);
      assert.equal(get('#results-table-body').children.length, 0);
      for (const chart of charts) assert.ok(chart.data.datasets[0].data.every(value => value === null));
    }
  };
}

test('cancel during upload stops before analysis starts and restores controls', async () => {
  const upload = deferred(); let id;
  const ui = harness(async (url, options) => {
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url.endsWith('/video/upload')) { id = options.headers['X-Job-Id']; return upload.promise; }
    if (url.includes('/video/cancel/')) return response({ status: 'cancelled' });
    if (url.includes('/video/status/')) return response({ status: 'cancelled' });
    return response({});
  });
  ui.get('#video-file').files = [{ name: 'example.avi', size: 100 }];
  ui.get('#video-file').emit('change');
  const analysis = ui.get('#analyze-button').emit('click'); await flush();
  assert.match(id, /^[a-f0-9]{32}$/);
  assert.equal(ui.get('#cancel-analysis').hidden, false);
  await ui.get('#cancel-analysis').emit('click');
  upload.resolve(response({ jobId: id })); await analysis;
  assert.equal(ui.get('#run-status').textContent, 'Cancelled');
  assert.equal(ui.get('#analyze-button').disabled, false);
  assert.ok(!ui.calls.includes('/api/video/analyze'));
});

test('track details are ordered, paged and filtered; readable report retains limitations', async () => {
  const batch = recoveredBatch();
  const tracks = Array.from({ length: 24 }, (_, i) => ({ trackingId: i + 1, objectClass: i < 20 ? 'car' : 'person', firstSeenSeconds: i, lastSeenSeconds: i + 2 }));
  const ui = harness(async url => {
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url.includes('/batches/')) return response(batch);
    const camera = batch.cameras.find(c => url.endsWith(c.jobId));
    return response({ jobId: camera.jobId, sourceName: 'example.avi', processing: {}, events: [], trackingSummaries: tracks,
      objectCountsByClass: { person: { uniqueTrackingIds: 4 }, car: { uniqueTrackingIds: 20 } } });
  });
  await ui.showBatch(batch.batchId);
  assert.equal(ui.get('#tracking-table').children.length, 10);
  assert.equal(ui.get('#tracking-table').children[0].children[1].textContent, 'person');
  ui.get('#tracks-next').emit('click'); assert.match(ui.get('#track-page-info').textContent, /Page 2 of 3/);
  ui.get('#track-filter').value = 'person'; ui.get('#track-filter').emit('change');
  assert.equal(ui.get('#tracking-table').children.length, 4);
  ui.get('#readable-report').emit('click');
  const text = await ui.blobs.find(value => value instanceof Blob).text();
  assert.match(text, /People tracks: 4/); assert.match(text, /Vehicle tracks: 20/);
  assert.match(text, /does not confirm robbery/);
});

test('review timestamps seek playback and an unsupported codec has a useful fallback', async () => {
  const batch = recoveredBatch();
  const ui = harness(async url => {
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url.includes('/batches/')) return response(batch);
    const camera = batch.cameras.find(c => url.endsWith(c.jobId));
    return response({ jobId: camera.jobId, video: { outputUrl: `/api/video/output/${camera.jobId}` }, processing: {}, eventCount: 1,
      ruleCoverage: { reviewSuggestionsEnabled: true, reviewSuggestionCount: 1, reviewSuggestionLimit: 1 },
      events: [{ event_type: 'rapid_movement_review', timestamp_seconds: 2, object_class: 'person', details: { reason: 'Review image motion.' } }] });
  });
  await ui.showBatch(batch.batchId);
  assert.match(ui.get('#video-rule-note').textContent, /limit was reached/);
  const player = ui.get('#saved-video'); player.play = () => Promise.reject(new Error('Unsupported codec'));
  const details = ui.get('#event-list').children[0].children[0];
  details.children.at(-1).emit('click'); await flush();
  assert.equal(player.currentTime, 2);
  assert.equal(ui.get('#saved-video-error').hidden, false);
  assert.match(ui.get('#saved-video-error').textContent, /Open or download/);
});

test('legacy person sightings are excluded while specific incident cues and counts agree', async () => {
  const batch = recoveredBatch();
  const ui = harness(async url => {
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url.includes('/batches/')) return response(batch);
    const camera = batch.cameras.find(c => url.endsWith(c.jobId));
    return response({ jobId: camera.jobId, processing: {}, eventCount: 3,
      events: [
        { event_type: 'person_visible', timestamp_seconds: 0, object_class: 'person' },
        { event_type: 'possible_fall_review', timestamp_seconds: 2, object_class: 'person' },
        { event_type: 'possible_vehicle_collision_review', timestamp_seconds: 3, object_class: 'car' }
      ] });
  });
  await ui.showBatch(batch.batchId);
  assert.equal(ui.get('#event-total').textContent, '2');
  assert.equal(ui.get('#event-list').children.length, 2);
  assert.match(ui.get('#event-list').children[0].children[0].children[0].textContent, /Possible person fall/);
  assert.match(ui.get('#event-list').children[1].children[0].children[0].textContent, /Possible vehicle collision/);
  ui.get('#readable-report').emit('click');
  const text = await ui.blobs.find(value => value instanceof Blob).text();
  assert.doesNotMatch(text, /person_visible/);
  assert.match(text, /possible_vehicle_collision_review/);
});

test('fresh page and refresh never request historical results; controls are neutral', async () => {
  for (let refresh = 0; refresh < 2; refresh++) {
    const ui = harness();
    await flush();
    ui.empty();
    assert.deepEqual(ui.calls, ['/api/health', '/api/video/batches/config']);
    ui.buttons.forEach(button => assert.equal(button.attributes['aria-pressed'], 'false'));
  }
});

test('batch picker accumulates visits, removes individual files, enforces both bounds and clears', async () => {
  const ui = harness();
  const choose = files => { ui.get('#batch-files').files = files; ui.get('#batch-files').emit('change'); };
  choose([{ name: 'a.avi', size: 100 }]);
  assert.equal(ui.get('#analyze-batch-button').disabled, true);
  assert.match(ui.get('#batch-status').textContent, /Add another/);
  choose([{ name: 'b.avi', size: 100 }]);
  assert.equal(ui.get('#analyze-batch-button').disabled, false);
  assert.equal(ui.get('#batch-camera-table').children.length, 2);
  assert.match(ui.get('#batch-camera-table').children[0].children[0].textContent, /a.avi/);
  choose(Array.from({ length: 9 }, (_, i) => ({ name: `extra-${i}.avi`, size: 100 })));
  assert.equal(ui.get('#analyze-batch-button').disabled, true);
  assert.match(ui.get('#batch-status').textContent, /11 recordings.*2-10/);
  ui.get('#batch-camera-table').children[0].children[2].children[0].emit('click');
  assert.equal(ui.get('#batch-camera-table').children.length, 10);
  assert.equal(ui.get('#analyze-batch-button').disabled, false);
  choose([]); assert.equal(ui.get('#batch-camera-table').children.length, 10);
  ui.get('#clear-batch-selection').emit('click');
  assert.equal(ui.get('#analyze-batch-button').disabled, true);
  assert.equal(ui.get('#clear-batch-selection').disabled, true);
  assert.match(ui.get('#batch-summary').textContent, /0 recordings/);
});

function recoveredBatch() {
  const id = 'd'.repeat(32);
  const cameras = ['e', 'f'].map((x, i) => ({ cameraId: x.repeat(32), jobId: String(i+1).repeat(32), filename: `saved-${i}.avi`, status: 'completed', reportUrl: `/api/video/results/${String(i+1).repeat(32)}` }));
  const sources = cameras.map(c => ({ cameraId: c.cameraId, jobId: c.jobId, tupleCount: 20 }));
  const simulation = { jobId: id, status: 'completed', workloadProfile: { type: 'multi_video', jobId: id, cameraCount: 2, requestedCameraCount: 2, durationSeconds: 2, tupleCount: 40, sources } };
  for (const s of ['cloud','edge']) {
    simulation[s] = result(s); simulation[s].metrics.processedTuples = 40;
    simulation[s].workloadProfile = { type: 'multi_video', jobId:id, virtualCameraSources:2, tupleCountFromProfile:40, generatedTuples:40, sources:sources.map(c=>({...c,processedTuples:20})) };
  }
  return { batchId:id, status:'completed', message:'Recovered completed batch.', cameras, simulation, summary:{eventCount:0} };
}

test('completed batch loads all reports and saved playback, clears stale content and supports camera switching', async () => {
  const batch = recoveredBatch();
  const ui = harness(async url => {
    if (url.endsWith('/health')) return response({status:'ok'});
    if (url.includes('/batches/')) return response(batch);
    const camera = batch.cameras.find(c => url.endsWith(c.jobId));
    if (url.includes('/results/')) return response({ jobId:camera.jobId, batchId:batch.batchId, cameraId:camera.cameraId, video:{outputUrl:`/api/video/output/${camera.jobId}`}, processing:{}, events:[] });
    return response({});
  });
  ui.get('#video-report-context').textContent='Unrelated old report';
  await ui.showBatch(batch.batchId);
  assert.equal(ui.get('#run-status').textContent,'Complete');
  assert.equal(ui.calls.filter(x=>x.includes('/video/results/')).length,2);
  assert.match(ui.get('#video-report-context').textContent,new RegExp(batch.cameras[0].jobId));
  assert.equal(ui.get('#saved-video').src,`/api/video/output/${batch.cameras[0].jobId}`);
  assert.equal(ui.get('#saved-video-download').href,`/api/video/output/${batch.cameras[0].jobId}`);
  await ui.get('#batch-camera-table').children[1].children[2].children[0].emit('click');
  assert.equal(ui.get('#saved-video').src,`/api/video/output/${batch.cameras[1].jobId}`);
  assert.match(ui.get('#results-note').textContent,new RegExp(batch.batchId));
});

test('missing saved artifacts are visible and do not restore an unrelated report', async () => {
  const batch=recoveredBatch();
  const ui=harness(async url=>url.endsWith('/health')?response({status:'ok'}):url.includes('/batches/')?response(batch):response({message:'Saved artifact missing'},false));
  ui.get('#video-report-context').textContent='Unrelated old report';
  await ui.showBatch(batch.batchId);
  assert.equal(ui.get('#video-results').hidden,true);
  assert.equal(ui.get('#video-report-context').textContent,'');
  assert.equal(ui.get('#batch-error').hidden,false);
  assert.match(ui.get('#batch-error').textContent,/artifact missing/);
  assert.match(ui.get('#batch-status').textContent,/missing or invalid/);
});

test('late camera requests and background report loading do not replace the most recently chosen report', async () => {
  const batch=recoveredBatch(), pending=new Map();
  const ui=harness(async url=>{
    if(url.endsWith('/health')) return response({status:'ok'});
    if(url.includes('/batches/')) return response(batch);
    const wait=deferred(); const list=pending.get(url)||[];list.push(wait);pending.set(url,list);return wait.promise;
  });
  const recovery=ui.showBatch(batch.batchId); await flush();
  const first=ui.get('#batch-camera-table').children[0].children[2].children[0].emit('click');
  const second=ui.get('#batch-camera-table').children[1].children[2].children[0].emit('click');
  const reply=(camera,index)=>pending.get(camera.reportUrl)[index].resolve(response({jobId:camera.jobId,processing:{},events:[]}));
  reply(batch.cameras[1],1);await second;
  reply(batch.cameras[0],1);await first;
  reply(batch.cameras[0],0);reply(batch.cameras[1],0);await recovery;
  assert.match(ui.get('#video-report-context').textContent,new RegExp(batch.cameras[1].jobId));
});

test('unavailable saved video is reported while another camera report still restores', async () => {
  const batch=recoveredBatch();
  const ui=harness(async url=>{
    if(url.endsWith('/health'))return response({status:'ok'});
    if(url.includes('/batches/'))return response(batch);
    const camera=batch.cameras.find(c=>url.endsWith(c.jobId));
    if(url.includes('/results/'))return response({jobId:camera.jobId,video:{outputUrl:`/api/video/output/${camera.jobId}`},processing:{},events:[]});
    return response({},camera.jobId!==batch.cameras[0].jobId);
  });
  await ui.showBatch(batch.batchId);
  assert.equal(ui.get('#run-status').textContent,'Recovery incomplete');
  assert.match(ui.get('#batch-error').textContent,/annotated video is missing/);
  assert.match(ui.get('#video-report-context').textContent,new RegExp(batch.cameras[1].jobId));
  assert.equal(ui.get('#results-table-body').children.length,2);
});

test('manual batch reload controls are removed from the dashboard', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../frontend/index.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
  assert.doesNotMatch(html + source, /batch-recovery-id|recover-batch-button/);
});

test('active batch displays the current camera frame progress', async () => {
  const batch = recoveredBatch();
  let polls = 0;
  const ui = harness(async url => {
    if (url.endsWith('/health')) return response({ status: 'ok' });
    if (url.includes('/batches/')) {
      if (polls++ === 2) return response({ ...batch, status: 'processing', message: 'Recording 1/2: Processing frame 25 of about 100.',
        cameras: batch.cameras.map((c, i) => ({ ...c, status: i ? 'uploaded' : 'processing', frameProgress: i ? null : { decodedFrames: 25, sourceFrames: 100, processedFrames: 9 } })) });
      return response(batch);
    }
    const camera = batch.cameras.find(c => url.endsWith(c.jobId));
    return response({ jobId: camera.jobId, processing: {}, events: [] });
  });
  const run = ui.showBatch(batch.batchId);
  await flush(); await flush();
  assert.match(ui.get('#batch-camera-table').children[0].children[1].textContent, /Analyzing.*frame 25 of 100; 9 samples/);
  assert.match(ui.get('#batch-status').textContent, /Recording 1\/2/);
  await run;
});

test('cancelled camera rows explain cancellation instead of showing unavailable', async () => {
  const batch = recoveredBatch();
  batch.status = 'cancelled';
  batch.cameras = batch.cameras.map(c => ({ ...c, status: 'cancelled' }));
  const ui = harness(async url => response(url.endsWith('/health') ? { status: 'ok' } : batch));
  await ui.showBatch(batch.batchId);
  assert.equal(ui.get('#batch-camera-table').children[0].children[1].textContent, 'Cancelled');
});

test('raw simulator values retain units across cards, table, chart axes and tooltips', async () => {
  const ui = harness(async url => url.endsWith('/health') ? response({ status: 'ok' }) : response(result('edge')), { reducedMotion: true });
  await ui.run('edge');
  assert.equal(ui.get('[data-metric="latency"]').children[0].textContent, '12');
  assert.equal(ui.get('[data-metric="latency"]').children[1].textContent, 'sim units');
  assert.equal(ui.get('[data-metric="analyticsLatency"]').children[1].textContent, 'sim units');
  assert.equal(ui.get('[data-metric="runtime"]').children[1].textContent, 'ms');
  assert.equal(ui.get('#results-table-body').children[1].children[2].textContent, '12');
  assert.match(ui.get('#metric-context').textContent, /Edge-based/);
  assert.equal(ui.charts[0].data.datasets[0].data[1], 12);
  assert.equal(ui.charts[0].options.scales.y.title.text, 'sim units');
  assert.equal(ui.charts[0].options.plugins.tooltip.callbacks.label({ parsed: { y: 12 } }), 'Full-loop latency: 12 sim units');
  assert.equal(ui.charts[0].options.animation, false);
});

test('missing chart library leaves cards, table and controls working with a visible notice', async () => {
  const ui = harness(async url => url.endsWith('/health') ? response({ status: 'ok' }) : response(result('cloud')), { chartsAvailable: false });
  await ui.run('cloud');
  assert.equal(ui.get('#chart-status').hidden, false);
  assert.match(ui.get('#chart-status').textContent, /results table remain available/);
  assert.equal(ui.get('.chart-grid').hidden, true);
  assert.equal(ui.get('[data-metric="latency"]').children[0].textContent, '12');
  assert.equal(ui.get('#results-table-body').children[0].children[2].textContent, '12');
  assert.equal(ui.get('#run-status').textContent, 'Complete');
  assert.equal(ui.buttons[0].disabled, false);
  ui.get('#camera-count').value = '6'; ui.get('#camera-count').emit('input'); ui.empty();
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

test('decoder errors show an actionable retry message while unrelated video errors remain intact', async () => {
  for (const message of ['OpenCV assertion at decoder; could not decode', 'Model weights are unavailable.']) {
    const ui = harness(async url => {
      if (url.endsWith('/health')) return response({ status: 'ok' });
      if (url.endsWith('/upload')) return response({ jobId: 'a'.repeat(32) });
      if (url.endsWith('/analyze')) return response({});
      return response({ status: 'failed', analysisStatus: 'failed', analysisError: message });
    });
    ui.get('#video-file').files = [{ name: 'corrupt.avi', size: 100 }];
    ui.get('#video-file').emit('change');
    await ui.get('#analyze-button').emit('click');
    assert.equal(ui.get('#video-error').hidden, false);
    assert.equal(ui.get('#run-status').textContent, 'Failed');
    assert.equal(ui.get('#analyze-button').disabled, false);
    if (message.startsWith('OpenCV')) {
      assert.match(ui.get('#video-error').textContent, /re-encode/);
      assert.doesNotMatch(ui.get('#video-error').textContent, /assertion/);
    } else assert.equal(ui.get('#video-error').textContent, message);
  }
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
      if (url.includes('/api/video/results/')) {
        const camera = cameras.find(item => url.endsWith(item.jobId));
        return response({ jobId: camera.jobId, batchId, cameraId: camera.cameraId, processing: {}, events: [] });
      }
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
      assert.match(ui.get('#batch-summary').textContent, new RegExp(batchId));
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
  await ui.showBatch(batchId);
  assert.equal(ui.get('#run-status').textContent, 'Failed');
  assert.match(ui.get('#profile-run-info').textContent, /No camera analysis succeeded/);
  assert.equal(ui.get('[data-metric="latency"]').children[0].textContent, '—');
  assert.equal(ui.get('#results-table-body').children[0].children[1].textContent, 'Not run');
  assert.ok(!ui.calls.includes('/api/results'));
});

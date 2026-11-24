(() => {
  'use strict';

  const API_ROOT = '/api';
  const CAMERA_INTERVAL_MS = 100;
  const CAMERA_DURATION_SECONDS = 15;
  const CAMERA_TUPLES_PER_SOURCE = CAMERA_DURATION_SECONDS * 1000 / CAMERA_INTERVAL_MS;
  const state = {
    results: { cloud: null, edge: null },
    statuses: { cloud: 'Not run', edge: 'Not run' },
    latestScenario: null,
    running: false,
    placementSelection: null,
    charts: {},
    comparisonMode: 'standalone',
    comparisonVersion: 0,
    batchFiles: [],
    batch: null,
    batchReports: {},
    batchReportErrors: {},
    reportVersion: 0,
    operation: null,
    trackPage: 0,
    batchLimits: { maxCameras: 10, maxTotalBytes: 1073741824, maxFileBytes: 524288000, maxCombinedTuples: 100000 },
    video: { file: null, previewUrl: null, jobId: null, report: null, reportJobId: null, workloadProfile: null, simulationStatus: 'not_started', simulationError: null, comparison: null }
  };
  const buttons = [...document.querySelectorAll('[data-run]')];
  const cameraCountInput = document.querySelector('#camera-count');
  const cameraCountValue = document.querySelector('#camera-count-value');
  const expectedCameraTuples = document.querySelector('#expected-camera-tuples');
  const statusText = document.querySelector('#run-status');
  const statusDetail = document.querySelector('#run-detail');
  const feedback = document.querySelector('#run-feedback');
  const progress = document.querySelector('#progress-track');
  const comparisonModeButton = document.querySelector('#comparison-mode-button');

  const format = (value, digits = 2) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
    : '—';

  function renderControls() {
    const profileSelected = state.comparisonMode === 'profile';
    document.querySelector('.scenario-description strong').textContent = profileSelected
      ? 'Standalone virtual-camera controls (inactive for recording comparisons)' : 'Choose a placement strategy';
    buttons.forEach(button => { button.disabled = state.running || profileSelected; });
    cameraCountInput.disabled = state.running || profileSelected;
    analyzeButton.disabled = state.running || !state.video.file;
    const retryButton = document.querySelector('#retry-comparison');
    retryButton.hidden = !state.video.report || state.video.reportJobId !== state.video.jobId ||
      state.video.report.batchId || !['failed', 'cancelled'].includes(state.video.simulationStatus);
    retryButton.disabled = state.running;
    document.querySelector('#analysis-mode').disabled = state.running;
    for (const [id, kind] of [['#cancel-analysis', 'single'], ['#cancel-batch', 'batch']]) {
      const button = document.querySelector(id);
      button.hidden = !state.running || state.operation?.kind !== kind;
      button.disabled = Boolean(state.operation?.cancelRequested);
    }
    batchButton.disabled = state.running || Boolean(batchSelectionError());
    document.querySelector('#clear-batch-selection').disabled = state.running || !state.batchFiles.length;
    batchFileInput.disabled = state.running;
    comparisonModeButton.hidden = !state.video.comparison;
    comparisonModeButton.disabled = state.running;
    comparisonModeButton.textContent = profileSelected ? 'Use virtual-camera simulation' : 'Show video comparison';
  }

  function setRunning(running, label = '') {
    state.running = running;
    if (running) {
      statusText.textContent = 'Running';
      statusDetail.textContent = label;
    }
    progress.hidden = !running;
    renderControls();
  }

  function setPlacementSelection(selection) {
    state.placementSelection = selection;
    buttons.forEach(button => {
      const selected = button.dataset.run === selection;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function renderCameraWorkloadSelection() {
    const count = Number(cameraCountInput.value);
    cameraCountValue.value = String(count);
    cameraCountValue.textContent = String(count);
    expectedCameraTuples.textContent = (count * CAMERA_TUPLES_PER_SOURCE).toLocaleString();
  }

  function setFeedback(message, kind = '') {
    feedback.textContent = message;
    feedback.className = `run-feedback${kind ? ` ${kind}` : ''}`;
  }

  function renderSummary() {
    const result = state.latestScenario ? state.results[state.latestScenario] : null;
    const values = {
      latency: result?.metrics.loopLatencyMs,
      analyticsLatency: result?.metrics.analyticsLatencyMs,
      networkUsage: result?.metrics.networkUsageMb,
      energy: result?.metrics.energyJoules,
      runtime: result?.metrics.wallClockMillis
    };
    document.querySelector('#metric-context').textContent = result
      ? `Summary: ${state.latestScenario === 'cloud' ? 'Cloud-only' : 'Edge-based'} scenario. The table and charts compare available scenarios.`
      : 'Summary values appear after a scenario completes.';
    const units = { latency: 'sim units', analyticsLatency: 'sim units', networkUsage: 'MB', energy: 'J', runtime: 'ms' };
    for (const [key, value] of Object.entries(values)) {
      const target = document.querySelector(`[data-metric="${key}"]`);
      const unit = units[key];
      target.replaceChildren(document.createTextNode(format(value)));
      const suffix = document.createElement('small');
      suffix.textContent = unit;
      target.append(suffix);
    }
  }

  function renderTable() {
    const body = document.querySelector('#results-table-body');
    const hasResult = Object.values(state.results).some(Boolean);
    const successfulCount = Object.values(state.results).filter(Boolean).length;
    document.querySelector('#results-note').textContent = state.comparisonMode === 'profile'
      ? `${state.video.workloadProfile?.type === 'multi_video' || state.batch?.batchId === state.video.jobId ? 'Recording batch' : 'Video job'} ${state.video.jobId} · ${state.video.simulationStatus}`
      : (hasResult ? `${successfulCount} completed standalone scenario${successfulCount === 1 ? '' : 's'}` : 'No simulation results yet');

    if (!hasResult && state.comparisonMode !== 'profile') {
      body.innerHTML = '<tr><td class="empty-state" colspan="8">No simulation results yet</td></tr>';
      return;
    }

    body.replaceChildren();
    for (const [key, label] of [['cloud', 'Cloud-only'], ['edge', 'Edge-based']]) {
      const record = state.results[key];
      const metrics = record?.metrics;
      const values = metrics
        ? [label, state.statuses[key], format(metrics.loopLatencyMs), format(metrics.analyticsLatencyMs), format(metrics.networkUsageMb), format(metrics.energyJoules), format(metrics.processedTuples, 0), format(metrics.wallClockMillis, 0)]
        : [label, state.statuses[key], '—', '—', '—', '—', '—', '—'];
      const row = document.createElement('tr');
      values.forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      });
      body.append(row);
    }
  }

  function renderProfileRunInfo() {
    const target = document.querySelector('#profile-run-info');
    if (state.comparisonMode !== 'profile' || !state.video.jobId) {
      target.textContent = 'Standalone scenario results are not associated with a video-analysis job.';
      return;
    }
    const profile = state.video.workloadProfile;
    if (!profile) {
      target.textContent = state.batch?.batchId === state.video.jobId && ['failed', 'interrupted', 'simulation_failed'].includes(state.batch.status)
        ? `Recording batch ${state.video.jobId}: no combined comparison is available. ${state.batch.message}`
        : `Video job ${state.video.jobId}: waiting for a validated workload profile.`;
      return;
    }
    if (profile.type === 'multi_video') {
      target.textContent = `Recording batch ${profile.jobId}: ${profile.cameraCount} analyzed cameras of ${profile.requestedCameraCount} selected; ${format(profile.tupleCount, 0)} tuples; longest recording ${format(profile.durationSeconds)} s. Each camera retains its own interval and identity. Successful cameras only; excluded cameras are listed in the batch table. CPU and payload values use each profile's declared assumptions. Actual frames are not sent to iFogSim.`;
      return;
    }
    const parts = [
      `Source video duration ${format(profile.video.durationSeconds)} s`,
      `${format(profile.virtualCameraSources, 0)} virtual camera${profile.virtualCameraSources === 1 ? '' : 's'}`,
      `${format(profile.tupleCount, 0)} generated tuples`,
      `${format(profile.tupleGenerationIntervalSeconds)} s tuple interval`
    ];
    if (profile.sourceClassification === 'synthetic_test') parts.push('SYNTHETIC TEST PROFILE');
    const cpuAssumption = profile.cpuDemand?.videoAnalyzerMI == null
      ? 'CPU MI uses existing Java simulation assumptions'
      : 'CPU MI uses profile calibration estimates';
    const payloadAssumption = profile.tuplePayloadBytes == null
      ? 'payload sizes use existing Java simulation assumptions'
      : 'camera payload uses a configured profile assumption';
    parts.push(`${cpuAssumption}; ${payloadAssumption}`);
    parts.push('Actual video frames are not sent to iFogSim.');
    target.textContent = `${parts.join(' · ')}. Job ${profile.jobId}.`;
  }

  function renderCharts() {
    const unavailable = !window.Chart;
    const notice = document.querySelector('#chart-status');
    notice.hidden = !unavailable;
    notice.textContent = unavailable ? 'Charts could not load. Metric cards and the results table remain available. Reload to try loading charts again.' : '';
    document.querySelector('.chart-grid').hidden = unavailable;
    if (unavailable) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const definitions = [
      ['latency', 'loopLatencyMs', '#83a9ff', 'Full-loop latency', 'sim units'],
      ['analytics-latency', 'analyticsLatencyMs', '#b2bfd2', 'Detector arrival', 'sim units'],
      ['network', 'networkUsageMb', '#63c9c1', 'Modeled payload traffic', 'MB'],
      ['energy', 'energyJoules', '#b2bfd2', 'Modeled device energy', 'J']
    ];
    for (const [chartId, metric, color, label, unit] of definitions) {
      const canvas = document.querySelector(`#${chartId}-chart`);
      const data = [state.results.cloud?.metrics[metric] ?? null, state.results.edge?.metrics[metric] ?? null];
      if (state.charts[chartId]) {
        state.charts[chartId].data.datasets[0].data = data;
        state.charts[chartId].update();
        continue;
      }
      state.charts[chartId] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: ['Cloud-only', 'Edge-based'],
          datasets: [{ label, data, backgroundColor: [`${color}70`, `${color}c0`], borderColor: color, borderWidth: 1, borderRadius: 3, barThickness: 22 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reducedMotion ? false : { duration: 250 },
          plugins: { legend: { display: false }, tooltip: { callbacks: {
            label: context => `${label}: ${format(context.parsed.y)} ${unit}`
          } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#9aa9bc', font: { size: 12 } }, border: { color: '#26364c' } },
            y: { beginAtZero: true, title: { display: true, text: unit, color: '#9aa9bc', font: { size: 12 } }, grid: { color: '#26364c' }, ticks: { color: '#9aa9bc', font: { size: 12 } }, border: { display: false } }
          }
        }
      });
    }
  }

  function setRecord(scenario, record) {
    if (!record || record.scenario !== scenario || !record.metrics) return false;
    state.results[scenario] = record;
    state.statuses[scenario] = 'Success';
    return true;
  }

  function clearStandaloneResults() {
    state.comparisonVersion += 1;
    state.results = { cloud: null, edge: null };
    state.statuses = { cloud: 'Not run', edge: 'Not run' };
    state.latestScenario = null;
    setPlacementSelection(null);
    statusText.textContent = 'Ready';
    statusDetail.textContent = 'No simulation run for the selected virtual cameras.';
    setFeedback('Ready. No simulation results yet.');
    renderAll();
  }

  async function requestJson(url, options) {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `API returned HTTP ${response.status}`);
    return body;
  }

  function renderAll() {
    renderSummary();
    renderTable();
    renderCharts();
    renderProfileRunInfo();
    renderControls();
  }

  function selectProfileComparison(jobId) {
    state.comparisonVersion += 1;
    state.comparisonMode = 'profile';
    setPlacementSelection(null);
    state.video.jobId = jobId;
    state.video.workloadProfile = null;
    state.video.simulationStatus = 'pending';
    state.video.simulationError = null;
    state.video.comparison = null;
    state.results = { cloud: null, edge: null };
    state.statuses = { cloud: 'Pending', edge: 'Pending' };
    state.latestScenario = null;
    renderAll();
  }

  function applyVideoSimulation(simulation, jobId) {
    if (!simulation || simulation.jobId !== jobId || state.video.jobId !== jobId) throw new Error('Simulation results do not match the selected video job.');
    if (simulation.status === 'completed' && ['cloud', 'edge'].some(scenario => {
      const record = simulation[scenario];
      return record?.scenario !== scenario || !record.metrics || record.workloadProfile?.jobId !== jobId ||
        record.metrics.processedTuples !== simulation.workloadProfile?.tupleCount;
    })) {
      throw new Error('Cloud and edge results are missing or belong to a different video job.');
    }
    if (simulation.status === 'completed' && simulation.workloadProfile?.type === 'multi_video') {
      const expected = simulation.workloadProfile.sources;
      if (['cloud', 'edge'].some(scenario => {
        const actual = simulation[scenario].workloadProfile;
        return actual.type !== 'multi_video' || actual.virtualCameraSources !== expected.length ||
          actual.tupleCountFromProfile !== simulation.workloadProfile.tupleCount ||
          actual.generatedTuples !== simulation.workloadProfile.tupleCount ||
          !Array.isArray(actual.sources) || actual.sources.length !== expected.length ||
          expected.some((source, index) => actual.sources[index]?.cameraId !== source.cameraId ||
            actual.sources[index]?.jobId !== source.jobId || actual.sources[index]?.processedTuples !== source.tupleCount);
      })) throw new Error('Combined comparison does not match the selected camera sources.');
    }
    state.comparisonVersion += 1;
    state.comparisonMode = 'profile';
    setPlacementSelection(null);
    state.video.comparison = simulation;
    state.video.jobId = jobId;
    state.video.workloadProfile = simulation.workloadProfile || null;
    state.video.simulationStatus = simulation.status;
    state.video.simulationError = simulation.error || null;
    state.results = { cloud: null, edge: null };
    state.latestScenario = null;
    const statusLabel = { completed: 'Success', failed: 'Failed', not_started: 'Not run', pending: 'Pending', running: 'Running' }[simulation.status] || 'Unavailable';
    state.statuses = { cloud: statusLabel, edge: statusLabel };
    if (simulation.status === 'completed') {
      setRecord('cloud', simulation.cloud);
      setRecord('edge', simulation.edge);
      state.latestScenario = 'edge';
    }
    renderAll();
  }

  const videoFileInput = document.querySelector('#video-file');
  const videoDropzone = document.querySelector('#video-dropzone');
  const videoSelection = document.querySelector('#video-selection');
  const videoPreview = document.querySelector('#video-preview');
  const analyzeButton = document.querySelector('#analyze-button');
  const videoStatus = document.querySelector('#video-status');
  const videoProgress = document.querySelector('#video-progress');
  const videoError = document.querySelector('#video-error');
  const videoResults = document.querySelector('#video-results');
  const batchFileInput = document.querySelector('#batch-files');
  const batchButton = document.querySelector('#analyze-batch-button');
  const batchStatus = document.querySelector('#batch-status');
  const batchError = document.querySelector('#batch-error');

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
  }

  function chooseVideo(file) {
    if (!file || state.running) return;
    const allowed = ['.mp4', '.m4v', '.mov', '.avi', '.mkv', '.webm'];
    const extension = `.${file.name.split('.').pop()}`.toLowerCase();
    videoError.hidden = true;
    videoResults.hidden = true;
    state.video.report = null;
    state.video.reportJobId = null;
    if (!allowed.includes(extension)) {
      state.video.file = null;
      analyzeButton.disabled = true;
      videoError.textContent = 'This file extension is not supported. Choose MP4, AVI, MOV, MKV or WebM.';
      videoError.hidden = false;
      return;
    }
    if (state.video.previewUrl) URL.revokeObjectURL(state.video.previewUrl);
    state.video.file = file;
    state.video.previewUrl = URL.createObjectURL(file);
    videoPreview.src = state.video.previewUrl;
    document.querySelector('#selected-filename').textContent = file.name;
    document.querySelector('#selected-filesize').textContent = formatBytes(file.size);
    videoSelection.hidden = false;
    analyzeButton.disabled = false;
    videoStatus.textContent = 'Video ready. Start analysis when you are ready.';
  }

  async function fetchVideoJson(url, options = {}) {
    const response = await fetch(url, { headers: { Accept: 'application/json', ...(options.headers || {}) }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Video API returned HTTP ${response.status}`);
    return body;
  }

  function addCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = value === null || value === undefined ? '—' : String(value);
    row.append(cell);
  }

  function readableVideoError(message) {
    return /opencv|could not decode/i.test(String(message))
      ? 'This recording could not be decoded. Try another supported video or re-encode the recording.'
      : message;
  }

  function batchSelectionError() {
    const count = state.batchFiles.length;
    if (count < 2) return count ? '1 recording selected. Add another recording, or use Start Analysis above for a single video.' : 'Choose at least 2 recordings to begin.';
    if (count > state.batchLimits.maxCameras) return `${count} recordings selected. Remove recordings to keep 2-${state.batchLimits.maxCameras}.`;
    if (state.batchFiles.reduce((sum, file) => sum + file.size, 0) > state.batchLimits.maxTotalBytes) return 'Selected recordings exceed the total batch size limit. Remove recordings before analysis.';
    return '';
  }

  function updateBatchSelection() {
    state.batch = null;
    batchError.hidden = true;
    batchStatus.textContent = batchSelectionError() || `${state.batchFiles.length} recordings ready. You can add more files or start analysis.`;
    renderBatch(); renderControls();
  }

  function clearDisplayedReport() {
    state.reportVersion += 1;
    state.video.report = null; state.video.reportJobId = null;
    videoResults.hidden = true;
    document.querySelector('#video-report-context').textContent = '';
    const player = document.querySelector('#saved-video');
    player.pause?.(); player.removeAttribute?.('src');
    document.querySelector('#saved-video-wrap').hidden = true;
    document.querySelector('#saved-video-error').hidden = true;
    document.querySelector('#saved-video-links').hidden = true;
  }

  async function restoreBatchReports(batch) {
    const reportVersion = state.reportVersion;
    const failures = [];
    const loaded = await Promise.all(batch.cameras.filter(c => c.status === 'completed').map(async camera => {
      try {
        const report = await fetchVideoJson(`/api/video/results/${camera.jobId}`);
        if (report.jobId !== camera.jobId || (report.batchId && report.batchId !== batch.batchId) ||
            (report.cameraId && report.cameraId !== camera.cameraId)) throw new Error('Saved report identity does not match this camera.');
        const url = report.video?.outputUrl;
        if (url) {
          if (url !== `/api/video/output/${camera.jobId}`) throw new Error('Saved video does not match this camera.');
          const media = await fetch(url, { headers: { Range: 'bytes=0-0' } });
          await media.body?.cancel();
          if (!media.ok) throw new Error('Saved annotated video is missing or unavailable.');
        }
        return { camera, report };
      } catch (error) { return { camera, error: readableVideoError(error.message) }; }
    }));
    if (state.video.jobId !== batch.batchId) return;
    state.batchReports = {}; state.batchReportErrors = {};
    for (const entry of loaded) {
      if (entry.error) { state.batchReportErrors[entry.camera.jobId] = entry.error; failures.push(`${entry.camera.filename}: ${entry.error}`); }
      else state.batchReports[entry.camera.jobId] = entry.report;
    }
    renderBatch(batch);
    const first = loaded.find(entry => entry.report);
    if (first && reportVersion === state.reportVersion) renderVideoReport(first.report, first.camera.jobId);
    if (failures.length) {
      batchError.textContent = `Some saved camera artifacts could not be restored. ${failures.join(' ')}`;
      batchError.hidden = false;
      batchStatus.textContent = 'Batch loaded with missing or invalid camera artifacts. Check the errors below.';
      statusText.textContent = 'Recovery incomplete';
      statusDetail.textContent = 'Some saved camera reports or videos could not be restored.';
      setFeedback('The saved batch has unavailable camera artifacts. Check the batch errors.', 'error');
    }
  }

  function renderBatch(batch = null) {
    const table = document.querySelector('#batch-camera-table');
    table.replaceChildren();
    const cameras = batch?.cameras || state.batchFiles.map((file, index) => ({ filename: file.name, cameraId: `Selection ${index + 1}`, status: 'selected' }));
    for (const [index, camera] of cameras.entries()) {
      const row = document.createElement('tr');
      addCell(row, `${camera.filename} · ${camera.cameraId}`);
      const label = { selected: 'Selected', awaiting_upload: 'Waiting for upload', uploading: 'Uploading', uploaded: 'Uploaded',
        processing: 'Analyzing', cancelled: 'Cancelled', completed: 'Analyzed', upload_failed: 'Upload rejected', analysis_failed: 'Analysis failed', interrupted: 'Interrupted' }[camera.status] || 'Unavailable';
      const cameraError = state.batchReportErrors[camera.jobId] || camera.error;
      const progress = camera.frameProgress;
      const progressText = camera.status === 'processing' && progress ? ` — frame ${format(progress.decodedFrames, 0)}${progress.sourceFrames > 0 ? ` of ${format(progress.sourceFrames, 0)}` : ''}; ${format(progress.processedFrames, 0)} samples analyzed` : '';
      addCell(row, cameraError ? `${label}: ${readableVideoError(cameraError)}` : `${label}${progressText}${camera.status === 'processing' && !progress && camera.message ? ` — ${camera.message}` : ''}`);
      const action = document.createElement('td');
      if (camera.status === 'completed') {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'button'; button.textContent = 'View analytics';
        button.addEventListener('click', async () => {
          clearDisplayedReport();
          const reportVersion = state.reportVersion;
          try {
            const report = state.batchReports[camera.jobId] || await fetchVideoJson(camera.reportUrl);
            if (state.video.jobId !== batch.batchId || reportVersion !== state.reportVersion) return;
            if (report.jobId !== camera.jobId) throw new Error('Saved report identity does not match this camera.');
            renderVideoReport(report, camera.jobId);
          }
          catch (error) { batchError.textContent = error.message; batchError.hidden = false; }
        });
        action.append(button);
      } else if (!batch) {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'button'; remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove recording ${index + 1}: ${camera.filename}`);
        remove.disabled = state.running;
        remove.addEventListener('click', () => { if (!state.running) { state.batchFiles.splice(index, 1); updateBatchSelection(); } });
        action.append(remove);
      } else action.textContent = 'Individual report appears after successful analysis.';
      row.append(action); table.append(row);
    }
    if (!cameras.length) table.innerHTML = '<tr><td colspan="3">No camera recordings selected.</td></tr>';
    if (batch) {
      batchStatus.textContent = batch.status === 'cancelled' ? 'Batch cancelled. Completed camera reports are kept. Select recordings and start a new analysis for a combined comparison.' : batch.message;
      const summary = batch.summary;
      const included = batch.cameras.filter(camera => camera.status === 'completed').length;
      const people = summary?.objectCountsByClass?.person || {};
      const vehicleClasses = ['car', 'bus', 'motorcycle'];
      const vehicles = vehicleClasses.reduce((total, name) => total + Number(summary?.objectCountsByClass?.[name]?.uniqueTrackingIds || 0), 0);
      document.querySelector('#batch-summary').textContent = summary
        ? `Batch ${batch.batchId}: ${included}/${batch.cameras.length} recordings analyzed. ${format(batch.simulation.workloadProfile?.tupleCount ?? 0, 0)} combined tuples. People tracks: ${format(people.uniqueTrackingIds || 0, 0)}. Vehicle tracks: ${format(vehicles, 0)}. Review moments: ${format(summary.eventCount, 0)}. Tracks are counted separately in each recording.`
        : `${batch.cameras.length} recordings selected. Camera processing is sequential; failed inputs will remain listed.`;
    } else document.querySelector('#batch-summary').textContent = `${cameras.length} recording${cameras.length === 1 ? '' : 's'} selected.`;
  }

  async function pollBatch(id) {
    while (true) {
      const batch = await fetchVideoJson(`/api/video/batches/${id}`);
      if (state.video.jobId !== id) return;
      state.batch = batch;
      renderBatch(batch);
      state.video.workloadProfile = batch.simulation.workloadProfile;
      state.video.simulationStatus = batch.simulation.status;
      renderAll();
      if (!['draft', 'processing', 'simulation_running'].includes(batch.status)) {
        if (batch.status === 'cancelled') {
          cancelledMessage(); await restoreBatchReports(batch); break;
        }
        applyVideoSimulation(batch.simulation, id);
        const success = ['completed', 'partial_success'].includes(batch.status);
        statusText.textContent = success ? (batch.status === 'partial_success' ? 'Partial success' : 'Complete') : 'Failed';
        statusDetail.textContent = batch.message;
        setFeedback(batch.message, success ? 'success' : 'error');
        if (batch.error) { batchError.textContent = batch.error; batchError.hidden = false; }
        await restoreBatchReports(batch);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1400));
    }
  }

  async function analyzeBatch() {
    if (state.running || batchSelectionError()) return;
    const files = [...state.batchFiles];
    const operation = { kind: 'batch', id: null, cancelRequested: false };
    state.operation = operation;
    batchError.hidden = true;
    clearDisplayedReport(); state.batchReports = {}; state.batchReportErrors = {};
    state.comparisonMode = 'standalone';
    clearStandaloneResults();
    setRunning(true, 'Uploading and analyzing multiple camera recordings.');
    setFeedback('The multi-recording job is running.');
    try {
      const created = await fetchVideoJson('/api/video/batches', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cameras: files.map(file => ({ filename: file.name, sizeBytes: file.size })), frameInterval: Number(document.querySelector('#analysis-mode').value) || 1 }) });
      const id = created.batchId;
      operation.id = id;
      if (operation.cancelRequested) { await finishCancellation(operation); return; }
      selectProfileComparison(id);
      state.batch = created;
      renderBatch(created);
      for (let index = 0; index < files.length; index++) {
        if (operation.cancelRequested) { await finishCancellation(operation); return; }
        const camera = created.cameras[index];
        if (camera.status !== 'awaiting_upload') continue;
        batchStatus.textContent = `Uploading recording ${index + 1}/${files.length}: ${files[index].name}`;
        const response = await fetch(`/api/video/batches/${id}/cameras/${camera.cameraId}`, {
          method: 'POST', headers: { 'X-File-Name': encodeURIComponent(files[index].name), 'Content-Type': 'application/octet-stream' }, body: files[index]
        });
        // Rejected camera uploads are persisted by the server and remain visible in the batch.
        if (!response.ok && ![400, 413, 415].includes(response.status)) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || 'A camera upload could not complete.');
        }
        state.batch = await fetchVideoJson(`/api/video/batches/${id}`);
        renderBatch(state.batch);
      }
      if (operation.cancelRequested) { await finishCancellation(operation); return; }
      await fetchVideoJson(`/api/video/batches/${id}/run`, { method: 'POST' });
      await pollBatch(id);
    } catch (error) {
      if (operation.cancelRequested) {
        try { await finishCancellation(operation); return; }
        catch (cancelError) { error = cancelError; }
      }
      batchError.textContent = error.message; batchError.hidden = false;
      batchStatus.textContent = 'The batch did not complete. Completed camera artifacts remain on the server.';
      statusText.textContent = 'Failed'; statusDetail.textContent = error.message;
      setFeedback('The camera batch did not complete. Check its error.', 'error');
    } finally { state.operation = null; setRunning(false); }
  }

  function renderVideoReport(report, jobId) {
    state.video.report = report;
    state.video.reportJobId = jobId;
    state.trackPage = 0;
    document.querySelector('#video-report-context').textContent = `Recording: ${report.sourceName || 'Saved recording'} · Report ID ${jobId}`;
    const outputUrl = report.video?.outputUrl;
    const player = document.querySelector('#saved-video');
    player.pause?.(); player.removeAttribute?.('src');
    document.querySelector('#saved-video-error').hidden = true;
    const validOutput = outputUrl === `/api/video/output/${jobId}`;
    document.querySelector('#saved-video-wrap').hidden = !validOutput;
    document.querySelector('#saved-video-links').hidden = !validOutput;
    if (validOutput) {
      player.src = outputUrl;
      document.querySelector('#saved-video-open').href = outputUrl;
      document.querySelector('#saved-video-download').href = outputUrl;
      document.querySelector('#saved-video-download').download = `annotated-${jobId}.mp4`;
    }
    const counts = report.objectCountsByClass || {};
    const classes = ['person', 'car', 'bus', 'motorcycle'];
    const detections = name => Number(counts[name]?.trackedObservations || 0);
    const unique = name => Number(counts[name]?.uniqueTrackingIds || 0);
    const vehicleClasses = ['car', 'bus', 'motorcycle'];
    const sum = (names, field) => names.reduce((total, name) => total + Number(counts[name]?.[field] || 0), 0);
    document.querySelector('#people-detections').textContent = format(detections('person'), 0);
    document.querySelector('#people-tracks').textContent = format(unique('person'), 0);
    document.querySelector('#vehicle-detections').textContent = format(sum(vehicleClasses, 'trackedObservations'), 0);
    document.querySelector('#vehicle-tracks').textContent = format(sum(vehicleClasses, 'uniqueTrackingIds'), 0);
    document.querySelector('#video-fps').textContent = format(report.processing?.processingFps);
    document.querySelector('#video-duration').textContent = format(report.processing?.processingDurationSeconds);
    const reviewEvents = (Array.isArray(report.events) ? report.events : []).filter(event => event.event_type !== 'person_visible');
    document.querySelector('#event-total').textContent = format(reviewEvents.length, 0);
    document.querySelector('#analysis-summary').textContent = `${format(unique('person'), 0)} people tracks and ${format(sum(vehicleClasses, 'uniqueTrackingIds'), 0)} vehicle tracks. ${format(reviewEvents.length, 0)} moments marked for review. These are recording-scoped tracks and review suggestions, not confirmed incidents.`;

    const ruleCoverage = report.ruleCoverage || {};
    const note = document.querySelector('#video-rule-note');
    note.textContent = (ruleCoverage.status === 'not_configured' ? 'Scene-specific rules were not set for this recording.' : (ruleCoverage.rulesEnabled?.length
      ? `Rules evaluated: ${ruleCoverage.rulesEnabled.join(', ')}.`
      : 'No scene-specific rules were evaluated.')) + (ruleCoverage.reviewSuggestionsEnabled
        ? ' Movement and posture cues are suggestions for review, not confirmed crimes or accidents. Ordinary person sightings are excluded.'
        : ruleCoverage.reviewSuggestionsEnabled === false ? ' Automatic review markers were disabled for this run.'
          : ' This saved report predates automatic review markers. Analyze a new recording to use them.');
    if (ruleCoverage.reviewSuggestionLimit && ruleCoverage.reviewSuggestionCount >= ruleCoverage.reviewSuggestionLimit) {
      note.textContent += ` The ${ruleCoverage.reviewSuggestionLimit}-marker limit was reached; later moments may not be indexed.`;
    }
    const presenceCount = (report.events || []).filter(event => event.event_type === 'person_visible').length;
    if (presenceCount) note.textContent += ` ${presenceCount} ordinary person sightings from this saved report were excluded from the review list. The original JSON is unchanged; run a new analysis for the newer posture and vehicle-contact checks.`;

    const vehicleBody = document.querySelector('#vehicle-table');
    vehicleBody.replaceChildren();
    for (const name of vehicleClasses) {
      const row = document.createElement('tr');
      addCell(row, name);
      addCell(row, format(detections(name), 0));
      addCell(row, format(unique(name), 0));
      vehicleBody.append(row);
    }

    renderTracks();

    const eventList = document.querySelector('#event-list');
    eventList.replaceChildren();
    const events = reviewEvents;
    if (!events.length) {
      const empty = document.createElement('p');
      empty.className = 'event-empty';
      empty.textContent = events.length === 0
        ? `No review moments were recorded. This does not establish safety.${ruleCoverage.status === 'not_configured' ? ' Scene-specific rules were not configured.' : ''}`
        : 'No event details are available in this report.';
      eventList.append(empty);
    }
    for (const event of events) {
      const card = document.createElement('article');
      card.className = 'event-card';
      if (event.evidenceUrl) {
        const image = document.createElement('img');
        image.src = event.evidenceUrl;
        image.alt = `Evidence frame for ${event.event_type || 'activity event'}`;
        image.loading = 'lazy';
        card.append(image);
      }
      const details = document.createElement('div');
      const title = document.createElement('h4');
      title.textContent = ({ possible_vehicle_collision_review: 'Possible vehicle collision — review required', possible_fall_review: 'Possible person fall — review required', rapid_movement_review: 'Rapid movement — review suggested' })[event.event_type] || String(event.event_type || 'Configured activity rule').replaceAll('_', ' ');
      details.append(title);
      const summary = document.createElement('p');
      const location = event.region?.name ? ` · ${event.region.name}` : '';
      summary.textContent = `${format(event.timestamp_seconds)} s · ${event.object_class || 'unknown class'}${event.tracking_id !== null && event.tracking_id !== undefined ? ` · Track ID ${event.tracking_id}` : ''}${location}`;
      details.append(summary);
      if (event.details?.reason) {
        const reason = document.createElement('small');
        reason.textContent = event.details.reason;
        details.append(reason);
      }
      const seek = document.createElement('button');
      seek.className = 'button'; seek.type = 'button';
      seek.textContent = `Review at ${format(event.timestamp_seconds)} s`;
      seek.disabled = !validOutput;
      seek.addEventListener('click', () => {
        const unavailable = () => {
          document.querySelector('#saved-video-error').textContent = 'Playback is unavailable here. Open or download the video and seek to this timestamp.';
          document.querySelector('#saved-video-error').hidden = false;
        };
        try {
          player.currentTime = Math.max(0, Number(event.timestamp_seconds) || 0);
          player.play?.()?.catch?.(unavailable);
        } catch { unavailable(); }
      });
      details.append(seek);
      card.append(details);
      eventList.append(card);
    }

    document.querySelector('#report-download').href = `/api/video/results/${jobId}?download=1`;
    videoResults.hidden = false;
  }

  function renderTracks() {
    const filter = document.querySelector('#track-filter').value || 'all';
    const tracks = [...(state.video.report?.trackingSummaries || [])]
      .filter(track => filter === 'all' || (filter === 'person' ? track.objectClass === 'person' : ['car', 'bus', 'motorcycle'].includes(track.objectClass)))
      .sort((a, b) => Number(b.objectClass === 'person') - Number(a.objectClass === 'person') || a.firstSeenSeconds - b.firstSeenSeconds || a.trackingId - b.trackingId);
    const pages = Math.max(1, Math.ceil(tracks.length / 10));
    state.trackPage = Math.max(0, Math.min(state.trackPage, pages - 1));
    const body = document.querySelector('#tracking-table'); body.replaceChildren();
    for (const track of tracks.slice(state.trackPage * 10, state.trackPage * 10 + 10)) {
      const row = document.createElement('tr');
      for (const value of [track.trackingId, track.objectClass, format(track.firstSeenSeconds), format(track.lastSeenSeconds)]) addCell(row, value);
      body.append(row);
    }
    if (!tracks.length) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = 'No matching tracks in this report.'; row.append(cell); body.append(row); }
    document.querySelector('#track-page-info').textContent = `${tracks.length} tracks · Page ${state.trackPage + 1} of ${pages}`;
    document.querySelector('#tracks-previous').disabled = state.trackPage === 0;
    document.querySelector('#tracks-next').disabled = state.trackPage + 1 === pages;
  }

  function cancelledMessage() {
    videoProgress.hidden = true; setRunning(false);
    videoStatus.textContent = batchStatus.textContent = 'Cancelled. Completed reports are kept; you can start another analysis.';
    statusText.textContent = 'Cancelled'; statusDetail.textContent = 'Processing stopped.';
    setFeedback('Analysis cancelled.');
  }

  async function requestCancellation(operation) {
    operation.cancelRequested = true; renderControls();
    videoStatus.textContent = batchStatus.textContent = 'Stopping processing…';
    if (!operation.id) return;
    if (!operation.cancelPromise) operation.cancelPromise = (async () => {
      const url = operation.kind === 'batch' ? `/api/video/batches/${operation.id}/cancel` : `/api/video/cancel/${operation.id}`;
      // An upload may not have reached the server when the user presses Cancel.
      for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetch(url, { method: 'POST' });
        const result = await response.json().catch(() => ({}));
        if (response.ok) return;
        if (response.status !== 404 || attempt === 19) throw new Error(result.message || 'Could not cancel this recording.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    })();
    try { await operation.cancelPromise; }
    catch (error) { operation.cancelRequested = false; operation.cancelPromise = null; renderControls(); throw error; }
  }

  async function finishCancellation(operation) {
    await requestCancellation(operation);
    const url = operation.kind === 'batch' ? `/api/video/batches/${operation.id}` : `/api/video/status/${operation.id}`;
    for (;;) {
      const result = await fetchVideoJson(url);
      if (['cancelled', 'completed', 'partial_success', 'failed', 'simulation_failed'].includes(result.status)) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    cancelledMessage();
  }

  async function pollVideoJob(jobId) {
    while (true) {
      const job = await fetchVideoJson(`/api/video/status/${jobId}`);
      videoStatus.textContent = job.message || `Analysis ${job.status}.`;
      state.video.jobId = jobId;
      state.video.workloadProfile = job.workloadProfile || state.video.workloadProfile;
      state.video.simulationStatus = job.simulationStatus || 'not_started';
      state.video.simulationError = job.simulationError || null;
      if (job.status === 'cancelled') { cancelledMessage(); return; }
      if (job.analysisStatus === 'completed' && state.video.reportJobId !== jobId) {
        renderVideoReport(await fetchVideoJson(`/api/video/results/${jobId}`), jobId);
      }
      if (job.status === 'completed' || job.status === 'simulation_failed') {
        applyVideoSimulation(await fetchVideoJson(`/api/video/simulation/${jobId}`), jobId);
        videoProgress.hidden = true;
        analyzeButton.disabled = false;
        setRunning(false);
        if (job.status === 'completed') {
          document.querySelector('#run-status').textContent = 'Complete';
          document.querySelector('#run-detail').textContent = 'Video analysis and both simulations completed.';
          setFeedback('Video analysis and its cloud/edge comparison completed.', 'success');
        } else {
          const message = job.simulationError || 'The simulations failed; successful video analytics results remain available.';
          videoError.textContent = `Video analysis succeeded, but simulation failed: ${message}`;
          videoError.hidden = false;
          document.querySelector('#run-status').textContent = 'Simulation failed';
          document.querySelector('#run-detail').textContent = 'Video analytics results are available; the comparison failed.';
          setFeedback('Video analysis succeeded, but its profile simulation failed.', 'error');
        }
        return;
      }
      if (job.analysisStatus === 'failed' || job.status === 'failed') throw new Error(job.analysisError || job.error || 'Video analysis failed.');
      if (!['processing', 'simulation_pending', 'simulation_running', 'uploaded'].includes(job.status)) {
        throw new Error(`Unexpected video job status: ${job.status}`);
      }
      renderAll();
      await new Promise(resolve => setTimeout(resolve, 1400));
    }
  }

  async function analyzeSelectedVideo() {
    if (!state.video.file || analyzeButton.disabled || state.running) return;
    const id = globalThis.crypto?.randomUUID?.().replaceAll('-', '') || Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const operation = { kind: 'single', id, cancelRequested: false };
    state.operation = operation;
    videoError.hidden = true;
    videoResults.hidden = true;
    analyzeButton.disabled = true;
    videoProgress.hidden = false;
    videoStatus.textContent = 'Uploading video…';
    setRunning(true, 'Local video processing in progress.');
    setFeedback('Video analysis and its workload comparison are running.');
    try {
      const file = state.video.file;
      const uploadResponse = await fetch(`${API_ROOT}/video/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Job-Id': id },
        body: file
      });
      const uploaded = await uploadResponse.json().catch(() => ({}));
      if (!uploadResponse.ok) throw new Error(uploaded.message || `Video upload failed (HTTP ${uploadResponse.status}).`);
      if (operation.cancelRequested) { await finishCancellation(operation); return; }
      selectProfileComparison(uploaded.jobId);
      state.video.report = null;
      state.video.reportJobId = null;
      videoResults.hidden = true;
      videoStatus.textContent = 'Upload complete. Starting Python analysis…';
      await fetchVideoJson(`${API_ROOT}/video/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: uploaded.jobId, frameInterval: Number(document.querySelector('#analysis-mode').value) || 1 })
      });
      await pollVideoJob(uploaded.jobId);
    } catch (error) {
      if (operation.cancelRequested) {
        try { await finishCancellation(operation); return; }
        catch (cancelError) { error = cancelError; }
      }
      videoError.textContent = readableVideoError(error.message) || 'Video analysis failed.';
      videoError.hidden = false;
      videoStatus.textContent = 'Analysis did not complete.';
      videoProgress.hidden = true;
      analyzeButton.disabled = false;
      setRunning(false);
      document.querySelector('#run-status').textContent = 'Failed';
      document.querySelector('#run-detail').textContent = 'Video analysis did not complete. Check the error and try again.';
      setFeedback('Video analysis did not complete.', 'error');
      renderAll();
    } finally { state.operation = null; renderControls(); }
  }

  videoDropzone.addEventListener('click', () => videoFileInput.click());
  videoDropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); videoFileInput.click(); }
  });
  videoFileInput.addEventListener('change', () => chooseVideo(videoFileInput.files?.[0]));
  videoPreview.addEventListener('error', () => {
    if (state.video.file) videoStatus.textContent = 'This browser cannot preview this video codec. It can still be sent to Python for analysis.';
  });
  videoDropzone.addEventListener('dragover', event => { event.preventDefault(); videoDropzone.classList.add('drag-over'); });
  videoDropzone.addEventListener('dragleave', () => videoDropzone.classList.remove('drag-over'));
  videoDropzone.addEventListener('drop', event => {
    event.preventDefault();
    videoDropzone.classList.remove('drag-over');
    chooseVideo(event.dataTransfer?.files?.[0]);
  });
  analyzeButton.addEventListener('click', analyzeSelectedVideo);
  document.querySelector('#retry-comparison').addEventListener('click', async () => {
    if (state.running || !state.video.reportJobId) return;
    const id = state.video.reportJobId;
    state.operation = { kind: 'single', id, cancelRequested: false };
    videoError.hidden = true; videoProgress.hidden = false;
    setRunning(true, 'Retrying the saved workload comparison. Video analysis will not run again.');
    try {
      await fetchVideoJson(`/api/video/simulation/${id}/retry`, { method: 'POST' });
      await pollVideoJob(id);
    } catch (error) {
      videoError.textContent = error.message; videoError.hidden = false;
      videoProgress.hidden = true; setRunning(false);
    } finally { state.operation = null; renderControls(); }
  });
  for (const selector of ['#cancel-analysis', '#cancel-batch']) document.querySelector(selector).addEventListener('click', async () => {
    const operation = state.operation;
    if (!operation || operation.cancelRequested) return;
    try { await requestCancellation(operation); }
    catch (error) { videoError.textContent = error.message; videoError.hidden = false; }
  });
  document.querySelector('#track-filter').addEventListener('change', () => { state.trackPage = 0; renderTracks(); });
  document.querySelector('#tracks-previous').addEventListener('click', () => { state.trackPage--; renderTracks(); });
  document.querySelector('#tracks-next').addEventListener('click', () => { state.trackPage++; renderTracks(); });
  document.querySelector('#readable-report').addEventListener('click', () => {
    const report = state.video.report;
    if (!report) return;
    const counts = report.objectCountsByClass || {};
    const vehicles = ['car', 'bus', 'motorcycle'].reduce((sum, name) => sum + Number(counts[name]?.uniqueTrackingIds || 0), 0);
    const text = ['EDGEVISION RECORDING REPORT', `Recording: ${report.sourceName || 'Saved recording'}`,
      `Report ID: ${state.video.reportJobId}`, `People tracks: ${counts.person?.uniqueTrackingIds || 0}`, `Vehicle tracks: ${vehicles}`,
      `Processing time: ${format(report.processing?.processingDurationSeconds)} seconds`,
      `Sampling: every ${report.video?.frameInterval || 1} frame(s)`,
      `Scene rules: ${report.ruleCoverage?.rulesEnabled?.join(', ') || 'Not configured'}`,
      '', 'MOMENTS TO REVIEW', ...(report.events || []).filter(event => event.event_type !== 'person_visible').map(event => `${format(event.timestamp_seconds)} s | ${event.event_type} | ${event.object_class} | ${event.details?.reason || 'Configured scene rule'}`),
      '', 'INTERPRETATION', 'YOLO locates objects; ByteTrack links their appearances. Tracks are not verified unique people.',
      'Movement, posture and vehicle-contact cues are unvalidated suggestions for human review. This system does not confirm robbery, collisions or safety.',
      report.ruleCoverage?.note || '', 'The annotated video contains detection boxes and track IDs; the separate cloud/edge simulation uses workload profiles, not video frames.'].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `edgevision-${state.video.reportJobId}-summary.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  batchFileInput.addEventListener('change', () => {
    if (state.running) return;
    const additions = [...(batchFileInput.files || [])];
    if (!additions.length) return;
    state.batchFiles.push(...additions);
    batchFileInput.value = '';
    updateBatchSelection();
  });
  document.querySelector('#clear-batch-selection').addEventListener('click', () => {
    if (!state.running) { state.batchFiles = []; batchFileInput.value = ''; updateBatchSelection(); }
  });
  document.querySelector('#saved-video').addEventListener('error', () => {
    if (!document.querySelector('#saved-video-wrap').hidden) {
      document.querySelector('#saved-video-error').textContent = 'This browser cannot play this video codec. Open or download it to watch in a compatible player.';
      document.querySelector('#saved-video-error').hidden = false;
    }
  });
  batchButton.addEventListener('click', analyzeBatch);
  async function checkApiHealth() {
    const version = state.comparisonVersion;
    try {
      const health = await requestJson(`${API_ROOT}/health`);
      if (version !== state.comparisonVersion || state.running || state.comparisonMode !== 'standalone') return;
      if (health.status !== 'ok') throw new Error('The simulation API is not healthy.');
      if (health.simulationRunning || health.videoAnalysisRunning || health.multiVideoRunning) {
        setFeedback('Another compute job is running on the server. Wait for it to finish before starting a run.');
      }
    } catch (error) {
      if (version !== state.comparisonVersion || state.running || state.comparisonMode !== 'standalone') return;
      statusText.textContent = 'API unavailable';
      statusDetail.textContent = 'Start the dashboard server and reload this page.';
      setFeedback(`Could not reach the simulation API: ${error.message}`, 'error');
    }
  }

  function validStandaloneResult(record, scenario, cameraCount) {
    const profile = record?.workloadProfile;
    return record?.scenario === scenario && record.metrics &&
      ['loopLatencyMs', 'networkUsageMb', 'energyJoules', 'processedTuples', 'wallClockMillis']
        .every(key => typeof record.metrics[key] === 'number' && Number.isFinite(record.metrics[key])) &&
      (record.metrics.analyticsLatencyMs == null || Number.isFinite(record.metrics.analyticsLatencyMs)) &&
      profile?.type === 'standalone_virtual_camera' && /^[a-f0-9]{32}$/.test(profile.workloadProfileId) &&
      profile.virtualCameraSources === cameraCount && profile.tupleCount === cameraCount * CAMERA_TUPLES_PER_SOURCE &&
      profile.durationSeconds === CAMERA_DURATION_SECONDS && profile.tupleIntervalMs === CAMERA_INTERVAL_MS &&
      profile.tuplesPerCamera === CAMERA_TUPLES_PER_SOURCE && Array.isArray(profile.sourceIds) &&
      profile.sourceIds.length === cameraCount && new Set(profile.sourceIds).size === cameraCount &&
      record.metrics.processedTuples === profile.tupleCount;
  }

  async function run(action) {
    if (state.running || state.comparisonMode !== 'standalone' || !['cloud', 'edge', 'both'].includes(action)) return;
    clearStandaloneResults();
    const version = state.comparisonVersion;
    const cameraCount = Number(cameraCountInput.value);
    const isCurrent = () => version === state.comparisonVersion && state.comparisonMode === 'standalone' &&
      cameraCount === Number(cameraCountInput.value);
    setPlacementSelection(action);
    const scenarios = action === 'both' ? ['cloud', 'edge'] : [action];
    setRunning(true, scenarios.length === 2 ? 'Running both placement scenarios...' : `Running ${scenarios[0]} scenario...`);
    setFeedback('Simulation is running.');
    try {
      const body = await requestJson(`${API_ROOT}/simulate/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cameraCount })
      });
      if (!isCurrent()) return;
      const records = action === 'both' ? body : { [action]: body };
      // Validate every record before publishing any of the comparison.
      if (scenarios.some(scenario => !validStandaloneResult(records[scenario], scenario, cameraCount)) ||
          (action === 'both' && JSON.stringify(body.cloud.workloadProfile) !== JSON.stringify(body.edge.workloadProfile))) {
        throw new Error('The API results do not match the requested virtual-camera workload.');
      }
      scenarios.forEach(scenario => setRecord(scenario, records[scenario]));
      state.latestScenario = scenarios[scenarios.length - 1];
      renderAll();
      setFeedback(scenarios.length === 2 ? 'Both simulations completed successfully.' : 'Simulation completed successfully.', 'success');
      statusText.textContent = 'Complete';
      statusDetail.textContent = 'Results are from the completed simulation.';
    } catch (error) {
      if (!isCurrent()) return;
      setFeedback(error.message || 'Simulation failed.', 'error');
      statusText.textContent = 'Failed';
      statusDetail.textContent = 'No results from this run. Check the error and try again.';
    } finally {
      // An older request must not change the controls or status of another comparison.
      if (version === state.comparisonVersion && state.comparisonMode === 'standalone') setRunning(false);
    }
  }

  buttons.forEach(button => button.addEventListener('click', () => run(button.dataset.run)));
  cameraCountInput.addEventListener('input', () => {
    renderCameraWorkloadSelection();
    if (state.comparisonMode === 'standalone') {
      clearStandaloneResults();
      // Native input is disabled during runs; also invalidate programmatic input changes.
      setRunning(false);
    }
  });
  comparisonModeButton.addEventListener('click', () => {
    if (state.running) return;
    if (state.comparisonMode === 'profile') {
      state.comparisonMode = 'standalone';
      clearStandaloneResults();
    } else if (state.video.comparison) {
      applyVideoSimulation(state.video.comparison, state.video.jobId);
      statusText.textContent = state.video.simulationStatus === 'completed'
        ? (state.batch?.batchId === state.video.jobId && state.batch.status === 'partial_success' ? 'Partial success' : 'Complete') : 'Simulation failed';
      statusDetail.textContent = 'Showing the selected video job comparison.';
      setFeedback('Showing video-associated results. Virtual-camera runs are separate.');
    }
  });
  const navigationLinks = [...document.querySelectorAll('.nav-link')];
  navigationLinks.forEach(link => link.addEventListener('click', () => {
    navigationLinks.forEach(item => item.classList.toggle('active', item === link));
  }));
  setPlacementSelection(null);
  renderCameraWorkloadSelection();
  renderAll();
  checkApiHealth();
  fetchVideoJson('/api/video/batches/config').then(limits => {
    if (['maxCameras', 'maxFileBytes', 'maxTotalBytes', 'maxCombinedTuples'].every(key => Number.isFinite(limits[key]))) {
      state.batchLimits = limits;
      if (state.batchFiles.length && !state.batch) updateBatchSelection();
      const limitSize = bytes => bytes >= 1073741824 ? `${format(bytes / 1073741824)} GiB` : `${format(bytes / 1048576)} MiB`;
      document.querySelector('#batch-limits-note').textContent = `Choose 2-${limits.maxCameras} uploaded recordings, one per camera. Up to ${limitSize(limits.maxFileBytes)} per file, ${limitSize(limits.maxTotalBytes)} total and ${format(limits.maxCombinedTuples, 0)} combined tuples. Processing is sequential; only successful cameras are simulated together. Recording start times are modeled together, without assuming synchronized footage.`;
    }
  }).catch(() => { /* API availability is reported by the health check. */ });
  // An explicit saved-job link restores analytics without uploading or running inference.
  if (window.location?.search) {
    const id = new URLSearchParams(window.location.search).get('job');
    if (id && /^[a-f0-9]{32}$/.test(id)) (async () => {
      setRunning(true, 'Loading the saved recording.');
      try {
        const job = await fetchVideoJson(`/api/video/status/${id}`);
        if (job.analysisStatus !== 'completed' || job.batchId) throw new Error('This link needs a completed individual recording report.');
        selectProfileComparison(id);
        renderVideoReport(await fetchVideoJson(`/api/video/results/${id}`), id);
        applyVideoSimulation(await fetchVideoJson(`/api/video/simulation/${id}`), id);
        videoStatus.textContent = job.message;
        statusText.textContent = job.simulationStatus === 'completed' ? 'Complete' : 'Comparison unavailable';
        statusDetail.textContent = job.simulationError || job.message;
      } catch (error) { videoError.textContent = error.message; videoError.hidden = false; }
      finally { setRunning(false); }
    })();
  }
})();

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const identity = () => randomUUID().replaceAll('-', '');
const validId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const filenameSafe = value => typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\/\0\x00-\x1f]/.test(value) && !['.', '..'].includes(value);
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

function combineProfiles(batchId, sources) {
  if (!validId(batchId) || !sources.length || sources.length > 10) throw new Error('A valid batch and 1-10 successful cameras are required.');
  const ids = new Set();
  const jobs = new Set();
  for (const source of sources) {
    if (!validId(source.cameraId) || !validId(source.jobId) || source.jobId === batchId || ids.has(source.cameraId) || jobs.has(source.jobId) ||
        source.workloadProfile.jobId !== source.jobId || source.workloadProfile.iFogSimWorkload.virtualCameraSources !== 1) {
      throw new Error('Combined camera/profile identities must be distinct and consistent.');
    }
    ids.add(source.cameraId); jobs.add(source.jobId);
  }
  const tupleCount = sources.reduce((total, source) => total + source.workloadProfile.iFogSimWorkload.frameBatching.tupleCount, 0);
  if (!Number.isSafeInteger(tupleCount) || tupleCount < 1) throw new Error('Combined tuple count exceeds the supported range.');
  return { schemaVersion: 2, profileType: 'multi_video', jobId: batchId,
    aggregationPolicy: 'concurrent_start_independent_traces', cameraCount: sources.length, tupleCount,
    durationSeconds: Math.max(...sources.map(source => source.workloadProfile.video.durationSeconds)), sources };
}

function publicProfile(profile, requestedCameraCount) {
  return { type: 'multi_video', jobId: profile.jobId, cameraCount: profile.cameraCount,
    virtualCameraSources: profile.cameraCount, requestedCameraCount, tupleCount: profile.tupleCount,
    durationSeconds: profile.durationSeconds, aggregationPolicy: profile.aggregationPolicy,
    sources: profile.sources.map(source => ({ cameraId: source.cameraId, jobId: source.jobId,
      durationSeconds: source.workloadProfile.video.durationSeconds,
      sourceClassification: source.workloadProfile.sourceClassification,
      tupleCount: source.workloadProfile.iFogSimWorkload.frameBatching.tupleCount,
      tupleIntervalSeconds: source.workloadProfile.iFogSimWorkload.proposedTupleGenerationIntervalSeconds })) };
}

function validBatchResult(record, scenario, profile, validRecord) {
  const used = record?.workloadProfile;
  if (!validRecord(record, scenario) || used?.type !== 'multi_video' || used.jobId !== profile.jobId ||
      used.virtualCameraSources !== profile.cameraCount || used.tupleCountFromProfile !== profile.tupleCount ||
      used.generatedTuples !== profile.tupleCount || used.durationSeconds !== profile.durationSeconds ||
      used.aggregationPolicy !== profile.aggregationPolicy || used.simulatedVideoFramesSent !== false ||
      used.tupleIntervalsMatchProfile !== true || record.metrics.processedTuples !== profile.tupleCount ||
      !Array.isArray(used.sources) || used.sources.length !== profile.sources.length) return false;
  return profile.sources.every((source, index) => {
    const actual = used.sources[index];
    const raw = source.workloadProfile;
    const workload = raw.iFogSimWorkload;
    const count = workload.frameBatching.tupleCount;
    const mi = value => value == null ? null : Math.max(1, Math.round(value / count));
    return actual?.cameraId === source.cameraId && actual.jobId === source.jobId &&
      actual.tupleCount === count && actual.generatedTuples === count && actual.processedTuples === count &&
      actual.tupleIntervalSeconds === workload.proposedTupleGenerationIntervalSeconds &&
      actual.durationSeconds === raw.video.durationSeconds && actual.sourceClassification === raw.sourceClassification &&
      actual.tupleIntervalsMatchProfile === true &&
      actual.videoAnalyzerMIPerTupleUsed === (mi(workload.cpuDemand.videoAnalyzerMI) ?? 1000) &&
      actual.eventDetectorMIPerTupleUsed === (mi(workload.cpuDemand.eventDetectorMI) ?? 2000) &&
      actual.cameraTuplePayloadBytesUsed === (workload.tuplePayloadBytes ?? 20000) &&
      actual.cpuDemandStatus === workload.cpuDemand.status && actual.tuplePayloadBasis === workload.tuplePayloadBasis;
  });
}

function createMultiVideoApi(deps) {
  const { outputsRoot, resultsRoot, readJsonBody, sendJson, uploadVideo, analyzeVideo, getVideoJob,
    validWorkloadProfile, validRecord, safeError, isBusy, setBusy, runSimulation, settings } = deps;
  const batches = new Map();
  const writes = new Map();
  const activeBatches = new Set();
  const maxCameras = Math.min(10, settings?.multi_video?.max_cameras || 10);
  const maxTotalBytes = settings?.multi_video?.max_total_file_size_bytes || 1073741824;
  const maxCombinedTuples = settings?.multi_video?.max_combined_tuples || 100000;
  if (!Number.isSafeInteger(maxCameras) || maxCameras < 2 || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 ||
      !Number.isSafeInteger(maxCombinedTuples) || maxCombinedTuples < 1) throw new Error('Invalid multi_video resource limits.');
  const batchRoot = path.join(outputsRoot, 'batches');
  const directory = id => path.join(batchRoot, id);
  const snapshot = batch => {
    const { cloud, edge, ...record } = batch;
    return record;
  };
  const persist = batch => {
    const record = JSON.stringify(snapshot(batch), null, 2) + '\n';
    const target = path.join(directory(batch.batchId), 'batch.json');
    const write = (writes.get(batch.batchId) || Promise.resolve()).catch(() => {}).then(async () => {
      await fs.promises.mkdir(directory(batch.batchId), { recursive: true });
      const temporary = `${target}.tmp`;
      await fs.promises.writeFile(temporary, record, { mode: 0o600 });
      await fs.promises.rename(temporary, target);
    });
    writes.set(batch.batchId, write);
    return write;
  };

  async function sourcesFor(batch) {
    const sources = [];
    const totals = { objectCountsByClass: {}, eventCount: 0, processingDurationSecondsSum: 0,
      uniqueTrackBasis: 'sum_of_camera_scoped_ids_not_cross_camera_people', crossCameraReIdentification: false };
    for (const camera of batch.cameras.filter(camera => camera.status === 'completed')) {
      const job = await getVideoJob(camera.jobId);
      const raw = JSON.parse(await fs.promises.readFile(path.join(outputsRoot, 'workloads', `${camera.jobId}.json`), 'utf8'));
      if (!job?.report || job.analysisStatus !== 'completed' || !validWorkloadProfile(raw, camera.jobId) ||
          raw.video.processedFrameCount !== job.report.video.processedFrameCount || raw.iFogSimWorkload.virtualCameraSources !== 1) {
        throw new Error('A camera report/profile could not be validated for this batch.');
      }
      sources.push({ cameraId: camera.cameraId, jobId: camera.jobId, workloadProfile: raw });
      for (const [name, counts] of Object.entries(job.report.objectCountsByClass || {})) {
        const target = totals.objectCountsByClass[name] ||= { trackedObservations: 0, uniqueTrackingIds: 0 };
        target.trackedObservations += counts.trackedObservations;
        target.uniqueTrackingIds += counts.uniqueTrackingIds;
      }
      totals.eventCount += job.report.eventCount;
      totals.processingDurationSecondsSum += job.report.processing.processingDurationSeconds;
    }
    return { sources, totals };
  }

  async function readComparison(batch, rawProfile) {
    const records = await Promise.all(['cloud', 'edge'].map(async scenario => {
      const record = JSON.parse(await fs.promises.readFile(path.join(resultsRoot, 'video_batches', batch.batchId, `${scenario}.json`), 'utf8'));
      if (!validBatchResult(record, scenario, rawProfile, validRecord)) throw new Error(`Saved ${scenario} results do not match this batch's camera workloads.`);
      return record;
    }));
    if (JSON.stringify(records[0].workloadProfile) !== JSON.stringify(records[1].workloadProfile)) throw new Error('Paired batch simulation metadata do not match.');
    batch.cloud = records[0]; batch.edge = records[1];
  }

  async function getBatch(id) {
    if (!validId(id)) return null;
    if (batches.has(id)) return batches.get(id);
    let batch;
    try { batch = JSON.parse(await fs.promises.readFile(path.join(directory(id), 'batch.json'), 'utf8')); }
    catch { return null; }
    if (batch.batchId !== id || !Array.isArray(batch.cameras) || !batch.cameras.length || batch.cameras.length > maxCameras ||
        new Set(batch.cameras.map(camera => camera.cameraId)).size !== batch.cameras.length ||
        batch.cameras.some(camera => !validId(camera.cameraId) || !filenameSafe(camera.filename) ||
          (camera.jobId !== null && !validId(camera.jobId)))) return null;
    batch.cloud = null; batch.edge = null;
    if (['processing', 'simulation_running', 'draft'].includes(batch.status)) {
      batch.status = 'interrupted';
      batch.message = 'This unfinished batch was interrupted by a server restart. Start a new batch; completed camera artifacts remain available.';
      batch.simulationStatus = 'not_started';
      batch.profile = null;
      for (const camera of batch.cameras) {
        if (!camera.jobId) {
          if (camera.status === 'uploading') { camera.status = 'interrupted'; camera.error = 'Upload was interrupted by the server restart.'; }
          continue;
        }
        const job = await getVideoJob(camera.jobId);
        if (job?.analysisStatus === 'completed') camera.status = 'completed';
        else if (['processing', 'uploading'].includes(camera.status)) {
          camera.status = 'interrupted'; camera.error = 'Camera analysis was interrupted by the server restart.';
        }
      }
      try { batch.summary = (await sourcesFor(batch)).totals; } catch { batch.summary = null; }
    } else if (batch.profile) {
      try {
        const { sources, totals } = await sourcesFor(batch);
        const combined = combineProfiles(id, sources);
        const saved = JSON.parse(await fs.promises.readFile(path.join(directory(id), 'workload.json'), 'utf8'));
        if (JSON.stringify(saved) !== JSON.stringify(combined)) throw new Error('Combined profile differs from the saved camera profiles.');
        batch.profile = publicProfile(combined, batch.cameras.length);
        batch.summary = totals;
        if (batch.simulationStatus === 'completed') await readComparison(batch, combined);
      } catch (error) {
        batch.status = 'simulation_failed'; batch.simulationStatus = 'failed';
        batch.error = safeError(error.message); batch.message = 'Camera analytics remain available; the saved comparison could not be validated.';
        batch.cloud = null; batch.edge = null;
      }
    }
    batches.set(id, batch);
    return batch;
  }

  const publicBatch = batch => {
    const finalizing = activeBatches.has(batch.batchId) && !['processing', 'simulation_running'].includes(batch.status);
    return ({ batchId: batch.batchId, status: finalizing ? 'processing' : batch.status, message: finalizing ? 'Saving batch results.' : batch.message,
    error: batch.error || null, createdAt: batch.createdAt, startedAt: batch.startedAt || null, completedAt: batch.completedAt || null,
    cameras: batch.cameras.map(camera => ({ ...camera, reportUrl: camera.status === 'completed' ? `/api/video/results/${camera.jobId}` : null })),
    summary: batch.summary || null,
    simulation: { jobId: batch.batchId, status: finalizing ? 'running' : batch.simulationStatus, message: batch.message, error: batch.error || null,
      workloadProfile: batch.profile || null, cloud: finalizing ? null : batch.cloud || null, edge: finalizing ? null : batch.edge || null } });
  };

  async function processBatch(batch) {
    activeBatches.add(batch.batchId);
    try {
      for (const camera of batch.cameras) {
        if (camera.status !== 'uploaded') continue;
        camera.status = 'processing';
        batch.message = `Analyzing camera ${batch.cameras.indexOf(camera) + 1} of ${batch.cameras.length}: ${camera.filename}`;
        await persist(batch);
        const job = await analyzeVideo(await getVideoJob(camera.jobId));
        if (job.analysisStatus === 'completed' && job.workloadProfile) {
          camera.status = 'completed';
          await fs.promises.writeFile(path.join(outputsRoot, camera.jobId, 'batch-source.json'),
            JSON.stringify({ jobId: camera.jobId, batchId: batch.batchId, cameraId: camera.cameraId,
              createdAt: job.createdAt, startedAt: job.startedAt, analysisCompletedAt: job.analysisCompletedAt }) + '\n', { flag: 'wx', mode: 0o600 });
        }
        else { camera.status = 'analysis_failed'; camera.error = safeError(job.error || job.simulationError || 'Camera analysis failed.'); }
        await persist(batch);
      }
      const { sources, totals } = await sourcesFor(batch);
      batch.summary = totals;
      if (!sources.length) {
        batch.status = 'failed'; batch.message = 'No camera analysis succeeded. No combined simulation was run.';
        batch.error = 'All selected camera inputs failed.';
        return;
      }
      const combined = combineProfiles(batch.batchId, sources);
      if (combined.tupleCount > maxCombinedTuples) throw new Error(`Combined workload exceeds the ${maxCombinedTuples}-tuple simulation limit. Individual analytics remain available.`);
      const profilePath = path.join(directory(batch.batchId), 'workload.json');
      await fs.promises.writeFile(profilePath, JSON.stringify(combined, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      batch.profile = publicProfile(combined, batch.cameras.length);
      batch.status = 'simulation_running'; batch.simulationStatus = 'running';
      batch.message = `Running both placements for ${sources.length} successful camera recordings; excluded ${batch.cameras.length - sources.length}.`;
      await persist(batch);
      await runSimulation(profilePath);
      await readComparison(batch, combined);
      batch.simulationStatus = 'completed';
      batch.status = sources.length === batch.cameras.length ? 'completed' : 'partial_success';
      batch.message = batch.status === 'completed' ? 'All camera analyses and the combined comparison completed.'
        : 'Combined comparison completed using successful cameras only. Failed cameras are excluded and listed below.';
    } catch (error) {
      batch.status = 'simulation_failed'; batch.simulationStatus = 'failed';
      batch.error = safeError(error.message); batch.message = 'Camera analytics were preserved, but the combined comparison failed.';
      batch.cloud = null; batch.edge = null;
    } finally {
      batch.completedAt = new Date().toISOString();
      try { await persist(batch); }
      catch (error) {
        batch.status = 'simulation_failed'; batch.simulationStatus = 'failed';
        batch.error = safeError(error.message); batch.message = 'The batch could not be saved reliably. Camera artifacts remain available.';
        batch.cloud = null; batch.edge = null;
      } finally { activeBatches.delete(batch.batchId); setBusy(false); }
    }
  }

  async function handle(request, response, pathname) {
    try {
      if (request.method === 'GET' && pathname === '/api/video/batches/config') {
        sendJson(response, 200, { maxCameras, maxTotalBytes, maxCombinedTuples, maxFileBytes: settings.upload.max_file_size_bytes }); return;
      }
      if (request.method === 'POST' && pathname === '/api/video/batches') {
        if (isBusy()) throw httpError(409, 'Another compute job is running.');
        const body = await readJsonBody(request);
        if (!Array.isArray(body?.cameras) || body.cameras.length < 2 || body.cameras.length > maxCameras) throw httpError(400, `Select 2-${maxCameras} recordings; use the existing single-video workflow for one recording.`);
        if (body.cameras.some(camera => !camera || !filenameSafe(camera.filename) || !Number.isSafeInteger(camera.sizeBytes) || camera.sizeBytes < 1)) throw httpError(400, 'Camera filenames and positive byte sizes are required.');
        const total = body.cameras.reduce((sum, camera) => sum + camera.sizeBytes, 0);
        if (!Number.isSafeInteger(total) || total > maxTotalBytes) throw httpError(413, 'Combined recording sizes exceed the configured batch limit.');
        const batch = { batchId: identity(), status: 'draft', createdAt: new Date().toISOString(), message: 'Upload the selected camera recordings, then start sequential analysis.',
          simulationStatus: 'not_started', error: null, totalBytes: total,
          cameras: body.cameras.map(camera => ({ cameraId: identity(), jobId: null, filename: camera.filename, sizeBytes: camera.sizeBytes,
            status: camera.sizeBytes > settings.upload.max_file_size_bytes ? 'upload_failed' : 'awaiting_upload',
            error: camera.sizeBytes > settings.upload.max_file_size_bytes ? 'Recording exceeds the per-file upload limit.' : null })) };
        batches.set(batch.batchId, batch); await persist(batch);
        sendJson(response, 201, publicBatch(batch)); return;
      }
      const match = pathname.match(/^\/api\/video\/batches\/([a-f0-9]{32})(?:\/(run|cameras)(?:\/([a-f0-9]{32}))?)?$/);
      if (!match) throw httpError(404, 'Batch endpoint not found.');
      const batch = await getBatch(match[1]);
      if (!batch) throw httpError(404, 'Video batch not found.');
      if (request.method === 'GET' && !match[2]) { sendJson(response, 200, publicBatch(batch)); return; }
      if (request.method === 'POST' && match[2] === 'cameras' && match[3]) {
        const camera = batch.cameras.find(camera => camera.cameraId === match[3]);
        if (!camera) throw httpError(404, 'Camera does not belong to this batch.');
        if (isBusy() || batch.status !== 'draft' || camera.status !== 'awaiting_upload') throw httpError(409, 'This camera upload cannot start in the current batch state.');
        let suppliedName;
        try { suppliedName = decodeURIComponent(String(request.headers['x-file-name'] || '')); } catch { throw httpError(400, 'Invalid encoded filename.'); }
        if (suppliedName !== camera.filename || Number(request.headers['content-length']) !== camera.sizeBytes) throw httpError(400, 'Upload filename/size must match the selected camera manifest.');
        camera.status = 'uploading';
        const job = await uploadVideo(request, response, { batchId: batch.batchId, cameraId: camera.cameraId });
        if (job) { camera.jobId = job.jobId; camera.status = 'uploaded'; }
        else { camera.status = 'upload_failed'; camera.error = `Recording upload rejected (HTTP ${response.statusCode}).`; }
        await persist(batch); return;
      }
      if (request.method === 'POST' && match[2] === 'run' && !match[3]) {
        if (isBusy() || batch.status !== 'draft') throw httpError(409, 'This batch cannot start while another job runs or after it has started.');
        if (batch.cameras.some(camera => ['awaiting_upload', 'uploading'].includes(camera.status))) throw httpError(409, 'Every selected recording must finish uploading or report an upload failure first.');
        setBusy(true); batch.status = 'processing'; batch.startedAt = new Date().toISOString();
        batch.message = 'Processing camera recordings sequentially.';
        try { await persist(batch); } catch (error) { setBusy(false); throw error; }
        sendJson(response, 202, publicBatch(batch));
        processBatch(batch).catch(error => { console.error('Batch persistence failed:', safeError(error.message)); }); return;
      }
      throw httpError(404, 'Batch endpoint not found.');
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.statusCode || 500, { message: safeError(error.message) });
    }
  }
  return { handle };
}

module.exports = { createMultiVideoApi, combineProfiles, validBatchResult, publicProfile };

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const projectRoot = path.resolve(__dirname, '..');
const root = path.join(projectRoot, 'frontend');
const resultsRoot = path.join(projectRoot, 'results');
const runScript = path.join(projectRoot, 'simulation', 'run.ps1');
const videoRoot = path.join(projectRoot, 'video_analytics');
const videoUploadsRoot = path.join(videoRoot, 'uploads');
const videoOutputsRoot = path.join(videoRoot, 'outputs');
const videoEvidenceRoot = path.join(videoRoot, 'evidence');
const videoPython = process.platform === 'win32'
  ? path.join(videoRoot, '.venv', 'Scripts', 'python.exe')
  : path.join(videoRoot, '.venv', 'bin', 'python');
const videoSettingsPath = path.join(videoRoot, 'config', 'settings.json');
const port = Number(process.env.PORT || 4173);
const execFileAsync = promisify(execFile);
let simulationRunning = false;
let videoAnalysisRunning = false;
let batchRunning = false;
const videoJobs = new Map();
let videoSettings = null;
try {
  videoSettings = JSON.parse(fs.readFileSync(videoSettingsPath, 'utf8'));
} catch (error) {
  console.error(`Video analytics configuration unavailable: ${error.message}`);
}
const maxVideoBytes = Number(videoSettings?.upload?.max_file_size_bytes || 0);
const allowedVideoExtensions = new Set(videoSettings?.upload?.allowed_extensions || []);
const videoSignatures = {
  '.mp4': { value: Buffer.from('ftyp'), offset: 4 },
  '.m4v': { value: Buffer.from('ftyp'), offset: 4 },
  '.mov': { value: Buffer.from('ftyp'), offset: 4 },
  '.avi': { value: Buffer.from('RIFF'), offset: 0 },
  '.mkv': { value: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), offset: 0 },
  '.webm': { value: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), offset: 0 }
};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function isValidJobId(value) {
  return /^[a-f0-9]{32}$/.test(value || '');
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validWorkloadProfile(profile, jobId) {
  if (!profile || profile.jobId !== jobId || !isValidJobId(profile.jobId) ||
      typeof profile.sourceClassification !== 'string' || !profile.sourceClassification.trim()) return false;
  const video = profile.video;
  const workload = profile.iFogSimWorkload;
  const batching = workload?.frameBatching;
  if (!video || !positiveNumber(video.durationSeconds) || !positiveNumber(video.sourceFps) ||
      !positiveInteger(video.processedFrameCount) || !positiveInteger(video.frameProcessingInterval) ||
      !positiveInteger(workload?.virtualCameraSources) || !positiveInteger(batching?.framesPerTuple) ||
      !positiveInteger(batching?.tupleCount) || !positiveNumber(workload?.proposedTupleGenerationIntervalSeconds) ||
      !positiveNumber(workload?.effectiveTupleArrivalRatePerSecond)) return false;
  const expectedTuples = Math.ceil(video.processedFrameCount / batching.framesPerTuple);
  const expectedInterval = video.frameProcessingInterval * batching.framesPerTuple / video.sourceFps;
  const expectedRate = batching.tupleCount / video.durationSeconds;
  const close = (actual, expected) => Math.abs(actual - expected) <= Math.max(0.02, Math.abs(expected) * 0.02);
  if (batching.tupleCount !== expectedTuples ||
      !close(workload.proposedTupleGenerationIntervalSeconds, expectedInterval) ||
      !close(workload.effectiveTupleArrivalRatePerSecond, expectedRate)) return false;
  if (workload.tuplePayloadBytes !== null && !positiveInteger(workload.tuplePayloadBytes)) return false;
  if (workload.tuplePayloadBytes === null && workload.tuplePayloadBasis !== 'unavailable_not_serialized') return false;
  if (workload.tuplePayloadBytes !== null && workload.tuplePayloadBasis !== 'configured_assumption') return false;
  const cpu = workload.cpuDemand;
  if (!cpu || (cpu.videoAnalyzerMI == null) !== (cpu.eventDetectorMI == null)) return false;
  if (cpu.videoAnalyzerMI == null && cpu.status !== 'unavailable') return false;
  if (cpu.videoAnalyzerMI != null && (!positiveNumber(cpu.videoAnalyzerMI) || !positiveNumber(cpu.eventDetectorMI) ||
      cpu.status !== 'estimated_from_configured_calibration' || !cpu.referenceHardware || !cpu.calibrationMethod)) return false;
  return true;
}

function publicWorkloadProfile(profile) {
  return {
    jobId: profile.jobId,
    sourceClassification: profile.sourceClassification,
    video: {
      durationSeconds: profile.video.durationSeconds,
      sourceFps: profile.video.sourceFps,
      processedFrameCount: profile.video.processedFrameCount,
      frameProcessingInterval: profile.video.frameProcessingInterval
    },
    virtualCameraSources: profile.iFogSimWorkload.virtualCameraSources,
    framesPerTuple: profile.iFogSimWorkload.frameBatching.framesPerTuple,
    tupleCount: profile.iFogSimWorkload.frameBatching.tupleCount,
    tupleGenerationIntervalSeconds: profile.iFogSimWorkload.proposedTupleGenerationIntervalSeconds,
    effectiveTupleArrivalRatePerSecond: profile.iFogSimWorkload.effectiveTupleArrivalRatePerSecond,
    tuplePayloadBytes: profile.iFogSimWorkload.tuplePayloadBytes,
    tuplePayloadBasis: profile.iFogSimWorkload.tuplePayloadBasis,
    cpuDemand: {
      videoAnalyzerMI: profile.iFogSimWorkload.cpuDemand.videoAnalyzerMI,
      eventDetectorMI: profile.iFogSimWorkload.cpuDemand.eventDetectorMI,
      status: profile.iFogSimWorkload.cpuDemand.status,
      referenceHardware: profile.iFogSimWorkload.cpuDemand.referenceHardware,
      calibrationMethod: profile.iFogSimWorkload.cpuDemand.calibrationMethod
    }
  };
}

function within(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function safeVideoError(value) {
  return String(value || 'Video processing failed.')
    .replaceAll(videoRoot, '[private video workspace]')
    .replace(/[A-Za-z]:\\[^\s"'<>]*/g, '[private path]')
    .split(/\r?\n/).filter(Boolean).slice(-3).join(' ')
    .slice(0, 600) || 'Video processing failed.';
}

async function readJsonBody(request, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
}

async function readOptionalJsonBody(request, maxBytes = 16 * 1024) {
  if (!request.headers['transfer-encoding'] && Number(request.headers['content-length'] || 0) === 0) return {};
  return readJsonBody(request, maxBytes);
}

async function handleVideoUpload(request, response, batchContext = null) {
  if (!videoSettings || !maxVideoBytes) {
    sendJson(response, 503, { message: 'Video analytics configuration is unavailable.' });
    return;
  }
  if (!fs.existsSync(videoPython)) {
    sendJson(response, 503, { message: 'The video analytics Python environment is unavailable. Set up video_analytics/.venv first.' });
    return;
  }
  if (simulationRunning || videoAnalysisRunning || batchRunning) {
    sendJson(response, 409, { message: 'A compute job is running. Wait for it to finish before uploading another video.' });
    return;
  }
  if (!batchContext && [...videoJobs.values()].some(job => job.status === 'uploaded' && !job.batchId)) {
    sendJson(response, 409, { message: 'An uploaded video is awaiting analysis. Analyze it before uploading another.' });
    return;
  }

  let originalName;
  try {
    originalName = decodeURIComponent(String(request.headers['x-file-name'] || ''));
  } catch {
    sendJson(response, 400, { message: 'X-File-Name must be URL-encoded.' });
    return;
  }
  if (!originalName || originalName.length > 240 || /[\\/\0]/.test(originalName) || path.basename(originalName) !== originalName) {
    sendJson(response, 400, { message: 'A simple video filename is required.' });
    return;
  }
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedVideoExtensions.has(extension) || !videoSignatures[extension]) {
    sendJson(response, 415, { message: 'Unsupported video format. Choose a format enabled by the video analytics settings.' });
    return;
  }
  const declaredSize = Number(request.headers['content-length'] || 0);
  if (declaredSize > maxVideoBytes) {
    request.resume();
    sendJson(response, 413, { message: 'Video exceeds the configured file-size limit.' });
    return;
  }

  const jobId = randomUUID().replaceAll('-', '');
  const uploadPath = path.join(videoUploadsRoot, `${jobId}${extension}`);
  const signature = videoSignatures[extension];
  let size = 0;
  let header = Buffer.alloc(0);
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > maxVideoBytes) {
        callback(Object.assign(new Error('Video exceeds the configured file-size limit.'), { code: 'VIDEO_TOO_LARGE' }));
        return;
      }
      if (header.length < 16) header = Buffer.concat([header, chunk.subarray(0, 16 - header.length)]);
      callback(null, chunk);
    }
  });

  try {
    await fs.promises.mkdir(videoUploadsRoot, { recursive: true });
    await pipeline(request, limiter, fs.createWriteStream(uploadPath, { flags: 'wx', mode: 0o600 }));
    if (!size) throw Object.assign(new Error('Uploaded video is empty.'), { statusCode: 400 });
    if (header.length < signature.offset + signature.value.length ||
        !header.subarray(signature.offset, signature.offset + signature.value.length).equals(signature.value) ||
        (extension === '.avi' && !header.subarray(8, 12).equals(Buffer.from('AVI ')))) {
      throw Object.assign(new Error('File contents do not match the selected video format.'), { statusCode: 415 });
    }
    videoJobs.set(jobId, {
      jobId,
      ...(batchContext || {}),
      status: 'uploaded',
      analysisStatus: 'uploaded',
      displayFilename: originalName,
      syntheticTestInput: process.env.NODE_ENV === 'test' && request.headers['x-edgevision-synthetic-test'] === 'true',
      message: 'Video uploaded and validated. Ready to analyze.',
      uploadPath,
      createdAt: new Date().toISOString(),
      reportPath: null,
      report: null,
      error: null,
      simulationStatus: 'not_started',
      simulationMessage: 'Simulation will start after successful video analysis.',
      simulationError: null,
      workloadProfile: null,
      simulationResults: { cloud: null, edge: null }
    });
    sendJson(response, 201, { jobId, status: 'uploaded', message: 'Video uploaded and validated.' });
    return videoJobs.get(jobId);
  } catch (error) {
    await fs.promises.rm(uploadPath, { force: true }).catch(() => {});
    const status = error.code === 'VIDEO_TOO_LARGE' ? 413 : (error.statusCode || 400);
    sendJson(response, status, { message: status === 400 || status === 413 || status === 415
      ? error.message : 'Video upload failed.' });
  }
}

function reportForApi(report, jobId) {
  const result = JSON.parse(JSON.stringify(report));
  result.video.outputUrl = `/api/video/output/${jobId}`;
  delete result.video.annotatedVideo;
  delete result.video.evidenceDirectory;
  result.events = result.events.map(event => {
    const eventId = event.event_id;
    const copy = { ...event };
    if (event.evidence_frame && isValidJobId(eventId)) copy.evidenceUrl = `/api/video/evidence/${jobId}/${eventId}`;
    delete copy.evidence_frame;
    return copy;
  });
  return result;
}

async function recoverCompletedVideoJob(jobId) {
  if (!isValidJobId(jobId)) return null;
  const reportPath = path.resolve(videoOutputsRoot, jobId, 'report.json');
  if (!within(videoOutputsRoot, reportPath)) return null;
  let report;
  try { report = JSON.parse(await fs.promises.readFile(reportPath, 'utf8')); }
  catch { return null; }
  if (report.status !== 'completed' || report.jobId !== jobId || !report.video || !Array.isArray(report.events)) return null;
  const annotatedRelative = report.video.annotatedVideo;
  if (annotatedRelative !== `outputs/${jobId}/annotated.mp4`) return null;
  const annotatedPath = path.resolve(videoOutputsRoot, jobId, 'annotated.mp4');
  if (!within(videoOutputsRoot, annotatedPath) || !fs.existsSync(annotatedPath)) return null;
  for (const event of report.events) {
    if (!event.evidence_frame) continue;
    const evidenceMatch = event.evidence_frame.match(new RegExp(`^evidence/${jobId}/([a-f0-9]{32})\\.jpg$`));
    if (!evidenceMatch) return null;
    const evidencePath = path.resolve(videoEvidenceRoot, jobId, `${evidenceMatch[1]}.jpg`);
    if (!within(videoEvidenceRoot, evidencePath) || !fs.existsSync(evidencePath)) return null;
  }

  const rawProfilePath = path.resolve(videoOutputsRoot, 'workloads', `${jobId}.json`);
  let rawProfile = null;
  let publicProfile = null;
  let profileError = null;
  try {
    if (!within(videoOutputsRoot, rawProfilePath)) throw new Error('Workload profile path is invalid.');
    rawProfile = JSON.parse(await fs.promises.readFile(rawProfilePath, 'utf8'));
    if (!validWorkloadProfile(rawProfile, jobId)) throw new Error('Saved workload profile is invalid.');
    publicProfile = publicWorkloadProfile(rawProfile);
  } catch (error) {
    profileError = safeVideoError(error.message);
  }

  let simulationResults = { cloud: null, edge: null };
  let simulationError = profileError;
  const sourceMarkerPath = path.join(videoOutputsRoot, jobId, 'batch-source.json');
  if (publicProfile && fs.existsSync(sourceMarkerPath)) {
    let association;
    try {
      association = JSON.parse(await fs.promises.readFile(sourceMarkerPath, 'utf8'));
      if (association.jobId !== jobId || !isValidJobId(association.batchId) || !isValidJobId(association.cameraId)) return null;
      const parent = JSON.parse(await fs.promises.readFile(path.join(videoOutputsRoot, 'batches', association.batchId, 'batch.json'), 'utf8'));
      if (parent.batchId !== association.batchId || !parent.cameras?.some(camera => camera.cameraId === association.cameraId && camera.jobId === jobId)) return null;
    } catch { return null; }
    const savedTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
    const job = { jobId, batchId: association.batchId, cameraId: association.cameraId, status: 'analysis_completed', analysisStatus: 'completed',
      message: 'Camera analytics recovered; simulation belongs to its recording batch.', reportPath, report,
      workloadProfile: publicProfile, simulationStatus: 'included_in_batch', simulationMessage: 'Use the parent batch comparison.',
      simulationError: null, simulationResults, error: null, uploadPath: null,
      createdAt: savedTime(association.createdAt), startedAt: savedTime(association.startedAt),
      analysisCompletedAt: savedTime(association.analysisCompletedAt), completedAt: savedTime(association.analysisCompletedAt) };
    videoJobs.set(jobId, job);
    return job;
  }
  if (publicProfile) {
    try {
      const profileResultsDir = path.resolve(resultsRoot, 'video_workloads', jobId);
      const records = await Promise.all(['cloud', 'edge'].map(async scenario => {
        const resultPath = path.resolve(profileResultsDir, `${scenario}.json`);
        if (!within(path.join(resultsRoot, 'video_workloads'), resultPath)) throw new Error('Saved simulation result path is invalid.');
        const record = JSON.parse(await fs.promises.readFile(resultPath, 'utf8'));
        if (!validProfileSimulationRecord(record, scenario, publicProfile)) {
          throw new Error(`Saved ${scenario} simulation results do not match this video job.`);
        }
        return record;
      }));
      simulationResults = { cloud: records[0], edge: records[1] };
      simulationError = null;
    } catch (error) {
      simulationError = safeVideoError(error.message || 'Saved paired simulation results are unavailable.');
    }
  }

  const completedAt = simulationResults.cloud && simulationResults.edge
    ? simulationResults.edge.completedAt : report.completedAt || new Date().toISOString();
  const job = {
    jobId,
    status: simulationError ? 'simulation_failed' : 'completed',
    analysisStatus: 'completed',
    message: simulationError
      ? 'Saved video analysis was recovered, but its paired simulation results are unavailable.'
      : 'Recovered video analysis and paired cloud/edge simulation results.',
    uploadPath: null,
    displayFilename: report.sourceName || null,
    createdAt: report.completedAt || completedAt,
    startedAt: null,
    analysisCompletedAt: report.completedAt || completedAt,
    completedAt,
    reportPath,
    report,
    error: null,
    simulationStatus: simulationError ? 'failed' : 'completed',
    simulationMessage: simulationError
      ? 'Video analysis is available, but the saved profile simulation could not be recovered.'
      : 'Recovered the saved cloud-only and edge-based results for this video profile.',
    simulationError,
    simulationStartedAt: null,
    simulationCompletedAt: completedAt,
    workloadProfile: publicProfile,
    simulationResults
  };
  videoJobs.set(jobId, job);
  return job;
}

async function getVideoJob(jobId) {
  if (!isValidJobId(jobId)) return null;
  return videoJobs.get(jobId) || await recoverCompletedVideoJob(jobId);
}

function validProfileSimulationRecord(record, scenario, profile) {
  const expectedTuples = profile.tupleCount;
  const used = record?.workloadProfile;
  return validRecord(record, scenario) && used?.jobId === profile.jobId &&
    used?.sourceClassification === profile.sourceClassification &&
    used?.durationSeconds === profile.video.durationSeconds &&
    used?.sourceFps === profile.video.sourceFps &&
    used?.processedFrameCount === profile.video.processedFrameCount &&
    used?.frameProcessingInterval === profile.video.frameProcessingInterval &&
    used?.virtualCameraSources === profile.virtualCameraSources &&
    used?.framesPerTuple === profile.framesPerTuple &&
    used?.tupleCountFromProfile === expectedTuples &&
    used?.tupleGenerationIntervalSeconds === profile.tupleGenerationIntervalSeconds &&
    used?.effectiveTupleArrivalRatePerSecond === profile.effectiveTupleArrivalRatePerSecond &&
    used?.tuplePayloadBytesFromProfile === profile.tuplePayloadBytes &&
    used?.tuplePayloadBasisFromProfile === profile.tuplePayloadBasis &&
    used?.cpuDemandFromProfileMI?.videoAnalyzerMI === profile.cpuDemand.videoAnalyzerMI &&
    used?.cpuDemandFromProfileMI?.eventDetectorMI === profile.cpuDemand.eventDetectorMI &&
    used?.cpuDemandStatusFromProfile === profile.cpuDemand.status &&
    used?.generatedTuples === expectedTuples && used?.tupleIntervalsMatchProfile === true &&
    used?.simulatedVideoFramesSent === false &&
    record.metrics.processedTuples === expectedTuples;
}

function failProfileSimulation(job, message) {
  simulationRunning = false;
  videoAnalysisRunning = false;
  job.simulationStatus = 'failed';
  job.simulationMessage = 'The video analysis succeeded, but its workload simulation failed.';
  job.simulationError = safeVideoError(message);
  job.simulationResults = { cloud: null, edge: null };
  job.status = 'simulation_failed';
  job.message = job.simulationMessage;
  job.completedAt = new Date().toISOString();
  job.simulationCompletedAt = job.completedAt;
}

function startProfileSimulations(job, profilePath) {
  simulationRunning = true;
  videoAnalysisRunning = false;
  job.simulationStatus = 'running';
  job.simulationMessage = 'Running cloud-only and edge-based simulations with this video workload.';
  job.status = 'simulation_running';
  job.message = job.simulationMessage;
  job.simulationStartedAt = new Date().toISOString();

  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let child;
  try {
    child = spawn(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', runScript, '-Profile', profilePath, '-Scenario', 'both'
    ], { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    failProfileSimulation(job, error.message);
    return;
  }

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString('utf8')).slice(-256 * 1024); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-256 * 1024); });
  let finished = false;
  const timeout = setTimeout(() => child.kill(), 30 * 60 * 1000);
  timeout.unref();

  const finalize = async (exitCode, processError = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    if (processError || exitCode !== 0) {
      failProfileSimulation(job, processError?.message || stderr || stdout ||
        `PowerShell simulation exited with code ${exitCode}.`);
      return;
    }
    try {
      const profileResultDir = path.join(resultsRoot, 'video_workloads', job.jobId);
      const [cloud, edge] = await Promise.all(['cloud', 'edge'].map(async scenario => {
        const resultPath = path.join(profileResultDir, `${scenario}.json`);
        if (!within(path.join(resultsRoot, 'video_workloads'), resultPath)) throw new Error('Simulation result path is invalid.');
        const record = JSON.parse(await fs.promises.readFile(resultPath, 'utf8'));
        if (!validProfileSimulationRecord(record, scenario, job.workloadProfile)) {
          throw new Error(`The ${scenario} result does not match this job's workload profile or tuple count.`);
        }
        return record;
      }));
      if (cloud.workloadProfile.jobId !== edge.workloadProfile.jobId ||
          cloud.workloadProfile.tupleCountFromProfile !== edge.workloadProfile.tupleCountFromProfile ||
          cloud.workloadProfile.generatedTuples !== edge.workloadProfile.generatedTuples) {
        throw new Error('Cloud and edge results do not describe the same workload.');
      }
      simulationRunning = false;
      job.simulationResults = { cloud, edge };
      job.simulationStatus = 'completed';
      job.simulationMessage = 'Cloud-only and edge-based simulations completed successfully.';
      job.simulationError = null;
      job.status = 'completed';
      job.message = 'Video analysis and both workload simulations completed.';
      job.completedAt = new Date().toISOString();
      job.simulationCompletedAt = job.completedAt;
    } catch (error) {
      failProfileSimulation(job, error.message);
    }
  };

  child.once('error', error => { finalize(null, error); });
  child.once('close', code => { finalize(code); });
}

function startVideoAnalysis(job, { analysisOnly = false, onComplete = null } = {}) {
  job.status = 'processing';
  job.analysisStatus = 'processing';
  job.message = 'Video analysis is running.';
  job.startedAt = new Date().toISOString();
  videoAnalysisRunning = true;
  let child;
  try {
    const pythonArgs = ['-m', 'app.run_video', job.uploadPath, '--job-id', job.jobId,
      '--display-filename', job.displayFilename];
    if (job.syntheticTestInput) pythonArgs.push('--synthetic-test-input');
    child = spawn(videoPython, pythonArgs, {
      cwd: videoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    videoAnalysisRunning = false;
    job.analysisStatus = 'failed';
    job.status = 'failed';
    job.message = 'Video analysis could not start.';
    job.error = safeVideoError(error.message);
    job.completedAt = new Date().toISOString();
    fs.promises.rm(job.uploadPath, { force: true }).catch(() => {});
    return false;
  }
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString('utf8')).slice(-128 * 1024); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-128 * 1024); });
  let finished = false;
  const timeout = setTimeout(() => child.kill(), 30 * 60 * 1000);
  timeout.unref();

  const finalize = async (exitCode, processError = null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    try {
      await fs.promises.rm(job.uploadPath, { force: true }).catch(() => {});
      if (processError || exitCode !== 0) {
        videoAnalysisRunning = false;
        job.completedAt = new Date().toISOString();
        job.analysisStatus = 'failed';
        job.status = 'failed';
        const detail = processError?.message || stderr || stdout || `Python processor exited with code ${exitCode}.`;
        job.error = safeVideoError(detail);
        job.message = 'Video analysis failed.';
        return;
      }
      const reportLine = stdout.split(/\r?\n/).find(line => line.startsWith('Analytics report: '));
      if (!reportLine) {
        videoAnalysisRunning = false;
        job.completedAt = new Date().toISOString();
        job.analysisStatus = 'failed';
        job.status = 'failed';
        job.error = 'Python processing finished without returning an analytics report.';
        job.message = 'Video analysis failed.';
        return;
      }
      const reportPath = path.resolve(reportLine.slice('Analytics report: '.length).trim());
      if (!within(videoOutputsRoot, reportPath) || path.basename(reportPath) !== 'report.json') {
        videoAnalysisRunning = false;
        job.completedAt = new Date().toISOString();
        job.analysisStatus = 'failed';
        job.status = 'failed';
        job.error = 'Python processor returned an invalid private report reference.';
        job.message = 'Video analysis failed.';
        return;
      }
      let report;
      try {
        report = JSON.parse(await fs.promises.readFile(reportPath, 'utf8'));
        if (report.status !== 'completed' || report.jobId !== job.jobId || !report.video || !Array.isArray(report.events)) {
          throw new Error('The analytics report has an invalid structure.');
        }
        const outputRelative = report.video.annotatedVideo;
        const outputMatch = typeof outputRelative === 'string' && outputRelative.match(/^outputs\/([a-f0-9]{32})\/annotated\.mp4$/);
        if (!outputMatch || outputMatch[1] !== job.jobId) throw new Error('The annotated video reference is invalid.');
        const outputPath = path.resolve(videoOutputsRoot, outputMatch[1], 'annotated.mp4');
        if (!within(videoOutputsRoot, outputPath) || !fs.existsSync(outputPath)) throw new Error('The annotated video is missing.');
        for (const event of report.events) {
          if (event.evidence_frame && !new RegExp(`^evidence/${job.jobId}/[a-f0-9]{32}\\.jpg$`).test(event.evidence_frame)) {
            throw new Error('An evidence reference in the analytics report is invalid.');
          }
        }
      } catch (error) {
        videoAnalysisRunning = false;
        job.completedAt = new Date().toISOString();
        job.analysisStatus = 'failed';
        job.status = 'failed';
        job.error = safeVideoError(error.message);
        job.message = 'Video analysis failed.';
        return;
      }

      job.reportPath = reportPath;
      job.report = report;
      job.analysisStatus = 'completed';
      job.analysisCompletedAt = new Date().toISOString();

      const workloadProfilePath = path.join(videoOutputsRoot, 'workloads', `${job.jobId}.json`);
      let workloadProfile;
      try {
        if (!within(videoOutputsRoot, workloadProfilePath) || !fs.existsSync(workloadProfilePath)) {
          throw new Error('Python processing completed without creating the job workload profile.');
        }
        workloadProfile = JSON.parse(await fs.promises.readFile(workloadProfilePath, 'utf8'));
        if (!validWorkloadProfile(workloadProfile, job.jobId)) {
          throw new Error('The generated workload profile is invalid or does not match this video job.');
        }
      } catch (error) {
        failProfileSimulation(job, error.message);
        return;
      }
      job.workloadProfile = publicWorkloadProfile(workloadProfile);
      if (analysisOnly) {
        job.status = 'analysis_completed';
        job.simulationStatus = 'included_in_batch';
        job.simulationMessage = 'Use the parent recording batch comparison.';
        job.completedAt = job.analysisCompletedAt;
        job.message = 'Camera analysis completed; its workload belongs to the batch comparison.';
        videoAnalysisRunning = false;
        return;
      }
      job.status = 'simulation_pending';
      job.simulationStatus = 'pending';
      job.simulationMessage = 'Workload profile validated; cloud and edge simulations are pending.';
      job.message = 'Video analysis completed. Cloud and edge simulations are starting.';
      startProfileSimulations(job, workloadProfilePath);
    } finally {
      if (analysisOnly) onComplete?.(job);
    }
  };

  child.once('error', error => { finalize(null, error); });
  child.once('close', code => { finalize(code); });
  return true;
}

async function sendPrivateFile(request, response, filePath, contentType, downloadName = null) {
  let stat;
  try { stat = await fs.promises.stat(filePath); } catch { sendJson(response, 404, { message: 'Requested video artifact was not found.' }); return; }
  if (!stat.isFile()) { sendJson(response, 404, { message: 'Requested video artifact was not found.' }); return; }
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
  const range = request.headers.range;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    headers['Content-Length'] = end - start + 1;
    response.writeHead(206, headers);
    fs.createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  headers['Content-Length'] = stat.size;
  response.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(response);
}

async function handleVideoApi(request, response, pathname, searchParams) {
  if (pathname.startsWith('/api/video/batches')) {
    await multiVideoApi.handle(request, response, pathname);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/video/upload') {
    await handleVideoUpload(request, response);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/video/analyze') {
    if (!videoSettings || !fs.existsSync(videoPython)) {
      sendJson(response, 503, { message: 'Video analytics Python environment is unavailable.' });
      return;
    }
    let body;
    try { body = await readJsonBody(request); } catch (error) { sendJson(response, error.statusCode || 400, { message: error.message }); return; }
    if (!isValidJobId(body.jobId)) { sendJson(response, 400, { message: 'A valid uploaded job ID is required.' }); return; }
    const job = videoJobs.get(body.jobId);
    if (!job) { sendJson(response, 404, { message: 'Video job not found.' }); return; }
    if (job.status !== 'uploaded') { sendJson(response, 409, { message: 'This video job has already been started.' }); return; }
    if (simulationRunning || videoAnalysisRunning || batchRunning) { sendJson(response, 409, { message: 'Another compute job is running. Try again after it finishes.' }); return; }
    if (!startVideoAnalysis(job)) {
      sendJson(response, 503, { message: job.error || 'Python processor could not be started.' });
      return;
    }
    sendJson(response, 202, { jobId: job.jobId, status: job.status, message: job.message });
    return;
  }

  let match = pathname.match(/^\/api\/video\/(status|results)\/([a-f0-9]{32})$/);
  if (request.method === 'GET' && match) {
    const [, kind, jobId] = match;
    const job = await getVideoJob(jobId);
    if (!job) { sendJson(response, 404, { message: 'Video job not found.' }); return; }
    if (kind === 'status') {
      sendJson(response, 200, {
        jobId, status: job.status, analysisStatus: job.analysisStatus,
        ...(job.batchId ? { batchId: job.batchId, cameraId: job.cameraId } : {}),
        simulationStatus: job.simulationStatus, message: job.message,
        error: job.error,
        analysisError: job.error, simulationError: job.simulationError,
        simulationMessage: job.simulationMessage, workloadProfile: job.workloadProfile,
        createdAt: job.createdAt, startedAt: job.startedAt || null,
        analysisCompletedAt: job.analysisCompletedAt || null,
        simulationStartedAt: job.simulationStartedAt || null,
        simulationCompletedAt: job.simulationCompletedAt || null,
        completedAt: job.completedAt || null, progress: null
      });
      return;
    }
    if (job.analysisStatus !== 'completed' || !job.report) { sendJson(response, 409, { message: 'Analytics results are not ready.', status: job.analysisStatus }); return; }
    if (searchParams.get('download') === '1') {
      await sendPrivateFile(request, response, job.reportPath, 'application/json; charset=utf-8', `edgevision-${jobId}-report.json`);
    } else {
      sendJson(response, 200, { ...reportForApi(job.report, jobId), ...(job.batchId ? { batchId: job.batchId, cameraId: job.cameraId } : {}) });
    }
    return;
  }

  match = pathname.match(/^\/api\/video\/simulation\/([a-f0-9]{32})$/);
  if (request.method === 'GET' && match) {
    const job = await getVideoJob(match[1]);
    if (!job) { sendJson(response, 404, { message: 'Video job not found.' }); return; }
    sendJson(response, 200, {
      jobId: job.jobId,
      ...(job.batchId ? { batchId: job.batchId, cameraId: job.cameraId } : {}),
      status: job.simulationStatus,
      message: job.simulationMessage,
      error: job.simulationError,
      workloadProfile: job.workloadProfile,
      cloud: job.simulationResults?.cloud || null,
      edge: job.simulationResults?.edge || null
    });
    return;
  }

  match = pathname.match(/^\/api\/video\/output\/([a-f0-9]{32})$/);
  if (request.method === 'GET' && match) {
    const job = await getVideoJob(match[1]);
    if (!job || job.analysisStatus !== 'completed' || !job.report) { sendJson(response, 404, { message: 'Video output not found.' }); return; }
    const outputRelative = job.report.video.annotatedVideo;
    const outputMatch = typeof outputRelative === 'string' && outputRelative.match(/^outputs\/([a-f0-9]{32})\/annotated\.mp4$/);
    if (!outputMatch) { sendJson(response, 404, { message: 'Video output not found.' }); return; }
    const filePath = path.resolve(videoOutputsRoot, outputMatch[1], 'annotated.mp4');
    if (!within(videoOutputsRoot, filePath)) { sendJson(response, 404, { message: 'Video output not found.' }); return; }
    await sendPrivateFile(request, response, filePath, 'video/mp4');
    return;
  }

  match = pathname.match(/^\/api\/video\/evidence\/([a-f0-9]{32})\/([a-f0-9]{32})$/);
  if (request.method === 'GET' && match) {
    const [, jobId, eventId] = match;
    const job = await getVideoJob(jobId);
    const event = job?.analysisStatus === 'completed' ? job.report?.events.find(item => item.event_id === eventId) : null;
    if (!event?.evidence_frame) { sendJson(response, 404, { message: 'Evidence image not found.' }); return; }
    const evidenceMatch = event.evidence_frame.match(/^evidence\/([a-f0-9]{32})\/([a-f0-9]{32})\.jpg$/);
    if (!evidenceMatch) { sendJson(response, 404, { message: 'Evidence image not found.' }); return; }
    const filePath = path.resolve(videoEvidenceRoot, evidenceMatch[1], `${evidenceMatch[2]}.jpg`);
    if (!within(videoEvidenceRoot, filePath)) { sendJson(response, 404, { message: 'Evidence image not found.' }); return; }
    await sendPrivateFile(request, response, filePath, 'image/jpeg');
    return;
  }
  sendJson(response, 404, { message: 'Video analytics endpoint not found.' });
}

function validRecord(record, scenario) {
  return record && record.scenario === scenario && record.metrics &&
    ['loopLatencyMs', 'networkUsageMb', 'energyJoules', 'simulationTimeSeconds', 'processedTuples']
      .every(key => typeof record.metrics[key] === 'number' && Number.isFinite(record.metrics[key])) &&
    (record.metrics.analyticsLatencyMs == null || (typeof record.metrics.analyticsLatencyMs === 'number' && Number.isFinite(record.metrics.analyticsLatencyMs)));
}

async function readResult(scenario) {
  const resultPath = path.join(resultsRoot, `${scenario}.json`);
  let record;
  try {
    record = JSON.parse(await fs.promises.readFile(resultPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read ${scenario} results: ${error.message}`);
  }
  if (!validRecord(record, scenario)) throw new Error(`The saved ${scenario} result file has an invalid structure.`);
  return record;
}

async function runScenario(scenario, cameraCount, workloadProfileId) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runScript, '-Scenario', scenario, '-CameraCount', String(cameraCount), '-WorkloadProfileId', workloadProfileId], {
      cwd: projectRoot,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024
    });
  } catch (error) {
    const details = [error.stderr, error.stdout, error.message].filter(Boolean).join('\n').trim();
    throw new Error(`${scenario} simulation failed${error.killed ? ' (timed out)' : ''}: ${details}`);
  }
  const record = await readResult(scenario);
  if (!record) throw new Error(`${scenario} simulation finished without creating results/${scenario}.json.`);
  const profile = record.workloadProfile;
  if (profile?.type !== 'standalone_virtual_camera' || profile.workloadProfileId !== workloadProfileId ||
      profile.virtualCameraSources !== cameraCount || profile.tupleCount !== cameraCount * 150 ||
      record.metrics.processedTuples !== profile.tupleCount) {
    throw new Error(`${scenario} simulation results do not match the requested virtual-camera workload.`);
  }
  return record;
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', simulationRunning, videoAnalysisRunning, multiVideoRunning: batchRunning,
      videoAnalyticsAvailable: Boolean(videoSettings && fs.existsSync(videoPython)) });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/results') {
    try {
      const [cloud, edge] = await Promise.all([readResult('cloud'), readResult('edge')]);
      sendJson(response, 200, { cloud, edge, simulationRunning });
    } catch (error) {
      sendJson(response, 500, { message: error.message });
    }
    return;
  }

  if (request.method === 'POST' && ['/api/simulate/cloud', '/api/simulate/edge', '/api/simulate/both'].includes(pathname)) {
    if (simulationRunning || videoAnalysisRunning || batchRunning) {
      sendJson(response, 409, { message: 'A compute job is already running. Wait for it to finish before starting another.' });
      return;
    }
    let body;
    try {
      body = await readOptionalJsonBody(request);
    } catch (error) {
      sendJson(response, error.statusCode || 400, { message: error.message });
      return;
    }
    const cameraCount = body.cameraCount === undefined ? 5 : body.cameraCount;
    if (!Number.isInteger(cameraCount) || cameraCount < 1 || cameraCount > 10) {
      sendJson(response, 400, { message: 'cameraCount must be an integer from 1 to 10.' });
      return;
    }
    // Reading the request body yields; another request may have acquired the compute slot.
    if (simulationRunning || videoAnalysisRunning || batchRunning) {
      sendJson(response, 409, { message: 'A compute job is already running. Wait for it to finish before starting another.' });
      return;
    }
    const workloadProfileId = randomUUID().replace(/-/g, '');
    simulationRunning = true;
    try {
      if (pathname.endsWith('/both')) {
        const cloud = await runScenario('cloud', cameraCount, workloadProfileId);
        const edge = await runScenario('edge', cameraCount, workloadProfileId);
        if (!cloud.workloadProfile || !edge.workloadProfile ||
            JSON.stringify(cloud.workloadProfile) !== JSON.stringify(edge.workloadProfile)) {
          throw new Error('Cloud and edge simulations did not use the same virtual-camera workload.');
        }
        sendJson(response, 200, { cloud, edge });
      } else {
        const scenario = pathname.endsWith('/cloud') ? 'cloud' : 'edge';
        sendJson(response, 200, await runScenario(scenario, cameraCount, workloadProfileId));
      }
    } catch (error) {
      sendJson(response, 500, { message: error.message });
    } finally {
      simulationRunning = false;
    }
    return;
  }

  sendJson(response, 404, { message: 'API endpoint not found.' });
}

const multiVideoApi = require('./multi-video').createMultiVideoApi({
  outputsRoot: videoOutputsRoot, resultsRoot, settings: videoSettings,
  readJsonBody, sendJson, uploadVideo: handleVideoUpload, getVideoJob,
  validWorkloadProfile, validRecord, safeError: safeVideoError,
  isBusy: () => simulationRunning || videoAnalysisRunning || batchRunning ||
    [...videoJobs.values()].some(job => job.status === 'uploaded' && !job.batchId),
  setBusy: value => { batchRunning = value; },
  analyzeVideo: job => new Promise(resolve => {
    if (!startVideoAnalysis(job, { analysisOnly: true, onComplete: resolve })) resolve(job);
  }),
  runSimulation: async profilePath => {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', runScript, '-Profile', profilePath, '-Scenario', 'both'],
    { cwd: projectRoot, windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
  }
});

const server = http.createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (pathname.startsWith('/api/video/')) {
      await handleVideoApi(request, response, pathname, new URL(request.url, 'http://localhost').searchParams);
    } else {
      await handleApi(request, response, pathname);
    }
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Could not read file');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    response.end(content);
  });
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the existing EdgeVision server with Ctrl+C before restarting.`);
    process.exitCode = 1;
    return;
  }
  console.error(`EdgeVision server could not start: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`EdgeVision dashboard: http://127.0.0.1:${port}`);
  console.log('Stop the server with Ctrl+C.');
});

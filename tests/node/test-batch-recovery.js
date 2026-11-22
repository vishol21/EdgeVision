/* Saved-artifact recovery checks in disposable OS-temp fixtures; no video inference. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMultiVideoApi, publicProfile, combineProfiles } = require('../../server/multi-video');
const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, '../../simulation/experiments/evidence/stage7-2026-11-17/raw.json'), 'utf8'));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edgevision-recovery-unit-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('edgevision-recovery-unit-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const original = evidence.cases.find(c => c.caseId === 'recordings-2').inputProfile;
  const input = combineProfiles(original.jobId, original.sources);
  const run = evidence.runs.find(r => r.caseId === 'recordings-2');
  const outputsRoot = path.join(root, 'outputs'), resultsRoot = path.join(root, 'results');
  const write = (name, data) => { fs.mkdirSync(path.dirname(name), {recursive:true}); fs.writeFileSync(name, JSON.stringify(data)); };
  const cameras = input.sources.map(s => {
    write(path.join(outputsRoot,'workloads',s.jobId+'.json'),s.workloadProfile);
    write(path.join(outputsRoot,s.jobId,'report.json'),{jobId:s.jobId,status:'completed',video:{processedFrameCount:s.workloadProfile.video.processedFrameCount},objectCountsByClass:{},eventCount:0,processing:{processingDurationSeconds:1}});
    fs.writeFileSync(path.join(outputsRoot,s.jobId,'annotated.mp4'),'test-only artifact presence; not a playable video');
    return {cameraId:s.cameraId,jobId:s.jobId,filename:'synthetic.avi',status:'completed'};
  });
  const manifest = {batchId:input.jobId,status:'completed',simulationStatus:'completed',profile:publicProfile(input,2),cameras,message:'Completed fixture'};
  const manifestPath = path.join(outputsRoot,'batches',input.jobId,'batch.json');
  write(manifestPath,manifest); write(path.join(path.dirname(manifestPath),'workload.json'),input);
  for (const s of ['cloud','edge']) write(path.join(resultsRoot,'video_batches',input.jobId,s+'.json'),run[s].result);
  const api=createMultiVideoApi({outputsRoot,resultsRoot,settings:{upload:{max_file_size_bytes:524288000}},
    validWorkloadProfile:()=>true,validRecord:()=>true,safeError:x=>x,
    getVideoJob:async id=>{
      if(id==='a'.repeat(32)) return {analysisStatus:'completed'};
      try { return {analysisStatus:'completed',report:JSON.parse(fs.readFileSync(path.join(outputsRoot,id,'report.json'),'utf8'))}; } catch { return null; }
    },sendJson:(res,status,body)=>Object.assign(res,{status,body})});
  const get=async id=>{const res={}; await api.handle({method:'GET'},res,'/api/video/batches/'+id); return res;};
  return {input,get,outputsRoot,manifestPath,manifest,write};
}

test('wrong Job ID and unknown Batch ID have distinct useful errors', async t=>{
  const f=fixture(t);
  const wrong=await f.get('a'.repeat(32)); assert.equal(wrong.status,404); assert.match(wrong.body.message,/single-video Job ID/);
  const absent=await f.get('b'.repeat(32)); assert.equal(absent.status,404); assert.match(absent.body.message,/same project\/server/);
});

test('completed batch validates artifacts even when cached; restoration permits a later retry', async t=>{
  const f=fixture(t), id=f.input.jobId;
  assert.equal((await f.get(id)).body.status,'completed');
  const artifact=path.join(f.outputsRoot,f.input.sources[0].jobId,'annotated.mp4');
  fs.renameSync(artifact,artifact+'.held');
  try {
    const missing=await f.get(id); assert.equal(missing.body.status,'simulation_failed');
    assert.match(missing.body.error,/missing or invalid/); assert.equal(missing.body.simulation.cloud,null);
  } finally {fs.renameSync(artifact+'.held',artifact);}
  const restored=await f.get(id); assert.equal(restored.body.status,'completed');
  assert.equal(restored.body.cameras.length,2); assert.equal(restored.body.simulation.cloud.metrics.processedTuples,32);
});

test('corrupt manifest and absent completed profile produce explicit diagnostics', async t=>{
  const f=fixture(t); fs.writeFileSync(f.manifestPath,'{invalid');
  const corrupt=await f.get(f.input.jobId); assert.equal(corrupt.status,409); assert.match(corrupt.body.message,/manifest/);
  f.write(f.manifestPath,{...f.manifest,cameras:[null]});
  assert.equal((await f.get(f.input.jobId)).status,409);
  f.write(f.manifestPath,{...f.manifest,profile:null});
  const missing=await f.get(f.input.jobId); assert.equal(missing.body.status,'simulation_failed'); assert.match(missing.body.error,/no combined workload/);
});

test('missing saved report is not accepted as a complete recovered comparison', async t=>{
  const f=fixture(t); const report=path.join(f.outputsRoot,f.input.sources[1].jobId,'report.json');
  fs.renameSync(report,report+'.held');
  try {
    const res=await f.get(f.input.jobId); assert.equal(res.body.status,'simulation_failed'); assert.match(res.body.error,/report.*missing or invalid/);
  } finally {fs.renameSync(report+'.held',report);}
});

'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { combineProfiles, publicProfile, validBatchResult } = require('./multi-video');
const source = (character, frames, fps, framesPerTuple) => ({ cameraId: character.repeat(32), jobId: (character === 'a' ? 'c' : 'd').repeat(32),
  workloadProfile: { jobId: (character === 'a' ? 'c' : 'd').repeat(32), sourceClassification: 'synthetic_test',
    video: { durationSeconds: frames / fps },
    iFogSimWorkload: { virtualCameraSources: 1, frameBatching: { framesPerTuple, tupleCount: Math.ceil(frames / framesPerTuple) },
      proposedTupleGenerationIntervalSeconds: framesPerTuple / fps, tuplePayloadBytes: null, tuplePayloadBasis: 'unavailable_not_serialized',
      cpuDemand: { videoAnalyzerMI: null, eventDetectorMI: null, status: 'unavailable' } } } });

test('combined profiles retain independent batches/intervals and longest recording duration', () => {
  const a = source('a', 20, 10, 3);
  const b = source('b', 12, 4, 5);
  const profile = combineProfiles('e'.repeat(32), [a, b]);
  assert.equal(profile.tupleCount, 10); // ceil(20/3) + ceil(12/5), never ceil(32/common batch).
  assert.equal(profile.durationSeconds, 3);
  assert.equal(profile.cameraCount, 2);
  assert.equal(profile.sources[0].workloadProfile.iFogSimWorkload.proposedTupleGenerationIntervalSeconds, 0.3);
  assert.equal(profile.sources[1].workloadProfile.iFogSimWorkload.proposedTupleGenerationIntervalSeconds, 1.25);
  const visible = publicProfile(profile, 3);
  assert.equal(visible.requestedCameraCount, 3);
  assert.equal(visible.sources[0].tupleCount, 7);
  assert.equal(visible.sources[1].tupleCount, 3);
});

test('combined identities reject duplicate cameras, duplicate jobs and batch/video aliasing', () => {
  const a = source('a', 20, 10, 1); const b = source('b', 12, 4, 1);
  assert.throws(() => combineProfiles('e'.repeat(32), [a, a]), /distinct/);
  assert.throws(() => combineProfiles(a.jobId, [a, b]), /distinct/);
  b.jobId = a.jobId; b.workloadProfile.jobId = a.jobId;
  assert.throws(() => combineProfiles('e'.repeat(32), [a, b]), /distinct/);
});

test('batch result validation rejects swapped cameras and partial tuple processing', () => {
  const sources = [source('a', 20, 10, 1), source('b', 12, 4, 1)];
  const profile = combineProfiles('e'.repeat(32), sources);
  const record = { scenario: 'cloud', metrics: { processedTuples: 32 }, workloadProfile: { type: 'multi_video', jobId: profile.jobId,
    virtualCameraSources: 2, tupleCountFromProfile: 32, generatedTuples: 32, durationSeconds: 3,
    aggregationPolicy: profile.aggregationPolicy, simulatedVideoFramesSent: false, tupleIntervalsMatchProfile: true,
    sources: sources.map(source => ({ cameraId: source.cameraId, jobId: source.jobId,
      tupleCount: source.workloadProfile.iFogSimWorkload.frameBatching.tupleCount,
      generatedTuples: source.workloadProfile.iFogSimWorkload.frameBatching.tupleCount,
      processedTuples: source.workloadProfile.iFogSimWorkload.frameBatching.tupleCount,
      tupleIntervalSeconds: source.workloadProfile.iFogSimWorkload.proposedTupleGenerationIntervalSeconds,
      durationSeconds: source.workloadProfile.video.durationSeconds, sourceClassification: 'synthetic_test',
      tupleIntervalsMatchProfile: true, videoAnalyzerMIPerTupleUsed: 1000, eventDetectorMIPerTupleUsed: 2000,
      cameraTuplePayloadBytesUsed: 20000, cpuDemandStatus: 'unavailable', tuplePayloadBasis: 'unavailable_not_serialized' })) } };
  const valid = (value, scenario) => value.scenario === scenario;
  assert.equal(validBatchResult(record, 'cloud', profile, valid), true);
  record.workloadProfile.sources.reverse();
  assert.equal(validBatchResult(record, 'cloud', profile, valid), false);
  record.workloadProfile.sources.reverse(); record.workloadProfile.sources[0].processedTuples--;
  assert.equal(validBatchResult(record, 'cloud', profile, valid), false);
});

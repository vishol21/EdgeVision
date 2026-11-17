# Multiple uploaded camera recordings

Stage 4 extends the existing single-video workflow. It does not add live feeds, physical camera registration or deployed fog/cloud devices. Python still runs YOLO26n and ByteTrack locally; iFogSim receives workload descriptions, never video frames.

## Use the website

Start `npm start` from the project root. The original single-video uploader remains available. In **Multiple camera recordings**, select 2-10 recordings and choose **Analyze camera recordings**. Each selected recording receives a unique camera ID and a separate video job ID, even if filenames repeat.

Uploads stream to private files. Python analyzes one camera at a time using the existing pipeline and writes its own report, annotated video, evidence (if a configured rule fires) and workload profile. The table shows each camera's progress, upload rejection or decode/analysis failure. **View analytics** opens the individual camera report without changing the selected combined comparison.

If at least one camera succeeds, both placements run on the exact same combined profile. Partial success explicitly excludes failed cameras and keeps their errors visible. If all cameras fail, no combined simulation runs. If simulation fails, successful camera analytics remain available. The aggregate counts sum observations, rule events and camera-scoped tracking IDs; they do not identify the same person or vehicle across cameras. Zero events are not evidence of safety.

Save the batch ID shown in the summary. Refresh deliberately starts with neutral standalone results. Enter the saved ID under **Recover a recording batch by ID** to load that batch explicitly, including after a Node restart. The existing virtual-camera controls stay inactive while a recording comparison is selected; switching to virtual-camera simulation clears the shared result view.

## Resource and processing implications

Defaults in `config/settings.json`:

| Setting | Default |
|---|---:|
| Per-recording upload limit (existing) | 500 MiB |
| `multi_video.max_cameras` | 10 |
| `multi_video.max_total_file_size_bytes` | 1 GiB |
| `multi_video.max_combined_tuples` | 100,000 |

One model/inference process runs at a time; models are loaded separately for each recording. Processing time therefore roughly adds across videos, plus model-loading and I/O overhead. Node allows one compute job at a time, including single-video, batch and standalone simulation jobs. It does not process videos concurrently to imply real-time multi-camera capacity.

Python frame/model memory is bounded by sequential processing, but Node caches completed analytics reports and Java retains tuple telemetry. The combined-tuple cap limits new batch simulation size; it is checked after video analysis. Exceeding it preserves individual analytics and reports a comparison failure. The simulation horizon is conservatively expanded for long/large combined traces; all sources and placements use the same horizon. This affects modeled idle energy and must be disclosed in experiments.

The input limits are not an output-storage quota. Uploaded originals, Python's temporary copy for the active camera, annotated videos, reports and evidence can require substantially more disk space than the uploaded inputs alone. Temporary input copies are removed after processing as in the existing workflow; completed outputs are retained. Interrupted/draft batches are not resumed automatically and their unprocessed uploads can remain on disk. No historical results are deleted automatically. Long-recording, maximum-size and memory/disk stress tests have not been performed.

All cameras currently use the shared detection/tracking/rule settings and normalized regions. Per-camera region editing and cross-camera re-identification are not implemented. Default regions are empty, so region-based rules are not evaluated.

## Combined workload and identity

The combined JSON uses `schemaVersion: 2`, `profileType: "multi_video"` and `aggregationPolicy: "concurrent_start_independent_traces"`. It contains the batch job ID, successful camera count, sum of source tuple counts, maximum recording duration and a `sources` array. Each source contains its camera ID, video job ID and complete original single-video workload profile.

Every camera has an independent finite Sensor and its own tuple count and interval. Cameras begin at the same simulated origin after CloudSim's startup offset; this is an experiment assumption, not a claim that the footage timestamps are synchronized. Unequal durations/FPS and per-camera frame batching are retained; there is no invented common FPS or round-robin redistribution of video tuples. The combined duration is the longest recording, not the sum of durations. Tuple counts sum the already rounded counts from each individual camera profile.

Camera-specific tuple types carry identity through the existing three modules. Each profile's configured CPU estimates and payload assumption are preserved; otherwise the existing Java defaults apply. Result metadata records actual emissions, intervals, cloud-storage arrivals and CPU/payload values for each camera. A separate batch accumulator measures the combined application-loop average; it does not report a first-camera-only average. The existing legacy latency-unit mismatch remains documented in Stage 3: exported `*LatencyMs` values are raw simulator time units until an explicit unit-contract correction is approved.

Private storage:

```text
video_analytics/outputs/<camera-job-id>/report.json
video_analytics/outputs/<camera-job-id>/annotated.mp4
video_analytics/outputs/<camera-job-id>/batch-source.json
video_analytics/outputs/workloads/<camera-job-id>.json
video_analytics/outputs/batches/<batch-id>/batch.json
video_analytics/outputs/batches/<batch-id>/workload.json
results/video_batches/<batch-id>/cloud.json
results/video_batches/<batch-id>/edge.json
```

Single-video comparisons retain `results/video_workloads/<job-id>/`; standalone results retain their original paths. Camera-to-batch sidecars are validated against the parent manifest during recovery, so an analysis-only camera does not falsely claim its own standalone video simulation failed. Recovery revalidates source profiles, report/frame identities, combined profile and both result records before publishing a comparison. Mismatched camera/job identities withhold both scenario records. An interrupted unfinished batch is clearly marked; completed camera artifacts remain accessible and no comparison is invented.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/video/batches/config` | Actual file/camera/tuple limits |
| POST | `/api/video/batches` | Create a manifest with `cameras: [{filename, sizeBytes}, ...]` |
| POST | `/api/video/batches/{batchId}/cameras/{cameraId}` | Raw upload; matching URL-encoded `X-File-Name` and Content-Length |
| POST | `/api/video/batches/{batchId}/run` | Start sequential analysis and paired comparison after uploads finish |
| GET | `/api/video/batches/{batchId}` | Camera statuses, aggregate analytics, profile summary and paired results |

The existing per-video report/output/evidence endpoints serve each successful camera's artifacts. JSON report/status responses additionally identify the camera and parent batch; raw downloaded Python reports retain their original schema and job ID. Batch states include `draft`, `processing`, `simulation_running`, `completed`, `partial_success`, `failed`, `simulation_failed` and `interrupted`. Camera failures remain explicit and do not become successful sources silently.

## Verification and reproduction

Verified on 2026-11-17 in an isolated project copy: the original single-video/standalone API suite passed; 23 Python tests and 11 frontend state/profile tests passed; the six-count standalone sensor/timing regression passed. The new batch suite passed the unequal two-camera case, partial/all failures and forced combined-simulation failure. Restart checks passed for the batch and camera artifacts/status associations. A swapped saved camera identity withheld both comparison records; a configured 31-tuple cap rejected a 32-tuple combined simulation while preserving analytics. Controlled Java checks preserved per-source CPU/payload/batching, completed ten sources and rejected nine malformed profiles. Browser checks covered sequential processing, individual reports, explicit recovery, partial/all failure and narrow-screen controls. [Reviewed evidence](../simulation/validation/stage4-integration.json) records these fixture cases; it is not an accuracy benchmark.

Use a dedicated idle project copy/server with the pinned simulator built and Python/model setup complete. Set `NODE_ENV=test` in its server terminal before `npm start`; only explicitly marked API fixture uploads get `synthetic_test` provenance. Normal UI uploads are not automatically labeled synthetic.

```powershell
.\simulation\build.ps1
node --test frontend/test-state.js frontend/test-multi-video-unit.js
Push-Location video_analytics
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Pop-Location
```

Against the same dedicated server and from that copy's project root:

```powershell
node frontend/test-api.js http://127.0.0.1:4176
node frontend/test-multi-video.js http://127.0.0.1:4176
```

The multi-video test generates a second moving-shape fixture under ignored `tests/.runtime/` if needed. The first clip has 20 frames at 10 FPS (2 s), the second 12 frames at 4 FPS (3 s). It verifies 32 total tuples with independent 0.1/0.25 s intervals, partial/all failure, busy locks, limits and simulation-failure isolation. It temporarily holds `run.ps1` inside try/finally for the failure case; do not run concurrent tests/users against that copy. Test artifacts are retained and are not detection-accuracy evidence.

The test prints `RECOVERY_BATCH_ID`. Restart the dedicated server, then run:

```powershell
node frontend/test-multi-video.js http://127.0.0.1:4176 --recover <batch-id>
```

Controlled Java profile checks use the successful first camera's profile path from that batch:

```powershell
node frontend/test-multi-profile.js video_analytics/outputs/workloads/<camera-job-id>.json
```

That test verifies different frame batches, intervals, test-only CPU estimates and payload assumptions, ten sources, and rejection of nine malformed profiles. Controlled CPU numbers are test inputs, not a claimed hardware calibration. No labeled real CCTV dataset or real-world detection/tracking accuracy was evaluated in this stage.

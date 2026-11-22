# EdgeVision

## Project overview

EdgeVision is a final-year B.Tech research prototype for local CCTV video analytics and cloud-versus-edge workload simulation. It has two connected components:

- Python analyzes uploaded recordings using YOLO26n, ByteTrack and OpenCV.
- Java and iFogSim simulate where the resulting processing workload is placed.

Python produces a workload profile; iFogSim reads that profile. **Actual video frames, detections and evidence images are not sent to iFogSim.** Simulation results are modeled outcomes, not measurements from a physical cloud or camera network.

The selected research paper is *Real-Time Video Analytics at the Edge: Enabling Low-Latency and Scalable Solutions*, ICCCNP 2025, DOI [10.1109/ICCCNP63914.2025.11233420](https://doi.org/10.1109/ICCCNP63914.2025.11233420). The [paper-alignment notes](research/PAPER_ALIGNMENT.md) explain the implementation differences and limits; exact replication is not claimed. The earlier 2019 reference remains historical context.

## Main features

- Analyze one uploaded recording or a batch of 2-10 camera recordings.
- Detect configured people, cars, motorcycles and buses; maintain camera-scoped ByteTrack IDs.
- Evaluate configurable intrusion, loitering, wrong-direction, crowd and vehicle-stopping rules.
- Save analytics reports, annotated videos, event evidence and video-derived workload profiles.
- Compare cloud-only and edge-based placement using matching workloads.
- Run standalone virtual-camera simulations with 1-10 sources, independently of uploaded videos.
- Recover saved recording batches, individual reports and comparisons without uploading the original videos again.
- Add recordings across file-picker visits, remove individual selections and clear the selection.

Live RTSP ingestion, physical camera registration and cross-camera re-identification are not implemented. [Live-camera feasibility](video_analytics/LIVE_CAMERA_FEASIBILITY.md) documents proposed future work.

## System architecture and workflow

```text
Browser dashboard (frontend/)
        |
        v
Node HTTP/API server (server/) ----- standalone virtual-camera request
        |                                         |
        v                                         |
Python analytics (video_analytics/)                |
  YOLO26n -> ByteTrack -> activity rules           |
        |                                         |
        +-- report, annotated video, evidence     |
        +-- finite workload profile               |
                       |                          |
                       v                          v
                 PowerShell -> Java / iFogSim
                       |
                       v
             Cloud and edge result records
                       |
                       v
               Dashboard comparison
```

The Node server runs on localhost and starts Python and PowerShell child processes. It allows one active analysis/simulation compute job at a time. Multiple recordings are analyzed sequentially, then successful camera workloads are combined into one comparison. This is not simultaneous live-camera inference.

## Technologies used

| Component | Technology |
|---|---|
| Dashboard | HTML, CSS, browser JavaScript and Chart.js |
| Backend | Node.js built-in HTTP, filesystem and subprocess APIs |
| Video analytics | Python, Ultralytics YOLO26n, ByteTrack, OpenCV, NumPy and PyTorch |
| Simulation | Java, pinned Cloudslab/iFogSim source and bundled JARs |
| Automation and tests | PowerShell, Node test runner and Python unittest |

The current Node server has no third-party npm dependencies. Chart.js and web fonts load from external CDNs; if charts are unavailable, cards and tables remain usable with a notice. Python dependencies are pinned in [requirements.txt](video_analytics/requirements.txt).

## Project folder structure

```text
EdgeVision/
|-- README.md                     Main project guide
|-- PROJECT_STATUS.md             Approvals, changes and verification history
|-- package.json                  Root npm-start command
|-- index.html                    Convenience redirect
|-- frontend/                     Dashboard HTML, CSS and browser JavaScript
|-- server/                       Node API server and batch module
|-- tests/node/                   Node unit and integration tests
|-- video_analytics/
|   |-- app/                      Analytics modules and activity rules
|   |-- config/settings.json      Detection, upload, tracking and rule settings
|   |-- tests/                    Python tests and synthetic fixtures
|   |-- models/                   Downloaded weights and model provenance
|   |-- uploads/                  Private processing inputs
|   |-- outputs/                  Reports, annotated videos, profiles and batches
|   |-- evidence/                 Event evidence frames
|   |-- .venv/                    Local Python environment
|   `-- requirements.txt
|-- simulation/
|   |-- src/main/java/            EdgeVision Java simulation source
|   |-- vendor/iFogSim/            Pinned upstream submodule
|   |-- experiments/              Experiment scripts and reviewed evidence
|   |-- tests/                    Java validation harness
|   |-- validation/               Reviewed validation records
|   |-- target/                   Generated Java classes
|   |-- build.ps1
|   |-- run.ps1
|   `-- validate-cameras.ps1
|-- results/                      Generated simulation and evaluation results
|-- docs/                         SETUP.md, DEMO_SCRIPT.md and VIVA_GUIDE.md
`-- research/                     References, alignment and dated research plans
```

This is the only EdgeVision-owned README. Upstream iFogSim and installed Python packages retain their own README files and notices. Those third-party documents are not duplicate project guides.

Git excludes the local environment, downloaded weights, uploads, private outputs/evidence, generated Java classes and results. The small tracked synthetic AVI is an intentional test fixture. Git is not a backup of ignored recovery data; keep private backups separately.

## Installation and setup

### Requirements

The documented Windows setup uses Node.js 22.21.0, Python 3.14 x64 and JDK 23 or newer. The Java scripts compile with `javac --release 23`; the validated JDK was Temurin 23.0.2+7. Other Python/package combinations have not been verified here.

Clone the pinned simulator submodule with the project:

```powershell
git clone --recurse-submodules https://github.com/vishol21/EdgeVision.git
cd EdgeVision
```

For an existing clone with a missing submodule:

```powershell
git submodule update --init --recursive
```

Keep iFogSim at `5f68d3947e450d8d2b4af42670be819206be68c9`. The upstream checkout identifies itself as iFogSim2. EdgeVision builds from its Java source and bundled JARs; no Maven build is required.

### Python environment and model setup

From the repository root:

```powershell
Push-Location video_analytics
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.download_model
.\.venv\Scripts\python.exe -m app.self_check
Pop-Location
```

These are setup commands for a new environment, not instructions to recreate an existing working environment unnecessarily.

The default checkpoint is `yolo26n.pt` from the official Ultralytics assets `v8.4.0` release. Model selection, release and auto-download are configured in `video_analytics/config/settings.json`. The downloader verifies the weight and reports filename, size, SHA-256 and license; provenance is recorded in the model manifest. Weights stay under `video_analytics/models/` and must be obtained separately on a fresh checkout.

The model and Ultralytics software use AGPL-3.0 terms by default; see [Ultralytics licensing](https://www.ultralytics.com/license) before redistribution. Preserve upstream license and font-distribution notices in dependencies. CPU inference is supported; CUDA is selected only when PyTorch reports it available.

### Java setup

Set `JAVA_HOME` to your actual JDK installation. The scripts otherwise check the documented local fallback under `%LOCALAPPDATA%\EdgeVision\jdk-23.0.2+7`. Build from the repository root:

```powershell
.\simulation\build.ps1
```

The scripts use `simulation/vendor/iFogSim/src`, the bundled `jars` and `jars/commons-math3-3.5`, and write compiled classes under `simulation/target/`.

Detailed Windows setup and troubleshooting remain available in [docs/SETUP.md](docs/SETUP.md).

## How to run the project

From the repository root:

```powershell
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The compatibility launcher `npm --prefix frontend start` also works. The Node server now lives under `server/` and explicitly serves browser assets from `frontend/`.

Use one server instance. Stop it with Ctrl+C before restarting after backend changes. If port 4173 is occupied, stop the existing EdgeVision instance in its own terminal; do not terminate unrelated processes. A different port can be selected with `PORT` before startup.

The dashboard contains Dashboard, Video Analytics, and Simulation & Comparison sections. A selected video comparison remains separate from standalone virtual-camera results. Use the explicit comparison-switch controls to change modes; refresh starts with neutral comparison cards rather than silently loading historical standalone results.

### Troubleshooting

| Problem | Check |
|---|---|
| Analytics environment unavailable | Verify `video_analytics/.venv/Scripts/python.exe` and the pinned packages |
| Missing model | Run the downloader from `video_analytics`; inspect model settings and download connectivity |
| Upload rejected | Check enabled extension, container signature and configured size limits |
| No rule events | Check configured regions and thresholds; an empty region list means rules were not evaluated |
| Annotated video will not play | Use the saved-video Open/Download fallback with a compatible player |
| Simulation failed | Check JDK setup, script output and the separate simulation error; analytics may still be available |
| Saved recovery incomplete | Check the matching report, video, workload, associations and comparison files; preserve remaining history |

## Video analytics workflow

### Single recording and multiple recordings

1. Select or drag in one recording and click **Start Analysis**, or choose 2-10 files under **Multiple camera recordings**.
2. For a batch, select files together or add more through later picker visits. Remove individual rows or clear the selection as needed.
3. Wait for analysis and the paired workload simulations. Progress is indeterminate because the processor does not provide reliable frame-by-frame progress.
4. Review camera-scoped observations, unique track IDs, rule coverage, events and the JSON report. Annotated videos are available through saved-artifact endpoints.

Accepted extensions are `.mp4`, `.m4v`, `.mov`, `.avi`, `.mkv` and `.webm`. Current settings allow 500 MiB per file, 1 GiB per batch and 100,000 combined tuples. The batch range is 2-10 recordings. Partial failures remain visible; successful camera profiles retain their own identities and timing.

Reports distinguish per-frame tracked observations from unique IDs. IDs are scoped to a recording; summed IDs across cameras do not represent unique people across the site. Cameras are modeled as concurrently starting independent traces, without claiming the original recordings were synchronized.

The server validates upload extension, size and container signature. Python uses private staged input files and removes temporary uploaded copies after processing completes. Completed reports, annotated videos, profiles and event evidence remain private and are exposed only through the existing artifact APIs. Incomplete uploads can remain after interrupted jobs.

### Command-line analytics

From `video_analytics`, process an existing local file:

```powershell
.\.venv\Scripts\python.exe -m app.run_video "C:\path\to\video.mp4"
```

The CLI creates a UUID-named private copy, validates it and prints the report and workload-profile paths. Reports retain a safe display basename and relative artifact references, not the caller's full path.

To label the existing moving-shape fixture explicitly as synthetic:

```powershell
.\.venv\Scripts\python.exe -m app.run_video ".\tests\fixtures\synthetic_test_clip.avi" --synthetic-test-input
```

This fixture checks processing and profile structure. It does not establish CCTV detection accuracy.

### Regions and activity rules

Edit [video_analytics/config/settings.json](video_analytics/config/settings.json) for a future configured run. Regions use normalized coordinates from 0 to 1 and bounding-box centers. Each region has a unique name, polygon, enabled rules and configured object classes.

| Rule | Behavior |
|---|---|
| `restricted_intrusion` | Emits on a configured entry into a restricted region |
| `loitering` | Emits after the configured time in a region |
| `wrong_direction` | Tests vehicle motion against the region's expected direction |
| `crowd` | Tests unique tracked people against a configured, confirmed threshold |
| `vehicle_stopping` | Tests vehicle movement against time and pixel-distance limits |

Example region object to merge into the existing `regions` array:

```json
{
  "name": "north_gate",
  "polygon": [[0.10, 0.15], [0.65, 0.15], [0.65, 0.85], [0.10, 0.85]],
  "rules": ["restricted_intrusion", "loitering"],
  "object_classes": ["person", "car", "motorcycle", "bus"]
}
```

Wrong-direction rules also need an `expected_direction`, such as `[1, 0]`. Crowd rules can set `max_people` per region or use the global threshold. The default `regions: []` evaluates no region-based rules; reports state this. Fall detection is not implemented. Rule events are potential activity indicators, not proof of harmful or criminal behavior.

### Reports and workload profiles

| Artifact | Repository-relative location |
|---|---|
| Analytics JSON | `video_analytics/outputs/<job-id>/report.json` |
| Annotated video | `video_analytics/outputs/<job-id>/annotated.mp4` |
| Event evidence | `video_analytics/evidence/<job-id>/` |
| Individual workload | `video_analytics/outputs/workloads/<job-id>.json` |
| Batch manifest and combined workload | `video_analytics/outputs/batches/<batch-id>/` |

The report includes model provenance, frame metadata, sampling, processing duration/FPS, class observations, tracking summaries, rule coverage and actual event records. Evidence images are saved only for actual emitted events. Movement history is bounded; it is not a complete trajectory archive.

The separate schema-1 workload profile preserves the job ID, safe filename, duration, dimensions, source FPS, decoded/processed frames, input size, measured processing times, class counts, events and source classification. Classification defaults to `not_labeled`; explicit fixture tests use `synthetic_test`.

With `frames_per_tuple` samples represented by each tuple, the finite count is `ceil(processedFrameCount / frames_per_tuple)`. The nominal interval derives from frame sampling, source FPS and batch size; effective rate is tuple count divided by video duration. A final partial batch is allowed.

Tuple payload and CPU estimates are unavailable by default. The settings block is:

```json
{
  "workload_profile": {
    "frames_per_tuple": 1,
    "tuple_payload_bytes": null,
    "cpu_calibration": {
      "mi_per_wall_second": null,
      "reference_hardware": null,
      "method": null
    }
  }
}
```

An explicit payload is a configured assumption, not measured video bytes. Input file size must not be substituted for tuple payload size. CPU estimates require a documented calibration factor, method and reference hardware, and cover only YOLO/ByteTrack and anomaly-stage wall times. They exclude decoding, drawing and encoding. No defensible hardware MI calibration currently exists; wall-clock milliseconds alone are insufficient.

### Recovery and API routes

Use the **Batch ID** shown for a recording batch, not an individual recording's **Job ID**. Batch recovery restores camera rows, reports, workloads and the paired comparison. Saved-video playback and Open/Download links use saved artifacts; original uploads are not required. Existing annotated MP4s may need an external compatible player.

Completed single-video jobs also recover through their job-specific APIs after restart. There is no separate single-job recovery field in the UI. Incomplete jobs are not automatically resumed. Recovery checks missing or invalid artifacts instead of replacing them with unrelated results; preserve incomplete legacy records for investigation.

| Method and route | Purpose |
|---|---|
| `GET /api/health` | Server availability and compute state |
| `GET /api/results` | Saved standalone results |
| `POST /api/simulate/cloud`, `/edge`, `/both` | Standalone simulation requests |
| `POST /api/video/upload` | Raw video body; URL-encoded `X-File-Name` header |
| `POST /api/video/analyze` | JSON job ID; starts asynchronous analysis |
| `GET /api/video/status/{jobId}` | Job state/error; reliable percentage progress is unavailable |
| `GET /api/video/results/{jobId}` | Analytics JSON and same-origin artifact URLs |
| `GET /api/video/results/{jobId}?download=1` | Original report download |
| `GET /api/video/output/{jobId}` | Annotated MP4 with byte-range access |
| `GET /api/video/evidence/{jobId}/{eventId}` | Evidence referenced by that report |
| `GET /api/video/simulation/{jobId}` | Job-scoped comparison and simulation error |

The [multi-recording guide](video_analytics/MULTI_CAMERA.md#api) documents batch configuration, creation, uploads, execution and recovery routes and their limits.

## iFogSim simulation

### Topology and workload assumptions

The model uses one cloud device and two identical fog devices. Each fog device connects to the cloud. Virtual cameras are sensor sources, not extra fog devices. The application graph is:

```text
CAMERA -> Video_Analyzer -> Event_Detector -> Cloud_Result_Storage
```

Cloud-only placement runs all three modules in the cloud. Edge placement runs the analyzer and event detector on the fog nodes and keeps result storage in the cloud. The scenarios use matching workload and device assumptions. Selectivity is 1.0: modeled event-result tuples are synthetic workload outputs, not detected real video events.

| Standalone parameter | Value |
|---|---:|
| Camera sources | 1-10; default 5 |
| Emission interval | 100 ms per camera |
| Workload duration | 15 seconds |
| Tuples per camera | 150 |
| Camera tuple | 20,000 bytes; 1,000 MI |
| Analyzed tuple | 2,000 bytes; 2,000 MI |
| Result tuple | 500 bytes; 500 MI |
| Simulation horizon | 2,000 simulator time units |
| Each fog device | 2,800 MIPS; 4,000 MB RAM |
| Cloud device | 44,800 MIPS; 40,000 MB RAM |
| Sensor-to-fog latency | 1 simulator time unit |
| Fog-to-cloud latency | 100 simulator time units |
| Link bandwidth | 10,000 in iFogSim bandwidth units |

Device capacities and linear power models follow the upstream DCNSFog example. The upstream default module allocation is 1,000 MIPS. Tuple sizes and CPU lengths are declared project assumptions, not hardware calibration or reproduced paper parameters.

### Running the scenarios

From the root, after building:

```powershell
.\simulation\run.ps1 -Scenario both
.\simulation\run.ps1 -Scenario cloud -CameraCount 1
.\simulation\run.ps1 -Scenario edge -CameraCount 10
```

The default five-camera case contains 750 tuples per scenario; one camera produces 150 and ten produce 1,500. Values outside 1-10 are rejected. Standalone selection does not override video-derived profile timing or counts.

For an existing successful video profile:

```powershell
.\simulation\run.ps1 -Profile ".\video_analytics\outputs\workloads\<job-id>.json" -Scenario both
```

Each scenario runs in a fresh JVM because CloudSim/iFogSim keep static state. Profile values are validated before simulation; malformed fields are not silently replaced by a standalone workload. Finite traces retain the profile's tuple count and interval. Combined schema-2 `multi_video` profiles retain independent camera traces and assumptions. Horizons can expand to allow tuples to finish processing; this affects modeled energy.

When CPU estimates exist, total analyzer/detector MI is divided across tuples, rounded to integer MI and bounded to at least 1 per tuple. Otherwise the existing 1,000/2,000 MI assumptions apply. Null input payload uses 20,000 bytes; analyzed/result payloads remain 2,000/500 bytes and storage remains 500 MI. Result metadata records the profile values and actual assumptions used. Java performs no new CPU calibration.

Successful runs print a `RESULT_JSON:` record and save results in separate locations:

| Workload | Results |
|---|---|
| Standalone virtual cameras | `results/cloud.json`, `results/edge.json` |
| Single recording profile | `results/video_workloads/<job-id>/cloud.json`, `edge.json` |
| Recording batch | `results/video_batches/<batch-id>/cloud.json`, `edge.json` |

Failed runs do not write a new successful result. If simulation fails after video analysis, the analytics report remains available with a separate simulation error. Saved standalone files are not used as fallback video comparisons.

## Cloud vs Edge comparison

### Metrics

| Key | Meaning |
|---|---|
| `loopLatencyMs` | Full camera-to-cloud-storage loop average in raw simulator time units |
| `analyticsLatencyMs` | Camera emission to arrival at Event_Detector, before its computation and final delivery; raw simulator time units |
| `networkUsageMb` | Counted modeled payload/link bytes, using 1 MB = 1,000,000 bytes; excludes protocol headers and deployment control traffic |
| `nativeNetworkUsageIndex` | Native tuple-size-times-link-latency total divided by horizon; not MB |
| `energyJoules` | Sum of configured device-model energy; sensors have no separate power model |
| `processedTuples` | Result tuples arriving at cloud storage |
| `simulationTimeSeconds` | Stop-clock value in simulator time units, despite the legacy name |
| `wallClockMillis` | Measured Java controller-region runtime, excluding Python analysis |

Legacy latency names and saved numerical values are retained for compatibility. The dashboard labels latency as simulator time units, not physical milliseconds. Missing complete measurements can be null. Local video processing duration/FPS is separate from simulator runtime.

The [Stage 3 analysis](simulation/experiments/STAGE3_ANALYSIS.md) and [Stage 7 evaluation](simulation/experiments/STAGE7_EVALUATION.md) retain raw data, statistics and charts. Stage 7 includes 110 measured simulations and two excluded warm-ups. Edge reduced detector-arrival latency and counted traffic, but increased full-loop latency; recording-derived cases also used more modeled energy. This is a qualified comparison, not a claim that edge placement wins every metric.

## Testing

Run mutation-producing tests and experiment commands on a dedicated idle project copy. Some integration tests create jobs/results or temporarily hold `run.ps1` to test failure handling. Do not run them alongside user jobs or against the only copy of saved recovery data.

### Node checks

From the root:

```powershell
node --check server/dev-server.js
node --check server/multi-video.js
node --test tests/node/test-state.js tests/node/test-multi-video-unit.js tests/node/test-batch-recovery.js
```

These unit tests cover state handling, selection limits, independent profile identity, recovery errors and missing artifacts; recovery fixtures use disposable OS-temporary directories.

For full API tests in a dedicated copy, first start its server in test mode:

```powershell
$env:NODE_ENV = 'test'
npm start
```

Then use another terminal in that copy:

```powershell
node tests/node/test-api.js http://127.0.0.1:4173
node tests/node/test-camera-workloads.js http://127.0.0.1:4173
node tests/node/test-multi-video.js http://127.0.0.1:4173
```

Test mode permits explicit synthetic-fixture provenance. Normal dashboard uploads are not automatically labeled synthetic. See the [batch verification instructions](video_analytics/MULTI_CAMERA.md#verification-and-reproduction) for restart recovery and controlled profile validation.

### Python, Java and experiment checks

From a dedicated copy's root:

```powershell
Push-Location video_analytics
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Pop-Location
.\simulation\validate-cameras.ps1
.\video_analytics\.venv\Scripts\python.exe -m unittest discover -s simulation/experiments -p "test*.py" -v
```

Python tests use controlled rule coordinates and synthetic media. The model-backed I/O test runs only when weights exist; it does not assert detection accuracy. The Java harness checks actual sources and paired emissions/processing for 1, 2, 3, 5, 6 and 10 cameras. Independent evaluator tests check workload fairness and descriptive calculations.

Generate or analyze experiments only in the dedicated copy:

```powershell
.\video_analytics\.venv\Scripts\python.exe simulation/experiments/run_experiments.py --repetitions 5
.\video_analytics\.venv\Scripts\python.exe simulation/experiments/analyze_experiments.py results/experiments/<run>/raw.json --output results/experiments/<analysis>
.\video_analytics\.venv\Scripts\python.exe simulation/experiments/stage7_evaluation.py
.\video_analytics\.venv\Scripts\python.exe simulation/experiments/stage7_evaluation.py --analyze simulation/experiments/evidence/stage7-2026-11-17/raw.json --output results/experiments/stage7-reanalysis
```

The analysis-only Stage 7 command reads retained raw evidence without starting inference/simulation, but still writes a new analysis directory. Historical raw evidence and recorded source hashes must remain unchanged.

### Evidence map

- [Stage 2 camera validation](simulation/validation/STAGE2_VALIDATION.md): source counts, timing and paired workload checks.
- [Stage 7 evaluation](simulation/experiments/STAGE7_EVALUATION.md): repeated simulations, recorded profiles, metrics and plots.
- [Stage 8 verification](frontend/STAGE8_VERIFICATION.md): unit labels, failure states, keyboard/mobile checks and recovery.
- [Paper alignment](research/PAPER_ALIGNMENT.md): selected-paper claims, implementation mapping and limitations.
- [Camera feasibility](video_analytics/LIVE_CAMERA_FEASIBILITY.md): proposed live-camera requirements and boundaries.
- [Project status](PROJECT_STATUS.md): dated approvals, changes and verification history.
- [Setup guide](docs/SETUP.md), [demonstration script](docs/DEMO_SCRIPT.md), and [viva guide](docs/VIVA_GUIDE.md): practical handover materials.

## Limitations

- No physical IP camera/NVR is confirmed; live RTSP ingestion and camera registration remain proposals.
- This implementation uses fixed cloud/edge mappings, not adaptive priority scheduling or automatic migration policies.
- Actual frames stay in the local analytics workflow. The simulator does not establish physical-network privacy, encryption or compliance guarantees.
- No labeled real-CCTV ground truth, measured detection accuracy, hardware-calibrated latency or defensible MI calibration is available. Some legacy output lacks original input provenance and complete workload artifacts; preserve it as history.
- Frame sampling can miss brief activity; tracker IDs can change after occlusion. Movement histories are bounded. Geometry, direction and stopping thresholds need scene-specific tuning; perspective compensation and lighting/weather validation are absent.
- An empty event list does not establish safety, especially when no regions are configured. There is no implemented fall detector or cross-camera re-identification.
- Annotated MP4 codec support varies by browser; saved Open/Download fallback is retained. Encoding changes are deferred.
- Processing is sequential and compute-locked; no real-time multi-camera throughput guarantee, automatic unfinished-batch resume, storage quota or long/max-size stress validation is claimed.
- Dependency README files and required notices remain with the pinned simulator and installed packages. They are outside the single EdgeVision-guide rule.
- Formal academic report, slide deck, institutional metadata and submission-template compliance remain deferred. Existing guides do not claim those artifacts are complete.

# EdgeVision Video Analytics (Phase 2)

This Python package processes uploaded/local CCTV video using Ultralytics YOLO detection, persistent ByteTrack tracking, OpenCV annotated output, and configurable rule-based unusual-activity events. Node invokes it as a separate local process; the Python package does not call iFogSim or the frontend.

The system detects only the configured COCO classes (person, car, motorcycle, bus). Event labels mean a configured rule was met; they do not establish harmful or criminal activity. The pipeline performs video object detection and tracking, not real-time object detection on encoded video streams or forensic validation.

## Windows PowerShell setup

Open PowerShell in `video_analytics`:

```powershell
cd video_analytics  # from the cloned EdgeVision project root
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.self_check
```

The isolated environment uses the project's pinned Python 3.14 Windows packages. It does not alter system Python. The validated machine uses CPU inference; CUDA is selected automatically only when PyTorch reports it available.

## Download and verify model weights

The default model is the official lightweight `yolo26n.pt` detection checkpoint from the Ultralytics assets `v8.4.0` release. Model selection, release and auto-download are configured in `config/settings.json`. The first inference or this explicit command downloads it into the private `models/` folder:

```powershell
.\.venv\Scripts\python.exe -m app.download_model
```

The command loads the checkpoint and prints its private filename, size, SHA-256 and license. The model and Ultralytics software are distributed under AGPL-3.0 terms by default; review [Ultralytics licensing](https://www.ultralytics.com/license) before redistribution or other use. Weights are ignored by Git and must be downloaded separately on another machine.

## Process a video

The CLI accepts an existing local video path, copies it to a UUID-named private upload file, validates the extension, size and container signature, then runs inference. Outputs remain under `outputs/` and evidence frames under `evidence/`:

```powershell
.\.venv\Scripts\python.exe -m app.run_video "C:\path\to\your\video.mp4"
```

It prints the path to the actual JSON report. The input video must use one of the configured extensions (`.mp4`, `.m4v`, `.mov`, `.avi`, `.mkv`, `.webm`) and be no larger than the configured 500 MiB limit. No local filesystem path is included in reports.

## Configure regions and rules

Edit `config/settings.json`. Regions use normalized `[0, 1]` polygon coordinates relative to frame width and height. Each region has a unique name and one or more rule names. The five supported names are:

- `restricted_intrusion`: emit when a configured tracked class enters the region.
- `loitering`: emit once after `loitering_seconds` in the region; a later visit can emit again.
- `wrong_direction`: vehicles move opposite the region's `expected_direction` vector by the configured travel and angle limits.
- `crowd`: unique tracked persons exceed the region's `max_people` limit for `crowd_confirm_seconds`.
- `vehicle_stopping`: a tracked vehicle stays within the configured displacement tolerance for `vehicle_stopped_seconds`.

Example region object (merge it into the top-level `regions` array):

```json
{
  "name": "north_gate",
  "polygon": [[0.10, 0.15], [0.65, 0.15], [0.65, 0.85], [0.10, 0.85]],
  "rules": ["restricted_intrusion", "loitering"],
  "object_classes": ["person", "car", "motorcycle", "bus"]
}
```

For wrong direction, include for example `"expected_direction": [1, 0]` (positive x in image coordinates). For crowd, set `"max_people": 10` per region, or omit it to use `anomaly_thresholds.crowd_max_people`. Thresholds and frame sampling are configurable in the same file. With `regions: []`, region-based rules are **not evaluated**; reports say so explicitly and show zero events. The optional fall-detection setting remains disabled and no fall detector is implemented.

## Tests and validation commands

```powershell
.\.venv\Scripts\python.exe -m compileall -q app
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

The tests use hand-authored tracking-coordinate sequences to check each of the five rule transitions, re-arming, duplicate suppression, upload validation, missing weights, invalid video handling, empty YOLO detections, and workload-profile schema/consistency. These controlled rule-unit inputs are not detection results. The synthetic clip at `tests/fixtures/synthetic_test_clip.avi` contains only a moving shape; it validates OpenCV video I/O and output writing. It does **not** validate real-world detection/tracking accuracy. A model-backed pipeline I/O test runs on that clip when the checkpoint exists, but no detected object count is asserted.

## Report contents and limitations

Each successful job writes `outputs/<job-id>/report.json` containing source video metadata, sampling/frame statistics, model filename/hash/license, actual class observation and unique-track counts, ByteTrack track summaries and movement histories, rule-coverage status, actual rule events, processing duration/FPS, and relative annotated-video/evidence references. Event evidence is saved only when a configured rule fires. With no event, the report contains `eventCount: 0` and an empty event list. A zero count with no configured regions means the rules were not evaluated, as indicated by `ruleCoverage`.

YOLO inference is frame-sampled according to `processing.frame_interval`; larger intervals reduce work but can miss brief activity and make timestamps coarser. ByteTrack IDs can change after long occlusions. Rule geometry uses bounding-box centers; camera calibration, perspective compensation, weather/lighting tests, and manual review of real footage are not implemented. Stopping and direction thresholds are pixel-based and need scene-specific tuning. The pipeline is not a safety or surveillance decision system. The output directory contains a completed report for a 2560×1440 non-fixture MP4, but the original input is absent and its provenance cannot be verified. There is no labeled ground truth, so real-world accuracy has not been measured.

## iFogSim workload profiles (Stage 1)

After each successful video analysis, the processor writes an additional profile to:

```text
outputs/workloads/<analytics-job-id>.json
```

This is a separate file from `outputs/<analytics-job-id>/report.json`; neither the analytics report nor `results/cloud.json` / `results/edge.json` is overwritten. The profile job ID matches the analytics report job ID. A safe display basename is recorded, never the caller's full filesystem path. For direct CLI input, this is the input filename. The website API passes the user-facing filename for display and the Node-generated job ID so the report and profile remain associated with the same job; neither the full path nor private staged upload name is exposed.

The profile contains:

- `video`: display filename, duration, dimensions, source FPS, OpenCV-reported frame count when available, decoded source frames, processed frames, configured sample interval, and uploaded file size.
- `processing`: measured total processing duration/FPS, average processing seconds per processed frame, measured accumulated YOLO+ByteTrack wall time and anomaly-evaluation wall time, plus their per-frame averages. Stage times are wall-clock measurements, not CPU instruction counts.
- `detections`: `totalDetections` is explicitly the sum of tracked detection observations over processed frames. `byClass` keeps those observations separate from unique tracking IDs; `totalUniqueTrackedObjects` is their sum across classes. Repeated observations of one tracked object are not collapsed into one detection.
- `anomalies`: total event count and counts by rule type, derived only from actual report event records. The five known rules appear with zero counts when none fired. No regions means the profile records zero events and the analytics report says rules were not evaluated.
- `iFogSimWorkload`: one virtual camera source per uploaded video; `framesPerTuple` (default 1); finite tuple count (`ceil(processedFrameCount / framesPerTuple)`); a proposed nominal tuple interval; and an effective finite-trace rate (`tupleCount / videoDurationSeconds`). The last tuple may represent a partial batch.
- `tuplePayloadBytes`: null by default because the Python pipeline does not serialize a video frame into an iFogSim tuple. If explicitly configured, it is marked `configured_assumption`, not measured. The source video file size is metadata and must not be treated as a tuple payload size.
- `cpuDemand`: `videoAnalyzerMI` and `eventDetectorMI` are null by default. If a documented `mi_per_wall_second` calibration, reference hardware, and method are configured in `workload_profile.cpu_calibration`, these values are labeled estimates derived from measured YOLO+ByteTrack/anomaly wall times. They do not include decode, drawing, or encoding time.
- `sourceClassification`: `not_labeled` by default. The synthetic validation command explicitly sets `synthetic_test`; that label is not a claim about model accuracy.

Configure batch size, an optional tuple payload assumption, and optional CPU calibration in `config/settings.json` under `workload_profile`. The defaults intentionally leave tuple size and CPU calibration unavailable:

```json
"workload_profile": {
  "frames_per_tuple": 1,
  "tuple_payload_bytes": null,
  "cpu_calibration": {
    "mi_per_wall_second": null,
    "reference_hardware": null,
    "method": null
  }
}
```

There is currently **no defensible Python-to-iFogSim MI calibration** in the codebase. iFogSim's existing Java tuple CPU lengths (1,000 / 2,000 / 500 MI) are declared simulation assumptions; they were not calibrated from Python processing time and must not be treated as such. A future calibration needs a documented reference CPU, a repeatable workload-specific method mapping measured instructions or benchmark throughput to MI, and separation of analyzer versus anomaly-stage work. Wall-clock milliseconds alone are insufficient.

### Generate a clearly labeled synthetic profile

From PowerShell, run from this folder:

```powershell
cd video_analytics  # from the cloned EdgeVision project root
.\.venv\Scripts\python.exe -m app.run_video ".\tests\fixtures\synthetic_test_clip.avi" --synthetic-test-input
```

The command prints both the analytics report and workload-profile paths. Inspect the profile with:

```powershell
Get-Content ".\outputs\workloads\<job-id>.json"
```

Replace `<job-id>` with the ID printed in the report/profile path. The fixture has 20 frames containing a moving shape. This run validates profile structure and frame-to-tuple bookkeeping only; it does not provide real-CCTV detections, anomaly evidence, or accuracy results.

### iFogSim integration

The website passes each completed profile to the existing iFogSim model using the same job ID. It creates a finite sensor/tuple trace using the recorded tuple count and interval, and reports configured CPU/payload assumptions separately. The profile represents workload derived from video analysis; **actual video frames, detections, and evidence are not sent to iFogSim**. See `simulation/README.md` for the paired cloud/edge commands and result schema.

# EdgeVision

EdgeVision has two separate technical components: local video analysis in Python (YOLO, ByteTrack and OpenCV), and cloud-versus-edge workload simulation in iFogSim. **Video analytics does not run on iFogSim.** The iFogSim camera feeds are modeled tuple workloads; they do not perform visual object detection.

## Start the website

Clone the project with its pinned simulator dependency:

```powershell
git clone --recurse-submodules https://github.com/vishol21/EdgeVision.git
cd EdgeVision
```

For an existing clone, run `git submodule update --init --recursive`. The iFogSim submodule is pinned to `5f68d3947e450d8d2b4af42670be819206be68c9`; keep that revision for reproducible builds. Follow [Python setup and model download](video_analytics/README.md) before video processing. Environments, model weights, uploads, generated reports and simulation results are excluded from Git; no Git LFS setup is required. The small synthetic video under `video_analytics/tests/fixtures/` is an intentional test asset.

Requirements: Node.js, the `video_analytics/.venv` Python environment and model, and JDK 23+ for iFogSim. From the project root, open PowerShell and run:

```powershell
npm start
```

Open <http://127.0.0.1:4173>. Stop the server with Ctrl+C before restarting it after code changes. If PowerShell reports that port 4173 is already in use, switch to the terminal where the existing EdgeVision `npm start` is running and press Ctrl+C, then run `npm start` again. Do not start a second server on the same port.

The dashboard has three sections: Dashboard, Video Analytics, and Simulation & Comparison. The existing Node server on port 4173 starts Python and PowerShell child processes in the background; it does not create a second backend server.

## Upload and analyze a video

1. Open **Video Analytics** and select or drag in a supported video.
2. Check the local preview, filename and size, then click **Start Analysis**.
3. Wait for video analysis, then for its workload-profile cloud and edge simulations to finish. The progress bar is indeterminate because the Python processor does not report reliable frame-by-frame progress.
4. Review the actual detection/tracking summary and event details, evidence (when a configured rule fires), and use **Download JSON report** to save the report.

Accepted extensions and the upload size limit are configured in `video_analytics/config/settings.json` (currently 500 MiB). The browser sends the file to the same-origin Node API; Node checks the extension, size and container signature before starting Python. Files, weights, reports, videos and evidence remain under private `video_analytics/` folders and are not served as static files. The temporary uploaded copy is removed when processing finishes. Reports and generated output videos remain in `video_analytics/outputs/`; event evidence frames are in `video_analytics/evidence/`; model weights are in `video_analytics/models/`.

The uploaded job ID is passed to Python and reused by its analytics report, workload profile and both simulation result records. After Python succeeds, Node verifies the job-scoped profile and automatically runs `simulation/run.ps1 -Profile <profile> -Scenario both`. The overall job is complete only when both scenarios succeed. If simulation fails, the successful video analytics report remains available and the comparison reports a separate failure. Profile results are written to `results/video_workloads/<job-id>/cloud.json` and `edge.json`; the browser gets them through `GET /api/video/simulation/{jobId}`. No actual video frames are sent to iFogSim.

The UI distinguishes per-frame tracked detections/observations from unique ByteTrack IDs. Processing FPS is the measured processing speed. No performance values or anomaly events are fabricated. With no configured regions, the report says region-based rules were not evaluated. Potential activity events are rule triggers, not proof of harmful or criminal behavior. The provided synthetic test clip contains only a moving shape and must not be used to claim detection accuracy.

Python environment setup and region/rule configuration are documented in [video_analytics/README.md](video_analytics/README.md). If the model is missing, set up the environment from that guide and run `python -m app.download_model` inside `video_analytics`.

## Run cloud and edge simulations

The Simulation & Comparison section lets you select 1–10 virtual cameras (default 5). Each camera emits 150 tuples at 100 ms intervals for 15 seconds; the displayed expected count updates with the selection. Cloud-only, edge-based, and both-scenario standalone runs use that selected count. Values outside 1–10 are rejected. Video-derived profile simulations remain tied to the uploaded job's workload and do not use this standalone selector.

Standalone results start empty on page load and refresh. Changing the camera count or starting another run clears the cards, charts and table; a failed run does not restore historical files. Both placements in a paired run share one workload profile ID. Saved historical files remain on disk and available through the existing results API.

While a video comparison is selected, standalone controls are disabled. Choose **Use virtual-camera simulation** to open an empty standalone comparison, or **Show video comparison** to return to the selected job's results during the same page session. Backend recovery of completed video jobs after a server restart remains available through the job-specific APIs.

From the project root, compile the existing iFogSim project once and run the scenarios:

```powershell
.\simulation\build.ps1
.\simulation\run.ps1 -Scenario cloud
.\simulation\run.ps1 -Scenario edge
```

The **Simulation & Comparison** section shows the profile-based cloud/edge comparison for the selected video job, including source duration, tuple workload, latency, network use, energy and measured wall-clock run time. It labels synthetic test profiles and Java CPU/payload assumptions. Its standalone cloud-only, edge-based and both buttons remain available without a video profile; those runs use the existing commands and `results/cloud.json` / `results/edge.json`. Standalone results are labeled separately and are never used as a fallback for a video job.

## API routes

The existing simulation routes remain available:

- `GET /api/health`, `GET /api/results`
- `POST /api/simulate/cloud`, `POST /api/simulate/edge`, `POST /api/simulate/both`

Video analytics routes use generated 32-character job IDs; IDs are kept in the running Node process:

- `POST /api/video/upload` — raw video request body; send `X-File-Name` as a URL-encoded filename. Returns a job ID.
- `POST /api/video/analyze` — JSON body `{ "jobId": "..." }`; returns HTTP 202 while Python runs.
- `GET /api/video/status/{jobId}` — current state, message and error (if any). `progress` is `null` until accurate frame progress is available.
- `GET /api/video/simulation/{jobId}` returns validated workload metadata, paired cloud/edge results, and simulation status/error for that job.
- `GET /api/video/results/{jobId}` — completed analytics JSON, with same-origin artifact URLs.
- `GET /api/video/results/{jobId}?download=1` — download the original generated JSON report.
- `GET /api/video/output/{jobId}` — private annotated MP4 stream with byte-range playback support.
- `GET /api/video/evidence/{jobId}/{eventId}` — only evidence referenced by an actual event in that job's report.

The Node process allows one active video analysis/simulation compute job at a time. Completed video jobs can be reloaded from their matching private report, workload profile and paired result files after a Node restart. In-progress uploads/analyses are not recovered if Node stops before those artifacts are complete.

## Test the website API

For the integration test, start the server in test mode so the known fixture is explicitly labeled synthetic. In the server terminal:

```powershell
$env:NODE_ENV = 'test'
npm start
```

Then run `node .\frontend\test-api.js` from another PowerShell terminal at the project root. The test uploads only `video_analytics/tests/fixtures/synthetic_test_clip.avi`, checks the complete Python/profile/cloud-and-edge workflow, profile/job association, comparison data, analysis preservation on simulated failure, invalid IDs and the original standalone endpoints. It restores `results/cloud.json` and `results/edge.json`. The test briefly renames `simulation/run.ps1` inside a `try/finally` block to exercise the simulation-failure path, then restores it. The synthetic clip has no labeled objects and does not validate real-world detection accuracy.
## Troubleshooting

For deterministic frontend state regression checks, run `node --test frontend/test-state.js` from the project root. These checks cover clearing results, failed and mismatched responses, delayed requests, and explicit switching between standalone and video comparisons. They complement the real API integration test and browser verification.

- **Port 4173 is in use:** stop the existing EdgeVision server with Ctrl+C in its terminal, then restart it.
- **Video Python environment unavailable:** follow the virtualenv setup in `video_analytics/README.md`; Node expects `.venv/Scripts/python.exe` on Windows.
- **Model unavailable or download fails:** check network access, then run `.\.venv\Scripts\python.exe -m app.download_model` from `video_analytics`. The model is stored privately under `models/`.
- **Upload rejected:** confirm the selected file extension is enabled in `config/settings.json`, its contents match its extension, and its size is within the configured limit.
- **No events:** check `regions` and thresholds in `video_analytics/config/settings.json`. Reports clearly state when no region rules were configured or evaluated.
- **Simulation API error:** check Java/JDK setup and run the relevant `simulation\build.ps1` / `simulation\run.ps1` command directly to see compiler or simulator output.
- **Profile simulation failed:** video analytics may still have completed; check the separate job simulation status/error. Confirm the profile exists at `video_analytics\outputs\workloads\<job-id>.json`.

## Research basis and limits

The 2019 smart-city surveillance paper is a research reference, not a claim that this implementation reproduces its complete model or results. Video analytics runs locally through Python. iFogSim separately simulates a finite tuple workload derived from the Python profile. Only successful actual outputs are displayed; CPU and tuple payload assumptions are labeled, and actual video frames are not sent to iFogSim.

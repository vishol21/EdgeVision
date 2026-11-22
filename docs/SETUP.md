# Windows setup and reproduction

Run commands from the project root unless a different directory is shown. This documents the existing implementation; it does not install software automatically or assume a physical camera.

## Requirements

- Git with submodule support; Node.js (validated: 22.21.0).
- Python 3.14 x64 for the pinned Windows package set in [requirements](../video_analytics/requirements.txt). Other Python/package combinations were not validated here.
- JDK 23 or newer capable of `javac --release 23` (validated: Temurin 23.0.2+7). Set `JAVA_HOME` to its installation directory. Existing scripts otherwise check the documented local fallback under the user's LocalAppData EdgeVision folder.
- Local YOLO26n weights and sufficient storage for annotated outputs. No Node package installation is required by the current dependency-free Node server. Chart.js and web fonts are loaded from external CDNs; without charts, the table/cards remain available.

## Prepare a checkout

```powershell
git clone --recurse-submodules https://github.com/vishol21/EdgeVision.git
cd EdgeVision
git submodule status
```

For an existing checkout whose submodule is absent, use `git submodule update --init --recursive`. Keep iFogSim at the repository's pinned revision `5f68d3947e450d8d2b4af42670be819206be68c9`; do not update to an arbitrary upstream head for reproducible evaluation.

Set `JAVA_HOME` to the actual local JDK directory if needed. Then:

```powershell
node --version
& "$env:JAVA_HOME\bin\java.exe" -version
.\simulation\build.ps1
Push-Location video_analytics
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m app.download_model
.\.venv\Scripts\python.exe -m app.self_check
Pop-Location
npm start
```

The explicit Java version command assumes `JAVA_HOME` is set; if using the script's local fallback instead, invoke that actual JDK's java.exe to inspect its version. Review the existing [model setup/license notes](../README.md#python-environment-and-model-setup) before redistribution. Model files and virtual environments are intentionally absent from Git. Environment creation/install commands are fresh-machine instructions, not claims that a new installation was exercised during documentation work.

Open [the local dashboard](http://127.0.0.1:4173). Use one server instance. Stop it with Ctrl+C in its terminal before restarting. If port 4173 is occupied, identify the existing server rather than stopping unrelated processes. The server binds locally; no router/firewall or camera-network changes are needed.

## Workflows and settings

- Virtual cameras: select 1-10 sources, default five; 150 tuples per camera. Choose cloud-only, edge-based or both. Refresh/configuration changes start neutral; historical results are not automatically displayed.
- Single video: choose a supported local recording, start analysis, then wait for its paired simulations. Unsupported browser preview does not necessarily prevent Python decoding. Save the job ID if using the recovery APIs later.
- Multiple recordings: choose 2-10 files; sequential local analysis creates independent reports. Successful profiles form a paired comparison. Save the batch ID; use the explicit recovery field after refresh/restart. Failed inputs remain excluded and visible.
- [Settings](../video_analytics/config/settings.json) govern sampling, classes, rules, regions and limits. Defaults: 500 MiB/file, 1 GiB/batch and 100,000 combined tuples. Limits do not establish real-time capacity or bound all generated storage. Region rules are not evaluated with the default empty region list.
- Full-loop and detector-arrival latency are raw simulator time units despite legacy API key names. Runtime is wall-clock milliseconds; video processing is separately reported in seconds/FPS. See [metric definitions](../README.md#metrics).

## Checks and experiment reproduction

Quick frontend checks:

```powershell
node --test tests/node/test-state.js tests/node/test-multi-video-unit.js
.\video_analytics\.venv\Scripts\python.exe -m unittest discover -s simulation/experiments -p "test*.py" -v
```

Python analytics tests, including a real-model I/O check when weights are available:

```powershell
Push-Location video_analytics
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
Pop-Location
```

Run the existing [API/batch integration instructions](../video_analytics/MULTI_CAMERA.md#verification-and-reproduction) only on a dedicated idle test copy/server: those suites intentionally simulate failures by temporarily holding the simulation script. They retain generated test jobs; do not run them alongside a demonstration or user compute job. The original server port can be changed for the dedicated process using `$env:PORT = '4178'` before starting it, and `$env:NODE_ENV = 'test'` permits explicitly marked API fixture provenance. Normal UI uploads are not automatically labeled synthetic.

For the final 11-case evaluation, run:

```powershell
.\video_analytics\.venv\Scripts\python.exe simulation/experiments/stage7_evaluation.py
```

It builds the simulator, analyzes two moving-shape fixtures in an isolated root and executes 110 measured simulations plus two excluded warm-ups. It creates a new ignored directory and preserves earlier experiments. Read the [report and reproduction details](../simulation/experiments/STAGE7_EVALUATION.md); this is not an accuracy or live-camera benchmark. To regenerate summaries alone without inference/simulation:

```powershell
.\video_analytics\.venv\Scripts\python.exe simulation/experiments/stage7_evaluation.py --analyze simulation/experiments/evidence/stage7-2026-11-17/raw.json --output results/experiments/stage7-reanalysis
```

Choose a fresh output directory when retaining a prior analysis. This setup guide does not run new experiments or overwrite their historical raw values.

## Storage and recovery

| Location | Contents |
|---|---|
| `video_analytics/models/` | Ignored downloaded weights and runtime tracker configuration. |
| `video_analytics/uploads/` | Private staged inputs; unfinished batches may leave uploads. |
| `video_analytics/outputs/<job-id>/` | Report, annotated output and optional batch association. |
| `video_analytics/outputs/workloads/` | Single-recording finite profiles. |
| `video_analytics/outputs/batches/<batch-id>/` | Batch manifest and combined profile. |
| `video_analytics/evidence/` | Frames referenced by actual configured rule events. |
| `results/video_workloads/` and `results/video_batches/` | Job/batch-specific paired simulator outputs. |
| `results/cloud.json`, `results/edge.json` | Standalone historical outputs; not refresh defaults. |
| `results/experiments/` | Ignored experiment runs; reviewed evidence is separately versioned. |

Recovery validates saved identity/count/profile associations before presenting results. It does not automatically resume unfinished jobs. Keep reports, profiles, batch associations and paired results together; do not manually mix job files or delete historical outputs as a troubleshooting shortcut.

## Troubleshooting

| Symptom | Next action |
|---|---|
| Python unavailable | Confirm `.venv/Scripts/python.exe` exists under `video_analytics`; use its interpreter for installs/checks. |
| Simulator build fails | Check pinned submodule and JDK 23+, then read the actual compiler error. |
| Charts unavailable | Use cards/table; check connectivity to the existing CDN and reload. |
| Video rejected/cannot decode | Confirm configured extension, file size and valid container; try a supported recording or re-encode it. |
| No events | Inspect rule coverage and configured regions; do not interpret zero as safe footage. |
| Analytics succeeded, simulation failed | Keep the report; inspect the separate simulation error and profile/Java setup. |
| Restart shows no results | Neutral refresh is intentional; explicitly recover the desired batch or use job-specific APIs. |
| Disk grows | Review retained outputs and unfinished uploads; do not automatically delete user history. |

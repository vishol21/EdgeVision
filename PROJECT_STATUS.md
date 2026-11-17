# EdgeVision project status

## Project information
- Title: Edge Computing for Online Video Analytics Using iFogSim
- Repository: https://github.com/vishol21/EdgeVision.git
- Workspace: EdgeVision project root (absolute local path omitted from version control).
- Current branch: main.
- Current stage: Stage 2 commit/push approved; Stage 3 approved to start after publication.
- Overall progress: audit, Stage 1 and Git publication complete; Stage 2 matrix verified at all six required counts.
- Authority: user handover received 2026-11-17 explicitly directs Stage 0 first and requires approval for each subsequent stage.

## Stage table
| Stage | Objective | Status | Approval |
|---|---|---|---|
| 0 | Audit architecture, baseline and Git | Completed | Explicit first-action instruction |
| 1 | Fix stale standalone state and result association | Completed | User approved with “yes” after Stage 1 plan |
| 2 | Validate actual 1-10 camera workloads | Completed | Explicit user request to continue after GitHub push |
| 3 | Repeatable multi-camera experiments | Not started | User approved Stage 2 commit/push and Stage 3 with yes |
| 4 | Multiple uploaded CCTV videos | Not started | Not received |
| 5 | Investigate live CCTV/IP camera integration | Not started | Not received |
| 6 | Align implementation with selected research paper | Not started | Not received |
| 7 | Performance evaluation | Not started | Not received |
| 8 | Dashboard and system quality | Not started | Not received |
| 9 | Final documentation and presentation | Not started | Not received |
| G0 | Inspect local and remote Git state | Completed | Read-only Stage 0 inspection |
| G1 | Prepare exclusions and review large/private files | Completed | Explicit user request to prepare Git and push first |
| G2 | Review and stage project source | Completed | Explicit user request to prepare Git and push first |
| G3 | Commit and configure main/origin safely | Completed | Explicit user request to prepare Git and push first |
| G4 | Inspect history and push verified approved commit | Completed | Explicit user request to prepare Git and push first |

For all unstarted stages: no tasks implemented, no files changed, no tests executed, browser verification not performed, no commit or push. Remaining work is the corresponding approved handover scope; stage-specific issues will be established by inspection. No stage is authorized by approval of another stage.

## Stage 0 audit — 2026-11-17

### Architecture and important files
- `package.json`: `npm start` delegates to `frontend`.
- `frontend/index.html`, `css/styles.css`, `js/app.js`: dashboard, video upload/analytics, standalone camera controls and shared comparison rendering. No localStorage/sessionStorage references found in app.js.
- `frontend/dev-server.js`: localhost HTTP server (default 4173), upload validation, Python subprocess, job status/artifact APIs, disk recovery, PowerShell simulation orchestration and standalone result APIs.
- `video_analytics/app/processor.py`, `detector.py`, `tracker.py`: local OpenCV decoding, YOLO26n inference and persistent ByteTrack IDs, activity evaluation, evidence and report generation.
- `video_analytics/app/rules/`, `anomaly_engine.py`: intrusion, loitering, wrong direction, crowd and vehicle stopping rules. `config/settings.json` currently has no regions.
- `video_analytics/app/workload_profile.py`: finite tuples derived from processed frames, source duration/timing and separately labeled CPU/payload assumptions.
- `simulation/build.ps1`, `run.ps1`: compile pinned iFogSim/CloudSim sources; run each placement in a fresh JVM and save successful JSON records.
- `simulation/src/main/java/com/edgevision/simulation/`: application topology, finite camera sensors, profile parsing, telemetry, metrics and serialization. Standalone sources have unique names, 100 ms interval, 15 s workload and 150 tuples per camera; default 5, valid range 1–10. Sensors are staggered within each interval.
- `simulation/vendor/iFogSim`: nested upstream Git repository, revision `5f68d39`, origin `https://github.com/Cloudslab/iFogSim.git`; working tree was clean. Preserve its history and handle vendoring explicitly during Git setup.
- `frontend/test-api.js`, `video_analytics/tests/`: API integration and Python unit/integration tests.
- `README.md`, component READMEs and `research/REFERENCE_NOTES.md`: setup, simulator assumptions and research notes. Research notes still describe an initial three-camera plan; selected full paper has not been verified in this audit.

### Result storage
- Standalone: `results/cloud.json`, `results/edge.json`.
- Video comparisons: `results/video_workloads/<job-id>/cloud.json` and `edge.json`.
- Analytics/profile/output: `video_analytics/outputs/<job-id>/`, `outputs/workloads/<job-id>.json`.
- Other private/generated data: `video_analytics/uploads/`, `evidence/`, `.venv/`, model weights, caches; simulation compiled classes in `simulation/target/`.
- Model weight `video_analytics/models/yolo26n.pt` is 5,544,453 bytes. Whole-tree large-file and secret review remains required before staging; no LFS decision made.

### Functionality and issues
- Verified synthetic-fixture local analytics, profile generation, job-scoped paired video simulations, JSON download, private-path filtering, partial annotated-video playback, invalid artifact IDs and simulation failure isolation.
- Verified completed video job recovery after restarting the audit server, including matching job identities and processed tuple counts.
- Verified individual default cloud/edge API runs with 5 cameras and 750 expected tuples; invalid counts 0 and 11 rejected.
- **Confirmed failure:** standalone `POST /api/simulate/both` returns HTTP 500 at the first tested count (1). Node calls `runScenario` twice without a common `WorkloadProfileId`; each PowerShell invocation generates its own ID. Node then compares complete profiles and rejects the pair. Java/run.ps1 already support supplying a shared ID.
- **Stale results:** app.js calls `loadSavedResults()` at startup; it fetches `/api/results` and renders historical files. The failed-run catch also loads those files. Camera input only updates the expected-count label and does not clear displayed results.
- **Status defect:** run() sets Complete/Failed, but finally calls setRunning(false), which overwrites status/detail with Ready/no running simulation.
- **Race exposure:** startup saved-result loading guards selected video mode, but has no standalone request-generation/configuration guard. setRecord validates only scenario and metrics presence; paired frontend application can mutate one record before validating the other.
- UI/profile boundary must remain explicit: a deliberate standalone run currently switches the shared comparison out of video mode. Stage 1 must define and verify selected-video protection without removing intentional workflow switching.
- Tracking summaries retain bounded histories (300 points); firstSeenSeconds and movementDistancePixels are calculated from retained history, so long-track summaries may omit earlier observations. Outside Stage 1 scope unless separately approved.
- Actual frames never enter iFogSim; inference runs locally. CPU calibration and payload are unset in Python settings and use declared Java assumptions. Zero events with no configured regions do not establish safety or detection accuracy.

### Baseline tests and results
1. `node --check` on app.js, dev-server.js and test-api.js: passed.
2. `.venv/Scripts/python.exe -m unittest discover -s tests -v` from video_analytics: **23 passed**, including real-model synthetic-clip I/O. Expected invalid-video decoder diagnostic occurred in the rejection test.
3. `simulation/build.ps1`: passed; compiler emitted deprecated/unchecked API notes.
4. `node frontend/test-api.js http://127.0.0.1:4174` against a separately launched NODE_ENV=test audit server: **failed**, exit 1, at test-api.js:269 (standalone both, 1 camera; expected 200, received 500). Prior checks listed above passed. Later 5/10-camera paired assertions were not reached; no claim of full camera validation.
5. Restarted audit server; independently requested status, report and comparison for completed job `9e2bbbbb85d845b0936aa5960a779677`: passed, paired job IDs and tuple counts matched.
6. Browser verification: not performed. Stale-state conclusions are based on source inspection, not observed browser interaction.

### Files changed and side effects
- Only authored project file: this `PROJECT_STATUS.md`; application source unchanged.
- Java build regenerated ignored-to-be compiled classes under simulation/target/classes.
- Existing integration suite generated two new synthetic jobs: `9e2bbbbb85d845b0936aa5960a779677` (successful) and `9bd33eabfd19461caf8694f450206f75` (intentional simulation failure). Retained for traceability.
- API suite restores original standalone cloud/edge JSON bytes in finally. Its intentional run.ps1 rename was restored; no held script remains. Historical results were not deleted.

### Git assessment and remaining tasks
- Root `git status`, branch, remotes and log all report not a Git repository; root .gitignore absent. Uncommitted user changes cannot be distinguished without a baseline; preserve all existing files.
- `git ls-remote` to the requested EdgeVision repository succeeded with exit 0 and zero advertised refs (including a separate HEAD/main query). No remote commits were visible at audit time.
- No root Git initialization, branch changes, staging, commits or pushes performed. No source visibility claim on GitHub.
- Before Git setup: approve scope; create exclusions; inspect all candidate files for secrets, personal data, large artifacts and generated data; decide how to preserve/reference nested simulator repository; initialize root only after review. Push only an approved, verified commit after rechecking remote history. Current failing baseline must not be represented as a verified completed implementation.
- Audit deliverable is complete; application baseline remains failing. Recommended next action: approve Stage 1 with frontend state correction and shared standalone workload ID fix, then rerun API and browser regression checks. Git setup needs its own concrete reviewed plan.

## Stage 1 — simulation state and result restoration
- Approval: user explicitly approved the Stage 1 plan with “yes”, 2026-11-17. No approval for Stage 2 or Git setup inferred.
- Status: implementation and verification completed; included in initial commit 687be247968f4e0c5472fc32068e3cdda76e5d76, now verified on origin/main.
- Objective: clear stale standalone presentation, associate responses with the active configuration, and preserve selected video comparisons/recovery.
- Tasks completed:
  - Removed frontend startup and failed-run loading of historical `/api/results`; the historical API and files remain intact.
  - Clear standalone cards, chart datasets, table and placement selection on camera input; clear results before every run.
  - Check request generation and camera selection before applying responses; validate both scenarios before publishing either; preserve Complete/Failed status after cleanup.
  - Pass one freshly generated workloadProfileId through Node to both separate Java runs. Reject standalone output whose profile ID, count or processed tuple count does not match the request.
  - Recheck compute availability after awaiting a simulation request body, preventing concurrent requests from claiming the same slot.
  - Disable standalone actions while a video comparison is selected. Added an explicit Use virtual-camera simulation / Show video comparison switch; keep the validated video comparison available in the same page session.
  - Validate video records before mutating shared comparison state; retain job-scoped storage and server restart recovery.
- Files changed: `frontend/js/app.js`, `frontend/dev-server.js`, `frontend/index.html`, `frontend/test-api.js`, new `frontend/test-state.js`, `README.md`, this tracker. No Python, Java, PowerShell or CSS source changes.
- Tests executed/results:
  - `node --check` for app.js, dev-server.js and test-api.js: passed.
  - `node --test frontend/test-state.js`: 6 passed, 0 failed. Covers fresh/refresh neutrality, run/camera clearing, failed response with no historical fallback, atomic rejection of mismatched pairs, delayed health/obsolete run responses, and video/standalone switching.
  - `node frontend/test-api.js http://127.0.0.1:4174` on an isolated NODE_ENV=test server: full suite passed (exit 0), including actual Python processing and job-scoped paired video simulations, failure isolation, private artifacts, invalid IDs, default individual standalone runs, camera rejection 0/11, and paired 1/5/10-camera runs with 150/750/1500 matching tuples and matching profile IDs.
  - After restarting that server, status/report/comparison retrieval for browser-created job `fa645e5823e14327a1b946177ec37381`: passed; both scenarios retain that job ID and process the expected 20 tuples.
  - Original standalone cloud/edge files restored and their SHA-256 hashes match the pre-test backups. The integration test's temporarily held run.ps1 was restored; no held script remains.
- Browser verification: passed in the in-app browser against port 4174. Observed empty initial page and refresh, both-scenario Running state with empty metrics/table, successful 5-camera pair with 750 processed tuples, Complete status retention, camera change to 6/900 clearing results and highlights, cloud-only selection, and failed edge request after stopping the audit server leaving Failed with no old results. Actual synthetic-fixture video analysis completed; standalone controls disabled in video mode; explicit switching cleared results and switching back restored the same video job. Final loaded source also confirmed Ready/6 cameras/900 expected tuples/empty results.
- Browser evidence: `stage1-empty-state.jpg` (local browser evidence outside the repository).
- Design scan: completed once; warnings include incumbent tiny text and low contrast. Browser screenshot also reveals existing overflow at the default narrow viewport. No CSS redesign attempted; assess these in approved Stage 8.
- Known limitations: fixture tests do not establish object-detection accuracy. Browser failure test used a stopped local server; API suite separately exercised simulation failure. Frontend video selection/cache is page-session state; backend completed-job recovery remains disk-based. Full camera validation at 2/3/6 and broader responsive checks remain Stage 2/8 work.
- Generated data: retained API test jobs `d876e5ab6151498ba8ad38b5d789b512` and `f3d2e279831d4b45a6fb69fe526ba2e4`, plus browser fixture job `fa645e5823e14327a1b946177ec37381`. These are test artifacts, not real CCTV evaluation. The browser fixture upload used normal UI classification, so it is not automatically marked synthetic_test by the API test header; its provenance is recorded here.
- Review: inspected diffs against pre-edit copies saved outside the project. Historical results preserved; test server stopped. At the original Stage 1 handoff, root Git was uninitialized and no commit/push had occurred. The later Git setup below published the reviewed source; generated jobs remain excluded.
- Remaining tasks at Stage 1 completion were Git setup and Stage 2 approval; both were subsequently authorized. Initial publication is verified below. No unresolved Stage 1 functional failure found in executed checks.

## Git preparation and initial publication — 2026-11-17
- Approval: user explicitly requested making the folder Git-ready, pushing to GitHub first, then continuing with the next stage. This authorizes G1–G4 and Stage 2 after a successful initial push.
- Root repository initialized on main; origin is https://github.com/vishol21/EdgeVision.git. Remote HEAD/main inspection advertised no refs before setup; no history was overwritten.
- iFogSim remains a submodule pinned to `5f68d3947e450d8d2b4af42670be819206be68c9` at its official upstream URL. Existing nested history and local runtime artifacts preserved.
- Added root .gitignore/.gitattributes and .gitmodules. Excluded environments, downloaded weights, private uploads/reports/evidence, simulation outputs/classes, credentials and editor files. Included the small synthetic AVI fixture (removed its earlier nested ignore rule). Weight download procedure already exists; no Git LFS adopted.
- Added recursive-clone/setup notes, removed machine-specific user paths from published documentation, and made API tests handle absent historical result files while restoring pre-existing files unchanged.
- Staged review: 57 entries, including one gitlink; approximately 329 KB of project files, with no large binary asset beyond the intentional 16,776-byte fixture. Filename/content scans found no credential patterns or local user paths in the final project candidate set. This is a targeted scan, not a claim of exhaustive secret detection.
- Verification on an isolated export of staged source, with no pre-existing standalone results: Java compilation passed, all 23 Python tests passed, all 6 frontend state tests passed, and the complete API integration suite passed, including paired 1/5/10-camera runs. Export reused installed Python dependencies/model and pinned local simulator checkout; dependency installation from the internet was not retested. Original project historical outputs were untouched.
- Commit/push: `687be247968f4e0c5472fc32068e3cdda76e5d76` (Initial EdgeVision project implementation) pushed to origin/main. Remote ref matched local HEAD; GitHub API confirmed frontend, backend, Python, Java, fixture and pinned submodule entries. Git Credential Manager browser authentication completed successfully; no credentials were placed in source or chat.
- Initial push verified before starting the authorized Stage 2 work.

## Stage 2 — virtual-camera simulation validation
- Approval: user requested continuing with the next stage after making the folder Git-ready and pushing. Stage 2 started only after commit `687be247968f4e0c5472fc32068e3cdda76e5d76` was verified on origin/main.
- Status/objective: validation completed locally for actual source construction, finite emissions, paired workload identity and UI response ordering at 1, 2, 3, 5, 6 and 10 cameras. User approved Stage 2 commit/push and Stage 3 with yes; Stage 3 not started at this commit.
- Tasks completed: inspected the production source factory and scheduling; added test-only Java factory/trace validation, a PowerShell runner, a real API matrix, reproducible instructions and reviewed JSON evidence. No application source or workload assumptions changed.
- Files changed: `frontend/test-camera-workloads.js`, `simulation/tests/CameraWorkloadValidation.java`, `simulation/validate-cameras.ps1`, `simulation/validation/STAGE2_VALIDATION.md`, `simulation/validation/stage2-simulator.json`, `simulation/validation/stage2-api.json`, `simulation/README.md`, this tracker.
- Tests executed/results:
  - `simulation/validate-cameras.ps1`: passed actual sensor construction at all six counts and 12 fresh-JVM cloud/edge simulations. Expected/emitted/processed tuples per placement: 1=150, 2=300, 3=450, 5=750, 6=900, 10=1500. Names distinct, fog gateways correct, 150 finite emissions per camera, 100 ms schedule verified within 1e-7 simulated seconds; maximum observed schedule error below 3.8e-14.
  - `node frontend/test-camera-workloads.js http://127.0.0.1:4175` in isolated exported copy: passed six paired API cases (12 actual scenario runs), exact source IDs/configuration and matching cloud/edge profiles, unique request IDs, correct processed counts. All three actions rejected 0, 11, -1, 1.5, string 5, null and true: 21 expected HTTP 400 responses.
  - `node --test frontend/test-state.js`: 6 passed, including obsolete run/delayed health response guards and atomic invalid-response rejection.
  - Syntax and whitespace checks passed. Simulator compilation emitted only the previously observed deprecation/unchecked notes.
- Browser verification: passed on isolated port 4175. Fresh page neutral; selected 6 cameras/900 expected tuples; observed Running with an empty results table; then Complete and 900 processed tuples in each scenario. Local screenshot: `stage2-six-cameras.jpg` outside Git. API matrix and browser used a copy of production commit 687be24; no production changes occurred in Stage 2.
- Known limitations: emission trace lacks explicit per-emission source IDs; timing phases are inferred from the staggered schedule, while actual sensor identities are verified separately. Synthetic simulator checks do not measure hardware or establish video detection accuracy. No performance significance/repeatability claim made; Stage 3 remains separate. Existing viewport/text issues remain Stage 8 scope.
- Historical data: original project cloud/edge SHA-256 hashes still match the Stage 1 backups; no historical files deleted. The matrix restored its isolated standalone outputs after completion. Generated validation reports remain in ignored results/validation; selected small evidence copies are intentionally staged under simulation/validation. No new video job in the original project.
- Git review: prepared eight Stage 2 files for review; proposed commit message `Validate virtual-camera workloads across six camera counts`. User approval received for this reviewed Stage 2 commit and push; publication will be verified before Stage 3. Initial source commit 687be24 is already pushed and its source files were verified through the GitHub API.
- Remaining tasks: approve committing/pushing the reviewed Stage 2 change set; separately approve Stage 3 multi-camera experiments and analysis. No unresolved Stage 2 failure found in executed checks.

## Current session log
| Date | Stage | Approval | Changes | Tests | Commit / push | Next action |
|---|---|---|---|---|---|---|
| 2026-11-17 | 0 / G0 inspection | Explicit handover first action | Tracker only; build/test artifacts as disclosed above | Python 23 pass; JS syntax pass; Java build pass; API suite fails paired standalone identity; restart recovery pass; browser not performed | None / not attempted | Await Stage 1 approval; preserve baseline and historical data |
| 2026-11-17 | 1 | Explicit “yes” to Stage 1 | Seven authored files; stale-state fix, common paired workload ID, explicit video/standalone switch and regression tests | State 6 pass; full API suite pass; syntax pass; browser pass; restart recovery pass | None / not attempted; root Git setup and commit review pending | Await Git setup review and Stage 2 approval |
| 2026-11-17 | G1-G4 | Explicit request to make Git-ready and push first | Root Git setup, submodule pin, exclusions, portable setup docs and clean-checkout API tests | Export: Java build pass; Python 23 pass; state 6 pass; full API pass | 687be247968f4e0c5472fc32068e3cdda76e5d76 / origin main verified | Started authorized Stage 2 only after push |
| 2026-11-17 | 2 | Explicit continuation after successful initial push | Eight validation/test/evidence/documentation files; no application behavior changes | Java six counts/twelve scenarios pass; API six pairs and 21 invalid inputs pass; state 6 pass; browser six-camera case pass | Stage 2 commit/push awaiting review | Request Stage 2 commit approval and Stage 3 approval |

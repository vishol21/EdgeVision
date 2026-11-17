# EdgeVision project status

## Project information
- Title: Edge Computing for Online Video Analytics Using iFogSim
- Repository: https://github.com/vishol21/EdgeVision.git
- Workspace: EdgeVision project root (absolute local path omitted from version control).
- Current branch: main.
- Current stage: Stage 4 commit/push approved; Stage 5 feasibility investigation approved after publication.
- Overall progress: audit and Stages 1-3 published; Stage 4 multi-camera uploads/analytics/simulation implemented and verified locally.
- Authority: user handover received 2026-11-17 explicitly directs Stage 0 first and requires approval for each subsequent stage.

## Stage table
| Stage | Objective | Status | Approval |
|---|---|---|---|
| 0 | Audit architecture, baseline and Git | Completed | Explicit first-action instruction |
| 1 | Fix stale standalone state and result association | Completed | User approved with “yes” after Stage 1 plan |
| 2 | Validate actual 1-10 camera workloads | Completed | Explicit user request to continue after GitHub push |
| 3 | Repeatable multi-camera experiments | Completed | User approved with yes after Stage 2 commit/push and Stage 3 questions |
| 4 | Multiple uploaded CCTV videos | Completed | User approved with yah; later go on continued the active stage |
| 5 | Investigate live CCTV/IP camera integration | Not started | User approved Stage 4 publication and Stage 5 investigation with yes; live implementation requires a concrete approved plan |
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
- Status/objective: validation completed locally for actual source construction, finite emissions, paired workload identity and UI response ordering at 1, 2, 3, 5, 6 and 10 cameras. User approved Stage 2 commit/push and Stage 3 with yes; Stage 2 published as 37fd6d79b7ad8ceeb655ee1ef0bee6aed3b4e268, verified against origin/main before Stage 3 started.
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
- Git review: prepared eight Stage 2 files for review; proposed commit message `Validate virtual-camera workloads across six camera counts`. Stage 2 commit 37fd6d79b7ad8ceeb655ee1ef0bee6aed3b4e268 pushed to origin/main and remote hash verified before Stage 3. Initial source commit 687be24 is already pushed and its source files were verified through the GitHub API.
- Remaining Stage 2 publication/Stage 3 approvals were received and executed; Stage 2 is verified on origin/main. No unresolved Stage 2 failure found in executed checks.

## Stage 3 — repeated synthetic camera experiments and analysis
- Approval: user answered yes to committing/pushing Stage 2 and moving to Stage 3. Published Stage 2 as `37fd6d79b7ad8ceeb655ee1ef0bee6aed3b4e268` and verified local/remote main hashes before starting this stage.
- Status/objective: repeatable comparisons completed; Stage 3 published as 6285c9a8ee5a866d98f5fdcb24abc7eb9b0f8fa1 after user approval, with remote main verified before Stage 4 started.
- Tasks completed: added a fresh-JVM experiment runner, validated analysis/CSV/chart generation, reference/failure-path tests, preserved raw results, and an academic report with assumptions and limitations. No application source, workload assumptions, API or dashboard behavior changed.
- Files changed: `simulation/experiments/run_experiments.py`, `analyze_experiments.py`, `test_experiments.py`, `STAGE3_ANALYSIS.md`, four reviewed files under `simulation/experiments/evidence/2026-11-17/` (raw.json, summary.json, summary.csv, overview.png), `simulation/README.md`, this tracker.
- Design: five measured repetitions per camera count/placement (60 measured scenario runs), plus one excluded five-camera warm-up pair. One fixed deterministic profile per count across repetitions; profile shared by each paired cloud/edge run. Alternating scenario order, rotating camera-count order. Fresh JVM per scenario; warm-up only affects OS/file caches, not shared JIT state. Existing 100 ms nominal interval, 15 s arrival window, 150 tuples/camera and 2,000-unit simulation horizon preserved.
- Tests/results:
  - Production Java compilation and 62 scenario invocations passed. All 30 measured pairs passed exact workload/source identity, configuration, complete tuple-arrival count and horizon validation.
  - `python -m unittest discover -s simulation/experiments -p test_experiments.py -v` using the project venv: 6 passed. Checks reference mean/sample standard deviation, non-finite input, incomplete/failed evidence, exact profile identity, missing processing, warm-up exclusion, signed comparisons and duplicate repetition rejection.
  - Independent audit verified all 96 camera/scenario/metric summaries against raw values and checked source/data SHA-256 hashes. Figure visually inspected; labels/legend/table data verified. Unit labels explicit in report, figure and CSV.
  - Modeled latency, payload traffic, energy and tuple counts exactly repeated across all five repetitions at each configuration. Wall-clock runtime varied; min/max and sample deviation retained. No statistical-significance claim.
- Key findings: edge detector-arrival latency 62.55–69.31% lower and counted payload traffic 48.75% lower; full application-loop latency 17.72–49.68% higher. Modeled energy is 0.502% higher at two cameras and 9.405% lower at ten cameras; not monotonic in every interval. At ten cameras, Java-measured runtime means: cloud 307.0 ms, edge 616.6 ms. This is local simulator runtime, not video-processing time or physical edge execution time.
- Unit finding requiring an approved correction: legacy `loopLatencyMs`/`analyticsLatencyMs` values are raw CloudSim clock averages with no milliseconds conversion. Existing dashboard labels remain misleading under the declared seconds-based workload. Stage 3 reports raw simulator time units and preserves the original exported keys/values; no hardware calibration or silent parameter reinterpretation. Fix the unit contract/UI before final academic presentation.
- Additional metric limits: detector latency ends at Event_Detector arrival and excludes its compute time; processed counter observes arrivals at cloud storage, not confirmed storage execution. Energy aggregates configured device counters over a fixed horizon; the small-load energy regression and non-monotonic steps need per-device utilization/accounting investigation before causal claims. Report explains topology-consistent delay trade-offs without isolated causal attribution.
- Browser verification: not rerun because no UI/production changes; Stage 2 browser checks remain the latest. Scientific chart inspected locally instead. No web research or paper-alignment claim made.
- Data protection: ignored generated run evidence is under results/experiments/stage3-2026-11-17; intentional reviewed copies total about 447 KB. Original cloud/edge files still match prior SHA-256 hashes; no historical output/profile deletion and no new video job.
- Git review: ten Stage 3 files prepared for review. Proposed message: `Add repeatable cloud-edge experiments and honest metric analysis`. Stage 3 commit 6285c9a8ee5a866d98f5fdcb24abc7eb9b0f8fa1 pushed to origin/main and remote hash verified before Stage 4. Stage 2 commit/push already verified.
- Stage 3 publication and Stage 4 approvals were received and executed. The latency-unit contract still needs a separately approved correction before final reporting; investigate energy attribution if stronger conclusions are required. No experiment execution or validation test failed.

## Stage 4 — multiple uploaded camera recordings
- Approval: user answered yah to Stage 3 publication and moving to Stage 4, then said go on while this stage was active. Stage 3 was committed/pushed as `6285c9a8ee5a866d98f5fdcb24abc7eb9b0f8fa1`; remote main matched before implementation began.
- Status/objective: implemented and verified locally. Multiple uploaded recordings retain individual YOLO/ByteTrack analytics and contribute independent camera workloads to one paired comparison. Stage 4 commit/push pending review; Stage 5 not started or approved.
- Implementation:
  - Preserved the original single-video uploader/routes. Added a separate batch manifest/upload/run/status API and UI, unique camera IDs plus separate child job IDs, streaming uploads and sequential existing Python processing under a shared compute lock.
  - Combined schema-2 profile embeds each original camera profile; tuple counts sum each source's independently rounded count. Cameras retain FPS/frame batching, independent intervals, CPU estimates/payload assumptions, and distinct tuple types/source IDs. Modeled start times share one origin; footage synchronization is not asserted.
  - Java creates independent finite sensors feeding the existing modules. Source-tagged telemetry verifies actual per-camera emissions, intervals and result arrivals; a batch-specific accumulator measures the combined loop average. Existing single-video and synthetic simulation branches retain their formats/behavior.
  - Combined results use results/video_batches/<batch-id>/; manifests/profiles and child association sidecars remain private under video_analytics/outputs. Recovery validates parent/child identities, original reports/profiles, combined profile and both outputs. Analysis-only child status explicitly identifies its batch comparison after restart.
  - UI shows per-camera progress/errors, individual analytics, aggregate camera-scoped counts, successful/selected camera counts and total tuples. Partial success excludes and lists failed inputs; all-failed batches run no simulation. Refresh starts neutral; batch recovery is explicit by ID. Narrow-screen controls/table received scoped fixes; existing design retained.
  - Configured defaults: 10 recordings, existing 500 MiB per file, 1 GiB total and 100,000 combined tuples. Sequential model loading bounds simultaneous inference, but processing time adds across cameras and output/report/cache storage can grow. Tuple cap and adaptive combined horizon are disclosed; no live sources or new framework introduced.
- Files changed: frontend server/new multi-video module, HTML/CSS/app/state tests plus new batch/profile tests; Java EdgeVisionSimulation/MetricsController/VideoWorkloadProfile and new MultiVideoWorkloadProfile; run.ps1 result routing; Python settings and synthetic fixture generator; README/component docs, reviewed stage4-integration.json and this tracker. Exact staged file list is the review scope; generated recordings/results are excluded.
- Tests/results:
  - Original full frontend/test-api.js in an isolated NODE_ENV=test copy: passed existing upload/analysis/profile/video comparison/artifacts, simulation-failure isolation, standalone cloud/edge/both, invalid counts and paired 1/5/10-camera workloads.
  - Python unittest discovery: 23 passed, including real YOLO26n/ByteTrack fixture I/O and existing rules/security/profile tests. Expected invalid-video decoder diagnostic occurred in its rejection test.
  - Frontend state/profile tests: 11 passed (8 state and 3 combined-profile tests). Includes neutral refresh, obsolete response guards, atomic batch identity validation, independent rounding and all-failed neutral presentation.
  - New batch API suite: passed two distinct clips (20 frames at 10 FPS, 12 at 4 FPS), 32 combined tuples, per-source 0.1/0.25 s intervals, 3 s maximum duration, matching paired profile and busy locks. Partial case retained one successful 20-tuple camera and separately displayed decode/upload failures. All-failed case produced no simulation. Forced missing run.ps1 preserved both successful camera reports and withheld scenario results; held script restored in finally.
  - Restart recovery on the final association-aware pipeline: passed batch `2876eae2e1054064858a5b4942a56f65`, both child JSON reports, batch/camera status identities, included_in_batch status and byte-range output playback. Swapped saved result source identity was rejected with neither scenario published; individual reports remained available. Unfinished draft recovery reported interrupted without inventing results.
  - Controlled Java profile checks: preserved different frame batches/intervals, configured CPU and payload inputs, verified modeled network bytes for those inputs, completed ten distinct recording sources, and rejected nine malformed profiles before result output. Controlled CPU test values are not a hardware calibration.
  - Standalone regression via validate-cameras.ps1: all six counts and both placements passed actual source/finite emission/timing/processed-count checks; output saved separately as ignored stage4-camera-regression.json.
  - Resource guard: isolated test temporarily set cap to 31; actual 32-tuple workload preserved both successful analytics and prevented combined simulation. Isolated configuration restored to 100,000. Camera manifest null descriptors returned HTTP 400; count/path/size-limit checks passed. Maximum-sized video transfers/stress tests were not performed.
  - Java build, Node syntax and whitespace checks passed. Existing compiler deprecation/unchecked notes remain. Frontend startup assertion was updated to permit the new configuration-only request; no historical-result fetch was introduced.
- Browser verification: passed actual two-file selection, sequential processing, two analyzed cameras/32 tuples, per-camera report without replacing comparison, neutral refresh and explicit recovery. Partial/all-failed recovery displayed correct statuses and exclusions. At 390 px viewport, scoped button height was 34 px and the 560 px camera table scrolled within its container. Viewport override reset. Local evidence: stage4-multi-recordings.jpg outside Git. Final user-facing status wording additionally covered by state tests.
- Design scan: executed once; incumbent small-text/contrast/tracking/progress findings remain Stage 8 scope. Scoped new table/control legibility fixes applied; no redesign.
- Known limits: tests use moving-shape fixtures and controlled profiles, not labeled real CCTV accuracy data. Shared global rules/regions apply to all recordings; per-camera region editing and cross-camera re-identification are not implemented. Unfinished batches are not automatically resumed; unprocessed uploads can remain. Output-storage quotas and long/max-size workload stress tests are absent. Legacy dashboard latency labels remain inconsistent with raw clock values, as documented in Stage 3; no silent unit/parameter change made.
- Data protection: root historical standalone hashes remain unchanged; no historical profiles/results deleted. Integration/failure/recovery/browser runs used an isolated copy. Original-workspace Python tests removed only their own temporary fixtures/jobs; controlled validation artifacts remain under ignored results. Selected small synthetic validation evidence is intentionally reviewed for version control. Test server stopped; no held simulation script remains.
- Git review: Stage 4 changes prepared for review; proposed commit `Add multi-recording analytics and identity-preserving batch simulation`. User approved Stage 4 commit/push with yes; publication will be verified before the Stage 5 feasibility investigation. Source and tested assumptions are documented in video_analytics/MULTI_CAMERA.md.
- Remaining tasks: approve Stage 4 commit/push, separately approve Stage 5 investigation of live CCTV/IP-camera requirements, and resolve the known unit contract before final academic presentation. No unresolved failure in the executed Stage 4 checks.

## Current session log
| Date | Stage | Approval | Changes | Tests | Commit / push | Next action |
|---|---|---|---|---|---|---|
| 2026-11-17 | 0 / G0 inspection | Explicit handover first action | Tracker only; build/test artifacts as disclosed above | Python 23 pass; JS syntax pass; Java build pass; API suite fails paired standalone identity; restart recovery pass; browser not performed | None / not attempted | Await Stage 1 approval; preserve baseline and historical data |
| 2026-11-17 | 1 | Explicit “yes” to Stage 1 | Seven authored files; stale-state fix, common paired workload ID, explicit video/standalone switch and regression tests | State 6 pass; full API suite pass; syntax pass; browser pass; restart recovery pass | None / not attempted; root Git setup and commit review pending | Await Git setup review and Stage 2 approval |
| 2026-11-17 | G1-G4 | Explicit request to make Git-ready and push first | Root Git setup, submodule pin, exclusions, portable setup docs and clean-checkout API tests | Export: Java build pass; Python 23 pass; state 6 pass; full API pass | 687be247968f4e0c5472fc32068e3cdda76e5d76 / origin main verified | Started authorized Stage 2 only after push |
| 2026-11-17 | 2 | Explicit continuation after successful initial push | Eight validation/test/evidence/documentation files; no application behavior changes | Java six counts/twelve scenarios pass; API six pairs and 21 invalid inputs pass; state 6 pass; browser six-camera case pass | 37fd6d79b7ad8ceeb655ee1ef0bee6aed3b4e268 / origin main verified after user approval | Started authorized Stage 3 |
| 2026-11-17 | 3 | Explicit yes to Stage 2 publication and Stage 3 | Experiment runner, analysis/tests, raw evidence/CSV/chart and report; model preserved | 60 measured + 2 warm-up scenarios passed; 30 matched pairs; 6 reference tests; 96-summary audit; plot inspected | 6285c9a8ee5a866d98f5fdcb24abc7eb9b0f8fa1 / origin main verified | Started authorized Stage 4; latency-unit correction remains required |
| 2026-11-17 | 4 | Explicit yah to Stage 3 publication and Stage 4; go on continued active work | Multi-recording batch API/UI, independent-source Java integration, recovery/partial failures, tests/docs/evidence | Original API pass; Python 23 pass; frontend 11 pass; batch/controlled Java/restart/resource/browser checks pass; standalone matrix pass | Stage 4 commit/push pending review | Approve Stage 4 publication and Stage 5 investigation separately |

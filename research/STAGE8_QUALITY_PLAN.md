# Stage 8 dashboard and system quality plan

Prepared 2026-11-17 after Stage 7 publication `3aba133c908933aa3af9a4df7292ee28d0b2a7b1`. User approved this concrete plan with yes on 2026-11-17. This file preserves the planned scope; completed changes, tests and limits are in [Stage 8 verification](../frontend/STAGE8_VERIFICATION.md).

## Findings from current source inspection

- `frontend/index.html` labels application/analytics latency as ms in cards, charts and result-table headers. `frontend/js/app.js` displays `loopLatencyMs` and `analyticsLatencyMs` directly. Java exports raw CloudSim averages without conversion, as established in Stages 3/7. A factual label correction is required.
- The two metrics have different endpoints: full loop ends at result arrival at cloud storage; analytics metric ends at Event_Detector arrival, before its compute time. Generic latency wording conceals that difference.
- Styles include 7-10 px mobile labels and 8-9 px table/chart text. Existing dark palette/layout should remain, while legibility and contrast receive scoped fixes.
- Main buttons are 34 px high and mobile navigation can be 32 px. Keyboard focus, file-picker/recovery input usability, long filenames and narrow-screen table containment need a browser pass.
- `renderCharts` silently returns if the external Chart.js library is absent. Numerical data/table remain useful, but users need a clear chart-availability notice rather than empty chart areas without explanation.
- Existing state guards, shared workload identity, neutral refresh, partial batch handling, explicit recovery and separate video/standalone selection are already implemented and must remain intact. Source inspection alone is not a new verification of runtime behavior.

## Proposed changes

1. Correct the presentation contract consistently. Label full-loop and detector-arrival values as raw simulator time units in cards, chart labels/axes/tooltips, accessibility descriptions and table headings. Add a short plain-language explanation of endpoints and distinguish Java wall-clock milliseconds from local video-processing seconds/FPS.
2. Preserve legacy Java/JSON keys and numerical values, including historic saved jobs. Do not multiply values, rewrite result files, silently reinterpret units or change workload timing. Document the legacy naming explicitly in developer-facing metric/setup documentation; keep implementation details out of ordinary UI copy.
3. Make modeled traffic/energy and tuple-arrival meaning clear without claiming measured LAN bandwidth, physical power or confirmed storage completion. Retain the distinction among uploaded recordings, replicated/virtual workloads and actual local inference. Retain region-rule coverage and camera-scoped ID caveats.
4. Fix verified presentation/accessibility defects within the existing palette and layout: readable text, contrast, visible keyboard focus, comfortably sized action targets, wrapping/contained tables, and reduced-motion behavior for progress/smooth scrolling. Preserve useful loading feedback when motion is reduced. Do not redesign or introduce a UI framework.
5. Provide an accessible chart-unavailable notice when Chart.js cannot load; keep cards/table and all actions functional. No new dependency, chart replacement, authentication or deployment.
6. Inspect all existing flows for concrete bugs; correct only reproducible issues within validation, state/error handling, job association and responsiveness. Record unrelated backend/resource/security extensions as limitations rather than expanding scope.

## Expected files

`frontend/index.html`, `frontend/css/styles.css`, `frontend/js/app.js`, focused frontend regression tests, simulation metric documentation, a Stage 8 verification report and `PROJECT_STATUS.md`. Backend changes only if a reproducible in-scope root cause requires them; document any such scope adjustment before changing it. No model, simulator parameter, generated-history or technology changes.

## Verification

- Add meaningful regressions for raw-value preservation with correct units/endpoints, neutral/loading/success/failure states, obsolete-response protection, selected recording comparisons and chart-library absence. Retain existing tests and avoid tests that merely mirror CSS declarations.
- Run frontend tests and existing API checks in an isolated test copy. Verify cloud-only, edge-only and paired runs, camera-count validation and matching profiles. Use the two synthetic fixtures for single/batch analysis, invalid media, partial/all-failed handling and recovery after restart. Do not present fixtures as accuracy evaluation.
- Browser verification in one batched desktop/mobile inspection (approximately 1440 px and 390 px), with keyboard access and a narrow/zoomed layout check. Cover fresh load/refresh, configuration change, running/failed/successful states, single versus batch comparison selection and reports, recovery, long filenames and chart-unavailable behavior. Inspect once, fix demonstrated defects together, then perform at most one visual confirmation pass. Functional regressions receive targeted retests as needed.
- Confirm cards/charts/table use matching units and unchanged API values. Use actual API data for observed success/recovery and clearly label any injected frontend failure fixtures. Check console/network failures, horizontal overflow, focus visibility and progress behavior.
- Keep original historical cloud/edge hashes and existing profiles/results unchanged. Use isolated run artifacts and stop test servers. No camera connection, network scan or live implementation.

## Publication and limits

Update the tracker with exact changes, tests and untested conditions. Present the reviewed file list and verification report; commit/push only after approval. Stage 9 documentation/presentation remains separately approved work. This pass cannot establish real CCTV accuracy, deployed edge/cloud performance, comprehensive security certification or universal accessibility compliance.

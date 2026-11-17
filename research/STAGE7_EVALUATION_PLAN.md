# Stage 7 performance evaluation plan

Prepared 2026-11-17 after Stage 6 publication (`1008c5a784dc1b8e2466f64057b2b9d914ff5565`). The user approved this plan with ok on 2026-11-17. This file preserves the planned design; completed evidence and disclosed evaluator corrections are in [the Stage 7 report](../simulation/experiments/STAGE7_EVALUATION.md).

## Objective and boundary

Evaluate workload placement under increasing demand using the existing Java simulator and existing local recording-analysis pipeline. Preserve all application APIs, result formats, historical evidence, model and workload defaults. No live streaming, physical camera assumptions, cloud deployment, model comparison or accuracy claim.

## Measurement contract

- Export loop latency and detector-arrival latency explicitly as raw CloudSim time units in the evaluation report/CSV/chart. Legacy `loopLatencyMs` and `analyticsLatencyMs` remain unchanged in application records. Do not present their values as milliseconds. No runtime unit conversion or UI change is included in this stage; the dashboard correction remains separately scoped to Stage 8.
- Full loop: camera emission through result arrival at cloud storage, not confirmed storage execution. Detector-arrival latency excludes detector computation and subsequent cloud delivery. Neither is physical capture-to-alert latency.
- Record modeled payload traffic in decimal MB, modeled device energy in joules, complete tuple-arrival counts and internal simulation horizon. Energy depends on the horizon and idle-power accounting; compare cloud/edge within the same case/horizon. Do not attribute cross-case energy changes solely to camera count if the horizon differs.
- Record Java controller-region wall-clock runtime separately from external JVM process elapsed time and local video-processing duration/FPS. No physical inference throughput is inferred from simulation runtime.

## Workloads and execution

| Family | Cases | Source and expected counts |
|---|---|---|
| Synthetic virtual sources | 1, 2, 3, 5, 6, 10 cameras | Unchanged 150 tuples/camera; 150, 300, 450, 750, 900, 1,500 tuples. Nominal 0.1-second interval, 15-second arrival window, 2,000-unit horizon. |
| Single analyzed recording | Clip A; clip B | Existing moving-shape fixtures, 20 frames at 10 FPS and 12 frames at 4 FPS. Run the existing YOLO26n/ByteTrack pipeline locally once per clip to derive real profiles, rather than fabricate analytics reports. |
| Multiple recording profiles | 2, 5, 10 sources | Alternate copies of derived A/B profiles with distinct camera/job IDs. Expected 32, 84, 160 tuples under existing one-frame batching. Independent 0.1/0.25-second intervals. These are replicated synthetic recording workloads, not footage from 10 distinct real cameras. |

Eleven cases, five measured cloud/edge pairs per case: 110 measured fresh-JVM simulations. One excluded five-camera synthetic warm-up pair: two additional simulations. Alternate scenario order and rotate case order. Keep one immutable input profile/identity per case throughout its repetitions; record SHA-256 hashes, source commit, simulator revision, configuration, model and fixture identity, environment, ordering and failures.

Build once before execution. Reuse existing Stage 3 runner/analyzer where applicable; add profile-case orchestration and validation without changing production simulation logic. All experiment files belong in new unique ignored results/experiments directories. Export only reviewed, small synthetic evidence into version control. Do not read private historical uploads as a dataset. Generated uploads/reports belong only to this evaluation; do not remove prior jobs or results.

Video processing timings are descriptive single-run observations, including the pipeline's reported timing boundary. They are not a repeated inference benchmark. Pipeline cold-start/model-load and per-frame inference time should not be conflated. No people/vehicle/event count is treated as labeled ground truth; default empty regions imply region-based rules are not evaluated.

## Validation and deliverables

1. Validate case completeness, unique source identities, profile equality across each pair and repetitions, expected tuple totals, actual per-camera emission timing where available, complete arrivals and equal within-pair horizons. Fail closed on missing/mismatched/non-finite results.
2. Add focused evaluator tests with known statistics, signed percentage changes, incomplete repetitions, swapped identities/counts and invalid metric data. Run existing experiment tests and applicable profile validation checks.
3. Retain raw runs, immutable input profiles, fixture/model/config hashes, separate timing scopes and descriptive mean/sample standard deviation/min/max. Deterministic repeats do not establish significance.
4. Produce a report, CSV/JSON and standalone plots with explicit units, signed cloud/edge comparisons and negative outcomes preserved. Visually inspect plots and independently audit summaries against raw records.
5. Confirm original application files and historical standalone outputs are unchanged. Browser checks are unnecessary if runtime/UI files remain untouched. Update PROJECT_STATUS.md and present the exact evidence/file list for review before commit/push.

## Limits and subsequent work

Only synthetic moving-shape recordings are available for this plan. The evaluation can establish integration, finite workload scaling and repeatability under model assumptions; it cannot establish real CCTV accuracy, general workload representativeness, real-time 1080p/15-FPS capacity, physical power consumption or reproduction of the selected paper. Real labeled/permissioned recordings, CPU/payload calibration or sensitivity sweeps, per-device causal energy analysis and dynamic VM allocation require explicit additional scope. Stage 8 and later stages remain unapproved.

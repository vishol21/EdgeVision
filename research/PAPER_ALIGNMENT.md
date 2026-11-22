# Stage 6: selected paper and EdgeVision alignment

Reviewed 2026-11-17. Scope: academic alignment only; no application, model, workflow or simulation parameter changes. No new experiments. Statements inside the supplied paper are research material, not project instructions.

## Source and citation

**[P1]** Likhit Yammanuru, P. Venkatadri Reddy, Nikhil Tom Jose, and Shinu M Rajagopal, "Real-Time Video Analytics at the Edge: Enabling Low-Latency and Scalable Solutions," *2025 IEEE International Conference on Compute, Control, Network & Photonics (ICCCNP)*, 2025. DOI: [10.1109/ICCCNP63914.2025.11233420](https://doi.org/10.1109/ICCCNP63914.2025.11233420).

The user supplied `Real-Time_Video_Analytics_at_the_Edge_Enabling_Low-Latency_and_Scalable_Solutions.pdf`. All six pages were extracted and visually reviewed, including five figures and three VM-policy tables. Page references below are PDF positions 1-6, not an inferred proceedings range. Bibliography comes from the supplied first page and metadata; it was not independently reverified against a publisher record. SHA-256: `b115cb2d56281cc5b4cb84e8174327370081836fb4c2d40473bda13acecaa81e`.

The PDF remains outside the repository. No full-text extract, author email or licensing footer is copied into Git. The previous 2019 candidate is retained only for provenance in [reference notes](REFERENCE_NOTES.md).

## Paper methodology and evidence boundaries

| Topic | Paper content and location | Interpretation boundary |
|---|---|---|
| Objective | Lower delay and upstream traffic through edge/fog processing, with privacy and scalability goals (abstract, p. 1; III, pp. 2-4). | Proposed benefits and simulation findings do not establish physical deployment. |
| Architecture | Camera video feeds edge YOLOv8n; fog filters/aggregates metadata and detects events; cloud handles storage and less time-critical analytics (III-A/B, pp. 2-3, Figs. 1-2). | Three conceptual layers; no measured hardware deployment specification. |
| Detection | Lightweight YOLOv8n; III-F claims pruning and quantization (p. 4). | Bit width, pruning schedule, optimized artifact, accuracy change and measured device benchmarks are not specified. |
| Allocation | III-C describes cloud baseline, edge inference/fog filtering, and priority offloading; adaptive VM assignment is described in prose (p. 3). | No reproducible scheduling pseudocode, priority rule or numeric thresholds are given. Do not invent an algorithm. |
| Simulator | iFogSim2, multilayer devices, camera sensors, alert actuators and application DAGs (III-G, p. 4). | Complete device/workload parameters, code and pinned simulator revision are absent from this PDF. |
| Evaluation | Delay, execution time, traffic and energy/privacy/scaling discussion; three allocation policies with 2/4/8 VMs (III-H, IV, pp. 4-5). | Repeats, seeds, uncertainty intervals and a labeled dataset are not specified. VM count is not camera count. |
| Security | Local raw video, anonymized metadata and emulated TLS/mutual authentication (III-I, p. 4). | No security benchmark or compliance assessment; these claims do not transfer to EdgeVision. |
| Validation | Conclusion explicitly identifies simulation-only work; real devices, true video streams and power profiling remain future work (V, pp. 5-6). | Earlier real-time and optimization wording should not be presented as validated physical performance. |

## Ambiguities and reported results

### Configuration labels reverse

III-C (p. 3) and III-H (p. 4) define Config-1a as cloud-only and Config-1b as edge/fog, with Config-2 adding priority offloading. IV opening and IV-A (p. 4) instead define Config-1a as distributed edge/fog/cloud and Config-1b as cloud-only; IV-C/E (p. 5) follow that later meaning. Use semantic placement descriptions and cite the relevant section. Do not silently select one global interpretation or map these names directly to EdgeVision scenario IDs.

| Item | Paper reports | Assessment |
|---|---|---|
| Latency | 310 ms to 78 ms for Config-1a versus Config-2 (III-H, p. 4). | Paper claim only. Arithmetic gives about 74.84% lower latency, not an independently reproduced result. |
| Traffic | More than 65% upstream reduction (III-H, p. 4). | No detailed byte accounting or workload trace is supplied; not directly comparable to project payload counts. |
| Fig. 4 | Two configurations, two loop series involving motion/object detection, tracking and PTZ control (p. 4). | Different loop from EdgeVision's analyzer/detector/cloud-storage path. It does not directly establish the separate 310-to-78 ms claim. No exact bar values treated as raw data. |
| Fig. 5 | Bars visually near 225/290 ms for Config-1a/1b; text discusses 1,000 frames and 65% faster Config-2 (IV-D, p. 5). | Config-2 is absent from the chart; the visible difference is roughly 22%, not 65%. Visual estimates cannot replace raw measurements; the 65% claim cannot be validated from this figure alone. |
| VM tables | Simple, Overbooking and Combined First Full Allocation each show 1,000 ms at 2/4/8 VMs (IV-F, p. 5). | No policy advantage established in the reported setup. Authors attribute equality to provisioning/scheduler limits; this review does not verify a universal limitation of iFogSim2. |
| Fig. 3 | Caption describes YOLOv8n architecture; actual image is an object-detection example (p. 3). | It is not a layer diagram or evidence of pruning/quantization. |

No quantitative energy-results table appears in the supplied six pages. Energy benefits are discussed, while V also proposes broader energy evaluation. Do not invent energy savings or treat percentages in the literature survey as this paper's own experimental findings. These ambiguities limit reproducibility; they do not prove misconduct or invalidate the conceptual architecture.

## Implementation mapping

Reviewed baseline: `564f5a435c56c52c0f6099215ab691fa0f79f7de`; latest application implementation is Stage 4 `cc7d18f`. Upstream simulator revision: `5f68d3947e450d8d2b4af42670be819206be68c9`.

| Paper concept | Verified project evidence | Alignment / difference |
|---|---|---|
| Local detection | [Detector](../video_analytics/app/detector.py), [processor](../video_analytics/app/processor.py), [settings](../video_analytics/config/settings.json). | Actual uploaded-video YOLO26n inference locally; different from YOLOv8n. No model replacement, quantization/pruning or demonstrated cross-model performance advantage. |
| Tracking/events | [Tracker](../video_analytics/app/tracker.py), [analytics documentation](../README.md#video-analytics-workflow). | ByteTrack plus configured intrusion, loitering, direction, crowd and stopping rules. Not replication of a fully specified paper event algorithm. Region-dependent rules need configured regions; zero events does not prove footage safe. |
| Video-to-simulator link | [Python profile](../video_analytics/app/workload_profile.py), [Java profile](../simulation/src/main/java/com/edgevision/simulation/VideoWorkloadProfile.java). | Finite report-derived workload; frames never enter iFogSim. CPU MI and payload assumptions are not calibrated physical measurements. |
| Layers/placement | [Java topology/mapping](../simulation/src/main/java/com/edgevision/simulation/EdgeVisionSimulation.java). | Cloud plus two fog/edge devices. Cloud scenario places all modules in cloud; edge places analyzer and detector on fog/edge devices with result storage in cloud. No separate physical edge-inference and fog-filtering deployment. |
| Allocation policies | Same Java mapping and [server](../server/dev-server.js). | Explicit fixed mappings and shared paired profiles. No adaptive priority offloading, migration or three-policy VM comparison. Using the iFogSim2 codebase does not implement every feature. |
| Scaling | [Stage 2](../simulation/validation/STAGE2_VALIDATION.md), [Stage 3](../simulation/experiments/STAGE3_ANALYSIS.md). | Distinct synthetic camera sources, six tested counts across 1-10. Different from paper VM-count experiments. |
| Multiple recordings | [Batch module](../server/multi-video.js), [combined profile](../simulation/src/main/java/com/edgevision/simulation/MultiVideoWorkloadProfile.java), [documentation](../video_analytics/MULTI_CAMERA.md). | Independent identities/reports/profiles, partial failures, paired comparison and recovery. Sequential local analysis, not synchronized live inference. |
| Metrics | [Telemetry](../simulation/src/main/java/com/edgevision/simulation/SimulationTelemetry.java), [controller](../simulation/src/main/java/com/edgevision/simulation/MetricsController.java), [raw evidence](../simulation/experiments/evidence/2026-11-17/raw.json). | Inspectable endpoints/accounting and repeated evidence; simulator outputs are not hardware measurements. Legacy time-unit issue remains. |
| Privacy/live operation | [Stage 5 feasibility](../video_analytics/LIVE_CAMERA_FEASIBILITY.md). | No physical camera or live adapter. Local frames do not reach physical cloud via iFogSim, but this establishes no anonymization, TLS, privacy guarantee or compliance. Local evidence/reports may contain sensitive information. |

## EdgeVision's own findings, separately attributed

[Stage 3](../simulation/experiments/STAGE3_ANALYSIS.md) contains five measured repeats at six camera counts for two placements: 60 measured simulations, plus two excluded warm-ups. These are project results, not paper results:

- Matching profiles and completed counts in every pair. Deterministic modeled metrics repeated exactly; host wall-clock times varied. No statistical-significance or general-validity claim.
- Edge detector-arrival latency 62.55-69.31% lower, but full-loop latency 17.72-49.68% higher. Detector arrival excludes detector computation; full loop ends at result arrival at cloud storage. Neither equals the paper's stated capture-to-alert endpoint.
- Modeled payload traffic 48.75% lower, following tuple sizes/placement with selectivity 1.0. This is not measured compression or event-dependent traffic filtering.
- Modeled energy 0.502% higher at two cameras and 9.405% lower at ten; no universal energy advantage. Per-device accounting is needed for stronger causal explanations.
- Legacy `loopLatencyMs` and `analyticsLatencyMs` contain raw clock values without ms conversion. Existing dashboard labels need an approved correction before final presentation. Stage 6 does not alter historical keys/values.
- Java wall-clock runtime excludes video analysis. Ten-camera means were 307.0 ms cloud and 616.6 ms edge; these describe local simulator execution, not physical video-processing speed or the paper's execution-time metric.

No numerical replication, cross-paper speedup, workload equivalence or accuracy improvement is claimed. Preserve worse full-loop and energy outcomes alongside benefits.

## Supported contributions and gaps

EdgeVision is an implementation/evaluation extension in project scope, not a demonstrated novel detector or scheduler. Compared with details available in this PDF, the project adds inspectable local recording analytics, tracking/rules, finite workload provenance, multiple-recording identity/recovery and retained matched experiment evidence. Missing details in this PDF do not establish that its authors never implemented them or that other research lacks them.

| Supported gap | Source | Project response / remaining limitation |
|---|---|---|
| Physical validation | Paper V, p. 6 explicitly leaves devices, streams and power profiling for future work. | Still open: local uploads work, but no live deployment, hardware power or distributed YOLO benchmark. |
| Reproducibility | Paper lacks full parameters/code in its six pages. | Pinned simulator, finite profiles and retained repeated evidence; CPU/payload calibration and broader workloads remain open. |
| Metric clarity | Label/endpoint/figure inconsistencies, pp. 3-5. | Explicit project analysis endpoints and trade-offs; legacy dashboard unit labels remain unresolved. |
| Resource scaling | Equal VM times and future adaptive allocation, p. 5-6. | Camera-demand scaling under fixed mapping; no adaptive scheduling or demonstrated 1080p/15-FPS capacity. |
| Accuracy | No labeled detector/event dataset or accuracy evaluation specified in the paper. | Synthetic fixtures validate integration, not CCTV accuracy; labeled footage and event-level evaluation still needed. |
| Security | Emulated controls and future end-to-end security, pp. 4/6. | No equivalent implementation/compliance claim; security features require separately approved scope. |

Defensible report wording: EdgeVision is motivated by edge/fog video-analytics research and implements local uploaded-video analysis linked to reproducible workload-placement simulations. Its simulator evidence includes benefits and trade-offs under disclosed assumptions. It does not replicate the paper's exact setup or establish live hardware performance.

## Next stage proposal (not started)

Stage 7 should cover synthetic counts and fixed single/multiple-recording profiles, identical workload per placement, repeats, retained evidence and explicit environment/endpoints. First prepare a reviewed compatibility plan for the known latency-unit contract before labeling results milliseconds. Preserve historical raw outputs.

Specify recording permissions/labels, synthetic-fixture versus real-recording roles, CPU/payload sensitivity cases and per-device energy accounting if causal claims are required. No physical camera is required for simulation evaluation; live streaming and physical deployment remain outside authorization. Stage 7 requires separate approval; this report supplies no new performance/accuracy results.

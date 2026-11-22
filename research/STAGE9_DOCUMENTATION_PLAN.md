# Stage 9 final documentation and presentation plan

Prepared 2026-11-17 after Stage 8 publication `5091b7f2de43ccbc76091940be68e713d59b6499`. The user approved moving to Stage 9, then explicitly deferred the report and slides and asked to continue with the next items. The practical supporting-document subset below was completed; formal report/deck authoring and rendering remain deferred. No institutional metadata is needed for this subset.

## Existing sources and gaps

The repository contains setup/component documentation, selected-paper alignment, Stage 3/7 raw experiment evidence and Stage 8 UI verification. No final academic report, slide deck, demonstration script or viva guide was found outside the vendored simulator. Existing README text predates some batch/recovery and metric-presentation details; consolidate and correct it against current implementation.

The user's selected paper is Real-Time Video Analytics at the Edge: Enabling Low-Latency and Scalable Solutions (ICCCNP 2025), DOI 10.1109/ICCCNP63914.2025.11233420. Its actual six-page text was reviewed in Stage 6. Preserve its configuration-label ambiguity and validation limits; do not claim numerical replication or reuse literature-survey percentages as project results. The earlier 2019 candidate remains historical context only.

## Originally proposed deliverables (report/slides subsequently deferred)

| Deliverable | Content and form |
|---|---|
| Academic report | Editable DOCX plus versioned Markdown source and, where the available renderer supports verified export, a PDF. Include abstract, problem, objectives, existing/proposed system, focused literature review, supported research gaps, architecture, methodology/algorithms, stack, implementation, experimental setup, results/discussion, limitations, future work, conclusion and references. |
| Presentation | Editable PPTX, approximately 16-18 slides, covering motivation, architecture, the two distinct workflows, multiple recordings, methodology, evidence, benefits/trade-offs, limitations and demonstration sequence. Include speaker notes where supported. Reuse verified charts and redraw simple architecture diagrams from implementation truth. |
| Demonstration script | Markdown guide for a short repeatable local demonstration: startup, neutral state, virtual-camera comparison, single video, multiple recordings/partial failures, reports/recovery and honest interpretation of metrics. Explain expected waiting times without promising a hardware benchmark. |
| Viva guide | Markdown questions/answers about edge/fog/cloud, simulator versus actual inference, YOLO/ByteTrack/rules, profiles, paired fairness, units, results, validation limits, paper differences and future work. |
| Setup/reproduction guide | Consolidated Windows setup, pinned submodule/JDK/Python/model requirements, startup, configuration, testing, experiment reproduction, storage locations and troubleshooting. Preserve exclusions and safe handling of generated/private media. |
| GitHub README and index | Update current README with implemented features, metric contract, qualified results and links to the final package/evidence. Add a documentation index and publication-readiness checklist distinguishing verified items from user-supplied academic metadata. |

Keep source material and reusable charts/diagrams under `docs/`; final report/deck exports under `docs/final/`. Existing evidence remains in place and is linked rather than duplicated unnecessarily. Do not copy the licensed paper, private uploads, model weights, generated CCTV outputs or personal filesystem paths into Git.

## Academic metadata

Request college/department, author/team names and IDs, supervisor and any required format. Use explicitly marked cover-page fields if these are not supplied; do not invent names, institutional claims, certificates, signatures or approvals. Treat any absent required institutional template as a final-submission customization limit, not a reason to fabricate compliance. Default to a clear conventional academic layout and a 16-18-slide demonstration deck.

## Claim and evidence contract

- Local uploaded-video inference is YOLO26n plus ByteTrack and configured rules. iFogSim receives finite workload profiles, not frames, and does not execute YOLO on physical edge/cloud devices.
- Synthetic 1-10 camera sources and multiple uploaded recordings are implemented. Multiple-recording processing is sequential; retained camera identity is not cross-camera person re-identification or synchronized capture.
- Stage 5 is feasibility only: no physical camera/NVR, live RTSP acquisition, reconnection or deployed CCTV network.
- CPU MI/payload assumptions and modeled device power are disclosed. Raw simulator latency, Java wall-clock runtime, internal horizon and local video-processing duration are distinct. Current UI says simulator units despite legacy JSON keys ending in Ms.
- Use Stage 7's 110 measured scenarios plus two excluded warm-ups as project evaluation. Record matched workloads, deterministic repeatability and host-runtime variation. Preserve worse edge full-loop latency and recording-derived energy outcomes; qualify horizon differences. No statistical significance, accuracy improvement or general edge superiority claim.
- Two 160x120 moving-shape fixtures support integration/timing checks only. Replicated profiles are not recordings from ten real cameras. No labeled CCTV accuracy, 1080p real-time capacity, hardware energy or calibrated instruction-demand result.
- No events with unconfigured regions is not proof of safety. No privacy certification, regulatory compliance or production-security guarantee is inferred from local processing.
- Focus the literature survey on sources actually examined. Clearly identify secondary references listed by the selected paper as unexamined if mentioned; do not manufacture summaries or citations. No new broad literature review is assumed without source verification.

## Authoring and verification plan

1. Read applicable document/presentation/PDF skill workflows and locate bundled runtimes before creating artifacts. Inspect existing report/chart evidence and implementation sources; maintain a claim-to-source checklist and consistent glossary.
2. Author report/deck and supporting Markdown together from one agreed scope. Reference exact paper sections where needed and link local project evidence. Include simple implementation-specific architecture/workflow diagrams; do not imply physical deployment.
3. Verify every reported count, timing scope and percentage against retained Stage 7 raw/summary data; ensure deck/report/demo/viva/README agree. Recheck repository-relative links, bibliography fields, commands and planned-versus-completed wording.
4. Render DOCX/PPTX through available supported tools and inspect every report page/slide for clipping, overlaps, unreadable tables, chart labels, broken diagrams and inconsistent pagination. Export PDF only through an available verified renderer; explicitly report any tool limitation instead of claiming unverified exports.
5. Test documentation commands with safe read-only/configuration checks where possible, using existing passed runtime evidence rather than repeating destructive failure-injection tests or overwriting historical outputs. No application, simulator parameter or model changes in this stage.
6. Review final file sizes, exports and staged content for private paths, secrets, unintended generated data and licensing-sensitive inclusions. Update PROJECT_STATUS.md with exact artifacts, verification and remaining cover/template limitations.
7. Present the finished package for review. Commit/push only after user approval. No deployment or publication to another service.

## Risks and limits

Institutional metadata/template may remain user-editable. Rendering/export depends on available tooling and must be verified honestly. The report can accurately document existing evidence but cannot replace missing real CCTV datasets, hardware calibration, causal energy experiments or security/accessibility certification. Stage 9 does not authorize live integration or additional development stages.


## Scope adjustment and completed practical handover

At the user's explicit request, no DOCX/PDF report or PPTX slides were created. Completed supporting files are docs/README.md, docs/SETUP.md, docs/DEMO_SCRIPT.md and docs/VIVA_GUIDE.md, with current README/component-documentation corrections. No institutional details, certificates or signatures were invented. Link, configuration/command-reference, evidence-claim and Git scope checks replace artifact rendering for these Markdown-only deliverables. Formal artifact authoring/rendering applies only if the deferred work is resumed.

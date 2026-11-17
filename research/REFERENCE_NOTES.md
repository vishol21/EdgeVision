# Reference notes and experiment methodology

## Selected Stage 6 paper

Likhit Yammanuru, P. Venkatadri Reddy, Nikhil Tom Jose, and Shinu M Rajagopal, "Real-Time Video Analytics at the Edge: Enabling Low-Latency and Scalable Solutions," *2025 IEEE International Conference on Compute, Control, Network & Photonics (ICCCNP)*, 2025. DOI: [10.1109/ICCCNP63914.2025.11233420](https://doi.org/10.1109/ICCCNP63914.2025.11233420).

The user supplied the complete six-page PDF during Stage 6 on 2026-11-17. Its full text and all rendered pages were reviewed. Bibliographic fields were checked against the supplied document and metadata; no proceedings page range is inferred. See [paper alignment](PAPER_ALIGNMENT.md) for page-specific findings, implementation mapping and limitations. The PDF remains outside Git; its hash is recorded in that report.

## Earlier candidate (not the user-selected paper)

P. Prakash, Raghavi Suresh and Dhinesh Kumar PN, “Smart city video surveillance using fog computing,” *International Journal of Enterprise Network Management*, 10(3/4), 389–399 (2019), DOI: [10.1504/IJENM.2019.103165](https://doi.org/10.1504/IJENM.2019.103165).

The publisher's public abstract says the work models and simulates a video surveillance system in iFogSim and discusses energy efficiency for fog versus cloud. The publisher page identifies full-text access as restricted. This project has not examined the full paper, and does not claim to reproduce its parameters, detailed design, or findings.

## Simulator architecture reference

The official [iFogSim repository](https://github.com/Cloudslab/iFogSim) currently describes iFogSim2 and gives an IDE/JAR setup process. Its official [DCNSFog intelligent surveillance example](https://github.com/Cloudslab/iFogSim/blob/main/src/org/fog/test/perfeval/DCNSFog.java) demonstrates the API pattern for application modules and edges, sensor tuple generation, fog devices, `ModuleMapping`, cloud mapping with `ModulePlacementMapping`, and edgeward placement with `ModulePlacementEdgewards`.

The chosen simulator revision and all dependency versions must be pinned after checkout and compilation. Do not assume Maven coordinates or invent iFogSim classes: use classes present in that selected source revision.

## Original experiment plan (historical, superseded)

The following records the original plan, not the current implementation. Current synthetic workloads support 1-10 distinct cameras (default five); Stage 4 also supports multiple uploaded recordings. See [Stage 3 evidence](../simulation/experiments/STAGE3_ANALYSIS.md), [multiple recordings](../video_analytics/MULTI_CAMERA.md) and [Stage 6 alignment](PAPER_ALIGNMENT.md). Current module names are Video_Analyzer, Event_Detector and Cloud_Result_Storage. Live camera integration remains feasibility-only. The simulator submodule is pinned to `5f68d3947e450d8d2b4af42670be819206be68c9`; the historical pinning task below has been completed.

- Physical topology: one cloud, two fog/edge nodes and three virtual camera sensors attached to the edge tier.
- Workload: deterministic sensor emissions represented by iFogSim tuples. Tuple size, CPU length, emission interval, simulation horizon, bandwidth, latency and power-model parameters must be disclosed as configurable experiment inputs.
- Application stages: `Video_Analyzer`, `Event_Detector`, and `Result_Forwarder`, represented as simulator modules and tuple edges. They model processing demand and data reduction only; there is no image content and no computer vision inference.
- Scenario A: map all analytics modules to the cloud using the simulator's fixed module placement mechanism.
- Scenario B: map analytics to the two fog nodes using supported placement mechanisms while keeping workload and network/device specifications consistent.
- Metrics: derive loop latency and network usage from iFogSim's own tracking/output; derive device energy only using supported power models and per-device utilization. Record simulation wall-clock runtime separately from simulated-time duration. Count emitted/processed tuples only if the model tracks them directly.

Every comparison must identify its measured source and units. A metric unavailable in the selected iFogSim release must be marked unavailable or replaced only with a justified simulator-derived quantity.

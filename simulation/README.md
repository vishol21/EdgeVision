# EdgeVision iFogSim simulation

## Upstream source

This simulation is written against the official Cloudslab/iFogSim checkout at commit `5f68d3947e450d8d2b4af42670be819206be68c9`. The checkout describes itself as iFogSim2 and sets JDK 23 in `.idea/misc.xml`. The repository does not provide a Maven build; the scripts compile against its Java source and bundled `jars` directory.

## Topology and application

- One cloud `FogDevice` and two identically configured fog `FogDevice`s. The fog nodes each have a parent link to the cloud.
- Standalone experiments accept 1–10 virtual camera `Sensor` sources (default 5), distributed across the two fog nodes. Each camera has a distinct `virtual-camera-NN` source ID; camera sources are sensors, not additional fog devices.
- Application graph: `CAMERA` → `Video_Analyzer` → `Event_Detector` → `Cloud_Result_Storage`.
- Scenario `cloud`: all three modules map to the cloud.
- Scenario `edge`: the analyzer and event detector are mapped to both fog nodes; cloud result storage remains in the cloud.
- Both cases use the same device specifications, sensor intervals, tuple sizes, tuple CPU lengths, selectivity, network links, and simulation horizon.

The processing modules operate on generated tuples that stand in for video-frame workload. Selectivity is 1.0, so each input workload tuple produces one analyzed tuple and one synthetic event-result tuple. This does not perform real image analysis or detect real events. In standalone runs, tuple sizes and CPU lengths are explicit project assumptions, not values attributed to the 2019 paper.

### Initial experiment parameters

| Item | Value |
|---|---:|
| Standalone camera emission interval | 100 ms per camera |
| Standalone workload duration | 15 seconds |
| Standalone tuple count | 150 per camera (dynamic; 750 at the default of 5 cameras) |
| Simulated frame tuple | 20,000 bytes; 1,000 MI |
| Analyzed tuple | 2,000 bytes; 2,000 MI |
| Result tuple | 500 bytes; 500 MI |
| Simulation horizon | 2,000 simulation time units |
| Each fog node | 2,800 MIPS; 4,000 MB RAM |
| Cloud | 44,800 MIPS; 40,000 MB RAM |
| Sensor-to-fog latency | 1 time unit |
| Fog-to-cloud latency | 100 time units |
| Uplink/downlink bandwidth | 10,000 (iFogSim bandwidth units) |

The device capacities and linear power values follow the official `DCNSFog` device-construction example, while the three-stage tuple workload and its sizes are this project's declared model. `Application.addAppModule(name, ram)` uses the upstream default of 1,000 MIPS per module.

## Metrics

Stage 3 adds [repeated multi-camera experiments and analysis](experiments/STAGE3_ANALYSIS.md), with raw records, CSV statistics and an exportable chart. Important unit finding: the legacy latency keys end in `Ms`, but currently contain raw CloudSim clock averages without a milliseconds conversion. Use simulator time units for those values until an explicit unit-contract correction is approved; the current dashboard's `ms` labels remain a known issue. Workload parameters and API fields were preserved in this analysis stage.

The Stage 2 camera matrix and reproducible validation commands are recorded in [validation/STAGE2_VALIDATION.md](validation/STAGE2_VALIDATION.md). It checks actual sensor construction, captured emission timing and paired API workloads at 1, 2, 3, 5, 6 and 10 cameras without changing production workload assumptions.

**Latency compatibility contract (Stage 8):** the legacy keys `loopLatencyMs` and `analyticsLatencyMs` contain raw CloudSim clock averages, without milliseconds conversion. The dashboard labels both as simulator time units and explains their different endpoints. Keys and numerical values are preserved for existing clients/jobs; historical files are not migrated. These values are not physical hardware latency. `wallClockMillis` remains actual Java controller-region runtime in milliseconds, excluding video analysis.

- `loopLatencyMs` is the complete camera-to-cloud-storage application loop average from the iFogSim `TimeKeeper`. `analyticsLatencyMs` separately measures camera emission to arrival at `Event_Detector`, using the same tuple IDs and CloudSim clock. Either is `null` if no complete measurement was recorded. This distinguishes edge analytics response from full delivery to cloud storage.
- `networkUsageMb` counts modeled camera-frame payload bytes and tuple bytes sent over fog-device links, converted using 1 MB = 1,000,000 bytes. It excludes protocol headers and module-deployment control traffic.
- `nativeNetworkUsageIndex` is the simulator's `NetworkUsageMonitor` total divided by the configured simulation horizon. In this iFogSim version that monitor sums tuple-size × link-latency, so it is retained as a native index and is not mislabeled as MB.
- `energyJoules` sums the energy reported by the three fog devices' configured power models. Camera sensors have no separate power model in this topology.
- `processedTuples` counts result tuples arriving at the cloud storage module.
- `simulationTimeSeconds` is the simulator clock value at stop in CloudSim's time units; `wallClockMillis` is measured runtime on this machine.

Values are emitted only after a simulation completes. Each scenario must run in a fresh JVM because CloudSim/iFogSim keep static simulation state.

## Build and run

Combined recording profiles use the additive schema-2 `multi_video` path described in [MULTI_CAMERA.md](../video_analytics/MULTI_CAMERA.md). Each camera retains its finite interval/count and CPU/payload assumptions; paired outputs are stored in `results/video_batches/<batch-id>/`. Existing single-video and standalone formats/paths remain available. Combined horizons may expand to allow the independent traces and downstream processing to finish, and reported device energy depends on that horizon.

Requires JDK 23 or newer with `javac` and `java` on `PATH`.

```powershell
.\simulation\build.ps1
.\simulation\run.ps1 -Scenario cloud
.\simulation\run.ps1 -Scenario edge
```

Each successful run prints a machine-readable `RESULT_JSON:` line and saves the actual record to `results/cloud.json` or `results/edge.json`. Failed runs do not write result files. The `results/` directory is created on the first successful run.

### Configurable standalone camera workload

Select 1–10 cameras in the Simulation & Comparison control, or pass `-CameraCount` in PowerShell. The default is 5. Each selected source emits 150 tuples at 100 ms intervals over 15 seconds, so the workload contains `camera count × 150` tuples (1 → 150, 5 → 750, 10 → 1,500). `-Scenario both` passes the same camera count to separate cloud and edge JVM runs. Values outside 1–10 are rejected. The generated standalone result includes the active camera count, unique source IDs, interval, duration, and expected tuple count.

```powershell
.\simulation\run.ps1 -Scenario both                 # default: 5 cameras, 750 tuples per scenario
.\simulation\run.ps1 -Scenario cloud -CameraCount 1
.\simulation\run.ps1 -Scenario edge -CameraCount 10
```

Video-derived `-Profile` runs remain separate: their camera count, interval, duration, and tuple count come from that profile and are not overridden by `-CameraCount`.

## Stage 1 video workload profiles

Pass a successful Python analytics profile with `-Profile`. The Java entry point reads it with the bundled json-simple 1.1.1 library and validates required fields and consistency before initializing CloudSim. Missing, malformed, non-finite, or inconsistent profile values stop the run with a field-specific error; the profile path is not silently replaced by standalone defaults.

Run one or both placements:

```powershell
.\simulation\run.ps1 -Profile ".\video_analytics\outputs\workloads\<job-id>.json" -Scenario cloud
.\simulation\run.ps1 -Profile ".\video_analytics\outputs\workloads\<job-id>.json" -Scenario edge
.\simulation\run.ps1 -Profile ".\video_analytics\outputs\workloads\<job-id>.json" -Scenario both
```

`both` starts two separate JVM simulations and passes the same profile path and values to each. `virtualCameraSources` controls the number of simulated Sensor entities. The profile's finite `tupleCount` is assigned round-robin across those cameras; each assigned sensor emits only its share, with tuple slots spaced at `proposedTupleGenerationIntervalSeconds`. The result records the requested count, actual sensor emissions, first/last emission times, and whether measured simulation-clock intervals match the requested interval. A profile horizon is expanded if necessary to allow the final tuples to finish the modeled path.

The profile provides workload count, timing, FPS, dimensions/duration, source classification, frame sampling/batching, and camera count. It does not carry video frame bytes. `simulatedVideoFramesSent` is always false. If profile `tuplePayloadBytes` is null, camera tuples use the existing 20,000-byte Java assumption. If non-null, that configured profile assumption is used for camera input tuples. The analyzed/result tuple payloads remain the existing 2,000/500-byte assumptions.

If both `cpuDemand.videoAnalyzerMI` and `eventDetectorMI` are present, their Stage 1 estimated total MI values are divided evenly across profile tuples and rounded to the nearest integer MI per tuple (minimum 1). Otherwise, the existing 1,000/2,000 MI values are used. The result records both raw profile CPU fields and actual per-tuple MI values. Result storage remains at 500 MI per tuple. No new CPU calibration is performed in Java. The profile's calibration status, reference hardware, and method are retained in the result for provenance.

Profile runs save under `results/video_workloads/<job-id>/cloud.json` and `edge.json`, keeping the existing `results/cloud.json` and `results/edge.json` standalone result files separate. These result records retain the existing `scenario`, `completedAt`, and `metrics` fields and add `workloadProfile` metadata, including whether the source was labeled `synthetic_test`. Synthetic profile metrics describe the simulator's synthetic workload trace; they are not real-CCTV results. The profile metadata also labels Java tuple sizes and CPU lengths as assumptions where used.

The original standalone commands remain available and retain their original paths:

```powershell
.\simulation\run.ps1 -Scenario cloud
.\simulation\run.ps1 -Scenario edge
```

## Stage 7 final evaluation

See [the Stage 7 report](experiments/STAGE7_EVALUATION.md) for the approved 11-case evaluation: 110 measured cloud/edge simulations, two excluded warm-ups, local synthetic-clip analysis, independent recording profiles, explicit metric units and retained raw/CSV/plot evidence. The evaluator leaves production outputs and legacy result keys unchanged.

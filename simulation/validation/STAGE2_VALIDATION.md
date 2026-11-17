# Stage 2 virtual-camera validation

Validated on 2026-11-17 against production source commit `687be247968f4e0c5472fc32068e3cdda76e5d76`, with iFogSim pinned to `5f68d3947e450d8d2b4af42670be819206be68c9`. Environment: Windows, Node.js v22.21.0, Eclipse Temurin OpenJDK 23.0.2+7. These are synthetic workload checks in iFogSim, not physical CCTV or hardware measurements.

| Cameras | Actual sensors inspected | Expected tuples | Cloud emitted / processed | Edge emitted / processed | Paired API processed, cloud / edge |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 150 | 150 / 150 | 150 / 150 | 150 / 150 |
| 2 | 2 | 300 | 300 / 300 | 300 / 300 | 300 / 300 |
| 3 | 3 | 450 | 450 / 450 | 450 / 450 | 450 / 450 |
| 5 | 5 | 750 | 750 / 750 | 750 / 750 | 750 / 750 |
| 6 | 6 | 900 | 900 / 900 | 900 / 900 | 900 / 900 |
| 10 | 10 | 1,500 | 1,500 / 1,500 | 1,500 / 1,500 | 1,500 / 1,500 |

All cases passed. The test-only Java harness inspects actual instantiated sensors from the production factory: distinct `virtual-camera-NN` names, the requested number of entities, alternating fog gateways, deterministic 0.1-second distributions and exactly 150 configured emissions per camera. In separate fresh JVMs it runs each placement and checks the captured simulator-clock emission trace and processed-result counter.

The finite workload window remains 15 seconds. The first event starts after CloudSim's 0.01-second startup offset, with each camera staggered by `cameraIndex * 0.1 / cameraCount`. The last emission occurs before the end of the 15-second workload window; the 2,000-unit simulation horizon allows downstream work to finish. Every inferred camera phase has 150 emissions separated by 0.1 seconds. Maximum deviation from the expected global schedule was below `3.8e-14` simulated seconds, within the test tolerance of `1e-7`.

The trace records emission times without source IDs. Consequently, phase-to-camera identity is inferred from the deterministic staggered schedule; source identity and sensor count are independently checked through factory inspection. This limitation is retained in [the simulator evidence](stage2-simulator.json). The harness adds no production telemetry or public API fields.

The real Node/PowerShell/Java API matrix verifies equal cloud/edge workload profiles, a shared 32-character profile ID within each pair, a new ID for each request, exact source IDs, camera count, interval, duration and processed tuple count. It also checks seven invalid inputs against all three actions (21 HTTP 400 responses): 0, 11, -1, 1.5, string `"5"`, null and true. See [the API evidence](stage2-api.json).

Frontend state regressions: all six `test-state.js` cases passed, including delayed/obsolete responses and atomic rejection of invalid comparisons. Browser verification at six cameras observed Running with an empty table, then Complete with 900 processed tuples in both rows. The initial browser page had neutral results. Screenshot evidence is retained locally as `stage2-six-cameras.jpg`, outside Git.

## Reproduce

From the project root with the pinned submodule and JDK available:

```powershell
.\simulation\validate-cameras.ps1
node --test frontend/test-state.js
```

For the API matrix, use a dedicated idle project copy/server so other users cannot start overlapping compute jobs. In that copy, start the server on an unused port:

```powershell
$env:PORT = '4175'
npm start
```

In a second terminal rooted in that same copy:

```powershell
node frontend/test-camera-workloads.js http://127.0.0.1:4175
```

The matrix restores the prior standalone result bytes when finished, or removes only its newly generated standalone files if none existed. Validation reports default to ignored `results/validation/`; the two JSON files beside this document are intentional, reviewed evidence from this session. Historical project results were not modified by this validation; the API matrix and browser used an isolated copy.

No workload assumptions or production source changed in Stage 2. Repeatability/performance analysis and claims about cloud-versus-edge advantage belong to Stage 3 and require separate approval.

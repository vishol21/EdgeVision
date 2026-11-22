# EdgeVision practical handover

This package covers setup, demonstration and viva preparation for the implemented local prototype. The formal academic report and slide deck are deferred at the user's request; neither is presented as completed.

| Guide | Purpose |
|---|---|
| [Setup and reproduction](SETUP.md) | Prepare a Windows checkout, start the app, locate artifacts and reproduce checks. |
| [Demonstration script](DEMO_SCRIPT.md) | Walk through fresh state, virtual cameras, local uploads, batch identity and recovery. |
| [Viva guide](VIVA_GUIDE.md) | Explain architecture, algorithms, evidence, trade-offs and limitations. |
| [Current implementation status](../PROJECT_STATUS.md) | Approvals, published commits and exact verification history. |

## Evidence map

- [Stage 2](../simulation/validation/STAGE2_VALIDATION.md): actual synthetic sensors/counts/timing at six camera counts.
- [Stage 7](../simulation/experiments/STAGE7_EVALUATION.md): 110 measured simulations, two excluded warm-ups, local synthetic-clip timing and retained raw/CSV/chart evidence.
- [Stage 8](../frontend/STAGE8_VERIFICATION.md): current unit labels, failure states, keyboard/mobile checks and recovery.
- [Selected-paper alignment](../research/PAPER_ALIGNMENT.md): actual paper claims, ambiguities and implementation differences.
- [Camera feasibility](../video_analytics/LIVE_CAMERA_FEASIBILITY.md): requirements and future work only; no physical camera or live implementation.

## Publication readiness

- Implemented workflows and measured outcomes are linked above. App/server/Java/Python behavior is unchanged by this documentation package.
- Git excludes environments, weights, uploads, private outputs and generated experiments. Do not add those artifacts when publishing source.
- Formal report/deck, institutional metadata, signatures and submission-template compliance are deferred, not fabricated.
- Real CCTV accuracy, hardware-calibrated performance, live RTSP and physical cloud/fog deployment remain unverified or unimplemented.
- The supporting documents can be reviewed and committed independently of the deferred report/slides. No additional development stage is defined in the original roadmap.

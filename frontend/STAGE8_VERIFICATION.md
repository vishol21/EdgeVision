# Stage 8 dashboard and system quality

Completed locally on 2026-11-17 against production baseline `3aba133c908933aa3af9a4df7292ee28d0b2a7b1`, under the [approved quality plan](../research/STAGE8_QUALITY_PLAN.md). The current layout, palette, technology and application workflows are retained. [Machine-readable verification](stage8-verification.json) records frontend source hashes, checks and sampled unconverted API metrics.

## Corrected measurement presentation

Cards, chart labels/axes/tooltips, accessibility descriptions and table headings now consistently identify full-loop and detector-arrival latency in simulator time units. Full loop ends at result arrival at cloud storage; detector arrival excludes event-detector computation and final delivery. A visible explanation distinguishes these from simulator wall-clock runtime and local video-processing duration.

The Java/JSON legacy keys `loopLatencyMs` and `analyticsLatencyMs` retain their original raw clock values. No multiplication, result migration, historical rewrite or workload reinterpretation occurred. Saved jobs and current responses use the same display path. The [simulation documentation](../README.md#metrics) explicitly records this compatibility contract. Runtime remains milliseconds; local analysis duration/FPS remains separate. Summary text identifies the scenario whose values are shown in the cards; the table/charts compare available scenarios.

For the verified two-recording batch, raw cloud/edge full-loop values remain 120.25835379464286 and 128.08075892857144, displayed as 120.26 and 128.08 sim units. Detector-arrival values remain 118.95026785714286 and 9.856562500000003, displayed as 118.95 and 9.86. Both scenarios retain 32 tuple arrivals. API response values are not converted by the frontend.

## Scoped usability changes

- Existing secondary text was brightened; small labels/table text and chart tick fonts raised to at least 12 px in inspected visible states. Base text remains 14 px. Palette calculation for primary/secondary text on four main surfaces gives a minimum 6.746:1 ratio; this is not a claim that every disabled/native/browser surface was audited.
- Buttons, file-selector actions, range hit area, recovery input and navigation use at least 44 px height. Visible focus rings, readable placeholders and tabular numbers improve keyboard/data use. Tables remain locally scrollable and are keyboard-focusable regions.
- Narrow layouts wrap navigation, explanations and long filenames. Metric cards use bounded columns and units wrap. Existing single-upload and batch controls remain separate.
- The first browser pass exposed a hidden mode-switch button because the new button display rule overrode native hidden styling; explicit hidden styling corrected it. Mobile column flex-basis could also produce a 130 px single-analysis button; the same fixed-height treatment now applies to both single/batch action rows. Both were rechecked after the correction.
- Missing Chart.js now shows an accessible notice and hides empty chart areas, while cards, tables and actions remain functional. No chart dependency or framework was replaced. Web fonts and Chart.js still depend on external CDNs.
- Reduced-motion styling preserves a static progress indicator and status text instead of continuous progress movement; chart animations are disabled when the preference matches. Normal progress feedback is retained.
- Decode failures retain failed-camera status and exclusions, with an actionable supported-video/re-encode message instead of exposing OpenCV assertion details in the UI. Raw backend diagnostics/response format remain unchanged; unrelated video errors retain their message.

## Tests and browser verification

| Check | Outcome |
|---|---|
| Frontend state/profile tests | 14 passed, including raw values/units/tooltips, chart absence, reduced-motion chart option, decoder retry messaging, stale-response guards, workflow switching and batch identity. |
| Full existing API suite, isolated copy | Passed real local video analysis, common paired profile/counts, report/range output, invalid inputs, compute coordination, preserved analytics after forced simulator failure, and standalone cloud/edge/both at 1/5/10 cameras. |
| Batch API suite, isolated copy | Passed two distinct clips (20+12 tuples), independent timing/identity, limits/locks, partial decode/upload failures, all-failed no simulation, and forced simulation failure preserving reports. Held test script was restored. |
| Restart | Server restarted. Single-job saved results matched returned results; completed batch recovered both source reports, correct child associations and byte-range annotated playback. |
| Browser standalone | Fresh/refresh neutral; selected six cameras/900 expected tuples; Running cleared prior values; Complete showed 900 arrivals in both scenarios. Changing count cleared cards/table. |
| Browser single video | Actual synthetic fixture selected/uploaded through the file chooser; local analysis and both simulations completed with 20 arrivals. Switching to virtual controls cleared presentation; switching back restored only that video comparison. |
| Browser batch/reports | Completed two-camera/32-tuple batch loaded by explicit ID, including after restart. Viewing an individual camera report preserved the batch comparison. Partial recovery showed 1/3 included and separate decode/upload errors. All-failed recovery showed neutral metrics and no stale fallback. |
| Chart absence | Isolated test-only HTML omitted the CDN script. Actual cloud simulation completed; notice/cards/table stayed available. This was deliberate dependency-failure injection, not a production CDN outage. |
| Keyboard | Tab reached recovery with visible outline, Enter loaded the batch; range arrow key changed counts; focused result table responded to horizontal arrow scrolling. |
| Responsive | Desktop 1440 px, mobile 390 px and narrow 320 px had no document overflow; tables scroll within their containers. At 390 px inspected action buttons were 44 px and visible main text was at least 12 px. A long synthetic filename remained contained at 320 px. An additional 980 px screenshot shows the recovered comparison. |
| Console / syntax / Git | No captured warning/error logs in the final normal browser check. Node syntax and whitespace checks passed. No backend/Java/Python/config change. |

Test IDs are synthetic/local: single job `57d2f29912e643258f7bcf90363f257c`; full batch `9f0261f148dd4e99a6bbab1f5011e1c9`; partial batch `5dacd360973143c19a90ad5f6d2a8dc0`; all-failed batch `fd79abb33a9e4ff08e328a827784755e`. The isolation root and screenshots remain outside Git. Screenshot names: `stage8-desktop-comparison.jpg` and `stage8-verified-comparison.jpg`; the latter uses the 980 px layout and avoids the wider capture's right crop.

## Inspection scope and remaining limits

One bundled design-detector scan found five tracking warnings on incumbent short uppercase labels and a progress-animation warning. These were reviewed in context: existing uppercase identity is preserved; progress is nontextual loading feedback with the added reduced-motion alternative. Its em-dash advisory describes neutral metric placeholders, not prose. No unverified automatic score or universal accessibility claim is made.

Actual OS reduced-motion preference and 200% browser zoom were not toggled. Chart option behavior was tested in the DOM harness and CSS preference handling inspected; 320 px reflow was tested independently. No physical touchscreen, full assistive-technology suite, load/storage stress, formal security assessment or exhaustive cross-browser test was performed. AVI browser preview may be unsupported even when OpenCV analysis succeeds, and the existing preview explanation remains available.

Original standalone result hashes remain unchanged: cloud `8548C8A1AE3C6858ECDA3CF75BB5803A93820D9E050F6E4804E7BBC4D3FD0C7E`, edge `F3A020FF9260F82F0177DFD837DD517EA40BC12D0EACA1BD57F3681E5D93FDBE`. No historical job/profile was deleted, no live camera connected and no network scan performed. The isolated server was stopped and browser viewport reset; no test server remains intentionally running.

Stage 8 corrects misleading current UI units; it does not calibrate simulated time to hardware or change the evidence in historical Stage 3/7 reports. Broader resource limits and representative CCTV accuracy evaluation remain open. Stage 9 final documentation/presentation requires separate approval and must describe only implemented features and qualified experiment findings.

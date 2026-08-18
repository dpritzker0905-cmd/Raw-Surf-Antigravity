# OPEN EVIDENCE GAPS — Audit 13.1

**Every claim this audit could not verify, and exactly what would verify it.**

Ordered by how much each gap constrains the trajectory verdict.

---

## ⛔ TIER 1 — gaps that limit a stated finding

### G-01 · The F1 magnitude was never measured on live data

| | |
|---|---|
| Claim affected | Finding 13.1-F1 — `swell_height_ft` publishes VHM0 on the frame lane and VHM0_SW1 on the live lane |
| What IS established | The two lanes read **different source fields**, traced to file:line on both sides, and the frame lane is default ON. This is a **static certainty**. |
| What is NOT established | **How far apart the two numbers actually are**, per spot and per hour. |
| Why not measured | Verifying it requires setting `CONDITIONS_BATCH_PRECOMPUTED=0` against a running backend. This audit is non-invasive and does not set environment variables on a production service. |
| **What would close it** | One `/api/conditions/batch` call for ≥10 spots across ≥3 regions present in the current frame, compared against the same spots with `CONDITIONS_BATCH_PRECOMPUTED=0`. Record both values and the signed difference. |
| Consequence if it shows agreement | **F1 downgrades from Critical to a naming defect** — and that is the explicit stop condition in `NEXT_AUTHORIZED_MISSION.md` §11. |

### G-02 · No baseline runtime measurement exists — so "coupling decreased" cannot be answered

| | |
|---|---|
| Claim affected | §9, §10, and the trajectory question *"Is unexpected coupling decreasing?"* |
| Why | Neither Audit 12.1 nor 12.2 produced a resource census, a frame-time distribution, a Jacobian matrix, or a pixel-decoded paint measurement. |
| Consequence | **Every runtime number in Audit 13.1 is a NEW baseline, not a delta.** The 6 unexpected first-order couplings and 3 unexpected nonlinear interactions are stated as *measured at HEAD* — never as *newly introduced*. |
| **What would close it** | Re-run `evidence/jac2.js` and `evidence/blindsnap.js` against a `791fdf78` worktree. Both harnesses are archived in `evidence/` and are build-agnostic. **This is the single cheapest way to make Audit 14.x able to answer the question 13.1 could not.** |

### G-03 · Why the 0.25° product is fetched but 2° is served was not determined

| | |
|---|---|
| Claim affected | Finding 13.1-F4 |
| What IS established | `~223 km (2°)` disclosed at **every zoom from 5 to 12** on the deployed build; `ncep_gfswave025` **is** requested (15× at Cocoa z9); the upstream is **healthy** (HEAD 200, Range 206, `latest.json` 200/5,332 B). |
| What is NOT established | The mechanism. Client-side aborts were observed (`signal is aborted without reason. Falling back cleanly.`) but these are **consistent with correct stale-request cancellation** on a Range-chunked reader when the camera moves. **This audit does not claim they are pathological.** |
| **What would close it** | Instrument the tier-selection path: log, per camera settle, which product id was *requested*, which *completed*, which was *selected*, and why the selector rejected the finer candidate. |

### G-04 · The parity ablation did not execute

| | |
|---|---|
| Claim affected | Finding 13.1-F3 |
| What happened | The probe attempted `visibility:'none'` on every custom layer; the map handle was lost and `hiddenIds` returned `null`. **Reported as not-performed, never as a null result.** |
| What survived | The **pixel-palette discriminator** — 4 layers × 5 cameras, each layer producing a distinct ocean mean RGB — which independently establishes that the *renderer* is correct and the *instrument* is at fault. |
| **What would close it** | Repeat with **opacity**, not visibility — the project's own record notes `visibility:'none'` is silently reverted on `OceanMask` (`OceanMask.js:658`), which would produce a **false negative that clears the culprit**. Re-acquire the map handle inside the probe before each read. |

---

## ⚠️ TIER 2 — instrument failures

### G-05 · `performance.memory` was frozen

Reported `159.3 MB` at **all 23 blind marks**, unchanged to the decimal. This is a measurement
failure in headless Chromium, **not** a finding of zero heap growth. **No memory-leak conclusion
is drawn anywhere in this audit.**
**What would close it:** CDP `HeapProfiler.takeHeapSnapshot`, or a headed browser with
`--enable-precise-memory-info`.

### G-06 · WebGL pixel read-back failed at all 12 projection-tour cameras

A second `getContext` with `preserveDrawingBuffer` cannot be obtained on a canvas MapLibre
already owns. **The tour therefore proves the style survived, not that the field painted.**
Paint was re-established separately by decoding screenshots (PNG inflate + unfilter in Node) —
which is why the projection-tour row and the paint-control rows are reported separately in
`LIVE_RUNTIME_VERIFICATION_MATRIX.csv`.
**What would close it:** attach the probe *before* MapLibre creates its context, or request
`preserveDrawingBuffer` at map construction in an audit-only worktree.

### G-07 · The first local paint run violated the repo's own probe contract

`truthOverlayGate.test.js` documents that probes must set `localStorage.__RAW_DIAG__='0'`
because *"a HUD inside the screenshot crop biases every pixel metric"*. The **first** local paint
run did not, and its crop boxes overlap the HUD region. The **served-resolution probe does** set
it, and the deployed build has no HUD by design.
**Affected figures:** the `paint-control-local-fb50fa6d.json` colour statistics only. The
`Class: COARSE 2° GRID` readings from that run are HUD-text reads and are **not** affected. The
deployed 20-cell resolution sweep is **not** affected.

### G-08 · One blind inference was withdrawn on review

A crop at Portugal z8 returned "2 distinct 5-bit colours / 91.7% dominant" and was read in-flight
as a possible blank field. **The frame shows a smooth teal wave gradient** — the crop landed
inside a low-contrast gradient. **The inference is withdrawn.** Recorded here because reviewing
recordings after capture, rather than judging live, is what caught it.

---

## ⚠️ TIER 3 — conditions never exercised

| gap | what is missing | what would close it |
|---|---|---|
| **G-09 · React Scan / React Profiler** | **No capture at all.** No statement in this audit about React commit counts or re-render behaviour. | run the profiler over the layer-switch and timeline-scrub paths |
| **G-10 · DevTools performance trace** | no frame-time distribution, no long-task census, no main-thread utilisation | ⚠️ under SwiftShader these would be **misleading**; capture on real hardware or not at all |
| **G-11 · Mobile viewport / DPR 2** | not exercised. `CLAUDE.md` mandates three themes on desktop **and** mobile, and `MapWeatherControls` has **three** layouts (desktop panel, mobile collapsed float, mobile expanded sheet) — **two were never rendered by this audit** | 390×844 DPR 2 with `hasTouch`/`isMobile`, reloaded so load-time device gates re-run |
| **G-12 · Light and beach themes** | the theme was **pinned to dark** throughout, deliberately (a prior finding records that light mode can hide the halo defect beach mode shows). **This audit therefore says nothing about two of the three mandated themes.** | repeat the paint control in all three themes |
| **G-13 · CPU throttling / reduced network** | never applied as a controlled variable. The cold-backend run is an *accidental* proxy, not a controlled one. | CDP `Emulation.setCPUThrottlingRate` and `Network.emulateNetworkConditions` |
| **G-14 · Cache-freshness / model-run identity** | no probe distinguished a fresh grid from a cached one, and WS-CAN-0005 (true model-cycle identity) remains owner-blocked because 87 spots share `run_time` to the microsecond | requires the owner decision on `run_time` first |
| **G-15 · Backend `/api/health`** | not resolved from this session — the wrong host returns `Not Found`; the correct host (`raw-surf-antigravity.onrender.com`) was reached only through the app | probe `https://raw-surf-antigravity.onrender.com/api/health` directly and record the embedded SHA |
| **G-16 · The full backend test suite** | not executed. Test-protection findings are from **reading assertions** plus the lane-selector measurement, not from a full run. | `pytest backend/tests` per lane, with `-rs` to make skips readable |
| **G-17 · The F2 selection outcome** | the island lane's effect on selection is established **from the selector code**; it was not observed on a live manifest after an ingest cycle | query the manifest for a Madeira coordinate after one cycle and record which `resolution` wins |

---

## 📋 TIER 4 — scope boundaries, declared

| boundary | note |
|---|---|
| **`568fc2c6` was analysed inline, not by the forensic fleet** | The static forensics were commissioned against `fb50fa6d`. `568fc2c6` landed mid-audit; it is CI-only (`ci.yml` + one test constant, **no runtime source**) and is analysed in §2 and `TEST_PROTECTION_QUALITY.md`. |
| **Commit *subject lines* were read during the baseline lock** | §7 of the audit contract requires a commit count, which requires `git log`. **No handoff, mission document, register, or evidence file was opened** until `BLIND_CURRENT_STATE_SNAPSHOT.md` was written and hashed (`daed6a32…`). |
| **Six commits are duplicate accounting** | `0509b1ec`, `7362bab4`, `7bb7b9d6`, `72a8edba`, `dd9dadff`, `118cfabc` are patch-identical (`git patch-id --stable`) to `bf8fb4cd`, `d4c6f487`, `be6a705a`, `d72444b5`, `ce66f6f4`, `e0fb3289`, reconciled at merge `ed280c93`. **Any per-commit productivity figure over this range is inflated by ~5%.** |
| **The production frontend was not exercised** | It is pinned at `3bd38a83` (2026-05-20), **90 days behind HEAD**, and contains none of the audited work. Probing it would measure a different program. |
| **No test was run that mutates state** | Test analysis is read-only plus `--collect-only`. |
| ⚠️ **`evidence/network/blind-network.json` was REDACTED before commit** | The raw capture contained a Mapbox **public** token (`pk.…`) repeated **1,134×** in `access_token=` query parameters on basemap tile URLs. GitHub secret scanning **rejected the push**, correctly. Every occurrence was replaced with `access_token=%5BREDACTED-BY-AUDIT-13.1%5D`; the file still parses as JSON and no other field changed. **The unblock URL GitHub offered was NOT used** — publishing the secret to clear the block would have been the wrong resolution. ⭐ **This is a RECURRENCE:** Audit 12.2 recorded the identical issue ("21 `pk.*` Mapbox tokens found and redacted"). **A network capture from this app carries provider tokens by default — redact before committing, every time.** No credential, cookie, signed URL, or private provider detail remains in any Audit 13.1 artefact; the whole tree was re-scanned for `pk.*`, `sk.*`, `access_token=`, `api_key=`, `Bearer`, `X-Goog-Signature` and `Signature=` and is clean. |

---

## The one gap worth fixing before anything else

> **G-02.** Two harnesses — `evidence/blindsnap.js` and `evidence/jac2.js` — are archived, build-agnostic, and take about 25 minutes to run. Executing them **once** against a `791fdf78` worktree converts every runtime number in this audit from *a baseline* into *a delta*, and lets Audit 14.x answer the one question Audit 13.1 had to leave open: **is unintended coupling actually decreasing?**

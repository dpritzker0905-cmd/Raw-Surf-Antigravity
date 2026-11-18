# 2026-11-18: phone trace split by phase, and the in-box first-visit check widened (Opus, Move 3; David: "Yes, do both")

## 21:34Z: registration (committed alone, before any run)

Both are MEASUREMENTS, not changes: no app code. Offline lab only; the census load-void rule (in-page 20M-iteration calibration,
void above 1.25x the run's lowest) applies and every session's calibration and CPU % are reported.

**A. The dropped CDN prefetch, widened (the three reviewers' finding: n=1).** Today's `dev` build; `scn_zoom_scrub.js`; arms `cur`
(bundles on) and `noregional`; the scenario's fixed step list. Cells:
- Florida z8 (-80.6, 28.1), GFS waves, PHONE (390x844, 4x CPU): the 2026-11-16 cell's missing phone run.
- Hawaii z9 (-157.5, 20.5), GFS waves, desktop and phone: a second pilot box.
- Hawaii z9, ICON waves, desktop and phone: a second model (ICON regional bundles, `FRAME_REGIONAL_BUNDLES_EURO_ICON` default on).
Claim tested: "inside a pilot box, today's build draws the exact frame on every first visit within 100 ms". It HOLDS if, in every cell's
`cur` arm, every first-visit step is exact within 100 ms; any step that is not is listed with its source. If it does not hold, the CDN
prefetch is reopened. Freshness is not testable offline (the lab's bundle is always current) and stays an open limit.

**B. Phone trace split by phase.** Phone profile (390x844, dpr 3, 4x CPU), z6 (-75, 30), GFS waves, today's `dev` profiling build,
10 ArrowRight steps at 900 ms, one DevTools trace per session (categories devtools.timeline, blink.user_timing, gpu, v8.execute), plus the
census hook's per-commit render ms. Per step, from the keydown to the next frame presented: ms in React commits (census), script outside
React, style + layout, paint + composite, GPU tasks, and idle. 3 sessions. Reported, not gated; the void rule applies. Limit stated now:
an emulated phone (CPU throttle on this machine's GPU), not a real mid-range Android.

## 23:25Z: results (as they fell; offline lab; today's `dev` production build; machine 85-92% busy during the trace)

**Probe fixes found while running (no app code):** the zoom-scrub scenario (1) never opened the phone's collapsed timeline sheet, so
phone keys never reached the wheel; (2) hard-coded GFS in its exact check and its expected-frame request, so every ICON step read
"never exact". Both fixed and committed (`aedd8e2f0`) BEFORE the cells were re-run; the first cell runs are superseded, not used.

### A. In-box first visits (arm `cur` = bundles on; ms from the key to the exact frame; the scenario's 10 fixed steps)

| cell | cur (bundles on) | noregional (bundles off) |
|---|---|---|
| Hawaii z9 GFS desktop | 9, 0, 0, 9, 13, 11, 5, 17, 2, 2: all exact <= 17 ms | 47, 0, 0, 33, 40, 39, 45, 40, 42, 48 |
| Hawaii z9 GFS phone | 0, 0, 93, 0, 9, 1, **109**, 10, 0, 8: all exact; one step 109 ms | 0, -, -, 0, 240, 158, 375, 211, 0, - |
| Hawaii z9 ICON desktop | 0, 0, 4, 0, 0, 2, **never**, 14, 0, 16 | 0, 0, 131, 0, 53, 58, never, 35, 0, 47 |
| Hawaii z9 ICON phone | 0, 0, 8, 0, 7, 7, **never**, 7, 0, 6 | 0, 0, 111, 0, 158, 203, never, 171, 0, 209 |
| **Florida z8 GFS phone** | **NO FIRST FRAME in 60 s (3 of 3 runs)** | 0, 0, 215, 0, 456, then 5 never |

- The registered claim ("every first-visit step exact within 100 ms inside a box") **does not hold as written**: Hawaii GFS phone has one
  step at 109 ms; ICON's 7th step (the burst to +172 h, past ICON's 168 h native range) is never exact in EITHER arm (ICON's tail, not
  the bundle); and Florida on the phone never draws at all with bundles on.
- Where it does draw, the bundle path is what makes first visits fast (0-17 ms desktop, 0-10 ms phone, vs 33-456 ms bundles off).
- **Florida z8 phone, bundles ON: a likely real defect.** The state dump at the timeout (`boxC/fl-phone-cur-diag.json.nofirstframe.json`):
  the regional bundle loaded (113 slices, prewarm frame ok), the series cache keeps hitting, but the engine holds no grid; the app's own
  backstop logs "Render backstop: engine empty + idle >= 3s, re-driving" every 3 s, a truth chain reports "ABSENT ... died after
  cacheRead (38s silent)", and NO `/grid` request is ever made. Bundles OFF on the same phone view draws. Desktop at the same view drew
  (2026-11-16). Not yet traced to code. **The CDN prefetch stays dropped (inside a box it adds nothing where the bundle works), but this
  phone defect is a bigger first-visit problem than the prefetch was.**

### B. Phone trace split by phase (390x844 dpr 3, 4x CPU, z6, GFS waves, 10 steps; production build, so React's own share is inside "script")

| session | calibration | step window (median) | main thread busy | script | style + layout | paint + composite | GPU thread | keypress-to-paint p50 |
|---|---|---|---|---|---|---|---|---|
| 1 | 126.7 ms | 1903 ms | 1885 ms | 1450 ms | 82 ms | 212 ms | 275 ms | 316 ms |
| 2 | 122.9 ms | 1686 ms | 1674 ms | 1311 ms | 56 ms | 210 ms | 188 ms | 256 ms |
| 3 | 120.1 ms | 1644 ms | 1628 ms | 1229 ms | 56 ms | 204 ms | 222 ms | 260 ms |

- The emulated phone's main thread is busy for ~99% of every step's window; **script is ~75% of a step** (1.2-1.45 s), paint ~205 ms,
  layout 56-82 ms; the GPU thread 190-275 ms. The step window exceeds the 900 ms dwell because the throttled page answers the harness late.
- So the next lever is script, not layout or paint. Which script is not measured here: React's share needs the profiling build, which
  crashes on `dev` (the React 19 `react-dom/profiling` alias fix lives only on `opus/scrub-render-census`'s craco config); a JS sampling
  profile of one step is the next instrument.
- Limits: an emulated phone (CPU throttle on this desktop's GPU), not a real Android; the machine was 85-92% busy; trace overhead included.

## 23:46Z: CORRECTION: the "Florida z8 phone draws nothing" was a LAB ARTIFACT, not an app defect (traced; David: "Yes, trace it")

- **What the app did:** it committed frames (`orchestratorCommit series_GFS_waves_h1 OK`, then the settle check's "committing covering
  regional series frame" 17 times), and the WebGL layer refused each one: `__MARINE_RENDER_SOURCE_DIAG__` = hasData true, hasGrid true,
  nonzeroCount 0, maxHeight 0, `renderBlockedReason: "all_zero_grid"`. Every height in the committed grid was zero.
- **Why every height was zero:** the lab's synthetic land mask (`serve_synthetic.py --land-mask 1`, `LAND_BOXES`) marks the box
  lon -125..-70, lat 25..60 as land. That covers the entire Florida east coast. The phone's narrow view at z8 (lon -81.14..-80.06,
  lat 27.14..29.05; its series box -81..-80 x 27..29) is therefore ALL land in the lab. The desktop view at the same centre is tall enough
  to reach the lab's water near 25-26 N, which is why desktop drew. Real products have ocean east of about -80.6 at that latitude.
- So: not a production defect, and the earlier "likely real defect" message to the director is withdrawn.
- **Re-measured at a Florida-box view that reaches lab water** (z8, (-80.3, 25.3), phone, 4x): bundles ON, every step exact:
  0, 33, 0, 0, 48, 47, **385** (the burst to +172 h, from the series), 8, 0, 16. The bundles-OFF session ran at a third of the load
  (calibration 38.5 vs 118.5 ms), so its timings (0, 54, 0, 0, 95, 99, 109, 71, 0, 86) are not comparable with this one.
- **A real but minor behaviour found on the way:** when a view is genuinely all land (all-zero grid), the app re-drives a fetch every 3 s
  indefinitely ("Render backstop: engine empty + idle >= 3s"). That is wasted client work on an inland view; a follow-up, not a bug in
  what is drawn.
- **Lab lesson:** the coarse `LAND_BOXES` make any narrow coastal view in a continent box all land; coastal phone cells must sit on lab
  water, or the lab needs a real coastline mask.

**Part A as it stands:** inside a pilot box, with bundles on, every measured first visit draws the exact frame; all but two steps are
within 48 ms (desktop <= 17 ms). The two exceptions: Hawaii GFS phone one step at 109 ms, and the +172 h burst step (Florida phone
385 ms; ICON never exact in either arm, past ICON's 168 h range). The CDN prefetch stays dropped.

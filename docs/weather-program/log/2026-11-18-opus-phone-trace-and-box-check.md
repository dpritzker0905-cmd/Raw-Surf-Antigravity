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

# 2026-10-23 (claude, GPU-frames session): day steps at z8 right after a pan session

Written 2026-10-24 (UTC). Branch `claude/z8-step-after-pans` from dev `3804154b3` (#501 and #505 in). Evidence:
`evidence/z8-steps-after-pans-2026-10-23.json`. Docs and harness only: no client change ships (see "Tried").

## Ask (the lead, 2026-10-23)
- "Yes, take the z8 day-step slowness after a pan session next: 1.4 to over 4 s, against 43-50 ms before the pans. That's a real
  instant-contract miss."

## Measured
Offline, `scn_sibling_toggle.js`: z8 (-79.95, 26.5) on the owner window; 20 drifting pans 3 s apart; the box modelled, surf at 1/5 of
live cost; Home then 6 PageUp, +24 h each, 4 s apart; ms from the key to the selected hour on the GPU, - = not within 4 s.
| Run (surf ON, ICON unless noted) | steps (ms) |
|---|---|
| no pans, pages warm (`NO_PANS_AND_DRAINED`, load) | 29, 43, 39, 42, -, 36 |
| after the pans, the client left to finish asking (252 s) | 69, 57, 35, 50, 43, 55 |
| scrub ~10 s after the last pan (`SOON_AFTER_PANS_A`, two sessions) | 61, 3133, 1362, -, 3296, - / 43, 1736, 3692, 1656, 1846, 1585 |
| scrub ~10 s after the last pan (`SOON_AFTER_PANS_B`) | 59, 809, 819, 2870, 2168, 836 |
| swell GFS, scrub soon after the pans (`MODEL_WARM_SUPERSEDE_SWELL`, both arms) | mostly - (> 4 s) |

- The slowness is not "after a pan session" as such: once the new view's series pages are warm, steps are 35-69 ms again. It is a
  scrub that starts BEFORE they are: every step past the first page has no series frame, so it waits for a per-hour /grid.
- Per-hour /grid latency during those steps (the harness's own request record): 0.6-5 s, against a modelled cost of 0.2 s (surf) /
  0.4 s (swell): the box is shared with the new view's series pages (3 s each modelled; a live ICON surf page is 10-25 s) and the
  synthetic backend's own build of each new box and hour.
- The forensic ring per step: the step commits as soon as its /grid lands (`commit` at the step's ms); no refusal (`reject_downgrade`,
  `rating_grace_hold`) delayed a step. So the client is not holding the frame; the data is not there yet.
- In 3 of 3 dev sessions the FIRST view's ICON pages (hours 95+, 143+, 191+) were still being asked 4-14 s after the last pan, while the
  user scrubbed the new view: the ICON model-switch prewarm (`useMarineSeriesWarm`'s second effect) uses its own long-lived controller
  unless the build flag is set, so #501's supersede-by-default never reaches it.

## Tried, measured, not shipped
- The model-switch warm sharing the viewport intent whenever supersede is on (kill `__RAW_DISABLE_MODEL_WARM_SUPERSEDE__`; commit
  73a9b2421 on this branch, reverted before the PR). Paired runs (surf twice, swell once): the first view's pages ran after the pans in
  0 of 3 fix sessions AND 0 of 3 kill sessions (which behave as dev), and step times were the same in both arms. No measured effect, so
  it is not in this PR. It stays the logical fix for the 3-of-3 dev observation if a later replay shows the old pages again.

## What would make these steps instant (for the lead / owner)
- Static coverage for the view: the regional bundles answer z7-9 only inside the GFS pilot boxes (the replay drifts out of
  florida_east_coast); ICON and surf mode have no static frames at all. A step there is a per-hour build on the box.
- Or warm the next pages faster after a pan: the new view's pages come one after another behind other background work (A15-11, one
  background request), so a scrub that starts within ~a page's build time of the pan (4-5 s GFS swell, 10-25 s per ICON surf page
  live) steps on /grid.
- Accept for ICON surf: each ICON surf page is a 10-25 s build live; no client ordering makes far hours instant seconds after a pan.

## Follow-up recorded (the lead, 2026-10-23: "Record it as a follow-up item in your fragment. Don't widen this PR for it.")
- The render backstop's clamp no-progress cap (`useMarineScrubSettle`, `marineSettleWatchdogs.evaluateClampCapProbe`) keys on the
  ENGINE grid's bounds; when two residents alternate (the /grid tile and a series frame: 13 x 13 and 17 x 13 in the reload-loop
  samples), the signature changes every pass and the cap never engages. #505 ended the network loop it allowed; the re-drive churn
  (settle checks, clamp_resharpen within its own cap) remains possible.

## Harness (this PR)
- `scn_sibling_toggle.js` STEPS: per step the engine-hour timeline, the forensic ring slice (`__RAW_FORENSIC__` events since the key)
  and `__MARINE_SHARPEN_DIAG__`; per session `req`: the harness's own start and response time of every /grid and /grid_series.

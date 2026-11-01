# 2026-11-01 (claude, infobox-honesty session): infobox P1-B, ICON past 168 reads the stored estimate (DARK)

Branch `claude/icon-point-stored-tail` from dev 9ddfd674c (#639). Started by the lead (local_d6b521eb). Client only.
**It moves a served number (the infobox's ICON height past hour 168), so it ships DARK:** build flag
`REACT_APP_ICON_POINT_STORED_TAIL`, default off; the runtime switch `window.__RAW_DISABLE_ICON_POINT_STORED_TAIL__ = true`
can only turn it off (D-001: no console or localStorage opt-in). Draft PR, not merged; the flip is the owner's word.

## Ask

- **The owner, 2026-11-01 16:03 EST (via the lead):** "build infobox P1-B, hidden. Past ICON hour 168 the infobox must
  read the SAME stored estimate the heatmap draws (the D-055 stored tail), not blend its own anchor fetches in the
  browser. That's one forecast path, per the ONE FORECAST COMPOSITION mandate."
- **Measured gap the lead cited (10-28 regression run):** +23% at h250 and +11% at h300 at 21.5N 118W.
- **Rules from the lead:** dark, default off, flag named in the PR; offline harness evidence only (never the live
  backend); do not touch `frontend/e2e/*`, `frontend/src/index.js`, `frontend/src/testSupport/*`,
  `frontend/scripts/offline-backend/route_lifecycle.js` or guardian/support files.

## What was wrong, read in the code

- `fetchBackendExactPoint` (backendWeatherServiceClientPoint.js) never asked `/point` for ICON past hour 168. It
  fetched anchors and blended them in the browser:
  - **hours 169-240:** ICON at 168 (persistence) + GFS at 168 and at the hour (trend), basis `icon_extended_estimate`;
  - **past 240:** that blend plus EURO at 240 and at the hour, and GFS at 240.
  Neither path carries the surf chain (`surf_height_m` stays null).
- The heat map draws the backend's STORED estimate (`icon_persistence_gfs_blend`, the D-055 tail) when the build has
  `REACT_APP_ICON_STORED_TAIL=true`, which is how the dev deploy builds. That means two forecast paths for one number,
  which the ONE FORECAST COMPOSITION mandate forbids.
- The backend already answers `/point` for ICON past 168 from the stored product, estimates included
  (`manifest_point_selection.choose_for_point`), and `point_resolution` has no ICON native-range guard. So no backend
  change is needed.

## What changed

- `iconEstimateDelivery.iconPointStoredTailEnabled(layer)` is true only when all of these hold:
  - the build has `REACT_APP_ICON_POINT_STORED_TAIL=true`;
  - the build ALSO has `REACT_APP_ICON_STORED_TAIL=true` (the card must read what the map draws; with the map still
    blending, the card blends with it);
  - the layer is not `swell_2` (it keeps its disclosed GFS/EURO blend, as the map does, D-003);
  - the kill switch is not set.
- `fetchBackendExactPoint`: with the flag on, ICON past 168 takes the ordinary path. That is one `/point` ask at the
  hour, answered from the stored estimate, with the surf chain. Off, the browser blend runs exactly as before.
- `iconPointStoredTail.test.js` (+1 suite / +4 tests), with the real point client against a stub backend:
  - off: the anchor asks and blend run unchanged, with no surf;
  - on: one ask `ICON@250`, the stored value 1.55 m, basis `icon_persistence_gfs_blend`, surf 2.1 m;
  - the flag needs both env vars, excludes `swell_2`, and the kill switch only disables;
  - native hours stay a single ask, and the kill switch brings the blend back.
- The frontend CI floor rises 527/6919 -> 528/6923.

## Measured (offline only)

Instrument: `frontend/scripts/offline-backend/scn_infobox.js` (#639), unchanged.
- **Backend:** the real backend over a synthetic store (`serve_synthetic_selector.py`, port 4131): run 12Z, first
  valid 2026-11-01T15Z, 115 frames, GFS/ICON/EURO waves. ICON is native through Nov 8, then the
  `*_estimated.json` stored tail.
- **Builds:** two production builds of this branch, both `REACT_APP_ICON_STORED_TAIL=true` (as the dev deploy).
  - **A (before) = flag off:** main.641eca64.
  - **B (after) = `REACT_APP_ICON_POINT_STORED_TAIL=true`:** main.975cde25.
- **Run:** ICON, waves, z4.6, dark. Points: 21.5N 118W (the lead's), 15.5N 108.5W (on the synthetic vortex's track)
  and 30N 70W (open ocean); hours 168 (native-edge control), 200, 250 and 300.
- **Times:** A 21:28-21:30Z, B 21:30-21:32Z. The host audit shows every API ask was routed to 127.0.0.1, and none
  reached the live box.
- **Columns:** "card" is the infobox's exact-point height. "grid" is the same backend's `/grid` for the same model,
  hour and box, bilinear at the point, from the same stored product the heat map drew. "gap" is card vs grid.

| point | hour | before: card / grid / gap | after: card / grid / gap |
|---|---|---|---|
| 21.5N 118W | 168 | 5.911 / 6.090 m / −2.9% | 5.911 / 6.090 m / −2.9% (control, unchanged) |
| 21.5N 118W | 200 | 3.975 / 3.119 m / **+27.5%** | 3.099 / 3.119 m / −0.6% |
| 21.5N 118W | 250 | 2.002 / 1.530 m / **+30.8%** | 1.512 / 1.512 m / 0.0% |
| 21.5N 118W | 300 | 1.610 / 1.446 m / **+11.3%** | 1.446 / 1.446 m / 0.0% |
| 15.5N 108.5W | 168 | 1.335 / 1.335 m / 0.0% | 1.335 / 1.335 m / 0.0% (control) |
| 15.5N 108.5W | 200 | 1.334 / 1.333 m / +0.1% | 1.333 / 1.333 m / 0.0% |
| 15.5N 108.5W | 250 | 1.365 / 1.333 m / +2.4% | 1.333 / 1.333 m / 0.0% |
| 15.5N 108.5W | 300 | 1.483 / 1.333 m / **+11.3%** | 1.333 / 1.333 m / 0.0% |
| 30N 70W | 168 | 0.842 / 0.842 m / 0.0% | 0.842 / 0.842 m / 0.0% (control) |
| 30N 70W | 200 | 0.842 / 0.842 m / 0.0% | 0.842 / 0.842 m / 0.0% |
| 30N 70W | 250 | 0.862 / 0.842 m / +2.4% | 0.842 / 0.842 m / 0.0% |
| 30N 70W | 300 | 0.937 / 0.842 m / **+11.3%** | 0.842 / 0.842 m / 0.0% |

- **Harness checks** (TIME: the card's point product time equals the drawn frame's; VALUE: the card is within
  max(0.15 m, 10%) of `/grid`):
  - before, 9 of 9 far-hour rows fail TIME (no point product: the browser blend), and 4 of 9 also fail VALUE;
  - after, 0 of 12 rows fail. Every row carries the stored estimate's product id, the one the heat map drew.
- **Point asks per far hour:** before 3 (h200, h300) and 5 (h250); after 1. Weather asks per session fell from 27 to
  18-20.
- **Card settle p50:** before 4.8 / 2.3 / 2.7 s, after 1.0 / 1.2 / 2.0 s (21.5N, 15.5N, 30N).
- **Words:** past 240, the card's own row said "blended from GFS and EURO beyond ICON's range" while the status line
  said "beyond ICON's native range". After the fix, both say "beyond ICON's native range".
- **Two caveats:**
  - The "+11.3%" at h300, the same at all three points, is the blend's GFS/EURO trend factor applied to a different
    anchor. The −2.9% at the 21.5N h168 control is identical before and after (the existing exact-point vs bilinear
    difference on the vortex's gradient, inside the harness tolerance). This change does not touch it.
  - The app anchors the wheel on the nearest whole hour, so sessions that started before 21:30Z (A at 21.5N) selected
    h250 = Nov 12 07Z and drew 06Z, and later sessions drew 09Z. Each row's gap compares the card with the `/grid` of
    its own selected time, so the gap is like for like; the absolute heights of A and B at 21.5N h250 are not.
- **vs the lead's 10-28 figures** (+23% at h250, +11% at h300): h300 reproduces (+11.3%). h250 reads +30.8% here: a
  different store and anchor hour, the same direction.

Evidence (local, not committed): `infobox_A.json` and `infobox_B.json` from the harness, copied to the session group's
shared notes folder.

## Tests run

- Jest, the whole `src` tree (`--testMatch` for the worktree): 612 of 613 suites, 8055 of 8056 tests. The one failure
  was `netlifyIconStoredTailScope` (Git Bash `spawnSync` 5 s timeout under load, known local-only); alone it passes
  12/12. Of those, `src/components/map` was 412 suites / 5916 tests and `src/tests` 29 suites / 286 tests, 0 failures.
- `node scripts/check_eslint.js`: no rule over its baseline (1627 files, 86 errors, 901 warnings).

## Not done here

- No flip. Turning it on means adding `REACT_APP_ICON_POINT_STORED_TAIL=true` to the Netlify build env, beside
  `REACT_APP_ICON_STORED_TAIL`, on the owner's word with evidence (D-001).
- P1-A (`MID_RES_EXACT_TIME_ESTIMATE`) is the lead's live flip, and the EURO/ICON scalar-height evidence is a
  separate lane. Neither was touched.
- The four follow-ups from the 10-28 log still wait for the owner:
  - backend refusal of a foreign `grid_product_id`;
  - the surf-grid `is_estimated` stamp (D7);
  - re-keying the point fetch on the ask instant;
  - UTC weekday ticks.

# 2026-11-12 — Opus, move 3: the "six misses" (branch `opus/move3-six-misses`)

Session: the move 3 static-frames session (main log `2026-11-12-opus-move3-static-frames.md`, #802; the publish order is #816 and
its log `2026-11-12-opus-move3-publish-order.md`). Ask (owner via the advisor, 16:10Z): fix the six cells that still missed the
100 ms step after #802: ICON swell_1, EURO swell_2, ICON swell_2, GFS wind_waves, EURO wind_waves, ICON wind_waves. Rules: offline
lab only, no served number moves, a published frame may only be read where it is a parity-gated mirror of `/grid`, and a published
ICON blend set is not to be built without the owner's decision.

**Result, plainly: no runtime change ships here.** On a fresh lab store, current dev already meets 100 ms at p95 in the three
non-ICON cells of the six (EURO swell_2, GFS wind_waves, EURO wind_waves; corrected from "four" after the advisor's check); the 06:50Z table that named them was read on an AGED lab store. The fix I built for the named cause (c) measured no
gain and is withdrawn. The two ICON causes remain and are sized below. This PR carries only the harness instrumentation and records.

## Method

- Harness `frontend/scripts/offline-backend/scn_instant_contract.js` (same plan as #802: R R R PU J:29 J:250 J:336 J:126 D:12 M R
  J:250 M R J:336), `MODELS=GFS,EURO,ICON LAYERS=swell_1,swell_2,wind_waves ZOOMS=2,4.6 THEMES=dark`, desktop, 18 sessions per run.
- Backend `serve_synthetic.py` on a FRESH store built with `--horizon 348` (150 sets, parity_bad 0, refused 0; tails to
  2026-11-27T03Z, so now + 336 h stays inside the client's 3 h window for the whole matrix), production's targeted fill mode.
- BEFORE = dev `33ea1320f` build (`main.d63802dd.js`); AFTER = the same plus the pack-now change below (`main.767061e6.js`).
  3 runs per arm. AFTER 17:49-20:21Z, BEFORE 20:40-21:52Z (other sessions shared the machine throughout).
- **A rerun, stated:** the first BEFORE runs (17:49-19:58Z) measured the wrong build. Port 3263 was still held by my own SPA
  server from the #802 session serving the pre-#802 build (`main.0ea76288.js`), so every BEFORE step read `no_index`. Those runs
  are discarded; BEFORE was rerun with the served bundle asserted (`main.d63802dd.js`) before each run.
- New in the harness: per action, the delta of the frame store's miss reasons, the static seam's miss reasons, deferred shows,
  and the store's aux-path refusals (`misses.store / sf / deferred / aux`). This is what found the causes below.

## Per cell (steps exclude model toggles M; drag presses count as steps; ms)

| Cell | BEFORE n | p50 | p95 | worst | AFTER n | p50 | p95 | worst | toggles BEFORE / AFTER p50 (max) |
|---|---|---|---|---|---|---|---|---|---|
| swell_1 ICON | 37 | 10 | 153 | 169 (J:126 z2, grid) | 39 | 15 | 144 | 185 (J:126 z2, grid) | n/a (no ICON toggle in plan) |
| swell_2 EURO | 66 | 7 | 16 | 17 | 71 | 9 | 47 | 111 (R h251 z4.6) | 66 (595) / 84 (145) |
| swell_2 ICON | 60 | 185 | 304 | 337 (J:250 z2, grid) | 60 | 201 | 326 | 556 (J:250 z2, grid) | 655 (1180) / 790 (1023) |
| wind_waves GFS | 68 | 10 | 31 | 42 | 72 | 9 | 50 | 84 | 53 (74) / 57 (110) |
| wind_waves EURO | 65 | 9 | 28 | 84 | 70 | 10 | 67 | 133 (R h251 z2, grid) | 63 (324) / 71 (87) |
| wind_waves ICON | 38 | 12 | 159 | 170 (J:126 z2, grid) | 41 | 13 | 168 | 228 (J:126 z2, grid) | n/a |

Per-run p95, BEFORE / AFTER: swell_1 ICON [150,169,153] / [132,145,140]; swell_2 EURO [16,12,12] / [43,61,16]; swell_2 ICON
[306,262,295] / [305,326,284]; wind_waves GFS [41,13,31] / [59,59,12]; wind_waves EURO [17,13,74] / [17,82,12]; wind_waves ICON [170,159,144] / [167,168,126]. The other three cells (GFS/EURO swell_1, GFS swell_2) meet
100 ms at p95 in both arms. Non-ICON steps over 100 ms across all 9 cells: 2 per arm.

## The three named causes, measured

**(c) First far jumps landing before the idle fill: not a cause on a fresh store, and the fix is withdrawn.** I built a pack-now
path (`onParsed` packs and shows synchronously when the parsed frame is the one a deferred step is waiting for, kill
`__RAW_DISABLE_FRAME_WANT_PACK_NOW__`, 2 tests and a mutant check). Deferred shows were 18 BEFORE / 19 AFTER and `not_ready` misses
62 / 66: the race it closes did not occur often enough to move any cell, and AFTER is no better at p50 or p95 in any cell (the
AFTER p95s that read higher, 16 -> 47, 31 -> 50 and 28 -> 67 ms, are not separable from machine load: BEFORE and AFTER ran in
separate time blocks on a shared machine, so this is not shown to be noise either; the third AFTER runs read 16, 12 and 12 ms).
Model toggles are excluded from the step figures and still run 53-655 ms p50 BEFORE (max 1,180 ms, ICON swell_2). A change with no
measured benefit does not ship. The diff is kept outside the repo for reference.

**(a) EURO hours past 240 h going to the box: in the lab it was the aged store.** With the fresh store, EURO swell_2 and wind_waves
steps at h250-h336 are served from the store. The 06:50Z misses at h336 (`no_frame_in_window`) came from a store whose tail had aged
past now + 336 h (even GFS h336 went to `/grid` then). In production the same symptom has two real causes, both outside the client:
the publish budget leaving the EURO swell sets a run behind (#816 bounds that to one run) and the far-edge hold late in each cycle.
The hold is NOT read on the client: its byte-for-byte equality with a published frame could not be shown, because in the lab the
filled and plain EURO swell frames are byte-identical (the synthetic fill is a no-op), so a "0 bad nodes" parity there is not
evidence. A possible production divergence to check: the held world answer has `coarse_fill: None` while the client reads the
`_filled` set.

**(b) ICON swell_2: a per-step client blend, still a miss (p50 ~190-200, p95 ~300-330 ms, all via the box).** `blendIconSwell2`
(60% GFS / 40% EURO, `iconSwell2Blend.js`) runs per hour on the normal path. Timed in Node/jsdom on a real world frame: blend
69-93 ms, encode 38-63 ms, `buildVectors` ~20-35 ms, so even with both inputs warm the blend alone is ~110-150 ms. Warming inputs
cannot reach 100 ms. The only client route is a blend packed ahead in idle time inside the frame store: about 200 ms of idle CPU per
frame and about 4.7 MB per run held, plus the parity gate against `/grid`'s ICON swell_2 answer. A published blend set
(server-built) is the other route and per the rules is not built: **owner's decision.**

**New, found by the aux counters: ICON swell_1 and wind_waves miss on ONE step, J:126 right after the J:336 blend hour (p95 144-168
ms).** After an ICON step past 168 h the resident frame is the client blend (a foreign commit), so the step back to h126 finds
`resident_not_this_set` and must compute chl/bath on the spot (~63 ms). The store refused it: a single-session probe (BEFORE build,
ICON swell_1 and wind_waves, z2) recorded `aux: { aux_not_ready: 16 }` on that step, and `/grid` answered at 158-163 ms. Sixteen
refusals over a 6 s window cannot all be the 1 s `AUX_SYNC_EVERY_MS` throttle; the likely gate is `store().tier !== 'desktop'` in
headless Chrome (`marineFrameStoreRuntime.auxShowable`). Not confirmed; that is the next instrument. If it is the tier, a real
desktop already passes; if it is the throttle, the fix is to allow the sync aux once on a step whose resident is a foreign commit.

## 23:50Z Owner's go-ahead to fix the ICON step: cause narrowed, the first fix falsified and withdrawn

Probe (harness now records the store tier and the aux sync/show counts): `tier: desktop`, so the device-tier gate is ruled out;
the refusal is the 1 s `AUX_SYNC_EVERY_MS` throttle. Per action, the J:126 key run (PageDown run from h336 back to h126) does
2 on-the-spot chl/bath computes and 2 aux shows, then 16-18 refusals: something clears the resident between the run's stored
steps, and the last step lands inside the throttle window. No backend ask is made during that action, so the normal path draws
h126 from client-side data (series or static seam), not from the box.

Fix tried: "a commit from an ICON blend hour re-arms the throttle" (kill `__RAW_DISABLE_FRAME_AUX_REARM__`, 2 tests, mutant check
failed exactly the new test). Lab A/B, ICON start x swell_1/swell_2/wind_waves x z2/z4.6, 3 runs per arm interleaved, bundle hash
asserted per run (dev `main.d63802dd.js` vs fix `main.1e659777.js`): p95 ms swell_1 163 -> 140, wind_waves 141 -> 146, swell_2
304 -> 221 (that cell never takes this path: `no_index`, the blend); `aux_not_ready` 52 -> 50 and 51 -> 53; J:126 still `grid` in
5 or 6 of 6 sessions per cell. **The re-arm never fired.** Reason: `WebGLMarineLayer` calls `noteCommitted` with
`hour: timeOffsetHoursRef.current`, the CURSOR's hour, so a late blend commit lands with the cursor already under 168 h and was
never classed as a blend commit. The premise (that late blend commits are what clear the resident) is therefore unproven too.
Withdrawn; the diff is kept outside the repo. Next instrument: log each `noteCommitted` outcome during a key run with the
committed grid's own time, served time and product id, to name the commit that clears the resident before changing anything.

## Still missing, plainly

| Cell | Why | Route |
|---|---|---|
| swell_2 ICON | per-step client blend, 110-150 ms of compute before the draw | store-packed blend (~200 ms idle/frame, ~4.7 MB/run) or a published set: owner's call |
| swell_1 ICON, wind_waves ICON | one step after a blend hour: aux path refused by the 1 s throttle (`aux_not_ready`; tier ruled out) | name the commit that clears the resident (instrument above), then fix; the blend re-arm was tried and failed |
| EURO in production (not the lab) | publish-budget staleness, far-edge hold | #816; the hold needs `/capabilities` to expose its rails before a client mirror |

## 00:10Z (11-13) The commit that clears the resident, named (owner: "instrument it")

Instrument: a LAB-ONLY trace build (never committed; diff kept outside the repo) logging every `noteCommitted` outcome with the
committed grid's OWN fields (`hourOffset`, valid/served time, product id, provider, estimated), next to every store show and refusal
(with ms since the last chl/bath sync). The harness now saves that trace per action when the build exposes it
(`window.__RAW_COMMIT_TRACE__`; a normal build has none, so nothing changes for it). One session each, ICON swell_1 and wind_waves,
z2, the J:126 key run (PageDown from h336 back to h126):

| t (ms) | swell_1 event |
|---|---|
| 0-355 | 6 asks at blend hours: `icon_blend_hour` |
| 481 | store shows h168 with its own chl/bath (sync) |
| **562** | **commit `no_served_time`: grid `hourOffset` 336, `is_estimated`, provider `estimated` (the h336 blend), cursor at h144** |
| 564-1380 | 13 refusals `resident_not_this_set` / `aux_not_ready` (sync 147-963 ms ago) |
| 1460 | store shows h131 (sync) |
| **1537** | **the same h336 blend grid commits again, cursor at h130** |
| 1539-1812 | 5 refusals (sync 97-370 ms ago) |
| 2069 | normal-path commit of h126 (`resident`, product `icon_marine_swell_1_global_mid_20261118T060000Z`): the step's answer |

wind_waves is the same shape: the h336 grid commits three times (cursor at h144, h128, h127) before h126.

**Finding.** The resident is cleared by a STALE re-commit of the h336 blend grid after the user has left that hour; it is not a
fresh blend answer. `WebGLMarineLayer` (the commit at line ~293) has no check that the grid's own `hourOffset` matches the cursor,
and it labels the commit with the cursor's hour (`publishMarineDrawn(grid, { hour: timeOffsetHoursRef.current })`), so the
harness's mislabel check reads 0 although the engine was handed h336 data at h144. That is a correctness question beyond latency:
for 0.1-1 s during such a run the map may draw the h336 estimate under a h144 label. Not yet shown on screen (no pixel read);
the likely route is the engine's no-downgrade stash being swapped back in after a store show (the case `supersedeStash` exists
for), not yet proven. Next: find which call re-commits it, and refuse a commit whose own hour is not the cursor's.

## 01:25Z (11-13) The fix: refuse a stale replay over a store show (owner: "fix it here")

**Cause, from the code.** `WebGLMarineLayer`'s upload effect re-runs on every cursor change (`timeOffsetHours` is in its deps) with
`dataRef.current`, the layer's LAST normal-path grid. Normally that re-run is a duplicate and skipped. After a frame-store show,
`layerUploadIsStale` (marineZoomOutRelease rule 1, 2026-10-22) turns the duplicate skip off on purpose, so the next NEW commit always
uploads; but a cursor move alone then re-uploaded the old grid. In the traced run that old grid was the h336 ICON blend.

**Change.** `marineZoomOutRelease.isStaleReplayOverShow(engine, grid, lastUploadedGrid, cursorHour)`, asked in `safeUploadWaveData`
before the duplicate check: refuse ONLY when the grid is the very object the layer last uploaded, its own `hourOffset` is not the
cursor's, and the engine holds a store show. A new grid object (a zoom-out world frame, a fresh commit, a snapped hour) still
uploads, so rule 1's zoom-out fix is untouched. The layer now records the object it uploads (`lastUploadedObjRef`). Counter
`window.__WEBGL_MARINE_STALE_REPLAY_SKIP__`; ON, kill `window.__RAW_DISABLE_STALE_REPLAY_GUARD__` (registered in the inventory). Tests
(`marineZoomOutRelease.test.js`, +4): the refusal, every pass-through case, the OFF path (the kill and the resync kill it rests on),
and the wiring order in `WebGLMarineLayer`. Mutant (the helper returns false): exactly the refusal test fails. No served number
moves: the guard only keeps a frame the store already drew for the cursor's hour instead of an older hour's frame.

**Trace on the fix build (lab-only trace patch on top):** the J:126 run commits only `resident` h126; the store shows every step
h168, h144, 143 ... 126 (20 shows), 0 refusals, in both swell_1 and wind_waves. The h336 re-commits are gone.

**Lab A/B** (ICON start x swell_1/swell_2/wind_waves x z2/z4.6, 3 runs per arm INTERLEAVED, bundle hash asserted per run: dev
`main.d63802dd.js` vs fix `main.0f1c9c77.js`; 00:38-01:23Z, shared machine):

| ICON cell | arm | n | p50 | p95 | worst | per-run p95 | J:126 via store | `aux_not_ready` |
|---|---|---|---|---|---|---|---|---|
| swell_1 | dev | 42 | 10 | 162 | 190 | 140, 141, 162 | 0 / 6 | 50 |
| swell_1 | fix | 42 | 6 | 50 | 142 | 18, 11, 16 | 4 / 6 (z2 3/3) | 0 |
| wind_waves | dev | 42 | 11 | 144 | 188 | 163, 134, 135 | 0 / 6 | 49 |
| wind_waves | fix | 42 | 9 | 126 | 145 | 17, 28, 12 | 3 / 6 (z2 3/3) | 0 |
| swell_2 | dev | 60 | 176 | 256 | 400 | 242, 256, 229 | 0 / 6 | 0 |
| swell_2 | fix | 60 | 193 | 305 | 452 | 292, 245, 305 | 0 / 6 | 0 |

**Read the fix arm plainly (advisor's check, 2026-11-13):** z2 is fixed (J:126 via the store 3/3 in both layers); z4.6 is not
(`crop_only_set`). Pooled over n = 42, ICON swell_1 passes 100 ms at p95 by ONE sample (2 of 42 steps still over 100 ms; p95 = the
third largest = 50 ms), and ICON wind_waves still MISSES at pooled p95 (3 of 42 over; p95 126 ms). The per-run p95s (18/11/16,
17/28/12) are n = 14 each and hide those z4.6 steps. Same object re-delivered at another hour (the advisor's coverage question): it
can happen (shared cached grids; `hourOffset` is stamped only when missing), and the guard refuses it on purpose, as the duplicate
skip already does with no store show up; reasoning in the helper's comment, pinned by a test (+1, floor fragment now +5).

Mislabel 0 in both arms (the harness cannot see the replay's mislabel: the layer labels a commit with the cursor's hour).
swell_2 never takes this path (its frames are the per-step client blend); its p95 difference is not separable from machine load.

**Still missing after the fix:** (1) ICON swell_2, the client blend (owner's decision, sized above). (2) J:126 at z4.6: 5 of 6
sessions still answer from /grid in 126-145 ms with `crop_only_set` x20 in BOTH arms: at mid zoom the plain ICON set shows only
through a crop window, and none is resident after the run back from the blend hours. A separate mechanism, not touched here.

## 03:35Z (11-13) Stale replay guard, refined after the advisor's re-check

The advisor showed my earlier answer was wrong: refusing a same-object re-delivery is NOT equivalent to the duplicate skip, because
with a store show up the screen holds the STORE's frame for another hour. Sequence: the normal path uploads a shared grid G
(stamped h138); the store then shows h137; the cursor moves to h139 where the store has no frame; the normal path hands back G. The
first guard refused G (138 != 139) and kept the h137 frame under an h139 label. Neither code reading nor a probe was needed to
settle it: the guard now refuses a replay only when its own hour is NO NEARER the cursor than the hour the store's frame was shown
for (`engine._waveData.waveGrid.hourOffset`); a nearer replay uploads, as before the guard. The traced case (G h336, store h168 /
h144, cursor h144) is refused either way, so the 01:25Z lab numbers (measured with the first guard) still describe that case; the
refinement only lets more uploads through. Tests: the advisor's sequence (uploads), the store at the cursor's hour or equally near
(refused); mutant (no distance check): exactly the advisor's-sequence test fails. Floor fragment +6 in total.

## 04:50Z (11-13) The z4.6 crop miss after a blend hour (owner: "fix the z4.6 crop miss next")

**Cause (lab-only trace build with the crop resident's state):** at z4.6 the ICON blend is a /grid clip one lattice cell smaller on
each side than the plain set's window (28 x 23 over -102..-48 / 8..52 against 30 x 24 over -104..-46 / 6..52). After a blend hour
the engine's texture is that smaller box; on the first stored step `engineHolds` fails on the dims, the plain window resident is
dropped, and every step is `crop_only_set` (x20) until the normal path commits h126. The store writes into the existing texture
(texSubImage2D), so a 30 x 24 window cannot be shown into a 28 x 23 texture, and the only path that cuts a window to the ENGINE's box
with its own chl/bath (`showCropSwitch`) ran on model switches only.

**Change** (`marineFrameStoreRuntime.js`, ON, kill `window.__RAW_DISABLE_CROP_AFTER_FOREIGN__`, in the inventory): a clip commit that
names no stored frame (`no_served_time`: the blend, a /grid fallback) is recorded as a FOREIGN crop resident (`CS.noteForeignCommit`,
already used for unindexed commits), and a stored step of the SAME model and layer may then take `showCropSwitch`: this set's window
of the engine's own box, with its own chl/bath. A step of one model never draws over another model's clip (an existing test,
`marineFrameStoreCropShow`, caught that in my first draft; the same-model rule restores it). The plain-set parity gate
(`servableClip`) still applies. Counter `shows.cropForeign`. Tests (`marineFrameStorePlainCrops.test.js`, +2): the fix (the encoder's
bytes for the blend's box, own chl/bath, then the crop resident is this set's window) and the OFF path; mutant (the foreign step
off): exactly the fix test fails. 13 frame-store and layer suites, 262 tests, pass.

**Trace on the fix build:** the J:126 run commits only `resident_crop` h126; the store refuses 7-8 steps `crop_not_ready` (the
window pack is built on demand) and draws h126 from the store.

**Lab A/B** (z4.6, GFS/EURO/ICON start x swell_1/swell_2/wind_waves, 3 interleaved runs per arm, bundle hash asserted; base = this
branch with the stale replay guard, `main.0f1c9c77.js`; fix `main.b00a08c1.js`; 03:29-04:37Z):

| Cell (z4.6) | arm | n | p50 | p95 | worst | steps > 100 ms | J:126 |
|---|---|---|---|---|---|---|---|
| ICON swell_1 | base | 24 | 12 | 141 | 164 | 3 | grid 3/3 |
| ICON swell_1 | fix | 24 | 10 | 25 | 47 | 0 | store 3/3 |
| ICON wind_waves | base | 24 | 12 | 147 | 156 | 3 | grid 3/3 |
| ICON wind_waves | fix | 22 | 7 | 11 | 15 | 0 | store 3/3 |
| ICON swell_2 | base / fix | 30 / 30 | 157 / 157 | 219 / 210 | 228 / 227 | 27 / 28 | grid (the blend) |

GFS and EURO cells: p95 16-29 ms in both arms, no step over 100 ms in either (worst 97 ms, GFS swell_1 fix).

**Mislabel, checked, not caused by this change:** the fix arm read more mislabel frames (GFS swell_2 / wind_waves 0 -> 38, EURO up to
164). All are run 3 (04:26-04:37Z, the arm that ran last), all at J:336, all labelled honestly (`mislabelSilent` 0, the "Showing ...
the nearest" status): the lab store's tail (11-27T03Z) fell behind now + 336 h. Runs 1-2 are equal across arms (the existing honest
J:250 nearest frames, offset 3 h). Control at 04:43Z, back to back, GFS swell_2 z4.6: base 38 and 38, fix 38 and 39 mislabel frames
at J:336, offset 2 h, both via the store. The aged store, not the fix.

**Still missing:** ICON swell_2 (the per-step client blend, p95 ~210-305 ms; owner's decision between a store-packed blend and a
published set).

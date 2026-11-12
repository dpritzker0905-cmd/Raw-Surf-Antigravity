# 2026-11-12 — Opus, move 3: the "six misses" (branch `opus/move3-six-misses`)

Session: the move 3 static-frames session (main log `2026-11-12-opus-move3-static-frames.md`, #802; the publish order is #816 and
its log `2026-11-12-opus-move3-publish-order.md`). Ask (owner via the advisor, 16:10Z): fix the six cells that still missed the
100 ms step after #802: ICON swell_1, EURO swell_2, ICON swell_2, GFS wind_waves, EURO wind_waves, ICON wind_waves. Rules: offline
lab only, no served number moves, a published frame may only be read where it is a parity-gated mirror of `/grid`, and a published
ICON blend set is not to be built without the owner's decision.

**Result, plainly: no runtime change ships here.** On a fresh lab store, current dev already meets 100 ms at p95 in the four
non-ICON cells; the 06:50Z table that named them was read on an AGED lab store. The fix I built for the named cause (c) measured no
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
AFTER p95s that read higher are within run-to-run spread on a shared machine: the third AFTER runs read 16, 12 and 12 ms). A change with no
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

## Still missing, plainly

| Cell | Why | Route |
|---|---|---|
| swell_2 ICON | per-step client blend, 110-150 ms of compute before the draw | store-packed blend (~200 ms idle/frame, ~4.7 MB/run) or a published set: owner's call |
| swell_1 ICON, wind_waves ICON | one step after a blend hour: aux path refused (`aux_not_ready`) | confirm tier vs throttle, then a small client fix |
| EURO in production (not the lab) | publish-budget staleness, far-edge hold | #816; the hold needs `/capabilities` to expose its rails before a client mirror |

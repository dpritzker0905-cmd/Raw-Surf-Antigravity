# 2026-10-25 (claude, ledger-fragments session): the day-14 end, measured offline per arm (ICON and EURO waves)

Written 2026-10-25/26. Branch `claude/day14-evidence`. Evidence only: no served number, flag or client changes (no SCOREBOARD
row). Harness committed: `frontend/scripts/offline-backend/day14_arms.py` + `day14_labels.mjs`.

## Ask
The owner's manual test (2026-10-25, the lead's FINDINGS.md): "the ICON data is showing Saturday 13th day on the Sunday 14th day
with holes in Gulf data". The lead asked for offline evidence with #548's path and the real resolver, at now + 312 h (day 13) and
now + 330-336 h (day 14), ICON and EURO, with the Gulf node count per arm:
- arm 0: today (the 10-deg hold);
- arm 1: `FAR_EDGE_HOLD_PREFER_MID=1`;
- arm 2: + `FRAME_TAIL_DOWNLOAD=1`;
- arm 3: a LABELLED GFS stand-in past the model's stored tail.

For each arm: the label the user sees, and parity against /grid.

## Method (real fields, offline serve)
- **Data:** the PUBLIC weather-frames CDN, read serially (latest.json, three run indices, 67 frames near the tail). The decoded
  frames became stored products as `serve_synthetic.real_frame_products` makes GFS's.
  - **Run:** 2026-10-25T12Z for all three models.
  - **NOW** = 2026-10-26T02Z, the instant the scrubber counts from: day 13 = 11-08T02Z; day 14 = 11-08T20Z, 23Z, 11-09T02Z.
  - **Real lane ends** (from the indices, which list the manifest's entries):
    - GFS: 11-10T12Z (f384; `GFS_WORLD_FULL_HORIZON` is live).
    - ICON and EURO: **11-08T18Z**, both at run + 336 h.
- **Hours the CDN does not carry** (not_local; re-baked with the REAL core-lane jobs over real anchors):
  - EURO's tail (11-04T15Z to 11-08T18Z): `ingest_euro_marine_extended_estimates_impl`.
  - ICON's 11-08T15Z and 18Z: `ingest_icon_marine_extended_estimates_impl`.
  - Re-bake vs the 12 published ICON tail frames it overlaps: median |dh| 0.033 m, p95 0.30 m. The published frames carry about
    335 more valid nodes (3%), none of them in the Gulf box (both 66 of 70). Unexplained; noted.
- **Lab stand-in:** the 10-deg `global_coarse` is every 5th node of the real 2-deg field, as serve_synthetic derives GFS's.
  Production's own 10-deg products are not published, so their masks are NOT measured here.
- **Serve:** the REAL app (`server.app`, FastAPI TestClient, no lifespan, no socket, outbound name lookups blocked), one fresh
  process and store copy per arm. Box setting `MARINE_GULF_FILL_MID_TARGETED=1` (live since 2026-10-24 15:14Z). World bbox.
- **Gulf box:** lat 18-31, lng -98 to -80, 70 nodes on the 2-deg lattice.
- **Labels:** the CLIENT's own `describeDrawnFrame` (#560), run on what `publishMarineDrawn` builds from each response
  (served time, `is_estimated`, `estimate_basis.type`, the asked model), worded in America/New_York.

## Results
Data = the instant the frame holds. Gulf = valid / nodes in the Gulf box. Fill donor = the GFS hour the targeted fill copied from.

| arm | model | ask | tier served | data (age) | Gulf | fill donor | status line (owner's zone) |
|---|---|---|---|---|---|---|---|
| 0 | ICON | +312 Sat 9 PM | 2-deg 181x83 | 11-08T03Z (-1 h) | 66/70 | 03Z | Showing Sat 10 PM: the nearest stored forecast (beyond ICON's native range) |
| 0 | ICON | +330 Sun 3 PM | 2-deg | 18Z (+2 h) | 66/70 | **21Z** | **Loading Sun 3 PM… still showing Sun 1 PM** |
| 0 | ICON | +333 Sun 6 PM | **10-deg 37x17** | 18Z (+5 h) | **4/4** | (legacy) | **Loading Sun 6 PM… still showing Sun 1 PM** |
| 0 | ICON | +336 Sun 9 PM | **10-deg 37x17** | 18Z (+8 h) | **4/4** | (legacy) | **Loading Sun 9 PM… still showing Sun 1 PM** |
| 1 | ICON | +330 / +333 / +336 | 2-deg | 18Z (+2 / +5 / +8 h) | 66/70 | **21Z / 00Z / 03Z** | Loading … still showing Sun 1 PM (all three) |
| 3 | ICON | +330 | 2-deg (the ordinary nearest window, not the hold) | 18Z (+2 h) | 66/70 | 21Z | Loading Sun 3 PM… still showing Sun 1 PM |
| 3 | ICON | +333 / +336 | 2-deg GFS stand-in | 00Z / 03Z (-1 h) | 66/70 | none | Showing Sun 7 PM / 10 PM: the nearest stored forecast (GFS stand-in beyond this model's range) |
| 0 / 1 | EURO | +330 | 2-deg | 18Z (+2 h) | 66/70 | 21Z | Showing Sun 1 PM: the nearest stored forecast (estimated) |
| 0 | EURO | +333 / +336 | 10-deg | 18Z (+5 / +8 h) | 4/4 | none | Loading … still showing Sun 1 PM |
| 1 | EURO | +333 / +336 | 2-deg | 18Z | 66/70 | 00Z / 03Z | Loading … still showing Sun 1 PM |
| 3 | EURO | +333 / +336 | 2-deg GFS stand-in | 00Z / 03Z | 66/70 | none | … (GFS stand-in beyond this model's range) |

Day 13 (+312 h) is the same in every arm, for both models.

Notes on the table:
- **Arm 1u** (`+ FAR_EDGE_HOLD_BEFORE_UPSTREAM=1`) is byte-identical to arm 1 for ICON/EURO world boxes: the dynamic lane is off
  past 168 h, so there is no upstream fetch to pre-empt.
- **Arm 2** serves /grid exactly as arm 1; its frames are below.
- **GFS** at the same asks: 2-deg, its own hour, 66/70.

**Arm 2, the publisher.** Pilots disk = the manifest with the core lane's tail files absent (96: 48 tail hours, each 2-deg and
10-deg); `--tail-store-dir` = the full store.

| set | FRAME_TAIL_DOWNLOAD=0 (control) | =1 |
|---|---|---|
| ICON waves global_mid | 1 built, 14 not_local | 15/15 built to 11-08T18Z |
| EURO waves global_mid | 3 built, 34 not_local | 37/37 built to 11-08T18Z |
| ICON waves global_mid_filled | 1 built, 14 not_local | 15/15 |
| EURO waves global_mid_filled | coverage-refused (2/3 authoritative) | the same: a LAB artifact, only 3 EURO native frames were fetched |

Parity of every built ESTIMATED frame against /grid at its valid time (filled frames against /grid with the targeted fill on,
plain frames with the 2-deg fill off), `frame_binary.parity`:
- ICON plain: 14 of 14 frames exact, 0 bad of 210,322 nodes.
- ICON filled: 14 of 14 exact, 0 bad of 210,322.
- EURO plain: 33 of 34 exact. The 34th is the first tail hour, 11-04T15Z (finding 5).

**Arm 3's seam** (node by node, nodes valid in both; median |dh|, p95 |dh|, mean dh in metres; world, then the Gulf box):

| step | ICON | EURO |
|---|---|---|
| the model's own 3-h step (15Z -> 18Z) | 0.043 / 0.40 / -0.01; Gulf 0.022 / 0.06 | 0.040 / 0.36 / 0.00; Gulf 0.021 / 0.06 |
| GFS's own 3-h step (18Z -> 21Z) | 0.044 / 0.40 / -0.01; Gulf 0.023 / 0.06 | (same) |
| model vs GFS at the same hour (18Z) | 0.374 / 1.93 / -0.08; Gulf 0.132 / 0.37 | 0.344 / 2.36 / -0.14; Gulf 0.247 / 0.74 |
| **THE SEAM: model 18Z -> GFS stand-in 21Z** | **0.386 / 1.92 / -0.09; Gulf 0.121 / 0.39** | **0.354 / 2.34 / -0.15; Gulf 0.261 / 0.69** |

## Findings, ranked
1. **Arm 1 alone restores the 2-deg field at every day-14 hour.** Gulf 66 of 70 nodes, the same as GFS. The 4 missing are the
   same 4 land nodes in GFS, ICON and EURO: (18 N, 98 W), (18 N, 90 W), (30 N, 98 W), (30 N, 96 W). Arm 0's 10-deg hold has 4 Gulf nodes. In this data the ICON/EURO 2-deg tails carry the Gulf themselves: the
   targeted fill copies 0 Gulf cells, while copying 125-135 ICON and 39-45 EURO cells elsewhere. So the "holes" are the 10-deg
   tier. The production 10-deg masks are not measured (lab stand-in).
2. **No flag fixes the label (the owner's mislabel class).** In arms 0-2 a held hour reads "Loading Sun 6 PM… still showing
   Sun 1 PM", a pending line that never resolves. That happens for ICON once the frame is more than 1 h away, and for EURO past
   144 h once it is more than 3 h away. `drawnFrameReadout.ESTIMATE_WORDS` has no far-edge-hold wording, and the hold keeps the
   tail's `estimate_basis`. This is a client wording fix (the #560 owner) or arm 3.
3. **The fill mixes instants on held frames, now that GFS reaches f384.** The route-level fill runs after `resolve_grid`
   overwrites `valid_time` with the ask, so its GFS donor is the asked hour, not the frame's. Arm 1 at +336 h serves ICON 18Z
   filled from GFS 03Z, 9 h apart, in 131 cells worldwide (0 in the Gulf here). The static filled frames take the donor at the
   frame's own hour (`frame_set_fill`), so a held /grid frame and its static twin differ. Fix candidate: look the donor up at the
   product's served time.
4. **Arm 3 (GFS stand-in) settles the label and the field, at a cost.**
   - The status line reads "Showing Sun 7 PM: the nearest stored forecast (GFS stand-in beyond this model's range)", same-hour
     data, Gulf 66 of 70, no locked blend touched.
   - Cost (a): the seam is the model gap. Stepping from the model's last hour to the stand-in moves heights by about 9x a normal
     3-h step (median 0.39 m vs 0.04 m; p95 1.9 m vs 0.4 m worldwide; Gulf 0.12 m vs 0.02 m ICON, 0.26 m EURO).
   - Cost (b): as prototyped (inside the hold), it misses the first 3 h past the tail. The ordinary nearest-stored window
     answers +330 h with the 2-h-old ICON frame ("Loading …"). A shipped arm 3 needs the rule there too: past the lane's end, a
     stored frame further than the lattice half-step loses to the GFS frame at the ask.
   - Not built, for the owner's choice: a trend-carried hold (the last frame + the GFS change since) would step exactly like
     GFS's own 3-h step (median 0.044 m) by construction. It extends the LOCKED ICON/EURO blend, so it is the owner's word only.
5. **EURO's first tail hour differs between the two paths.** Asked 11-04T15Z, /grid serves the native 12Z frame (3 h older,
   authoritative-first); the static index picks the exact 15Z estimated frame. Every other EURO tail hour matches node for node.
   It is the native-to-tail boundary on EURO's 6-hourly lattice past 144 h. Owner: static-frames / resolver.
6. **`FRAME_TAIL_DOWNLOAD` works as designed.** It moves every ICON/EURO tail hour from not_local to built, ICON exact
   against /grid.

## Not measured / limits
- Production's own 10-deg ICON/EURO products (masks, values): lab stand-in only.
- The browser rendering: labels are the client's pure function, not a screenshot.
- The EURO filled set (lab coverage).
- Live read-backs after any flip.
- One run (2026-10-25T12Z) and one NOW.

## Reproduce
From the repo root, with `FRAMES_BASE` = the public weather-frames object prefix. On this machine Python also needed
`REQUESTS_CA_BUNDLE` = certifi plus the sandbox's `NODE_EXTRA_CA_CERTS`.
```
python frontend/scripts/offline-backend/day14_arms.py fetch --copy <copy>
python frontend/scripts/offline-backend/day14_arms.py build --copy <copy> --store <store>
python frontend/scripts/offline-backend/day14_arms.py arm 0 --store <store> --out arm0.json     # 1, 1u, 3 likewise
python frontend/scripts/offline-backend/day14_arms.py publish --store <store> --out arm2.json
python frontend/scripts/offline-backend/day14_arms.py seam --store <store> --out seam.json
TZ=America/New_York node frontend/scripts/offline-backend/day14_labels.mjs arm0.json arm1.json arm3.json
```

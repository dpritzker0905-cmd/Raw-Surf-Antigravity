# HANDOFF 2026-07-22 EVE (Opus 4.8) — the EURO Gulf partition root-cause + fix, wind/switch/toggle fixes, frontend transients

Base was `7a50c437`. HEAD is now **`0b7d6376`** (`HEAD==origin/dev`). Autonomous arc across marine switching,
wind scrub, and the **EURO coarse Gulf** headline. The Gulf was **root-caused** (the coarse-tier data is
fundamentally broken — see below) but my ingest fix FAILED and was reverted; **the user's actual issue was fixed
in parallel** by the mid-tier ceiling. Shipped this session: switch-strand + instant-commit + wind-hour fixes
(all live-verified) + the diag that cracked the Gulf; the partition GFS-fill was tried and reverted.

## 0. BINDING RULES (applied)
forensics-not-guessing · Jacobian (isolate the ONE variable) · study memory + 3mo of commits before touching a
subsystem · instrument + kill-switch + A/B · unit AND live tests · **probe the served DATA at the exact cells,
never a proxy** · **INSTRUMENT rather than guess when static analysis is exhausted** (the DIAG that cracked the Gulf).

## 1. ★★★ THE EURO COARSE GULF (Bertha) + ROSS SEA — ROOT-CAUSED + FIXED `71c7dc69`
**USER-REPORTED (all session):** zoomed out, the EURO `waves` heatmap inflates the Gulf of Mexico (~4-5ft where
reality/GFS is ~1.5ft) and does NOT fill the Ross Sea; correct at z≥5 (mid tier), wrong at z<5 (coarse tier).

### The 6-approach saga (DO NOT repeat 1-5)
| # | Commit | Approach | Why it failed |
|---|---|---|---|
| 1 | `0fcde49c` | block-mean the height | can't invent ocean subcells the mask lacks |
| 2 | `bedc0def` | route coarse `waves` CMEMS→ecmwf_opendata | ecmwf_opendata ALSO masks the Gulf |
| 3 | `7a50c437` | GFS-fill masked cells from the GFS coarse grid | **GFS raw TOTAL is masked too** |
| 4 | `77b712b2` | fill was 429-stranded → reuse stashed NOAA grid | got GFS data in, but still `filled 0` |
| 5 | (diag) `2901c8e9` | instrument the fill's 0-result | ✅ this CRACKED it (below) |
| 6 | **`71c7dc69`** | **reconstruct the total from GFS PARTITIONS** | ✅ **the real fix** |

### The DIAG that cracked it (run 29948647704)
`DIAG={cell_hit:612, cell_miss:0, time_miss:0, masked_seen:4615, gfs_masked:4615, filled:0}`.
Cells + times align PERFECTLY (as static analysis + a served-data repro both said). filled=0 ONLY because the
raw GFS **TOTAL (HTSGW / `wave_height`)** is masked at every cell ECMWF masks. **GFS masks the Gulf TOTAL
identically to ECMWF** — the entire "GFS carries the Gulf" premise was wrong at the raw-total level. (The earlier
served-data repro filled 126 because the SERVED GFS product's total is ALREADY reconstructed downstream.)

### The reconciliation (proven live)
GFS-Wave GRIB carries **PARTITIONS** — WVHGT (wind-wave) + SWELL1 + SWELL2 — and they ARE valid at the Gulf
(live probe: GFS coarse Gulf `swell_1=0.54, swell_2=0.30, wind_waves=0.60`, all `is_valid=True`). The
**normalizer builds GFS's served `waves` total FROM the partitions** (served GFS Gulf `waves=0.73m`). The ECMWF
wave stream is **TOTAL-only** (no partitions), so the normalizer can't reconstruct EURO's Gulf → it stays masked
→ the frontend inflates the hole = the 4-5ft. **Ross Sea = same story** (coarse south edge −69.7°, Antarctic cells
masked the same way).

### THE PARTITION FIX `71c7dc69` — TRIED, FAILED, REVERTED (`0b7d6376`)
Hypothesis: reconstruct the GFS total from its PARTITIONS (Hs=sqrt(Hww²+Hsw1²+Hsw2²)) when the raw total is masked.
Shipped `71c7dc69`, baked (run 29963037253). **The DIAG still logged `filled:0`** — `{masked_seen:4615, time_miss:142,
gfs_masked:4473, filled:0}`. The fix READ the partitions (keys confirmed in `noaa_gfs_wave_fetcher` series_keys) and
still filled 0 → **the raw GFS partitions are masked at the Gulf too**, not just the total. So it was **REVERTED in
`0b7d6376`** (a dead premise like the 4 before it — do not re-ship). The served GFS Gulf (0.73m, valid partitions) is
a NORMALIZER **nearest-neighbor reconstruction** from valid cells outside the masked region — NOT raw data. The
earlier "repro fills 126" used the SERVED (already-reconstructed) product; the real ingest fill uses the RAW
(fully-masked) grid. **No exact-match ingest GFS-fill can work.**

### ✅ THE USER'S ISSUE WAS FIXED BY A PARALLEL SESSION (mid-tier ceiling)
While I chased the coarse fill, a parallel session shipped the REAL user-facing fix (DEPLOYED + live-verified):
raise `MARINE_MID_RES_MAX_SPAN` (+ 4 lockstep FE/engine/arbiter sites) to **120°** so the correct **2° `global_mid`**
tier serves down to ~z3 — EURO shows correct Gulf colors at z3-z6.5 (the user's z4.88 report). Commits
`555d2eb6`·`f50f80bc`·`06b3dbc2`·`6c206234`. See [[marine-storm-vanishes-zoomout-midtier-ceiling-2026-07-22]].

### ⚠️ OPEN FOLLOW-UP (low priority)
The 10° `global_coarse` tier still masks the Gulf at TRUE world zoom (span >120°, z<3). A real fix must replicate
the normalizer's **nearest-neighbor** reconstruction (fill EURO from the nearest VALID GFS cell) or inpaint EURO's
masked cells directly — UNTRIED. Verify by probing the served `global_coarse` `is_valid` at lat20/-90 (NOT the
provider/health lane). The GFS-fill code (`7a50c437`+`77b712b2`) is a NO-OP in prod (fills 0) — a cleanup candidate.

## 2. FRONTEND fixes shipped this session (all verified live, on origin/dev)
| Commit | Fix | Kill switch |
|---|---|---|
| `8861b920`+`7a1e9c47` | **coarse-tier model/layer SWITCH strand** (couldn't switch GFS↔EURO↔ICON at z<5) — bounded strand watchdog | `__RAW_DISABLE_MARINE_STRAND_WATCHDOG__` |
| `df6ad2f2` | **instant cache-hit layer commit** advances `lastFetchedLayerRef` (wrong-layer A→B→A toggle) | `__RAW_DISABLE_INSTANT_COMMIT_LASTLAYER__` |
| `948d8064` | **wind stale-HOUR guard** on the primary attemptFetch + base-lane (pan-then-scrub race) | `__RAW_DISABLE_WIND_PRIMARY_HOUR_GUARD__` |
Details: [[marine-switch-strand-watchdog-2026-07-22]], [[wind-scrub-hour-findings-2026-07-22]]. Two forensic-hunt
workflows found these (adversarially verified). FE suites: 902 map-component + 159 wind + 73 coordinator green.

## 3. FRONTEND TRANSIENTS — characterized, NOT fixed (fragile area; user to decide)
Both are cold-start / tier-swap transients in a **20-fix fragile zoom-out area** (`e8f10955`, `74b1b1dd`,
`56a6f2f4`, …). I root-caused both but did NOT ship (regression risk > value for narrow transients):
- **Rectangle on zoom-out (#3):** at z9 EURO commits a **14° regional tile**; on a COLD coarse base the tile
  renders clamped (`__coarseBridgeActive:false`, `_coarseBaseData:null`) until the coarse world fetch lands
  (~2-3s). Reproduced with a forced-cold LRU: 36 frames of `bridge:false` at z≤6. Warm session bridges fine
  (coarse re-caches in ~222ms). Residual = inherent activation-fetch latency. Fix options: proactive coarse
  prefetch, or gated render-suppression (trades rectangle for a brief blank — the competing bug those commits
  fought). **Needs a user UX call.**
- **Halos on zoom-out:** the GPU mask-based `__HALO_DEBUG__` (+ a transient peak-detector I built) reads
  `realBleed ≈ 0` settled AND during the zoom → NOT a mask bleed; a sub-second tier-swap transient.
- **Jacobian:** BOTH likely improve once the coarse tier has CORRECT data (the partition fix) — the masked
  coarse Gulf/coast cells are what render as inflation + transient artifacts on swap-in.
Detail: [[euro-gulf-0fill-and-rectangle-2026-07-22]].

## 4. OPEN QUEUE
1. **VERIFY the fix bake** (`29963037253`, monitor `bcu0flgf5`) — expect DIAG `filled>0` + served Gulf flips. THE live thread.
2. **Frontend rectangle #3 / halos** — deferred; re-check after the fix lands (may self-resolve); user UX call on the render-suppression option.
3. **Disposition of the dead GFS-fill layers** — `0fcde49c`/`bedc0def`/`7a50c437`/`77b712b2` are now all superseded by the partition logic; harmless (the partition path subsumes them) but the code carries dead premises — a cleanup candidate.

## 5. LANDMINES / LESSONS
- **The served product ≠ the raw ingest grid.** GFS's served `waves` Gulf is reconstructed from partitions; the
  raw `wave_height` total the fill reads is masked. A served-data repro that "works" can hide a raw-data bug —
  INSTRUMENT the real ingest (the DIAG) when static analysis is exhausted.
- **`gh run view --log` only works AFTER a run completes** — you cannot read the DIAG mid-run; monitor for completion.
- **scheduler.py is AT the 800-LOC hard gate** — every marine ingest edit must be net-zero (walrus + merged log).
- **The provider/health lane LIES about the coarse Gulf** — always probe the served `global_coarse` `is_valid`.
- Frontend cold-start transients (rectangle/halos) need a forced-cold state to reproduce; the warm session hides them.

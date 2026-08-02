# HANDOFF 2026-08-01-I — from a 4-part audit to implementation

**Branch:** `dev` · **Base at handoff:** `9d14870e` · **Session shipped 11 commits** (`0f7076a6..9d14870e`).
⚠️ A **concurrent session** held 11 files uncommitted throughout (`spot_conditions.py`,
`point_resolution.py`, `test_rating_composition_parity.py`, routes/…). **Nothing here touched them.**
Stage BY PATH; re-check `git status` before you commit.

---

## §1 — READ THESE FIRST

| doc | what it is |
|---|---|
| `docs/research/AUDIT-2026-08-01-MASTER-final-pass-and-sync-upgrade-path.md` | **START HERE.** All 4 audits consolidated, ~70 findings with status, the M1–M13 leverage table, and the synchronized upgrade path |
| `…-v4-archaeology-forensics-jacobian.md` | archaeology (2,861 commits), the fourth forecast path, the ensemble |
| `…-v3-forensic-simulation-audit.md` | mutation testing of the sim (12 mutations) |
| `…-v2-jacobian-lens-deep-audit.md` | the Jacobian census; corrections to the recorded memory |

---

## §2 — WHERE THE UPGRADE PATH STANDS (measured `9d14870e`)

**Item count 11/20 · leverage-weighted ~30%.** The gap is the point: **everything shipped is
"make the system honest and guarded". The accuracy work is entirely ahead.**

```
M1  fourth forecast path      *****  DONE
M2  shore-normal coverage     *****  OPEN — and the audit's plan for it was REFUTED (see §4)
M3  ensemble / probabilistic  *****  OPEN
M4  spectral decomposition    ****   HALF DONE (composition in, ingest gated — §3)
M5  refraction Kr             ****   OPEN
M6  self-invalidating docs    ****   OPEN (measured down to 5 stale SHAs — small)
M7  bathymetry 0.25deg->15s   ***    OPEN
M8  flag-lane guards          ***    DONE
M9  two-veto coupling         ***    RETRACTED — not a defect (§4)
M10 pin the unpinned          ***    2 of 3 (3rd blocked on their file)
M11 revive code-graph MCPs    ***    OPEN (external server bugs)
M12 data plane                **     OPEN — 0.0 forecast points
```

Verify any row yourself — every claim below has a command.

---

## §3 — DO THIS NEXT: M4, and it is gated on ONE probe run

**The composition half is shipped and dark.** `services/weather_pipeline/period_bands.py` turns
ECMWF's six period bands (`h1012 h1214 h1417 h1721 h2125 h2530`, free on the endpoint
`ecmwf_opendata_fetcher` already uses) into the `{h,tp,dir,kind}` shape `estimate_surf_partitioned`
consumes. **Nothing imports it yet.**

**Measured value** — two band sets, identical total Hs (1.75 m) *and* identical blended period
(11.5 s), i.e. indistinguishable to today's chain:

```
groundswell-dominated   8.3 ft 80.2 good  ->  9.2 ft 76.8 good    -3.4
chop-dominated          8.3 ft 80.2 good  ->  7.4 ft 47.3 fair   -32.9  LEVEL CHANGE
```

### ⛔ THE GATE — run this before writing any ingest

```bash
python backend/scripts/ecmwf_band_closure_probe.py
```

* **`BANDS_CLOSE`** → extend `LAYER_PARAMS["waves"]` in `services/ecmwf_opendata_fetcher.py:51`
  with the six band params, decode them in the loop at `:128` (same shape as `want_h`/`want_pk`),
  emit them on the point dict, wire `bands_to_partitions` at the composition point. Ship behind a
  flag at `'0'` in **all three lanes**, A/B census before the flip.
* **`BANDS_EXCEED_TOTAL`** → **STOP.** `period_bands`' residual would fabricate energy. Rethink the
  residual before any ingest.
* **`VOID` (exit 2)** → you have no decoder. **That is the expected result on a Windows/py3.14 box** —
  ECMWF packs these with **CCSDS/AEC (GRIB2 template 5.42)**, which needs ecCodes built with libaec.
  `pygrib` in CI and on Render has it. **Run it there.** Do not write ingest blind.

---

## §4 — TWO PLANS THE AUDIT PROPOSED THAT MEASUREMENT KILLED

Do not re-propose these without new evidence.

1. **Scheduling `build-shore-normals.yml` on a cron (M2).** `build_shore_normals.py` has **0**
   matches for RNG/wall-clock → the fit is deterministic; a spot missing from the asset was
   **rejected** by the gate, not skipped (Bondi re-fitted in 22.5 s and was rejected
   `ambiguous_coastline` a second time; of 24 sampled, 0 were merely missing). **0 spots created
   since the asset build date.** A weekly rebuild burns ~4.3 h of a public NOAA endpoint for
   nothing. ⇒ replaced by `scripts/shore_normal_coverage_census.py` (verdict today: `NO_NEW_WORK`).
   **Capturing M2's 49.1% coarse share needs a different SOURCE** — GSHHG or OSM coastline as a
   *producer* (see v2 §4.1; GSHHG is public-domain-sourced, unblocking the ODbL objection), or
   moving pins. Not a rebuild.
2. **M9 "two-veto coupling".** RETRACTED. `oversize_thresholds` tier 3 (`OVERSIZE_ABS_START_M = 8.0`
   = 26.2 ft, "know nothing about the spot") is a **documented deliberate fallback**, and the map
   band's own comment *rejects* passing `break_depth_m` because `depth_fn` supplies SHELF depth
   (p50 157–234 m) → a ~100 m ceiling, silently inert, i.e. worse. Not a defect.

---

## §5 — QUEUE / DEBT, with what is verified vs still a LEAD

**Verified open (commands in the audits):**
* **M2 shore normal** — `779/1587 = 49.1%` still on the coarse 0.25° bearing; p50 error 24.7°,
  p90 80°, **>90° at 7.5%**; LEVEL differs at **58.1%**. Asset matches at `MATCH_RADIUS_KM = 1.0`
  and rebuilds only by `workflow_dispatch`.
* **M7 bathymetry** — runtime grid is ETOPO**1** at `dlat=0.25` (~27.8 km) while the repo already
  builds ETOPO 2022 **15 s** for `shore_normals.json`.
* **M5 Kr** — `def refraction` absent; Kr assumed 1.0. Measured median **0.797** over 385,651 CDIP
  hours, 1.75× swing at a fixed site.
* **M3** — `ifs/waef` is a **50-member** ensemble, free, all 13 params, members byte-distinct,
  16 bits/value (verified by GRIB2 Section-5 parse). The sim returns one number. At ±10% spread
  **2 of 4 spots span multiple LEVELS**; at ±30%, all four.
* **3.3 blocked** — `test_rating_composition_parity.py:356` asserts `>= 4` with message *"all five
  rating surfaces must be listed"* and lists 4; the live `/spot-ratings` route
  (`routes/weather.py:389`, gate at 509–527) is absent. **Their file — coordinate first.**
* **Phase 0 remnants** — `render.yaml` is an unsynced Blueprint describing no deployed service
  (adversarially confirmed); decide sync-or-delete.

**LEADS — agent-measured, NOT re-run. Verify before acting:**
`SURF_HEIGHT_H110` guard passes with the flag ON · 246 non-forecast CI-orphans · `conditions_labels.py`
CI coverage · 4 reverted-and-never-restored guard files · `swell_exposure_fraction` wired to nothing ·
the ledger auditor scoring reverted commits as shipped (verifier corrected it to **8 of 666**, and 2
of those were re-landed — smaller than first claimed).

---

## §6 — WHAT SHIPPED THIS SESSION (all mutation-proven)

| commit | what | proof |
|---|---|---|
| `0f7076a6` | lane-parity saw 4 of 8 flags; pilots lane unread | drift mutation: 8 passed → caught |
| `0ae96ae3` | `/api/surf-conditions` served OFFSHORE as surf (**−34.1%…+29.7%**, 29 spots) | pass-through mutation: 4 of 10 fail |
| `5707b96b` | provenance dropped at `get_full_conditions` | key-removal red |
| `41c67116` | NaN → `'epic'` (**two** input paths) | both guards removed: 8 of 12 fail |
| `8e76a981` | geometry cache key unpinned (487 pairs <1.1 km) | 2 dp mutation: 3 of 4 fail |
| `c08acaec` | shore-normal rebuild **detector** (replaces the refuted cron) | 3 of 9 fail |
| `62691c88` | **9 undeclared science switches** incl. all 3 vetoes + a kill switch that does not kill | both directions fail |
| `629ff46c` | **309 CI-orphans**; 63 forecast-chain files adopted into a new parallel lane | floors 63/480 |
| `484e72ba` | period bands → partitions (M4 composition half) | clamp + NaN mutations fail |
| `673ae091` | band-closure probe (M4 gate) | 6 of 12 fail |
| `9d14870e` | `surf_science_audit` graded its **own env**, reporting 2 defects production doesn't have | control: explicit `0` still fails |

**CI now: composition lane 103 files / 1189 passed · forecast-chain lane 63 files / 486 passed.**
Was 96 files / 1096 before this session.

⚠️ **`ci.yml MIN_FILES` is still 96** while committed is ~101. Deliberate: the working tree shows
one more because it holds the concurrent session's **untracked** test file, and this repo has a
recorded scar (`6c4ab178`) from setting a floor off a shared tree. **Raise it from a quiet tree.**

---

## §7 — WORKING RULES THAT EARNED THEIR KEEP HERE

1. **Assert the mutation LANDED.** An inert mutation is indistinguishable from a missed guard —
   a `_sim_flag` default of `"1"` made one of mine a no-op and it read as a coverage gap.
2. **A separation only tests a coarser key if it lands INSIDE one of its cells.** My first geometry
   test used 34.0000/34.0100 — distinct at 2 dp — so it passed under the very defect it guarded.
3. **Every probe needs a known-present control.** Mine 404'd every ECMWF ensemble stream until the
   control (`ifs/enfo`) failed and revealed the wrong URL stem (`-ef`, not `-fc`).
4. **`| tail` swallows the exit code.** Check `$?` on the bare command.
5. **Test the blast radius of your own change** — that is how `5707b96b` was found.
6. **Verify in a clean worktree with no `dev.db` and `fastmcp` blocked** before setting any floor.

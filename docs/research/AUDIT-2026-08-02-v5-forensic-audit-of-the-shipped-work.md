# AUDIT v5 — forensic audit of 2026-08-02's shipped work

- **Date:** 2026-08-02
- **HEAD at audit time:** `9553991d6c71b7a8115f39b8e050189b70e00a1f` (branch `dev`, committed 2026-08-02 10:48:58 -0400)
- **Mode:** READ-ONLY adversarial verification. Every finding below was independently re-executed by a
  second agent whose brief was to REFUTE it. 42 candidate findings were filed; **19 survived**,
  **23 were struck** (§4). Mutations were made only on copies, in `git worktree`s, or via env
  switches restored in a `finally`; the tracked tree at the end of the audit is byte-identical to
  the snapshot at the start (same 11 `M` + 4 `??` entries held by the concurrent session).
- **Commits under audit** (all four landed 2026-08-02, none previously audited):
  - `a9bd6e35` — shore normal gets its own 3 km borrow radius (`BEARING_RADIUS_KM`) while break
    depth stays at `MATCH_RADIUS_KM = 1.0`; `_scan`'s bucket span became derived; kill switch
    `SHORE_NORMAL_BEARING_RADIUS_KM`.
  - `429fd0fc` — declared that flag in `.github/workflows/sim-parity-monitor.yml`.
  - `6d8376f3` — `.github/workflows/ecmwf-band-closure-probe.yml` (dispatch-only GRIB probe).
  - `9553991d` — ECMWF period-band FETCH half in `services/ecmwf_opendata_fetcher.py`.

## What v5 covers that v1–v4 and the MASTER pass do not

| Prior artifact | Scope | Why v5 is not a repeat |
|---|---|---|
| `AUDIT-2026-08-01-sota-architecture-and-zero-regression-upgrade-path.md` | SOTA gaps, the M-table | v5 re-executes M5 and M7 at HEAD and **retires the M5 blocker as stale**; it closes Gap 2.7. |
| `AUDIT-2026-08-01-v2-jacobian-lens-deep-audit.md` | Jacobian over the pre-a9bd6e35 chain | v5's Jacobian is measured over the **split-radius** chain that shipped today. v2's R2 ("widen the constant") is now provably the WRONG fix — see §3. |
| `AUDIT-2026-08-01-v3-forensic-simulation-audit.md` | The sim's guards | v5 re-tests the two recorded v3 misses at HEAD: **the cache-key miss is CLOSED**, the NaN→`epic` path is unreachable through the sim (§3). |
| `AUDIT-2026-08-01-v4-archaeology-forensics-jacobian.md` | Archaeology; decoded ensemble metres | Already superseded by MASTER on magnitudes. v5 does not revisit it. |
| `AUDIT-2026-08-01-MASTER-final-pass-and-sync-upgrade-path.md` | Re-execution of every claim at `dd3c8614` | **v5 audits four commits MASTER could not see**, plus the blast-radius census that all of them inherited from a stale local DB (§2, finding 2). |

---

## §0 PROOF STANDARD

Every quantitative statement in §1–§4 was produced by executing code at HEAD, not by reading it.
The house rules that applied:

1. **A control in both directions.** A green run alone proves nothing. Every mutation battery
   carries a known-failing control (a mutation the guard MUST catch) and a known-passing control
   (an unmutated baseline). Where a battery reported a MISS, at least one control in the same lane
   reported a CATCH — otherwise the miss is indistinguishable from a broken harness.
2. **Assert the setup landed.** Env overrides were re-read through the production accessor
   (`shore_normal_asset._bearing_radius_km()` must return the intended value); file mutations were
   re-grepped on disk; injected asset entries were re-scanned before any count was taken.
3. **Count values, not timestamps or file presence.**
4. **A fit graded against another fit measures self-consistency.** Where the only available grader
   shared a source with the thing graded, that is stated and the number is not used as evidence.
5. **Absence of THE fix is not absence of A fix** — the symptom was checked, not the symbol.
6. **Restore in a `finally`, then re-grep.** (The 2026-08-02 morning scar: a harness crashed between
   mutate and restore and left a mutation on disk.)

**Number provenance legend, used throughout:**

- **[M]** — measured today, at HEAD, by this audit.
- **[I]** — inherited from an earlier session or from the commit message; **not** re-measured today.
  Every `[I]` number is flagged again where it appears.

The two `[I]` numbers that matter most and that nobody re-ran today:
**C3** (OSM-graded borrowed bearing, n=113, coarse p50 38.7° → borrowed 12.6°, better 73.5%) — the
OSM coastline source is not in-repo; and **C5** (band-closure probe, n=20494, p50 0.5549,
max 1.0012, 0.0% exceeding) — gated on `pygrib`, which has no wheel for this box's Python.

---

## §1 THE JACOBIAN — surviving findings ranked by sensitivity × uncertainty

Sensitivity = how far a **served** number (or a number a human will size work against) moves.
Uncertainty = how badly we can be wrong about that input without any instrument saying so.

| Rank | Item | Sensitivity (measured) | Uncertainty (measured) | Leverage |
|---:|---|---|---|---|
| 1 | **F1 — the parity monitor collects `SHORE_NORMAL_BEARING_RADIUS_KM` and never compares it** (`test_flag_lane_parity.py:258`) | No served number. But a monitor left at 1.0 km while ingest writes at 3.0 km pages on every spot that gained a bearing — **LEVEL disagrees on 38.0–42.9% of evaluations [M]**, signed both ways | **Zero uncertainty about the gap, total about the state**: drift the value or delete the line and the suite stays at **13 passed [M]**, with 5 positive controls red in the same lane | ★★★★★ |
| 2 | **F2 — the whole a9bd6e35 blast-radius census was taken on `dev.db`** | Served numbers unchanged. The **recorded** blast radius is 2.5× high: 231 spots → **91 [M]**; coarse share 47.4→33.0% → **22.2→17.1% [M]**; 779/1587 coarse → **413/1773 [M]** | **64.5% of the counted population is phantom or nonexistent [M]** (94 already `etopo` at their production coordinate, 55 absent from production). dev.db→live drift p90 = **3.470 km [M]**, larger than the 3 km effect under test | ★★★★★ |
| 3 | **F3 — a borrowed bearing is indistinguishable from a measured one** (`spot_geometry_readiness.py:76`, `surf_point.py:85-87`) | The bearing is the #1 Jacobian variable. Perturbing it by the borrowed residual (12.6° **[I]**) over the borrowed class, n=1840: **LEVEL changes on 33.2% [M]**, \|ΔQ\| p90 12.6 pts | Borrow distance p50 **1.981 km**, max **2.996 km [M]**, and **no served field carries it**. `source_at()`, written for this, has **zero production callers [M]** | ★★★★ |
| 4 | **F4 — both CI ratchets sit below their live counts** (`ci.yml:462`, `:585`) | Two forecast-chain files could stop running with the gate green. Chain **65 files / 504 collected** vs `MIN_FILES, MIN_PASSED = 63, 480`; composition **102 / 1244** vs `96, 1090` **[M, clean worktree]** | The chain slack is **today's**: 63 files at `dd3c8614`, 65 at HEAD, and `ci.yml` is in none of today's four commits **[M]** | ★★★★ |
| 5 | **F5 — the admin flag registry cannot see either shore-normal kill switch** (`routes/admin/surf_forecast.py:31`) | The `/admin/surf-forecast/status` board is the **only** instrument that can read Render — the lane no test can check. 6 chain-read switches are absent, incl. both documented kill switches for the #1 Jacobian variable | Total by construction: the guard filters on a hardcoded FILE list (`_RATING_SURFACES`) that omits `shore_normal_asset.py`, `surf_point.py`, `ecmwf_opendata_fetcher.py`, so widening prefixes alone leaves the scan at **17 flags [M]** | ★★★ |
| 6 | **F6 — `sim_compare`'s "(coarse bearing — median 22.3° off)" is false for ~349 live spots** (`sim_compare.py:321`) | A user-facing MCP caveat on the headline sentence, plus an "indistinguishable, treat as equal" recommendation. **19.7% of the live catalogue; 52.7% of all `degraded` spots [M]** | Mostly pre-existing (~257 before), **+36% today [M]**. The verdict conflates a coarse bearing with a missing depth and with non-coastal | ★★★ |
| 7 | **F7 — `surf_transform.py:14` is stale on both of its subjects** | Bottom friction is **already implemented** (`shelf_dissipation`, default on); the per-point shore normal Kr "needs" has been threaded since 2026-07-17. `_height_exposure_factor` moves the served height by **−27.8% to −30.0% at 75° off-normal, 8/8 spots [M]** | An implementer reading it would fit Kr against a chain they believe is direction-blind and **double-count direction** | ★★★ |
| 8 | **F8 — `ECMWF_PERIOD_BANDS` is declared in the lane that never reads it and absent from the lane that runs 2 of 3 EURO wave fetches** (`forecast-ingest-pilots.yml`) | Zero today (flag is `'0'` everywhere, composition half unwired). On flip: global coarse EURO carries bands, every 0.25° regional tile does not — **the same coast decomposes its sea differently by zoom level** | The pilot guard iterates the **INTERSECTION** (`test_flag_lane_parity.py:240`), so an absent flag can never contradict anything. Documented flip left the suite at **13 passed [M]**; ingest-lane control red | ★★ |
| 9 | **F9 — `_nearest`'s asset-before-overlay precedence lets a 1–3 km asset entry outrank a 0 km overlay bearing** (`shore_normal_asset.py:313-318`) | Zero today (all 5 live overlay entries are depth-only **[M]**). Latent ceiling on 231 spots: measured displacement **30.0° to 147.8° [M]** through production `resolve_surf_geometry` | Refutes C8's stated MECHANISM ("nearest-wins, so a larger radius can only ADD farther candidates") across the store boundary. No guard has a full overlay entry at 0 km vs an asset entry at 2 km | ★★ |
| 10 | **F10 — 6 composition switches escape the registry guard via two routes** | `SURF_HEIGHT_H110` (the "BOTH OR NEITHER, +25.5%" landmine) escapes by FILE scope; `SURF_V3_EXPOSURE/KOMAR/MAGNETS/SHELF_RECAL` escape by the `_v3(flag)` INDIRECTION inside a guarded file | All 6 sit at code default in every git-visible lane **[M]**, so impact today is zero. Render is the one lane not in git | ★★ |
| 11 | **F11 — `# covered by the next test` is false for 4 of 6 collected prefixes** (`test_flag_lane_parity.py:133`) | None. An undeclared `MARINE_`/`SPOT_RATINGS_`/`SHORE_NORMAL_`/`ECMWF_` flag produces **0 failures**; an undeclared `RATING_` one produces **3 [M]** | A comment asserting coverage that does not exist — the repo's own recorded class | ★ |
| 12 | **F12 — queue item #22 is closed by `0a00766f`; CLAUDE.md:45's "height-blind" is stale** | Zero forecast sensitivity. Cost is queue credibility and a binding project rule that describes a fixed defect | `0a00766f` is an ancestor of `dev` **[M]**; the sim's height sweep gives **4 distinct qualities over Hs 0.3→20.0 m** with a negative control returning 1 **[M]** | ★ |
| 13 | **F13 — `_scan` never wraps the antimeridian**; **F14 — `lru_cache` capacity halved, sizing comment imprecise** | Zero: nearest catalogue coordinate to ±180 is Funafuti at 179.198 (~88 km, ~30× the radius) **[M]**; cache is 2.00 entries/coordinate, 3168 of 20000, **zero evictions, ~4.6 MB [M]** | Both pre-date or are inert. Cheap hardening, not defects | ☆ |

---

## §2 FINDINGS

### MEDIUM

#### F1 — The parity monitor's `SHORE_NORMAL_BEARING_RADIUS_KM` is collected but never compared
**Refutes: nothing. Invalidates the guarantee written in `sim-parity-monitor.yml`.**
`backend/tests/test_flag_lane_parity.py:258` (test at `:248`, scope at `:66`)

**What it is.** `429fd0fc`'s entire functional content was adding one line to
`sim-parity-monitor.yml`. `_workflow_flags` collects **five** flags from that file
(`RATING_TIDE`, `RATING_OBS_GATE`, `RATING_LOCAL_SIZE`, `SURF_PARTITIONS`,
`SHORE_NORMAL_BEARING_RADIUS_KM`) and
`test_the_parity_monitor_grades_with_the_same_composition_it_measures` compares **four** — line 258
skips anything outside `COMPOSITION_PREFIXES = ("RATING_", "SURF_")` (confirmed at HEAD:
`DRIFT_PREFIXES` has six entries, `COMPOSITION_PREFIXES` has two). No other test in the repo opens
`sim-parity-monitor.yml`.

**Exact evidence [M]** — clean `git worktree` at HEAD, every mutation asserted to have landed,
restore in a `finally`, `git status --porcelain .github/` empty afterwards:

```
BASELINE                                                        rc=0  13 passed
monitor  SHORE_NORMAL_BEARING_RADIUS_KM '3.0'->'1.0'            rc=0  13 passed   *** MISS ***
monitor  SHORE_NORMAL_BEARING_RADIUS_KM DELETED                 rc=0  13 passed   *** MISS ***
monitor  RATING_LOCAL_SIZE  '1'->'0'      [CONTROL, same lane]  rc=1   1 failed   CAUGHT
monitor  RATING_OBS_GATE    '1'->'0'      [CONTROL, same lane]  rc=1   1 failed   CAUGHT
monitor  SURF_PARTITIONS    '0'->'1'      [CONTROL, same lane]  rc=1   1 failed   CAUGHT
precompute SHORE_NORMAL_BEARING_RADIUS_KM '3.0'->'1.0' [CTRL]   rc=1   1 failed   CAUGHT (two_ingest_lanes_agree)
precompute ECMWF_PERIOD_BANDS '0'->'1'                 [CTRL]   rc=1   1 failed   CAUGHT
```

Five positive controls red in the same lane; both shore-normal-in-the-monitor mutations green. The
prefix filter is blind, not the test.

**Reachability.** `shore_normal_asset._bearing_radius_km()` reads the env **per call** (verified at
HEAD, lines 322–331), the monitor runs the sim in-runner with `--fail-on-divergence` against
precomputed frames, and 91 live-catalogue spots change bearing between 1.0 and 3.0 **[M]**. So a
split is a real composition split, not a cosmetic one.

**Two corrections to the obvious fix, both measured.**
1. Adding `SHORE_NORMAL_` to `COMPOSITION_PREFIXES` takes the suite to **`rc=1, 2 failed` [M]**:
   `test_every_science_flag_a_workflow_sets_is_declared_at_all` breaks for both ingest lanes because
   the flag is absent from `_RATING_FLAGS`, and it **cannot** be added there while
   `test_registry_parses_and_is_not_empty` asserts `entry[0] in ("0","1")` and this flag's default
   is the scalar `'3.0'`.
2. The three-lane KILL documented in `forecast-ingest.yml:72` names **forecast-ingest + precompute +
   Render** — the monitor is a silent FOURTH lane the ingest comments never mention.

**Fix.** Give the monitor comparator its own scope: `MONITOR_PREFIXES = DRIFT_PREFIXES` minus an
explicitly named `SPOT_RATINGS_PRECOMPUTE*` exemption ("the monitor grades, it does not
precompute"). Do **not** widen `COMPOSITION_PREFIXES`. Separately, either widen the registry's
default column to accept a scalar or add a named exemption mirroring the existing `_REGISTRY_EXEMPT`
entries for `SURF_SHELF_CF_SCALE` and `SURF_V3_JACK_MAX`.

**Cost if left.** An incident kill executed under time pressure follows the workflow comment, which
names three lanes; the monitor is missed; the monitor then grades at 1 km while production serves at
3 km and pages on **231 (dev.db) / 91 (live) correct spots**, with nothing red anywhere. The file's
own comment at `sim-parity-monitor.yml:118` promises this suite catches exactly that.

---

#### F2 — The blast-radius census that every artifact quotes was taken on `dev.db`, a snapshot that has drifted from production
**Refutes: C1 (as a statement about production).** C2 is unaffected and was reconfirmed on the LIVE
catalogue.
No single defective code line. The residue is in `shore_normal_asset.py:53` and `:74`,
`tests/test_shore_normal_borrow_radius.py:21`, the `a9bd6e35` commit trailer, both workflow comments,
and the MEMORY.md index line.

**What it is.** The A/B was run over `backend/dev.db`'s 1,587 rows. Production's catalogue, fetched
live through `sim_forecast.fetch_catalog()` (`catalog_source() == 'live_catalog'`), is 1,773 rows.

**Exact evidence [M]** — kill-switch A/B through production `resolve_surf_geometry`, restore
asserted (`_bearing_radius_km()` re-read as 3.0), controls held (an on-entry coordinate reads
`etopo` at both radii; mid-Pacific `(-30,-140)` reads `none` at both):

```
dev.db  (n=1587):  gain 231 (229 coarse + 2 none)   coarse 47.5% -> 33.1%
LIVE    (n=1773):  gain  91 ( 89 coarse + 2 none)   coarse 22.2% -> 17.1%
  transitions: 1354 etopo->etopo · 304 coarse->coarse · 89 coarse->etopo
               ·  18 none->none  ·   6 override->override ·  2 none->etopo

dev.db -> live coordinate drift, n=1293 name-matched:
  p50 0.000 km   p90 3.470 km   >1 km: 22.0%
decomposition of the 231 "gainers":
  94 PHANTOM (already etopo at their production coordinate — never coarse there)
  55 absent from the production catalogue entirely
  82 real
  => 149/231 = 64.5% phantom or nonexistent
```

Worked example: *New Smyrna Beach – Flagler Avenue* is `29.028, -80.921` in dev.db (nearest asset
entry 2.715 km → counted as a gainer) and `29.038081, -80.895559` in production (nearest entry
0.000 km → never coarse).

**Independent corroboration that the live frame is the right one [M]:** `asset_meta()` reports
`spots_considered = 1820`. Production's 76.4% one-kilometre coverage tracks the asset's
1386/1820 = 76.2% acceptance rate; dev.db's 50.5% is a pure drift artifact.

**The drift p90 (3.470 km) exceeds the 3 km effect under test.** That is a systematic bias, not
noise: a spot sitting ON its asset entry in production appears 2.7 km away in dev.db and is counted
as a new borrower.

**C4 re-measured on the 88 spots that really gain [M]** (8 swell dirs × 4 wind states, 2,816 evals):
LEVEL moved on **42.9%**, up 46.9% / down 53.1%, mean level delta −0.07, \|ΔQ\| p50 3.60 / p90 36.40
/ max 84.90. C4's qualitative verdict (a per-spot correction no constant could apply; a PRODUCT
EVENT) survives; its population does not.

**Not undisclosed, but not propagated.** The session's own topic memory already carries "Counts are
dev.db-specific… the *ratio* and the *error curves* travel; the *231* does not." It propagated
UNQUALIFIED into tracked source: `shore_normal_asset.py:74` says "Measured over the **live
catalogue**: 0 of the 808 already-covered spots change" — 808 is dev.db's 802 `etopo` + 6 override;
production's already-covered count is 1,360.

**Fix.** Re-run any geometry census against `sim_forecast.fetch_catalog()` / `sim_spots.query_spots()`
— which exists in-repo for exactly this reason and whose docstring says so. Amend the five
statements above to carry the production figures or the `dev.db` label. Add a guard that a census
reports `catalog_source()` alongside any percentage — but do **not** hard-assert
`== 'live_catalog'`, because that needs the Render app reachable and would void every offline census.

**Cost if left.** The next agent sizes follow-up work against a 2.5× overstated opportunity
(779/1587 = 49.1% coarse vs the live 413/1773 = 23.3%).

---

#### F3 — The readiness envelope's only disclosure of bearing quality vanished, and nothing replaced it
**Refutes: C6 (confirms it).**
`backend/services/weather_pipeline/spot_geometry_readiness.py:76`; root cause at
`backend/services/weather_pipeline/surf_point.py:85-87`.

**What it is.** `resolve_surf_geometry` stamps `shore_normal_src = "etopo"` on ANY asset hit at ANY
distance:

```python
_fine, _spread = _asset_normal_at(lat, lng)
if _fine is not None:
    normal, src = _fine, "etopo"
```

and `assess_geometry` treats `src == "etopo"` as fine unconditionally
(`elif src not in ("etopo",) and not str(src).startswith("override"):`, verified verbatim at HEAD).
So a bearing measured at the spot's own coordinate and one borrowed 2.996 km away are the same
string.

**Exact evidence [M]** — kill-switch A/B on one spot, restore asserted:

```
HEAD (3.0 km), New Smyrna Beach – Flagler Avenue, bearing borrowed 2.715 km:
  shore_normal_source : 'etopo'      shore_normal_deg : 64.9
  readiness           : 'degraded'   readiness_missing: ['break_depth']
  readiness_note      : "Degraded geometry: it has no nearshore break depth, so the
                         depth-limited size cap cannot apply."

CONTROL, SHORE_NORMAL_BEARING_RADIUS_KM=1.0 (pre-a9bd6e35), same spot:
  shore_normal_source : 'coarse'
  readiness_missing   : ['fine_shore_normal', 'break_depth']
  readiness_note      : "...it is using a coarse 0.25 degree shore orientation instead of
                         its own measured one; ..."

KNOWN-PRESENT CONTROL, entry at its own coordinate (Flagler Beach Pier):
  source='etopo' readiness='full'
  note: "Full per-spot geometry: this spot's forecast uses its own measured shore normal and
         break depth."
```

The clause that told a caller the bearing was not the spot's own is **gone for 231 spots** with
nothing added. Borrow distance for that class: **p50 1.981 km, p90 2.781, max 2.996 [M]**.

**Discriminability, measured properly.** The joint distribution of `(verdict, missing)` over
BORROWED (1–3 km, n=231) vs MEASURED (≤1 km, n=802) **[M]**:

```
('full',     ())                        borrowed   3   measured 568
('degraded', ('break_depth',))          borrowed 226   measured 220
('degraded', ('break_depth','coastal')) borrowed   2   measured   4
('degraded', ('coastal',))              borrowed   0   measured  10
```

**231/231 borrowed spots sit in a cell also occupied by measured spots.** The envelope discriminates
for exactly zero spots.

**Pre-existing, and widened.** At the old 1 km radius, **105 of 802** `etopo` spots (13.1%) already
borrowed (p50 0.580 km, max 0.997) and **86 of them already read `full`** with the false "own
measured shore normal" sentence **[M]**. Today took the borrowing class from 105 to 336 of 1033
(32.5%).

**The `full` sentence over a borrowed bearing is reachable — but only locally.** Three spots
(Lagide 1.60 km, Astwood Cove 1.46, Kaifu 2.16) read `full` **[M]**, because `_nearest` scans the
committed asset first at each radius, letting a ~2 km committed bearing coexist with a depth-only
overlay entry at 0 km. With `SHORE_NORMAL_OVERLAY=0` — the state of any git-deployed box, since
`shore_normals_overlay.json` is **untracked and has never been committed on any branch [M]** — the
count is **0**, and it is 0 at both radii. So a9bd6e35 changed **zero readiness verdicts in
production**. Structurally: from the committed asset alone, `full` on a >1 km borrow is impossible,
because any entry inside the 1 km depth radius is also the nearest-wins bearing source. That is what
`test_geometry_provenance_envelope.py::test_a_borrowed_bearing_does_not_borrow_a_depth` pins —
though both its fixtures have `break_depth_m is None`, so the guard passes under the state it forbids.

**Measured cost of the silence [M].** Perturbing the bearing by the borrowed residual (12.6° **[I]**)
over the borrowed class, 1,840 evals: \|ΔQ\| p50 1.30, p90 12.60, max 19.60; **LEVEL changed on
33.2%**.

**Where it reaches.** `schemas.NormalizedPointResponse.shore_normal_source / geometry_readiness /
geometry_missing` (`schemas.py:198-200`, stamped at `point_surf_augment.py:151-158`),
`routes/weather.py` `SpotRatingItem.geometry_readiness:332` which `spot_ratings.rate_one_spot:189`
persists into the precomputed L2 frame every client downloads, `sim_rating.geometry_payload`, and
`weather_sim_mcp.py:225 orientation_source`. Grep of `frontend/src` for `geometry_readiness` /
`shore_normal_source` / `geometryReadiness` returns **ZERO hits [M]**, so today the imprecision is
API/MCP/DB-facing, not rendered.

**Fix.** Carry the match distance out of `_nearest` onto `SurfGeometry` (`shore_normal_km`), so the
grader stays pure. Then: distinguish `"etopo"` from `"etopo:borrowed"` above `MATCH_RADIUS_KM`; add
a `borrowed_shore_normal` entry to `_IMPACT` quoting the OSM figure; emit the distance in
`sim_rating.geometry_payload`; and extend
`test_a_borrowed_bearing_does_not_borrow_a_depth` with a fixture that HAS a break depth so `full`
can never be asserted over a borrowed bearing. Threshold at **>0 km**, not `>MATCH_RADIUS_KM` — the
false `full` sentence has been live for 86 sub-kilometre borrows since well before this commit.

**Cost if left.** The one field that could let a downstream consumer discount a 3 km borrow does not
exist, and the ETOPO re-fit backlog keeps spending ~22 s of public ERDDAP per spot on 231 spots
whose measured bearing `_nearest` will then never consult (F9).

---

#### F4 — Both CI ratchets sit below their live counts; the chain lane's slack is today's
**Refutes: C7 partially** — the period-band ON path is not untested-in-CI;
`tests/test_ecmwf_period_bands_ingest.py` is collected by the forecast-chain lane.
`.github/workflows/ci.yml:462` and `:585` (both confirmed unchanged at HEAD).

**Exact evidence [M]** — measured in the configuration CI actually runs: fresh
`git worktree add --detach HEAD` (verified complete: `data/etopo_depth_0p25.npy` +
`shore_normals.json` present, **no `dev.db`**), with `fastmcp` blocked via a `PYTHONPATH` stub
package that raises `ImportError`:

```
chain selector (ci.yml's python block, verbatim):        65 files
  incl. tests/test_ecmwf_period_bands_ingest.py, tests/test_shore_normal_borrow_radius.py
pytest $CF -q --collect-only                       ->   504 tests collected

composition glob (ci.yml's ls|sort -u|grep -v):         102 files
pytest $PF -q --collect-only                       ->  1244 tests collected

grep -n "MIN_FILES, MIN_PASSED" .github/workflows/ci.yml
  462:  96, 1090        585:  63, 480
git log --oneline dd3c8614..HEAD -- .github/workflows/ci.yml   ->  (empty)
```

**Attribution [M].** The same selector yields exactly **63** at `dd3c8614` and at `e079200c` (the
commit `ci.yml` names as the floor's source). `a9bd6e35`'s own message records "forecast-chain lane
63 → 64 files, 486 → 495 passed" — the new count was **measured at commit time and the floor left at
63 anyway**. The composition lane's drift (96 → 102) happened during the PRIOR day's commits, not
today.

**"Could be deleted and stay green" survives `MIN_PASSED` too [M]:** the chain's two smallest files
(`test_euro_marine_ext_tz.py`, `test_euro_marine_horizon_contract.py`) carry 1 test each;
composition's six smallest total 12 tests against ~121 tests of `MIN_PASSED` headroom.

**Fix.** Raise the chain floor to `MIN_FILES = 65` — safe now, because `origin/dev == local HEAD`
and the concurrent session's untracked `test_spot_hub_local_size_reference.py` matches
`tests/test_spot_*.py` and therefore lands in the **composition** lane, not the chain lane **[M]**.
Set `MIN_PASSED` from the **gate's own run output on `origin/dev`**, never from a checkout — that is
`ci.yml`'s own recorded lesson about `6c4ab178`, and the composition lane's 96/1090 must wait for a
quiet tree for exactly that reason. Better still: make `MIN_FILES` an equality against the
selector's own `len(files)`, but note that this makes every new chain test file a required `ci.yml`
edit.

**Cost if left.** The ratchet is the only thing standing between "a guard was deleted" and "a guard
silently ran nowhere" — the repo's recorded recurring class, and how the composition glob came to
miss 45 of its own files.

*Method caveat:* a full RUN of either lane could not be completed on this box — several chain-lane
modules (`test_buoy_calibration`, `test_swell_fetch`) make network calls CI has and this box does
not; the run reached 8 tests in ~15 minutes. The collect-only counts above are deterministic and
are the honest number; `MIN_PASSED` remains unmeasured.

---

#### F5 — The admin flag registry cannot see the #1 Jacobian variable's radius, its kill switch, or the period-band flag
`backend/routes/admin/surf_forecast.py:31`

**What it is.** `_RATING_FLAGS` (21 entries, ast-parsed **[M]**) omits six switches the served
composition chain reads:

```
ECMWF_PERIOD_BANDS              services/ecmwf_opendata_fetcher.py:83
SHORE_NORMAL_ASSET              services/weather_pipeline/shore_normal_asset.py:308
SHORE_NORMAL_OVERLAY            services/weather_pipeline/shore_normal_asset.py:316
SHORE_NORMAL_OVERLAY_PATH       services/weather_pipeline/shore_normal_asset.py:148
SHORE_NORMAL_BEARING_RADIUS_KM  services/weather_pipeline/shore_normal_asset.py:330
SURF_V3_NORMAL_OVERRIDES        services/weather_pipeline/surf_point.py:94
```

`/admin/surf-forecast/status` is the **only** endpoint in the repo that emits a flag board (verified:
no other `os.environ.get` value is returned by any admin or health route **[M]**), and its docstring
claims "every rating feature flag". Two of the six are documented incident kill switches for the #1
Jacobian variable.

**The binding filter is the FILE list, not the prefix list [M].** Widening `_SCIENCE_PREFIXES` alone
leaves the guard's scan at **17 flags** and the suite green, because `_RATING_SURFACES`
(`test_flag_lane_parity.py:301`) omits `surf_point.py`, `shore_normal_asset.py` and
`ecmwf_opendata_fetcher.py`. `SURF_V3_NORMAL_OVERRIDES` is the exception — its `SURF_` prefix already
matches, so adding `surf_point.py` alone catches it (control C).

**The boolean contract blocks only two of six [M].** `SHORE_NORMAL_BEARING_RADIUS_KM` (default
`'3.0'`) and `SHORE_NORMAL_OVERLAY_PATH` (a filesystem path). The other four are plain `'0'`/`'1'`
and are declarable **today** with no contract change.

**Fix, in this order.** (1) Declare the four booleans now. (2) Add `surf_point.py` and
`shore_normal_asset.py` to `_RATING_SURFACES`, with `SHORE_NORMAL_` in `_SCIENCE_PREFIXES`, so the
next such switch fails the test until declared. (3) Add a named scalar exemption (mirroring
`_REGISTRY_EXEMPT`) for the radius. Note that adding `ecmwf_opendata_fetcher.py` pulls in five
non-composition ingest knobs (control D) — decide deliberately.

**Cost if left.** Render is the lane no test can check. A flag worth a LEVEL move on 38–43% of
evaluations is invisible on the one surface built to report serve-box flag state. The radius's code
default (3.0) currently equals every git lane's value, so an unset Render env carries no present
divergence — that is luck, not a guarantee.

---

#### F6 — `sim_compare`'s "(coarse bearing — median 22.3° off)" caveat is now false for ~349 live spots
`backend/services/weather_pipeline/sim_compare.py:321` (verified verbatim at HEAD:
`elif b.get("geometry_readiness") == "degraded": caveat = " (coarse bearing — median 22.3° off)"`),
plus the `within_resolving_power` note at `:256-268`.

**What it is.** The `degraded` verdict conflates a coarse 0.25° bearing with a missing `break_depth`
and with non-coastal. After a9bd6e35, spots that hold a **fine ETOPO bearing** but no depth are
told, in the headline sentence naming the best spot, that they are on a coarse bearing.

**Exact evidence [M]** — live 1,773-spot catalogue, random n=600 sample plus an independent
nearest-asset-entry control: the false-caveat population is **~349 spots = 19.7% of the catalogue =
52.7% of all `degraded` spots**, up from **~257** before a9bd6e35 (a ~36% increase of a mostly
pre-existing defect). On `dev.db` the same measurement reads 234 → 462 — the F2 inflation again.

**Fix.** Branch on the `missing` list, not the verdict: emit the coarse caveat only when
`'fine_shore_normal' in missing`, and a borrow caveat when the bearing is borrowed. Note
`geometry_missing` lives on the weather-route schema, not on `sim_compare`'s rows — the fix must
also add `missing` to `sim_compare._readiness`, or branch on the row's existing
`shore_normal_source`.

**Cost if left.** A user-facing MCP string that is wrong for one spot in five, plus an
"indistinguishable, treat them as equal" recommendation in `find_best_spot` that suppresses a real
ranking verdict. No served height, quality or rank changes.

---

### LOW

#### F7 — `surf_transform.py:14` is stale on both of its subjects; the served height is NOT direction-blind
**Bears on M5 (Kr).**
`backend/services/weather_pipeline/surf_transform.py:14`

The comment reads: *"Refraction (Kr, needs a per-point shore-normal) and bottom friction are
deliberate PHASE-2 refinements."* (verified verbatim at HEAD).

1. **Bottom friction is already implemented.** `shelf_dissipation` (Ardhuin 2003; Kurian 1987) is
   called as `Kf` inside `estimate_surf` and is default-on.
2. **The Kr precondition is satisfied.** `shore_normal_deg` is a first-class argument on
   `estimate_surf` (`:316-318`) and `estimate_surf_at` (`surf_point.py:130`); all four production
   callers pass `swell_from_deg`. Blame: comment 2026-06-27, `_height_exposure_factor` 2026-07-17,
   `shore_normal_asset.py` 2026-07-26, 3 km borrow today.
3. **M5 itself is CONFIRMED** — no Kr term exists in the chain. `grep 'refract'` across all `*.py`
   returns exactly one implementation, `snell_kr` at `scripts/validate_nearshore_transform.py:192`,
   an instrument. The height chain is Ks-only (`:172-173`, `:379`).

**But the chain is not direction-blind [M].** `_height_exposure_factor` (`:303`, default-ON via
`_v3`, kill switch `SURF_V3_EXPOSURE`) multiplies H at `:380` by a measured 0.5950–1.0000. Over 8
real spots at 75° off each spot's own ETOPO normal the served height moved **8/8 by −27.8% to
−30.0%** (Ocean Beach SF 8.51 → 5.95 ft), with known-null controls (head-on;
`swell_from_deg=None`) byte-identical and a known-present control (180° off) returning exactly 0.595.

**Fix.** Rewrite the comment: bottom friction is implemented (`shelf_dissipation`); the per-point
shore normal is available and consumed; `_height_exposure_factor` is the current empirical direction
stand-in.

**Cost if left.** An implementer takes M5 at face value, fits Kr against a chain they believe
returns 1.0, and **double-counts direction**. Note also that the two are not the same quantity: the
exposure factor is a floored cosine penalty capped at 1.0 and cannot focus, whereas the repo's own
instrument measured Kr above 1.0 (max 1.031; fitted open-water A up to 1.250). Any Kr A/B must be
run against 0.595–1.0, not against 1.0.

---

#### F8 — `ECMWF_PERIOD_BANDS` is declared in the one lane that never reads it and absent from the lane that runs the 0.25° EURO wave ingest
`.github/workflows/forecast-ingest-pilots.yml` (absent); declared at `'0'` in
`forecast-ingest.yml:71` and `precompute.yml:72` (both confirmed at HEAD).

**Caller map [M]**, from `scheduler/forecast.py`:

```
core_jobs  EURO Marine Global      -> euro_marine_coarse_ingestion.py:147   [forecast-ingest.yml   DECLARES]
pilot_jobs EURO Marine Global Mid  -> marine_mid_res_ingestion.py:203       [pilots lane  ABSENT]
pilot_jobs EURO Marine Pilot 0.25° -> marine_mid_res_ingestion.py:391       [pilots lane  ABSENT]
precompute_ci.py  spawns NO fetcher (restores from L2, prewarms, rates)     [precompute.yml  INERT]
```

`run_fetcher_subprocess` (`services/_fetch_common.py:665`) passes no `env=`, so the workflow step env
reaches the child. Following the workflows' own instruction ("Flip ONLY together with
precompute.yml") therefore bands **1 of 3** EURO wave fetches, and the declaring lane that is inert
is `precompute.yml`.

**Why the shipped guard cannot see it [M].**
`test_the_pilot_lane_does_not_contradict_the_ingest_lanes` (`test_flag_lane_parity.py:240`) iterates
`sorted(set(PILOT_FLAGS) & set(other))` — the **INTERSECTION**. A flag absent from the pilot lane can
never contradict anything. Mutation in a clean worktree: the documented flip left the suite at
**13 passed**; a control drifting the same flag BETWEEN the two ingest lanes failed
`test_the_two_ingest_lanes_agree`; a control **declaring** it in the pilot lane failed the pilot
test. So the guard is blind only in the absent-from-pilots direction, and declaring the flag closes
it without any semantics change.

**Fix.** Declare `ECMWF_PERIOD_BANDS: '0'` in `forecast-ingest-pilots.yml`; correct both ingest-lane
comments to name the pilots lane as a flip target; and change the pilot test to compare the UNION
with "absent means code default" semantics, as `test_the_two_ingest_lanes_agree` already does at
line 224.

**Cost if left.** Latent today (flag is `'0'` everywhere; `period_bands.bands_to_partitions` has zero
production callers). On flip: the global coarse EURO carries bands while every 0.25° regional tile —
the tier the close-zoom rating band actually reads, per `scheduler/forecast.py` — does not. The same
coast decomposes its sea differently by zoom level: a coverage-class defect.

---

#### F9 — Widening lets a 1–3 km asset entry outrank an overlay bearing measured at the spot's OWN coordinate
**Refutes: C8's mechanism sentence** ("nearest-wins, so a larger radius can only ADD candidates
farther than any incumbent"). C8's measured content (0 of 808 already-covered spots reshuffle) is
TRUE and was independently reconfirmed.
`backend/services/weather_pipeline/shore_normal_asset.py:313-318`

**What it is.** `_nearest` scans the committed asset first and the overlay only if the asset returned
nothing — precedence is evaluated **per radius**, not per distance. Widening the bearing radius to
3 km therefore lets an asset hit in the 1–3 km band suppress a full overlay entry published at the
spot's own coordinate.

**Exact evidence [M]** — synthetic, setup asserted (asset entry 2.002 km away bearing 200.0; overlay
entry 0.000 km away bearing 10.0):

```
radius 1.0 km -> normal (10.0, 2.0)   src=overlay
radius 3.0 km -> normal (200.0, 5.0)  src=asset      <- the incumbent was DISPLACED by a FARTHER entry
```

And live, through production `resolve_surf_geometry`, publishing exactly what
`resolve_spot_geometry.resolve_one` publishes on a successful re-fit
(`add_overlay_entry(lat, lng, 77.7, 3.0, 5.5)` at the spot's own coordinate, with the entry asserted
to have landed and sentinel 77.7 verified absent from the committed asset):

```
Jaco Beach       (9.6167,-84.6167)  r=1.0 -> 77.7  | r=3.0 -> 225.5   (147.8° away)
Princeton Jetty (37.498,-122.488)   r=1.0 -> 77.7  | r=3.0 -> 225.1   (147.4°)
The Washout     (32.675,-79.92)     r=1.0 -> 77.7  | r=3.0 -> 133.6   ( 55.9°)
Local          (-27.670,-48.482)    r=1.0 -> 77.7  | r=3.0 -> 107.7   ( 30.0°)
```

**Latent, and bounded.** All 5 live overlay entries are depth-only (`normal is None`) **[M]**, so
zero served numbers are affected. The DEPTH half still lands at the spot's own coordinate
(`MATCH_RADIUS_KM` stayed 1.0), so the resolver's largest catalogue gap is still filled. And the
trigger is a hand-run of `resolve_new_spot_geometry.py`, which is referenced by **no workflow [M]**
and whose own header says it is "deliberately NOT wired into the ingest workflow yet". The one
recorded real fitter run (`backend/scripts/geometry_backfill.json`, 2026-08-01) published **0**
bearings: 5 depth-only, 7 rejected, 0 failed.

**Also latent: the exposed population stays in the backlog.** `resolve_spot_geometry.needs_geometry`
gates on `assess_geometry(...)['actionable']`, and after the widening the 231 read
`verdict=DEGRADED / missing=['break_depth'] / actionable=True` **[M]**. The job will keep spending
~22 s of ERDDAP per spot to measure an at-coordinate bearing `_nearest` then never consults.

**Fix, carefully.** The asset-over-overlay precedence is a **named, tested invariant** —
`tests/test_resolve_spot_geometry.py::test_the_committed_asset_always_WINS_over_the_overlay` pins it
as BLOCKER 2 of the 2026-07-29 audit. Do not simply reverse it. Make precedence distance-aware for
the BEARING only: prefer the overlay entry when it carries a non-None normal AND is strictly closer
than the asset hit; keep asset-wins for ties and for depth. Add a guard with a full (non-depth-only)
overlay entry at 0 km against an asset entry at 2 km. Separately, `_nearest`'s docstring (`:297-306`)
still says "Lookup is nearest-wins within 1 km" and describes a 1 km cost band — that band is now
3 km for the bearing and the affected population grew 808 → 1039.

---

#### F10 — Six composition switches escape the registry guard by two distinct routes
`backend/routes/admin/surf_forecast.py:31` (registry) and `backend/tests/test_flag_lane_parity.py:327`
(the guard's literal `os.environ.get("NAME")` scan).

**Two escape hatches [M], both reproduced with a positive control** (`SURF_TRANSFORM`/`SURF_RATING`
visible → True; the six below → False):

- **FILE scope.** `SURF_HEIGHT_H110` is read at `services/weather_pipeline/surf_height_convention.py:59`
  (`os.environ.get("SURF_HEIGHT_H110", "0") == "1"`, verified at HEAD), a file not in
  `_RATING_SURFACES` — yet its `to_surf_convention()` is called from the guarded
  `surf_transform.py:393` on the **served height**. Same shape: `SURF_V3_NORMAL_OVERRIDES`
  (`surf_point.py:94`).
- **INDIRECTION.** `surf_transform.py:290 def _v3(flag): return os.environ.get(flag, "1") != "0"`
  hides `SURF_V3_SHELF_RECAL` (`:295`), `SURF_V3_EXPOSURE` (`:307`), `SURF_V3_KOMAR` (`:366`) and
  `SURF_V3_MAGNETS` (`:381`) from a literal-string scan even though they live inside a guarded file.
  All four default `"1"` = ACTIVE, and all four multiply the served height.

**Corrections to the census that produced this.** The "33 undeclared science flags" figure is
reproducible (50 read / 17 declared / 33 undeclared) but ~21 of the 33 are operational plumbing
(`MARINE_MID_CLIP_*`, `MARINE_*_CONCURRENCY`, the four `SURF_REGIONAL_PREFER_*` constants, …) that
the suite documents as **out of the registry's scope by design**. `SURF_SHELF_CF_SCALE` and
`SURF_V3_JACK_MAX` are already named `_REGISTRY_EXEMPT` entries guarded against staleness by
`test_no_exemption_outlives_the_flag_it_excuses` — false positives. And the naive fix makes the suite
RED: `test_registry_parses_and_is_not_empty` asserts `entry[0] in ("0","1")` while those two are
calibration scalars (proven by mutating a COPY, mutation asserted landed, 3 hits).

**Severity is low, and this is why [M].** None of the six is set to a non-default value anywhere in
git: 0 occurrences across `.github/workflows/` and `render.yaml` for `SURF_HEIGHT_H110`,
`SURF_V3_EXPOSURE/KOMAR/MAGNETS/SHELF_RECAL`, `SURF_SHELF_CF_SCALE`, `SURF_V3_NORMAL_OVERRIDES`.
Impact on a served number today is **zero**. The residual risk is conditional and real:
`SURF_HEIGHT_H110` is the documented "BOTH OR NEITHER" landmine (+25.5% if flipped alone), and
Render is the one lane not in git.

**Fix.** Leave `_RATING_FLAGS` boolean-only. Widen the EXISTING guard: add
`surf_height_convention.py` and `surf_point.py` to `_RATING_SURFACES`, teach its regex the
`_v3\(\s*["'](NAME)["']\)` indirection, then declare the five booleans and add a named scalar
exemption for `SHORE_NORMAL_BEARING_RADIUS_KM` (already lane-declared and drift-guarded).

---

#### F11 — `# covered by the next test` is false for four of the six collected prefixes
`backend/tests/test_flag_lane_parity.py:133`

`test_a_workflow_that_overrides_a_default…` does `entry = REGISTRY.get(flag); if entry is None:
continue  # covered by the next test`, but the next test filters on `COMPOSITION_PREFIXES`. Flags
carrying the other four `DRIFT_PREFIXES` (`MARINE_`, `SPOT_RATINGS_`, `SHORE_NORMAL_`, `ECMWF_`) are
skipped by both and are never required to be registered.

**Exact evidence [M]** — injection with a control: an undeclared `RATING_` flag produces **3
failures**; an undeclared `MARINE_`/`SPOT_RATINGS_`/`SHORE_NORMAL_`/`ECMWF_` flag produces **0**. Six
real flags are in that state today. Live demonstration: all three lanes declare
`SHORE_NORMAL_BEARING_RADIUS_KM: '3.0'`, the registry has it as `False`, and
`pytest tests/test_flag_lane_parity.py tests/test_shore_normal_borrow_radius.py -q` → **22 passed**.

**Bounded consequence, measured.** This does NOT let a flag drift unguarded: drifting the
unregistered radius (value change and outright removal, both tested) is CAUGHT by
`test_the_two_ingest_lanes_agree`, whose `REGISTRY.get(flag, (None,))[0]` fallback makes unregistered
flags **stricter** to compare, not weaker. The only consequence is the
`/admin/surf-forecast/status` listing.

**Fix.** Not "extend the registry test to `DRIFT_PREFIXES`" — three of the six hold non-boolean
values (`'3.0'`, `'0,3'`, `'GFS,EURO,ICON'`) and would fail the boolean contract. Replace the
comment with an explicit statement of which prefixes are exempt and why. As written it asserts
coverage that does not exist.

---

#### F12 — Two stale records: queue #22, and CLAUDE.md's "the sim is height-blind"

**#22 is CLOSED by `0a00766f`** (`git merge-base --is-ancestor` → **ANCESTOR-OF-dev YES**,
2026-08-01 17:26:09 -0400) **[M]**. Scope correction: the queue names two layers
(`swell_1`, `wind_waves`); the closing commit fixed **nine cards across three layers** —
`'Primary Swell'` (`:372/:444`), `'Secondary Swell'` (`:475/:543`), `'Wind Waves'` (`:571/:634`) —
deliberately not plain `'Swell'`, which would have rebuilt #17 one level down (TOTAL vs TRAIN). No
`'Height'` label remains. **Refuted sub-claim:** "#10 is also partly stale via `c34ff88f`" does not
hold — `c34ff88f` adds an Energy card computed from each layer's own h and T, a NEW QUANTITY on an
existing single-train card set, and its own body says the summed shore-relative version is queued
behind the tier fix. **#10 stays fully OPEN.**

**CLAUDE.md:45's parenthetical is stale.** "weather_sim_mcp.py simulation logic is height-blind
(calculates quality_score from wind/swell alignment/period, ignoring swell_h)". Measured **[M]**:
`weather_sim_mcp.py` defines no rating logic; `weather_sim_mcp.calculate_surf_rating is
sim_rating.calculate_surf_rating` → **True** (the same object, not a copy). Height sweep at Mavericks
with all else fixed, setup asserted (geo 225.1 / `etopo` / break_depth 22.1): Hs 0.3 → 20.0 m gives
breaking 1.7 → 54.3 ft and **4 distinct quality values [21.5, 45.1, 55.9, 69.4]**. Positive control
(Tp 3→20 s → 7 distinct scores) and negative control (`rating_score` with `surf_h` pinned at 1.0 →
**1 distinct**) both behaved. The `SIM_PRODUCTION_GEOMETRY=0` Komar fallback branch is also
height-sensitive (5 distinct, 26.5–88.3).

Two precisions: the dependence is **height-sensitive at both ends and saturating in the middle**
(quality is flat at 69.4 across Hs 1.0–10.0 m, i.e. breaking 4.9 → 31.2 ft), not "strongly
height-dependent"; and the payload key is `quality_rating`, not `quality_score`. This is
already-triaged documentation debt — SOTA Gap 2.7 / MASTER 2.7, "RE-PROVEN — still stale" — so file
the fix as closing that, not as a discovery. The note's imperative clause ("treat production
`surf_rating.py` as authoritative") is **correct** and points toward the single composition; only the
descriptive parenthetical is wrong.

---

### INFO

#### F13 — `_scan` never wraps the antimeridian; the widening tripled the width of a pre-existing blind band
`backend/services/weather_pipeline/shore_normal_asset.py:280` (`idx.get((b_lat + d_lat, b_lng + d_lng), ())`,
verified verbatim at HEAD — no modulo over the 3600-cell longitude domain).

**Evidence [M], with a passing control:** entry `(0.0, 179.985)`, query `(0.0, -179.995)`, true
great-circle 2.224 km, buckets `(0,1799)` vs `(0,-1800)`, `_bucket_span(0,3.0) = (1,1)` →
`shore_normal_at` returns `(None, None)`. Control, same separation moved off the seam → `(123.0, 5.0)`.

**Four corrections to the way this was first filed.** It **pre-dates** `a9bd6e35` — reproduced at the
old 1.0 km radius (entry `(0.0, 179.9965)`, query `(0.0, -179.9985)`, true GC 0.5560 km → `(None,
None)`) against a byte-matched off-seam control at the same separation returning `(123.0, 5.0)`. The
rationale is backwards: `_bucket_span` corrected the **width** of the longitude walk, not its
wraparound. The offered "identical separation" control was not identical (1.6679 km vs 2.2239 km).
And "blind band 1 km → 3 km" conflates radius with band width; the band is 2r, so 2 → 6 km.

**Latent, with margin [M].** The shipped `shore_normals.json` (1,386 entries) has lng range
`[-175.368, 179.198]` with **0 entries within 3 km of the seam**; `dev.db surf_spots` (1,587 with
lng) has the same range and the same 0. The nearest coordinate on either side is Funafuti at 179.198,
~88 km from ±180 — about 30× the radius. Even for a seam spot the symptom is a fall back to the
coarse bearing (the pre-a9bd6e35 behaviour), not a `None`.

**Fix.** `((b_lng + d_lng + 1800) % 3600) - 1800`. Verified **[M]** that the bucket domain is exactly
−1800..1799 and that this expression is the identity across it while mapping 1800→−1800 and
−1801→1799; with `lng_span` capped at 180 the walked window is at most 361 buckets, so wrapping
cannot double-visit. Add a guard mirroring `test_bucket_scan_covers_the_whole_radius_it_is_given`
with the entry/query straddling ±180 and an assertion that the bucket indices really differ by more
than the span.

**Adjacent, same class, also latent [M]:** `bathymetry.shore_normal_at` (`bathymetry.py:301-303`)
normalises lng into [−180,180) then clamps with `max(0, c - window_cells), min(nlon, c + window_cells + 1)`
— it truncates at the array edge rather than wrapping. So the coarse fallback a seam spot would land
on is itself computed from a half window at ±180.

---

#### F14 — `lru_cache` is correct under two radii, but effective coordinate capacity halved
`backend/services/weather_pipeline/shore_normal_asset.py:288` (`@lru_cache(maxsize=20_000)`,
`def _nearest(lat, lng, max_km=MATCH_RADIUS_KM)`, verified at HEAD).

**Correctness is control-proven, not merely observed [M].** `max_km` is part of the key; warm-cache
results match both an always-cold run and a reversed call order at **0 mismatches over 1584
catalogue coordinates**, while a deliberately collapsed `(lat,lng)` key corrupts **186** of them
(depths borrowed from up to 3 km). Full-catalogue A/B in one process:
`{'hits': 9528, 'misses': 3168, 'maxsize': 20000, 'currsize': 3168}` — exactly **2.00 entries per
distinct coordinate**, no evictions, and identical to the two-separate-process expectation.
With the kill switch at `1.0` it is exactly 1.00 (`currsize=1584`). Int/float aliasing (21 vs 21.0)
does not split the key.

Consequence is microseconds: an eviction forces a ~13 µs recomputation of a value deterministic in
`(lat, lng, max_km)`; worst-case memory ~**4.6 MB** (230 B/entry, `tracemalloc`).

**Two corrections.** The "make `max_km` required" nit is **unreachable** — no 2-arg or keyword caller
of `_nearest` exists anywhere in the repo (the only external reference is a source-text assertion at
`test_resolve_spot_geometry.py:125`). And the sizing comment at `:247-250` is **imprecise, not
wrong**: 20 000 still exceeds the working set 6.3×. The numbers in it that ARE stale are different
ones — 20 000 entries measure ~4.6 MB, not "~3 MB", and the working set is 1584 distinct
coordinates / 1587 spots, not 1516. Its "9 spatial-hash buckets" clause did **not** go stale:
`_bucket_span(lat, 3.0)` is `(1,1)` for all 1584 catalogue coordinates, diverging only above 74.4°
against a catalogue max of 58.62°.

**Fix.** If the comment is touched at all, restate it in entries rather than spots and use the
measured 4.6 MB / 1584-coordinate figures.

---

## §3 WHAT SURVIVED SCRUTINY — do not re-litigate these

These were attacked and could not be broken. Every one was re-executed today unless marked **[I]**.

### The shipped change itself

- **C1's arithmetic is exact on the population it was taken over.** Independently re-derived twice
  over all 1,587 `dev.db` spots: **gained 231 = 229 from `coarse` + 2 from `none`**; coarse share
  47.5% → 33.1% (commit says 47.4 → 33.0; a 2-spot denominator difference). Borrow distances: min
  1.002 km, p50 1.981, p90 2.776, max 2.996 — **0 under 1 km, 118 in 1–2 km, 113 in 2–3 km, 0 over
  3 km**. The widening does exactly and only what it claims. *(Its applicability to production is
  F2.)*
- **C2 CONFIRMED on all three sub-claims, on BOTH catalogues, by comparing WHICH ENTRY answers and
  not merely the resulting value.** dev.db (n=1587) and live (n=1773) both give: break depths
  changed **0**; depth-answering entry changed for any spot **0**; bearings lost **0**; already-etopo
  spots whose answering entry changed **0**. `MATCH_RADIUS_KM` is genuinely untouched. One agent
  independently asserted its re-implementation of the bucket walk matched production `_scan` over
  400 spots (disagreements 0) *before* taking these counts.
- **C4's character is right; its magnitudes are sea-state-dependent and its population is wrong.**
  The 38.0% figure reproduces to within 0.05 pp at the stated sea state, but a 10-config sweep gives
  **25.2%–44.9%**: `Hs=3.0/Tp=9/W=12` → 25.22%, `Hs=1.5/Tp=12/W=0` → 44.32%, `Hs=1.5/Tp=12/W=5` →
  37.94%. The quoted `46.8 / 44.5 / mean −0.13` triple is identifiable as **SCORE**, not LEVEL, and
  is inside the band under every parameterisation tried (W=4.0 → 47.0/45.2/−0.1306; W=6.0 →
  47.3/45.6/−0.1136; alternate direction set → 47.9/46.4/−0.1293). Negative control: the LEVEL split
  is 49.1/50.9 of moved and never approaches 46.8/44.5. **Treat "a large, signed-both-ways share of
  evaluations change level" as robust and any single percentage as sea-state-conditional.**
- **C8 holds within the committed asset.** Three attempts to break monotonicity, two failed:
  full-catalogue A/B (0 lost, 0 of 812 covered reshuffled) and bucket boundaries (`_bucket_span` is
  monotone non-decreasing in `max_km`, and the `km <= max_km` filter is strictly looser, so the 3 km
  candidate set is a superset of the 1 km one **within one index**). It breaks only across the
  asset/overlay boundary (F9).
- **The high-latitude half of the `_bucket_span` derivation is CORRECT.** No latitude was found where
  the derived span under-reaches 3 km, including where the `min(lng_span, 180)` clamp bites. Measured
  reach at 3 km: lat 0 → 11.132 km (span 1,1); 60 → 5.566; 70 → 3.807; 73 → 3.255; 75 → 5.762
  (span 1,2); 85 → 3.881 (span 1,4); 89.9 → 3.011 km (span 1,155). Every row ≥ 3.0 km; the clamp is
  unreachable for this radius at any latitude. Catalogue spots above |lat| 60: **0**.
- **The signature change is safe.** A repo-wide regex for a third *positional* argument to
  `shore_normal_at` / `source_at` / `break_depth_at` returns only four hits, all in
  `test_shore_normal_borrow_radius.py`, and all four are `*_at_km(...)` unpacking a 2-tuple. The
  only third-arg caller anywhere passes it by keyword. `scripts/filter_spot_candidates.py` imports
  the unrelated `bathymetry.shore_normal_at` — no collision.
- **The shipped guards pass and are not inert where checked.**
  `pytest tests/test_shore_normal_borrow_radius.py tests/test_geometry_provenance_envelope.py
  tests/test_flag_lane_parity.py -q` → **36 passed** (and with `test_ecmwf_period_bands_ingest.py`,
  **45 passed**). `test_bucket_scan_covers_the_whole_radius_it_is_given` carries a real negative
  control (it asserts the entry lands ≥2 buckets away, so a fixed ±1 scan could not find it). The
  fixture-stability claim in `test_geometry_provenance_envelope.py` was verified by brute force
  against all 1,386 asset entries: Makapuu **16.391 km**, Old Orchard Beach **15.236 km** from any
  gate-passed entry (the retired fixtures: Bondi 1.048 km, Chicama 2.253 km).
- **The kill switch is live and not inert.** `_bearing_radius_km()` → 3.0 unset, 1.0 under the env,
  3.0 under `'garbage'` (documented fallback, does not raise), resolved **per call**. It is declared
  at `'3.0'` in all three git lanes; no lane was ever found holding `'1.0'`.

### The period-band ingest half

- **The band series stay aligned with `times`.** `_assemble` iterates `for vt in times_dt` and
  appends `None` when `b[bp].get(vt)` is None, so a band missing at some valid times cannot shift a
  later hour's height into an earlier slot. Executed: dropping `h1417` at t1 gives `[0.7, None, 2.7]`
  with `len == len(times) == 3`; adding an `h1012` message at a valid time `swh`/`mwd` lack keeps the
  series at length 3. **Negative control:** the plausible buggy form `for vt in sorted(b[bp])`
  produces `[0.7, 2.7]` of length 2, which the assertion rejects — the check has discriminating power.
- **Both directions of the flag/stream mismatch behave.** Flag OFF with 18 band messages asserted
  present in the stream: request stays exactly `['swh','mwp','pp1d','mwd']`, zero `wave_band_*` keys
  emitted. Flag ON with no band messages: six all-null series, and the consumer fails closed
  (`bands_used=0`, `bands_represent()` → False).
- **No late-binding or shared-mutable-state bug** in `def hourly_of(pi, _bands=bands)`. Run
  multi-bbox with 2 regions × 9 points over a ramp field giving every native cell a distinct value:
  all 18 points × 6 bands × 3 steps matched their own nearest cell exactly.
- **`sanitize_height_m` is the right sanitizer and does not mask a real zero.** It returns None only
  for NaN or values outside [0, 30]; feeding 0.0 for every band yields `[0.0, 0.0, 0.0]`, not
  `[None, None, None]`. The consumer's own explicit `BAND_MIN_H_M = 0.05` gate is a deliberate
  threshold, not an accident of the sanitizer.
- **The shortName dispatch key is CORRECT — measured from three independent artifacts.** The live
  ECMWF index (20260802/00z) publishes `h1012 h1214 h1417 h1721 h2125 h2530`; byte-range-fetched
  GRIB2 headers parsed by hand give `disc=10 cat=0 num=3 PDT=104` with
  `typeOfWavePeriodInterval=7, scaledValueOfLower=10, scaledValueOfUpper=12`; and ecCodes'
  `definitions/grib2/shortName.def` contains a block named verbatim `h1012` conditioned on exactly
  those eight values. ecCodes' resolver is **best-match** (`concept_evaluate`), so `h1012`
  (8 conditions) beats generic `swh` (3). *This is a derivation from source + definition tables +
  live message octets, not a `pygrib` call — `pygrib` has no wheel for this box's Python.*
- **Adding the bands to the request is MONOTONE.** Driven against the real `ecmwf-opendata` client
  (0.3.34) and the live index: full index/10 params → 10 parts; index with `h2530` deleted → 9 parts,
  base four still matched, **no exception**, only `warning_once`; all six bands deleted → 4 parts.
  Control with none of the 10 params present → `ValueError`, i.e. the harness CAN see the failure
  mode. The sole `raise` is `if not result`.
- **06/18z cycles are not a hazard.** Fetched live: 20260802/06z and 20260801/18z each return the
  same 13 params including all six bands, under `.../0p25/wave/...-wave-fc`. Since IFS Cycle 50r1
  (2026-05-12) the 06/18 runs stay under `oper/wave`; `scwv` applies only to earlier dates and 404s
  now. *(Residual: `ecmwf_opendata_fetcher.py:52`'s comment about scwv is stale post-50r1.)*
- **C7 CONFIRMED and broader than stated.** `fetch_global_coarse` appears in **zero** tests. The nine
  tests in `test_ecmwf_period_bands_ingest.py` touch only `layer_params()`, `period_bands_enabled()`
  and the two constants; `test_enclosed_sea_height_survival.py:78-80` asserts the module *imports*
  `energy_mean_height_block`, never that it calls it. **The whole ECMWF decode loop — not just the
  band branch — had never executed under test.** The nine existing tests do pass (9 passed in 1.33 s).
  → A standalone harness that DOES execute it now exists (see §5, item 6).

### The sim

- **The sim mirrors the mandated chain; no re-derivation found.** `sim_rating.calculate_surf_rating`
  calls `surf_point.resolve_surf_geometry` (`:75`), `surf_point.estimate_surf_at` (`:224-227`) and
  `surf_rating.rating_score` + `score_to_level` (`:278-290`). It uses the pair rather than
  `compute_surf_rating`, but `surf_rating.py:586-608` shows `compute_surf_rating` is a None-guard
  plus exactly that pair, and `test_rating_composition_parity.py:186-191` accepts both names by
  design. An AST sweep of `sim_rating` found no second quality formula. The three omitted engine
  inputs (`tide_norm`, `best_tide`, `breaker_xi`) are registry-waived with costed reasons at
  `test_rating_composition_parity.py:159-166`.
- **v3's recorded miss "the sim's geometry cache key is unpinned (2 dp merges 487 spot pairs)" is
  CLOSED at HEAD.** `sim_rating.py:72` is
  `key = (round(float(lat), 6), round(float(lng), 6))` — 6 dp ≈ 0.1 m.
- **NaN cannot reach `'epic'` through the sim — three independent layers.**
  `score_to_level(rating_score(nan, 12.0, 3.0))` → `'unknown'`;
  `score_to_level(rating_score(1.5, nan, 3.0))` → `'unknown'`; control
  `score_to_level(rating_score(1.5, 12.0, 3.0))` → `'good'`. And the sim rejects it before the
  engine: `simulate_weather_change('Mavericks', …, nan, …)` → `success=False, "Invalid swell height:
  nan meters."`
- **The sim's quality curve is NOT flat in height under production's composition.** With a local
  reference supplied, the Hs 0.5→8.0 m sweep goes from 10/11 flat (2 distinct qualities) at
  `reference_size_m=None` to **2–3/11 flat with 9–10 distinct qualities** at ref 1.0–2.0 m, on
  Mavericks, Trestles and Pipeline alike. Isolated: `size_score(h, ref=None)` returns 1.0000 for
  every h ≥ 1.2 m — **the flat band IS the legacy global curve**, and `RATING_LOCAL_SIZE` has been 1
  in all three lanes since `3263031c`.
- **The what-if already answers with the PAIR.** A live end-to-end run (staged override 1.5 → 6.0 m)
  returns `breaking_height_ft {from 7.7, to 23.5, delta 15.8}` alongside
  `quality_rating {96.0, 96.0, 0.0}`, plus `conditions_label "Triple Overhead+"`,
  `size_verdict within_range`, `rideable_ceiling_ft 45.2` and a factor-level `why_summary`.
- **The geometry provenance envelope IS served, at the top level of the sim response.** A live
  `simulate_weather_change` returns a `geometry` sibling of `simulated_surf_output` carrying
  `readiness`, `readiness_missing`, `readiness_note`, `shore_normal_source`, `break_depth_m`. Its
  recall over the borrowed class is **230/230 `degraded`** — an earlier probe that reported "no
  interval/spread/confidence field" had enumerated the wrong subtree.

### Guards, lanes, and the queue

- **`a9bd6e35`'s derived `_COLLECT_RE` fix is REAL for the two ingest lanes.** Diffing the old
  hardcoded regex against the `DRIFT_PREFIXES`-derived one shows it newly captures exactly
  `ECMWF_PERIOD_BANDS` and `SHORE_NORMAL_BEARING_RADIUS_KM` and no previously-hidden flag:
  `forecast-ingest` 8→10, `precompute` 7→9, `sim-parity-monitor` 4→5, `forecast-ingest-pilots` 0→0.
  Mutating either new flag in ONE ingest lane turns `test_the_two_ingest_lanes_agree` red.
- **The monitor's `RATING_`/`SURF_` flags ARE guarded.** Three controls in `sim-parity-monitor.yml`
  went red (`RATING_LOCAL_SIZE`, `SURF_PARTITIONS`, `RATING_OBS_GATE`). The monitor guard's logic
  works; only its scope is defective.
- **The flag propagates into the fetcher subprocess.** `_fetch_common.py:665` calls
  `subprocess.run([...])` with no `env=`, so `os.environ` is inherited.
- **The pilots-lane grid size climatology does NOT depend on the shore normal.**
  `accumulate_points_into_grid_climatology` (`grid_size_climatology.py:52`) calls `estimate_surf`
  with `depth_fn`/`coastal_fn`/`width_fn` and never touches `shore_normal_at` or `break_depth_at`.
- **Queue #26 CONFIRMED, not stale — all 12 levers still have ZERO reads.**
  `git grep -I --fixed-strings -l <flag>` returned 0 files for every one; controls returned
  `SURF_PARTITIONS` 20 files, `RATING_LOCAL_SIZE` 44, `SHORE_NORMAL_BEARING_RADIUS_KM` 6. Class (A) —
  the three phantom levers — genuinely never existed: `git log --all -S<flag>` is EMPTY for
  `__RAW_TUNER_BANDS__`, `__RAW_DISABLE_MIDGESTURE_COMMIT__` and `RATING_PARTITION_AWARE`, while the
  same pickaxe returns 2 commits each for the class-(B) levers. **#26's open question is answered:
  the real partition flag is `SURF_PARTITIONS`** (registry default `'0'`, read at
  `point_resolution.py:103` and `spot_conditions.py:95`) — run any partition A/B through it.
- **Queue #25's headline CONFIRMED.** `1a1134ec` is a real commit, is NOT an ancestor of `dev`, and
  `git branch -a --contains` still lists only `prep/icon-coverage-valid-nn`. The downgrade rationale
  also holds: the serve-time symptom fix (`coarse_gulf_fill.py` + `test_coarse_fill_layers.py`,
  `ade26017`/`e079200c`) IS on `dev`.
- **Queue #7 re-measured at HEAD and reproduces exactly, line numbers included.**
  `normalizer.py:348` `s1_h_list = pt_hourly.get("swell_wave_height", [])`, `:356`
  `swell_active_count += 1`, `:358` the availability increment, `:193` the 0.95 gate. The two
  candidate mechanisms (key absent vs array shorter than total) are both live and still
  distinguishable by the single log the queue prescribes. The structural disagreement is intact: the
  infobox prefers the exact-point lane (`MapForecastOverlay.js:269-270`) while the animated field
  reads only the resident grid tier (`forecastHelpers.js:289`, off `window.__MARINE_WIND_DATA__`),
  and nothing asserts the two agree. Matches the `-H` handoff's "DORMANT, NOT FIXED".
- **M7 CONFIRMED as recorded.** The runtime bathymetry grid is ETOPO1 at 0.25°
  (`etopo_depth_0p25.meta.json`: nlat 721, nlon 1441, dlat/dlon 0.25), loaded by `bathymetry.py:24`.
  No finer runtime depth grid exists.

---

## §4 CORRECTIONS LEDGER — 23 findings struck, and the instrument that lied in each

These matter as much as the findings. Each row names the instrument and the specific way it misled.

| # | Struck claim | The instrument that lied |
|---:|---|---|
| 1 | "C2's *0 already-covered reshuffled* is false: 3 of 812 changed" | **The denominator was silently changed.** The comment says "0 of the **808**". With `SHORE_NORMAL_OVERLAY=0` (gate proven live: coverage 812→808) reshuffled = **0** — exactly the comment's two numbers. All 3 lie in the 4-spot delta contributed by the untracked overlay. The same 3 spots are already documented, with the same count, in the same commit's own test docstring. |
| 2 | "C4's direction split / mean −0.13 do not reproduce; retract" | **A search that never covered the quoted quantity.** A 10-parameterisation sweep places the commit's `46.8/44.5/−0.13` inside the SCORE band everywhere; the negative control shows LEVEL never approaches it. The fix would have retracted a correct measurement. |
| 3 | "C6 confirmed — borrowed bearings reach readiness `full`, live today" | **A local, untracked cache read as production.** From the committed asset alone `full`-on-a->1 km-borrow is **structurally impossible** (depth radius 1 km ⊂ bearing radius 3 km, same nearest search). Measured with the overlay off, twice, by two routes: **0 of 1,587**. |
| 4 | "An own ERDDAP fit is SHADOWED for 231 spots; the job reports published" | **A synthetic bearing standing in for a real one.** All 5 production overlay entries are depth-only; **zero** overlay bearings exist to be shadowed. The one recorded fitter run published 0 bearings (0/12). The precedence is a named, tested invariant (BLOCKER 2 of the 2026-07-29 audit) and the proposed fix would break its test. |
| 5 | "`geometry_lat/lng` record the PIN — the moved-pin guard is disarmed" | **The guard was never run.** Executed on the worst borrow (2996 m): unmoved → `None`, 55 m jitter → `None`, 222 m → `'moved'`, 5.6 km → `'moved'`. Applying the proposed fix makes **325 of 1007** rows report `'moved'` with no pin having moved, and turns `test_spot_geometry_db.py` red. |
| 6 | "The borrowed entry's spread is frozen as the spot's own fit confidence" | **A column with zero readers.** `shore_normal_spread_deg` appears in exactly 3 places: the writer, a script's `print`, and one unit assert. No route, model, frontend file or workflow reads it, and `needs_geometry_refresh` never touches it. Also already declared verbatim in `a9bd6e35`'s message. |
| 7 | "3 spots grade `full` on a 1.46–2.16 km borrow and are retired from the queue" | **A cache that was not cleared.** `SHORE_NORMAL_OVERLAY` is read INSIDE the `lru_cache`d `_nearest`; the first pass flipped it without `cache_clear()` and read values cached under the previous setting. Re-run correctly: prod-shape verdicts are **identical at 1.0 and 3.0 km**. The 3 spots' depth-only entries exist because the gate **rejected** their fitted bearing — so "can never obtain their own fit" is backwards. |
| 8 | "`swh` is block-RMS-meaned while bands are point-sampled, then divided downstream" | **A fixture ratio reported as a measurement.** A uniform-field control gives the same 1.4697 with **zero** estimator divergence. The load-bearing clause is false outright: nothing forms `sqrt(sum(band²))/swh` — `bands_to_partitions`/`bands_represent` have zero non-test callers. And at the cited enclosed-sea cells period/direction are **already `None`** in today's default (control K4), so nothing regressed. |
| 9 | "Turning the flag on makes the whole EURO wave ingest hostage to band availability" | **Reading the client instead of running it.** Driven against the real `ecmwf-opendata` 0.3.34 and the live index: a deleted band produces 9 parts and a `warning_once`, never an exception. The scwv second prong is also refuted by fetching 06/18z live. |
| 10 | "A shortName spelling drift is a silent total loss" | **A probe with no control.** The drift is now measured **not to occur**: three independent artifacts (live index, hand-parsed GRIB2 octets, ecCodes `shortName.def` + `concept_evaluate` best-match) agree the key is `h1012`. The "no alias tuple" premise is also false — every wave param is a single spelling. |
| 11 | "There is no carrier for `wave_band_*` past the fetcher" | **Attacking a decorative clause.** True mechanically, but the commit message and BOTH workflow comments already say "the COMPOSITION half is NOT wired yet… changes NO rating… flip ONLY together". And composing bands into the existing `swell_1/swell_2/wind_waves` payloads at ingest is an equally viable architecture, so "there is no carrier" is not necessarily a gap. |
| 12 | "`want_bands` is not layer-gated, so wind/pressure grow six unused keys" | **A property attributed to the wrong commit.** The pre-existing line already allocated all seven kinds for every layer (five dead for wind). SHA-256 of the full payload, flag OFF vs ON, is **byte-identical** for wind and pressure, with waves as a passing negative control. |
| 13 | "A total retrieve failure returns a list even in multi-bbox mode" | **A return value that never leaves the process.** Both variants produce `FILE_EXISTS=False, exit=0` — `main()` gates on emptiness, not type; the only production path is a subprocess spawn; and consumers guard with `isinstance(data, dict) and data.get("__multi_region__")`. Control: the known-different non-empty pair DOES produce different files, so the null result is genuine inertness. |
| 14 | "`seed_geometry_columns --apply` freezes 231 borrowed bearings and drops them from the queue" | **A count taken over the wrong query.** The script queries `is_active=true & latitude not null` (1,547 rows), giving **225**, not 231. "Were queue members" cannot have been measured on `dev.db` at all — `PRAGMA table_info(surf_spots)` returns **zero** geometry columns. And `needs_geometry` is **True for 222 of the 225**, so the central harm is contradicted. |
| 15 | "The band ON path dispatches on a key no instrument has observed; failure is silent+total" | Same as #10. **Refuted by measurement.** The genuine residual is the inverse and weaker: on ecCodes ≤ 2.31 the bands resolve to `swh` and would OVERWRITE the total — but `pygrib>=2.1.5` resolves to 2.1.8, whose wheels bundle ecCodes ≥ 2.36. |
| 16 | "`_bucket_span`'s unbounded `lat_span` makes an env typo an unbounded hot-path loop; 0/−1 blinds every spot" | **Cache-miss cost reported as per-call cost, and a fallback path not followed.** `resolve_surf_geometry` only overwrites when the asset returns non-None, so radius −1 is **byte-identical to the supported `SHORE_NORMAL_ASSET=0`** — and strictly better, since `break_depth_at` reads the constant and is preserved. Cost is per distinct coordinate once per process (~21 s at env `'1000'`), not 124 s per cycle. |
| 17 | "C6 is half wrong: 225 of 228 newly-etopo report `degraded`, not `full`" | **An adjacent instrument.** It measured "is the verdict token `'full'`?"; C6 claims indistinguishability. Measured properly, **231/231 borrowed spots share a `(verdict, missing)` cell with measured spots**. Counts also off by 3 (duplicate-coordinate collapse), and the 3 `full` spots vanish without the local overlay. |
| 18 | "`SHORE_NORMAL_ASSET`/`_OVERLAY` are declared in zero lanes and no guard can see them" | **Generalising from the registry test to the whole file.** Mutation-proven: `SHORE_NORMAL_ASSET='0'` in one ingest lane → `rc=1`, message `forecast-ingest.yml='0' vs precompute.yml=None`. The separate workflow COMPARATOR sees both today. Negative control (agreeing in both lanes) → green. Also, `SHORE_NORMAL_OVERLAY=0` changes nothing (1386/1386, depth 1087). |
| 19 | "The lane-parity guard is structurally blind to `WAVES_ANIM_*`" | **A fabricated fixture line.** The probe graded against `WAVES_ANIM_DOMINANT_SWELL: '1'`; the real line is `${{ vars.WAVES_ANIM_DOMINANT_SWELL \|\| '0' }}`, and `WAVES_ANIM_SWELL_AVAIL_MIN` is set by no workflow at all. The proposed one-line fix collects **{}** from the real files — a proven no-op. Both lanes source the same repo variable, so drift is structurally impossible. *(One real residue survives: the collector is blind to the `${{ vars.* }}` form for EVERY prefix — latent today, none carries a DRIFT_PREFIX.)* |
| 20 | "#25's evidence decayed: the grep now returns a hit" | **An instrument that was invented.** The queue records no grep (`grep -n "git grep"` → nothing), line 104 sits inside a `<details>` block titled "superseded — kept as the forensic record", and the proposed correction is already written 14 lines above at `:90`. `ledger_audit.js` — the only mechanical grepper — does not include the symbol and already uses the proposed classifier. |
| 21 | "The sim's dominant uncertainty is GEOMETRIC — 330× the met input" | **A metric chosen on one of two served numbers.** On the HEIGHT axis the ratio inverts: Hs +20% moves the served height 0.939 ft p50 (15.7%) vs 0.064 ft (0.76%) for 12.6° of bearing. Doubling Hs changes LEVEL on 0.1% of evaluations while changing height by 74% — proof the quality metric is height-normalised by construction. The 1.9×-spread statistic also does not reproduce (measured 1.18×, overlapping), and the discriminator it says is missing is served today. |
| 22 | "C8 refuted: widening is not monotone" *(as a defect)* | **A distance metric that is not the served number.** All 231 changes are `None` → value: 0 lost, 0 replaced, 0 depth changes. The three "farther" spots are three of the 231 improvements. And the widening **closes its own latent trigger**: post-widening those spots read `actionable=False / needs_geometry=False`, so `add_overlay_entry` is never reached there with a non-None normal. |
| 23 | "The what-if is a point estimate over a saturated curve" | **A flag read off this process's env instead of the served payload** — the repo's own recurring scar. Every run used `reference_size_m=None`, the legacy 1.2 m curve; `RATING_LOCAL_SIZE` has been 1 in all three lanes since `3263031c`. With a local reference the flat band collapses from 10/11 to 2–3/11. Already adjudicated in v2 §2.2, which records the identical self-correction. |

### Process scars recorded today

- **A mutation battery run on the SHARED working tree gave the OPPOSITE verdict** to the same
  mutation in a clean `git worktree` (M7: `rc=1` vs `rc=0`), because a concurrent session was editing
  `forecast-ingest.yml` inside the measurement window. **Run every guard battery in a clean worktree
  at HEAD.**
- **`node -e` shell escaping produced `defined=false` for a KNOWN-PRESENT control** — caught only
  because the control existed. Re-run from a file.
- **An `lru_cache` swallowed an env flip** (#7 above). Any A/B on `SHORE_NORMAL_*` must call
  `_nearest.cache_clear()` between arms or it measures nothing.

---

## §5 REMAINING TASKS — one ordered queue

Each item: the **GATE** (what must be measured before building), the **GUARDRAIL** (what proves it
landed), and whether it is a **PRODUCT EVENT** (a user-visible number changes).

| # | Task | Gate (measure first) | Guardrail | Product event? |
|---:|---|---|---|---|
| **1** | **Close the monitor-lane blindness (F1).** Give the parity monitor comparator its own scope. | Confirm the naive `COMPOSITION_PREFIXES` widening is rejected — it takes the suite to `2 failed` (already measured). Decide the registry contract question first: scalar column vs named exemption. | The exact mutation matrix from §2 F1: monitor drift → red, monitor delete → red, both ingest lanes agreeing → still green, plus the 5 existing positive controls still red. | No |
| **2** | **Correct the recorded blast radius (F2)** in `shore_normal_asset.py:53` and `:74`, `test_shore_normal_borrow_radius.py:21`, the handoff, MEMORY.md, and both workflow comments. | Re-run the census through `sim_forecast.fetch_catalog()` and report `catalog_source()` beside every percentage. | A census that prints its catalogue source and row count. Do NOT hard-assert `== 'live_catalog'` — it needs Render reachable and would void offline work. | No (records only) |
| **3** | **Raise the chain ratchet to `MIN_FILES = 65` (F4).** | Read `MIN_PASSED` off the GATE'S OWN RUN on `origin/dev`, never off a checkout (`ci.yml`'s own `6c4ab178` lesson). Composition (96→102) must wait for a quiet tree — the concurrent untracked test file lands in that lane. | Delete one chain file locally; the gate must go red. | No |
| **4** | **Carry the borrow distance (F3).** `shore_normal_km` on `SurfGeometry` → `"etopo:borrowed"` → `_IMPACT` entry → `sim_rating.geometry_payload`. Fix `sim_compare.py:321` to branch on `missing` (F6) in the same change. | Nothing new — the borrow distribution is already measured (p50 1.981, max 2.996 km; 231/231 indistinguishable). | Extend `test_a_borrowed_bearing_does_not_borrow_a_depth` with a fixture that HAS a break depth, so `full` can never be asserted over a borrowed bearing. Threshold **>0 km**, not `>MATCH_RADIUS_KM`. | **Yes, string-level** — a user-facing MCP caveat changes for ~349 spots. No number moves. |
| **5** | **Declare the four boolean shore-normal switches in `_RATING_FLAGS` and widen `_RATING_SURFACES` (F5, F10).** | Decide whether `ecmwf_opendata_fetcher.py` joins the surface list — it pulls in 5 non-composition knobs. | The guard must go red on an undeclared new switch in `surf_point.py` / `shore_normal_asset.py` / `surf_height_convention.py`; teach the regex the `_v3("…")` form. | No |
| **6** | **M4 composition half — bands → partitions.** Declare `ECMWF_PERIOD_BANDS` in `forecast-ingest-pilots.yml` FIRST (F8); promote the standalone decode harness into `backend/tests/`. | C5 (BANDS_CLOSE, n=20494) is **[I]** and was NOT re-run today — `pygrib` has no wheel here. Re-run `scripts/ecmwf_band_closure_probe.py` on a box with pygrib, and on a 06/18z cycle, before wiring. C7 stands: the whole ECMWF decode loop has never executed under test. | The alignment/per-point contracts (S1/S2/S8 in the harness), each with its negative control. Add `ECMWF_` to the monitor scope once composition lands. | **Yes, when flipped** — EURO gains partitions. Today the flag is `'0'` in every lane and changes nothing. |
| **7** | **M5 — Kr.** First fix the `surf_transform.py:14` comment (F7). | **A/B against `_height_exposure_factor`'s 0.595–1.0, not against 1.0**, or direction is double-counted. Note Kr can exceed 1.0 (measured max 1.031) while the exposure factor is capped at 1.0 and cannot focus. | Named exemplars, not aggregate PSI — PSI reads 0.0000 under a full shuffle that moves 70.9% of spots. | **Yes** — median Kr 0.797, 1.75× swing at a fixed site (that figure is **[I]**, from `validate_nearshore_transform`). |
| **8** | **M3 — the `ifs/waef` 50-member ensemble.** | Its leverage claim is **unsettled**: the "geometric uncertainty dominates 330×" argument was struck (§4 #21) because it measured only the quality axis; on the HEIGHT axis met input dominates 15×. **Measure both served axes before committing.** Values remain UNVERIFIED — count values. | A known-present/known-failing control on the URL stem (a prior session's wrong stem `-ef` vs `-fc` was caught only by a control). | **Yes** — a new input to the served height. |
| **9** | **M6 — self-invalidating docs.** Close CLAUDE.md:45 (F12), `_nearest`'s "nearest-wins within 1 km" docstring (F9), `ecmwf_opendata_fetcher.py:52`'s scwv comment, the `lru_cache` sizing comment (F14), and `test_flag_lane_parity.py:133`'s "covered by the next test" (F11). | None — each is measured above. | Where a doc states a number, cite the artifact that produced it and its population (this is the F2 lesson generalised). | No |
| **10** | **#22 → CLOSED (`0a00766f`); #10 stays OPEN.** Record the ancestry check that proves it. | None. | — | No |
| **11** | **#26 dead levers.** Delete the 3 phantom levers from the queue; route any partition A/B through `SURF_PARTITIONS`. | The 12 levers still have 0 reads (re-verified today). ⚠️ `SURF_PARTITIONS` costs **4×**. | — | No |
| **12** | **#7 waves-arrow.** Still DORMANT, structurally intact. | The queue's prescribed single log distinguishes the two mechanisms (key absent vs array shorter than total) at `normalizer.py:348/:356/:358`. The 0.95 availFrac gate at `:193` is ours. | Run every direction ladder in BOTH rating states — three prior "fixed" sessions each measured something adjacent. | **Yes, if it reproduces** — a tier-boundary direction flip. |
| **13** | **M9 (new) — antimeridian wrap (F13) and the two-store precedence guard (F9).** Cheap hardening. | Both latent: 0 catalogue spots within 3 km of ±180; 0 overlay bearings exist. | A seam guard asserting the bucket indices really differ by more than the span; a precedence guard with a full overlay entry at 0 km vs an asset entry at 2 km. | No |

---

## §6 LIMITS — what this audit did NOT establish

1. **C3 was not re-measured.** The OSM grading (n=113, coarse p50 38.7° → borrowed 12.6°, better
   73.5%, >90° errors 16.8% → 9.7%) is **[I]**. The OSM coastline source is not in-repo. It is used
   above only as an INPUT to Jacobian perturbations, never as evidence. Its direction is weakly
   corroborated in-repo by the spread distribution (borrowed p50 15.4° vs own-entry p50 13.0°
   **[M]**) — note that this in-repo corroboration is far weaker than the 1.9× that was claimed and
   struck. **Quote 12.6°, never the 4.3° hold-out figure: that was ETOPO graded against ETOPO,
   i.e. self-consistency.**
2. **C5 was not re-measured.** The band-closure probe (n=20494, p50 0.5549, p99 0.9929, max 1.0012,
   0.0% exceeding → BANDS_CLOSE) is **[I]** and gated on `pygrib`, which has no wheel for this box's
   Python (CCSDS/AEC template 5.42). The probe's own arithmetic was reviewed and does NOT suffer the
   block-mean/point-sample contamination that was alleged (`ecmwf_band_closure_probe.py:166-178`
   forms `sqrt(quad_sq[ocean]) / total[ocean]` from raw native 0.25° arrays — one estimator on both
   sides) — but the numbers themselves were not reproduced.
3. **No full CI lane RUN was completed.** Both `MIN_FILES` figures are deterministic collect-only
   counts. `MIN_PASSED` for either lane is **unmeasured** and must be read off the gate's own run on
   `origin/dev`.
4. **`dev.db` vs production, restated.** `backend/dev.db` is a 1,587-row snapshot last written
   2026-07-12. Its asset-miss share (49.1%) is **twice** the live catalogue's (23.8%); name-matched
   coordinate drift is p50 0.000 km / p90 3.470 km / >1 km 22.0% **[M]**. Every count in this
   document is labelled with its catalogue. Where only a dev.db figure exists (F3's 231-spot
   readiness deltas, F14's 1584-coordinate cache census, the joint-distribution table), **the ratios
   travel and the absolute counts do not** — the live equivalents are roughly 91/1773 for the gaining
   class.
5. **No production credentials.** `backend/.env`'s `SUPABASE_URL` points at a project whose public
   schema no longer exposes `surf_spots` (PGRST205), so no DB row state was read from production. The
   live catalogue was obtained through `sim_forecast.fetch_catalog()` (the app's own HTTP endpoint).
   Consequently: whether Bondi's production row carries
   `geometry_reject_reason='ambiguous_coastline'` is **unverified**, and whether
   `seed_geometry_columns.py --apply` has ever been run against production is **unknown** (its
   sibling's docstring says REST PATCH is 403 under RLS, which suggests it is the dead lane).
6. **`shore_normals_overlay.json` is untracked, has never been committed on any branch, and is not
   gitignored.** Three findings' local behaviour depends on it. Every production-shape statement here
   was re-run with `SHORE_NORMAL_OVERLAY=0` and the cache cleared. **The overlay's tracking status is
   an open decision, still carried from the 2026-08-01 handoffs.**
7. **`pygrib` could not be executed.** The shortName conclusion (§3) is a derivation from ecCodes
   source + definition tables + hand-parsed live GRIB2 octets — three independent artifacts agreeing,
   which is not a fit graded against itself, but is **not an execution**.
8. **`SURF_HEIGHT_H110`'s Render value is unknown**, as is every other Render env value. That is the
   whole point of F5. Nothing in this audit can see that lane.
9. **Nothing in this audit measured the frontend.** Greps establish that `geometry_readiness`,
   `shore_normal_source` and `geometryReadiness` have zero hits in `frontend/src`; no rendering was
   exercised, and the accessibility and three-theme mandates were not audited.
10. **Not re-executed by a second agent:** the corrections in §4 were each produced by one
    verification pass. Where a struck finding's refutation itself rests on a single measurement, it
    is stated inline (e.g. #7's cache-clear discovery, #14's `PRAGMA` result).

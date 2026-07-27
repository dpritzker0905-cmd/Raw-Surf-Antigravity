# HANDOFF 2026-07-27 LATE — the weather simulation server answered nothing, and could not forecast the catalogue

**Continues `HANDOFF-2026-07-27-NIGHT-catalogue-from-open-data.md`.**
3 commits on `dev`, tree clean. Backend **1092 passed / 0 failed** (the pre-existing unrelated
`test_media_privacy_contracts.py` grom-media failure excluded, as before).

Read [[standing-work-rules-user-mandate]] first. Everything below was measured against the running
server, and **two claims in my own memory were overturned** — marked ⛔ where they appear.

---

## 0. ⛔ DO THIS FIRST: RESTART THE WeatherSimulation MCP SERVER

The running server process holds the OLD module and is **still deadlocked**. Until it is restarted,
`mcp__WeatherSimulation__*` calls will keep hanging to the 1800 s client timeout. Nothing else in
this handoff is observable through the MCP tools until then.

---

## 1. ★★★ THE SERVER WAS UNREACHABLE, AND 26 GREEN UNIT TESTS SAID OTHERWISE

`mcp__WeatherSimulation__get_surf_spots` **aborted at the client's 1800 s idle timeout** — the same
hang the 2026-07-26 memory recorded and dismissed. Driving the server over stdio the way the client
does:

```
initialize      4.11s  OK
tools/list      0.01s  OK
get_surf_spots  *** NO RESPONSE after 480s ***
```

### The root, from faulthandler stacks of the live server (byte-identical at 25 s, 50 s, 75 s)

```
get_surf_spots -> shore_normal_for -> spot_geometry -> resolve_surf_geometry
  -> bathymetry.shelf_depth_at:108 -> import numpy -> create_module   <- STUCK
     [AnyIO worker thread]
```

`import numpy` is a **function-level import inside `shelf_depth_at`**. So the first tool call is the
thing that loads numpy's `_multiarray_umath` C extension — inside a worker thread, under the running
stdio event loop — and that DLL load never returns.

### ⚠️ Four hypotheses killed by measurement — so nobody re-tries them

1. **Not slowness.** The hung process had **3.7 s of CPU across 43 minutes**. Blocked, not computing.
2. **Not fastmcp, and not sync-vs-async dispatch.** A minimal server containing **zero Raw-Surf
   code**, with a trivial *sync* tool, answers in **0.01 s** on the same interpreter.
3. **Not `get_surf_spots`.** ★ Whichever tool is called **FIRST** is the one that hangs — swapping
   the order moved the hang to `get_weather_forecast`. And **a second request unblocks the first**,
   whose response then arrives under the OLDER id. **Read the response `id`**, or you will credit
   the wrong call: that is exactly what made my first probe look like "one bad tool".
4. **Not fixed by importing `bathymetry`.** numpy is imported inside the function, not at that
   module's scope, so importing the module warms nothing. I tried this first and it cost a cycle.

⚠️ A plain `threading.Thread` (0.115 s) and a bare `anyio.to_thread.run_sync` (0.11 s) both
**complete** the same call. **Only the real stdio server reproduces it.**

### The fix (`f794f78f`)

`_warm_hot_path()` runs one full `calculate_surf_rating` at module import **on the main thread**, so
every lazy import on the tool hot path — numpy, the bathymetry grid, the ETOPO shore-normal asset,
the magnet overrides, `estimate_surf` — is resolved before the server serves. Measured cost
**0.2 s**. The identical call now returns in **0.02 s**, and all four tools work end to end.
Kill: `SIM_EAGER_WARMUP=0`.

★★ **THE LESSON.** The 26 unit tests on this file all passed throughout, because they call the tool
functions **directly on the main thread** — the one context in which the bug cannot occur. A green
suite proved nothing about whether the server could answer at all.
`tests/test_weather_sim_mcp_server_startup.py` now drives the real server over stdio and **fails
with a 60 s hang** under `SIM_EAGER_WARMUP=0`.

★ **THE GENERAL RULE: in an MCP/async server, never let a C-extension import happen for the first
time inside a request handler.**

---

## 2. ★★★ IT COULD FORECAST 3 OF 1547 SPOTS (`7f04c945`)

`get_weather_forecast` carried a baseline only for the three hand-tuned `MOCK_SPOTS`; the other
**1544 returned `forecast: null`**. My own memory called that "by design, not a bug". It is design,
**and it is the missing feature** — a forecast tool that cannot forecast 99.8% of the catalogue.

The app already serves exactly this at **`/api/weather/point`**, off the same cached product grid the
heatmaps sample. So the sim **asks it** rather than modelling a second forecast, and
★ **the mapping is copied verbatim from `spot_ratings.rate_one_spot`** — the production consumer of
that endpoint — so a second caller cannot drift into a private reading of the same payload:

| sim field | source | ⚠️ |
|---|---|---|
| `swell_height_m` | marine `point.speed` | **OFFSHORE Hs, not the breaking height** |
| `swell_period_sec` / `swell_direction_deg` | marine `point.period` / `.direction` | |
| `wind_speed_knots` | wind `point.speed` | **that endpoint already reports KNOTS** |
| `wind_direction_deg` | wind `point.direction` | |

**Precedence: staged override → LIVE forecast → hand-tuned catalog default.** Live outranks those
defaults deliberately — they are invented constants for three spots. An override still wins, because
it is the caller's explicit what-if.

⚠️ **Both legs are required.** Marine-without-wind falls back and **names its reason** rather than
fabricating a wind — an invented wind is exactly how a blown-out day reads clean.

### The parity block — the divergence is now printed, not hidden

`marine.surf_height_m` is the **breaking** height the app itself serves. The sim computes its own
from the offshore Hs through the production chain, and the response now reports both plus
`delta_pct`. A silent divergence there is the defect `cf2efb48` was written to end.

Measured live: **Mavericks served 2.3077 m vs sim 2.3165 m = +0.38%**, **Pipeline −0.2%** — entirely
the 0.1 ft rounding of the reported value.

**Live-verified through the real stdio server:** `Trestles`, previously `null`, returns a
**0.77 m / 17.6 s swell from 202.8°** against its **220.9° ETOPO normal** (18° off — a textbook south
swell) in **0.72 s**. Kill: `SIM_LIVE_FORECAST=0`; also `SIM_FORECAST_BASE_URL`,
`SIM_FORECAST_MODEL` (GFS), `SIM_FORECAST_TIMEOUT_S`.

⚠️ The suite is kept hermetic by an autouse fixture setting `SIM_LIVE_FORECAST=0`; the live lane's
own tests stub `sim_forecast.fetch_point`. A network cannot exercise a mapping deterministically,
and today's swell is not a fixture.

---

## 3. THE 800-LOC RATCHET FORCED A GOOD SEAM (`5d8babe4`)

`weather_sim_mcp.py` landed at **exactly 800 lines**, so the next change to it would have failed
`loc-check`. The forecast lane was the natural seam — cohesive, no MCP dependency, useful to any
out-of-process caller. `services/weather_pipeline/sim_forecast.py` (120 lines) now owns the config,
the hourly cache, the two point fetches and the mapping. **`weather_sim_mcp.py` 800 → 700.**

---

## 4. Verified along the way, not changed

* `condition_reports` in `dev.db` is **schema-valid** for the sim's UPDATE (`spot_name`,
  `wave_height_ft`, `conditions_label`, `wind_conditions`, `is_active` all present) but holds
  **0 rows**, so `database_updated: false` is correct in dev, not a defect.
* `get_surf_spots(limit=500)` resolves geometry for all 500 in **0.29 s** — no robustness issue at
  the maximum limit.
* The sim's geometry matches production exactly at Mavericks: shore normal **225.1° etopo**, shelf
  depth **101.5 m**, regime `shoaling` — identical to what `/api/weather/point` returns.

---

## 5. ★★★ THE SHORE-NORMAL GATE: A COUNT WAS DOING A CONFIDENCE JOB (`6b739835`)

With the sim reachable, the next Jacobian is the largest degraded population in the app:
**567 of 1515 spots (37%) had NO ETOPO shore normal** and fell back to the coarse 0.25° grid — a
bearing decided from a **194.6 km window** — while shore normal swings breaking height **40%**.
That is far bigger than the 164 flagged placements.

Verdict breakdown from the 15:38 build: accepted 948 · **ambiguous_coastline 264** ·
**too_few_windows 153** · **no_shoreline_in_window 149** · not_on_open_ocean 1.

### What was actually wrong
`accepted()` required `n_windows >= 3`. But **`fit_shore_normal` returns a bearing at TWO windows**
and None below — the build was stricter than its own fitter. All 153 rejects had exactly 2 windows,
**133 of them ON_OCEAN a median 0.21 km from open water**, agreeing to a **median spread of 5.5°**.

### ★★ The instrument, and why it can be trusted
Overpass was down (a real 504 from the main instance, timeouts from both mirrors), so OSM was
unavailable. Substitute: **accepted spots within 15 km as a local reference frame** — that
population was OSM-validated as a class at median 6.4°. ★ **Run leave-one-out on the accepted set,
the instrument reports 6.2°, reproducing the independent OSM number.** Calibrating a substitute
against the known result BEFORE using it on new data is what makes the rest of this defensible.

| | vs local consensus | coarse | ETOPO wins |
|---|---|---|---|
| accepted (control, n=176) | **6.2°** | 14.6° | 70% |
| 2-window candidates (n=41) | **10.1°** | 17.4° | 68% |

⚠️ **Measurement killed the obvious alternative.** "Loosen the spread gate to recover the 264
ambiguous" — NO: their spreads are p50 **69.7°**, p75 107°, p90 165°, not clustered at the boundary;
≤50° recovers only 54. They are genuinely ambiguous coastlines. **The 40° gate stays.**

### ✅ Rebuilt: 948 → **1073** of 1515 (62.6% → **70.8%**)
Predicted +129, actual **+125**; `too_few_windows` is now 0 and the 4 difference went to the ocean
gate (1→5) and spread gate (264→268) — the other clauses still bite.

**Payoff through the REAL rating engine** (118 comparable spots, 8 swell directions, sea state
fixed): shore normal moves **median 22.0°** (p90 67.0), rating **median 2.8 pts** (p90 36.3), and
**43.1% of evaluations CHANGE LEVEL** — above the original ETOPO rollout's 27.4%, because these are
the spots the coarse grid served worst. ⚠️ That is CHANGE; the *improvement* evidence is the table
above. Kill: `SHORE_NORMAL_MIN_WINDOWS=3`.

`scripts/validate_shore_normals_osm.py` **is now committed** — written, used and thrown away on
07-26, then needed again 24 h later. It carries its own historic bug as a warning (averaging every
segment within N km makes the two shores of a spit CANCEL), plus mirror rotation and a certifi CA
context. ⚠️ **This machine's system CA store has an expired root**: Overpass fails
`CERTIFICATE_VERIFY_FAILED` while other hosts succeed, so "our API works" proves nothing.

---

## 6. ★★ THE SIM'S CATALOGUE WAS A DRIFTED SNAPSHOT (`913b4af7`)

Shipping the live forecast lane exposed this: the sim read its spot list from `dev.db`, which has
diverged from production in the way that matters most — **coordinates**.

| | dev.db (what the sim served) | production |
|---|---|---|
| Bethune Beach | 28.998,-80.926 — **the pre-fix coordinate** | 28.950892,-80.83899 (**~7 km**) |
| New Smyrna Beach Inlet | active | **deactivated** (inland duplicate) |
| row count | 1547 active | 1515 active |

★ **A stale catalogue is worse than a missing one once the forecast is real** — the sim was about to
sample a genuine forecast at a point 7 km from the spot and report it with full confidence.

Now served from the public `/api/surf-spots` (1515 spots, no credentials), snapshot as fallback, and
`source` names which answered (`live_catalog` vs `surf_spots_snapshot`). Verified end to end through
the real stdio server: **Bethune Beach resolves at 28.950892,-80.83899 with shore normal 57.9° etopo
— the value the relocation produced.** Kill: `SIM_LIVE_CATALOG=0`.

---

## 6b. ★★★ A MISPLACED SPOT WAS REPORTED AS AN UNFITTABLE ONE (`084a29f4`)

Chasing the remaining 442 spots without a normal turned up something better than a fitting fix.

**`spot_misplaced` fired on 0 of 1515 spots while 133 were provably beyond `MAX_SHORELINE_KM`** —
Manzanillo **12.01 km** from shore at +79.9 m, Nihiwatu 10.58 km at **+264 m** — every one labelled
`no_shoreline_in_window`.

★ **The cause is clause ORDER.** A badly misplaced pin has no coastline in its window, so it failed
the FIT clause first, short-circuiting the placement check that would have named the real problem.
**The worse the misplacement, the less likely it was called one.** The clauses answer two different
questions — *is this coordinate a surf spot at all?* (actionable: move the pin) versus *is the fit
trustworthy?* (describes the data) — so placement is now tested first.

⚠️ **This cannot change which spots are accepted** — every clause is a rejection, so reordering can
only change the reported reason. Verified by replaying BOTH orders over the real 1515-row review
CSV: **accepted 1070 both ways, accept set IDENTICAL.** The shipped asset is unaffected.

**140 labels change**, all from an unactionable fitting failure to an actionable placement error:

| was | actually is | n |
|---|---|---|
| `no_shoreline_in_window` | **`spot_misplaced`** | 58 |
| `no_shoreline_in_window` | **`not_on_open_ocean_inland`** | 52 |
| `spot_misplaced` | `not_on_open_ocean_inland` | 13 |
| `no_shoreline_in_window` | `not_on_open_ocean_no_ocean` | 8 |

⇒ **127 spots with fixable coordinate errors were invisible.** That signal is the prerequisite for
importing new spots safely — an import gate needs a truthful "misplaced".

### ⚠️ The detector is one-sided, and this is its seaward half
`placement_verdict` returns ON_OCEAN | INLAND | NO_OCEAN — it asks only whether swell can REACH the
pin, so a spot stranded in open water passes. Measured: **293 spots (19.3%) have their pin in water
deeper than 20 m**, 141 deeper than 50 m, 90 deeper than 100 m — **all ON_OCEAN**, and **114 already
ship a shore normal**. Cannon Beach sits at **−40 m, 2.7 km offshore**; Punta de Lobos at −107 m.
⚠️ Depth alone is NOT a misplacement test — Cane Bay is 0.32 km from shore in 240 m of water, a real
steep drop-off. The shoreline-DISTANCE gate is the one that catches these, which is why its ordering
mattered so much.

### ⚠️ I corrected my own estimate here
The previous handoff said "most likely the next +89" for the `no_shoreline_in_window` bucket. **That
was wrong**: only **~31** of the 89 ON_OCEAN spots are inside the 3 km bound and therefore
recoverable at all; the other 58 fail the misplacement gate regardless. They are not a fitting
problem to solve — they are coordinates to fix.

---

## 6c. ★★★ THE OWNER'S ERRORS: THE LIVE LANE COULD OUT-WAIT THE CLIENT (`576dcbdd`)

Owner reported errors from the MCP server. **Reproduced, and it was my own regression.** Putting
network I/O inside the tool handlers with a 30 s timeout meant that with the app unreachable
**`get_surf_spots` blocked 42.2 s and `get_weather_forecast` 42.1 s** — past the point where an MCP
client reports a TIMEOUT instead of an answer. The sim looked broken while being merely patient.
⚠️ **The host is a free Render instance that cold-starts in ~50 s: slow is a NORMAL state here.**

| | before | after |
|---|---|---|
| `get_surf_spots`, app down | 42.16 s | **8.03 s** |
| `get_weather_forecast`, app down | 42.08 s | **0.00 s** |
| second call, app down | 42 s | **0.00 s** |
| live data when reachable | ✓ | ✓ (0.58 s / 0.39 s) |

Three fixes: timeout **30 → 8 s** (warm requests measure 0.5–1.1 s) · a **circuit breaker** with a
60 s cooldown (without it every call re-pays the timeout, and `get_weather_forecast` makes TWO
requests — the same pile-up the 429 breaker was added for) · the catalogue **prefetched in a daemon
thread at start**, safe off the main thread only because `urllib`/`ssl` are imported at module scope.

★★ **A second failure mode found while measuring: RESPONSE SIZE.** `limit=500` serialised to
**93.5 KB (~24k tokens)**, which a client REJECTS rather than displays — also indistinguishable from
"the tool is broken". The cap is now a measured budget (200 ≈ 9.6k tokens), coordinates round to
5 dp and bearings to 1 dp (they were serialising at 17 significant digits), and the payload carries
`total_matching` + a note so a truncated answer can never look complete.

---

## 6d. ★★★ THE WORST-PLACED SPOTS ESCAPED THE MISPLACEMENT BOUND (`bf47d86e`)

A bound expressed in km-from-shore **cannot see a pin that has no shore in its window**:
`shoreline_km` is None when the ~18 km fetch window holds no shoreline, so the further out to sea a
pin is, the more certainly it escapes. The same shape as §6b, one level deeper.

25 spots have no shoreline measurement, and they split cleanly by the **sign of the pin elevation**:
8 above sea level were already caught as `not_on_open_ocean_no_ocean`; **17 UNDERWATER were reported
as unfittable** — **Telescopes −1778 m · Macaronis −1686 m · Scorpion Bay Second Point −1677 m ·
Iron Bottom Sound −654 m.** World-famous breaks whose stored pin sits in over a kilometre of water.

New verdict `spot_misplaced_at_sea`, bounded by **physics not a percentile**: a wave breaks in
roughly 1.3× its own height, so nothing breaks below 50 m — while a genuine shallow offshore bank
(Cortes Bank breaks over a seamount) reads far shallower and is deliberately NOT caught, pinned by
its own test. Accept set still exactly 1073.

### ★★ THE CONVERGENCE — and the production write that turned out NOT to be needed
I predicted the newly-named misplacements were "very unlikely to all be inside the existing 164
production flags". **WRONG. All 147 were already flagged — `newly_flagged: 0`.** The earlier session
flagged from `ocean_verdict` + shoreline distance directly; only the build's *label* was wrong.
⇒ **No production write was needed, and none was made.** A snapshot was taken, found unnecessary,
and dropped.

★ Final diagnosis: **74 inland + 65 misplaced + 17 at-sea + 8 no-ocean = 164** — *exactly* the 164
spots production has flagged, reached by a different route on a different day. **Two independent
paths naming the same population is the strongest evidence either of them is right.**

---

## 7. NEXT (ranked)

1. **Restart the MCP server** (§0), then re-probe the four tools through the client.
2. ✅ **RESOLVED, NOT PENDING — the placement flags were already correct.** See §6d: the measured
   overlap was **147 of 147 already flagged, 0 new**. No production write was needed or made.
   ⇒ The remaining accuracy work is **moving the 164 coordinates**, not finding more of them.
3. **The remaining spots without a normal, corrected estimate:**
   * **`no_shoreline_in_window`** — only **~31** are inside the 3 km bound and recoverable by
     fitting; the rest are coordinates to fix, not fits to rescue.
   * **`ambiguous_coastline` 268** — genuinely ambiguous (p50 spread 69.7°). Leave them.
   * The window ladder is (0.015, 0.02, 0.03, 0.045)° while the FETCH window is ±0.08°, so a larger
     rung costs **no extra ERDDAP request** (that API charges per request, not payload). Cheap to
     test for the ~31.
2. **The owner's call this session: refine existing spots before growing the list.** The reasoning
   is recorded and still stands — placement error moves the shore bearing 35° per 1.6 km and the
   normal swings breaking height **40%**, there are **165 flagged spots and that is an undercount**
   (the water-blind detector missed all three Volusia spots the owner caught by eye), and every
   import runs through the same geometry chain, so expansion multiplies whatever it does.
3. **Re-run the placement flags from `ocean_verdict`** once the shore-normal asset rebuild lands.
4. **Work the Precision Queue** — the 165 flagged spots are visible and filterable in the admin.
5. Only then: import the ranked PT/IE candidates (`--commit`), then France/Spain/UK.
6. Buoy calibration: fit a **quantile** correction, not a single number.
7. **Do NOT flip `RATING_LOCAL_SIZE`** — still no oversize penalty, so a beginner beach outranks the
   point break. (The sim follows the flag, so it tracks whenever it is flipped.)

### ⚠️ OPEN / LATENT
* `data://forecasts/summary` still iterates **`MOCK_SPOTS` only** — now that every spot has a live
  forecast, that resource is the narrowest surface left.
* `caller_role` remains **caller-asserted**. A sandbox gate, never the app's auth pattern.
* Size-climatology coupling (unchanged): `grid_size_climatology.py:95` / `surf_rating.py:453`
  compute climatology **without** a break depth while served heights have one. Harmless at
  `RATING_LOCAL_SIZE=0`; fix before flipping.
* `get_surf_spots` reports coarse orientations at full float precision
  (`160.25316339457387`) — cosmetic only; the ETOPO ones are clean.
* `test_media_privacy_contracts.py` still fails on `dev`, unrelated to all of this.

---

## 8. ★★★ SPOT ACCURACY: WHAT GEOMETRY CAN AND CANNOT DO (`af7d95c1`)

### ⚠️ First, a claim of mine that measurement overturned
The 3rd decimal of latitude is **`8` on 633 of 1515 spots and `2` on 316** — 949 of 1515 (62.6%)
where uniform would be ~151 each, i.e. **41 sigma** — and the four Mentawai breaks sit on a perfect
0.010° diagonal lattice. I concluded a large block of coordinates was **synthetic**.

**Wikidata (CC0) says no.** Name-matched, n=18 famous breaks: **p50 0.47 km**, 55.6% within 0.5 km,
83.3% within 3 km — Snapper Rocks **0.035 km**, Pipeline 0.245, Trestles 0.26.
★ And the instrument validated itself: the worst four are **Jaws 5.13 · Guincho 3.50 · Mavericks
3.46 · Cloud 9 2.42 km**, reproducing `find_missing_spots`' known PLACEMENT_DISCREPANCY set exactly.
⇒ **The catalogue is broadly accurate with a specific bad tail.** The digit anomaly is real but does
not imply wrong coordinates.

### THE STRUCTURAL FINDING: detection and correction are different problems

| verdict | n | nearest-ocean proposal | usable? |
|---|---|---|---|
| `not_on_open_ocean_inland` | 74 | p50 **4.63 km**, max 12.01 | **0 of 74** inside the 3.0 km bound |
| `spot_misplaced` | 65 | 0.19 km — but they are ALREADY at sea | points the **wrong way** |
| `spot_misplaced_at_sea` | 17 | same | no shoreline in window to snap to |
| `not_on_open_ocean_no_ocean` | 8 | none | — |

⇒ **All 164 need an authoritative name→coordinate source.** This is the Volusia lesson at catalogue
scale: an ETOPO-only proposal kept Bethune Beach's wrong LATITUDE.

### The tool, proven
`scripts/propose_spot_corrections.py` — review CSV + any gazetteer CSV → name-match → **validate the
candidate against ETOPO** (a proposal that is itself misplaced launders a bad coordinate into a
reviewed-looking one) → ranked review artefact. **It never writes to the database.**

Against EEA bathing waters (CC-BY, 4478 ES/FR/PT sites): **7 proposals, all passing**, recognisably
correct — **Nazaré → `NORTE (NAZARE)`** (Praia do Norte, the canyon big-wave break), **El Socorro →
`PLAYA SOCORRO (EL)`, 7.57 km** from a pin sitting at **+1020 m elevation**, plus La Piste, Santocha
and Les Estagnots at Capbreton by exact name.

### ⛔ THE GAP, now precise — and it is the same gap as global expansion
**157 unmatched.** Flagged spots by country: Indonesia 23 · Chile 12 · Philippines 11 · Mexico 9 ·
USA 8 · Sri Lanka 8 · Nicaragua 7 · Spain 7 · Japan 6 · Peru 6. GNIS reaches 8, EEA ~12; **~144 are
outside US/Europe.** Worst-covered: Mentawai 8, South Coast 6, Rivas 4, Siargao 4, Arica 4.

★★ **`NGA GNS` (public domain, worldwide) is the missing source, and it serves BOTH goals — fixing
the 164 AND growing the catalogue globally. One fetcher, two jobs.** Add as
`spot_sources.py --source gns`, then re-run this proposer and `filter_spot_candidates`.
⚠️ **Not OpenStreetMap:** production holds zero `osm_id` and ODbL must not ride in through a
coordinate correction.

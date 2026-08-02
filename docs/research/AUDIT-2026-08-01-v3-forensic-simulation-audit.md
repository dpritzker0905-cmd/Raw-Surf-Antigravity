# Forensic Audit v3 — The Simulation System

**Date:** 2026-08-01 · **Measured at:** clean `git worktree` @ `f311d8f1` · **Mode:** read-only.
No functional code was altered. Every mutation was applied in a **disposable worktree** and reverted;
`git status -- services/` was verified clean after each.

**Predecessors:** v1 (ranked by CPU — ranking was wrong) · v2 (Jacobian lens — corrected 3 recorded
figures). This one is **forensic**: nothing here is read off the source and believed. Every claim was
executed, and every instrument was given a control that could fail.

---

## §0 — Method, and why the numbers can be trusted

This repo's recorded scars dictate the configuration. All four were honoured:

| Requirement (from the repo's own history) | What I did | Verified? |
|---|---|---|
| Never measure on a shared working tree | isolated worktree at committed HEAD | ✅ `git status` = 0 foreign edits |
| No `dev.db` (a test that names a spot must not assert about the machine) | worktree has none | ✅ confirmed absent |
| Block `fastmcp` — it is installed locally, absent in CI | `PYTHONPATH` stub raising `ImportError` | ✅ **control: `import fastmcp` fails**, and `weather_sim_mcp` still imports via `sim_mcp_shim` |
| Never edit source while a suite runs (`inspect.getsource` reads live) | **second** worktree for mutations | ✅ suite and mutations never shared a tree |

**Concurrent-session containment.** Another session committed 4× during this audit
(`1d269d97` → `0a00766f`) and holds 8 uncommitted files (the spot-hub `reference_size_m` waiver:
`spot_conditions.py`, `point_resolution.py`, `test_rating_composition_parity.py`).
`git diff --name-only | grep -c 'sim_'` = **0** at every check — the sim lane was untouched
throughout, and my worktree contains none of their in-flight edits. One consequence is flagged in
§4.3: they are editing the very parity guard this audit exercises.

---

## §1 — What I proved WORKS (evidence, not assertion)

### 1.1 ✅ The full composition guard suite is genuinely green — **1096 passed, 66 skipped, 0 failed**
96 files, 607 s, CI glob reproduced exactly, fastmcp blocked. CI's floor
(`ci.yml:333`, `MIN_FILES, MIN_PASSED = 96, 1090`) is **accurate and met** — not a floor pinned to a
number nobody re-measures.

### 1.2 ✅ The zero-network invariant HOLDS — measured with the socket layer genuinely severed
`socket.connect` replaced with a raiser, **control asserted first** (`create_connection` to a real
host must fail, or the timings prove nothing):

| sim call | seconds |
|---|---|
| `simulate_weather_change` (wind) | **0.093** |
| `simulate_weather_change` (swell) | **0.006** |
| `get_weather_forecast` | **0.005** |
| `clear_simulation_overrides` | **0.006** |
| `get_surf_spots` | **0.008** |

The `576dcbdd` regression (**42.2 s of blocking, past an MCP client's timeout**) has not returned.
The sim degrades gracefully — logs `live forecast … failed`, falls back, answers in milliseconds.

### 1.3 ✅ Input validation is airtight at the sim boundary — **15 of 15 adversarial inputs rejected**
NaN / +inf / −inf on height, period, wind speed, wind direction; negative height; 9,999 m; numeric
strings; garbage strings; 720°; −45°. **Zero non-finite scores, zero NaN→`epic` leaks.** Numeric
strings raise `TypeError` rather than silently coercing — defensible either way, but it is a refusal,
not a wrong number.

### 1.4 ✅ The guard lattice is real — **6 of 6 realistic defects caught**

| # | Defect injected | Verdict | Guards red |
|---|---|---|---|
| M1c | served reference gated behind `RATING_LOCAL_SIZE` (*the* design error `5f19ac7d` fixed) | **CAUGHT** | **4** |
| M2c | geometry-blind demotion deleted from `sim_compare`'s rank key | **CAUGHT** | 1 |
| M3 | shim `run()` silently succeeds instead of refusing | **CAUGHT** | 2 |
| M4c | `break_depth_m` dropped from the sim's engine call | **CAUGHT** | 1 |
| M5 | served reference discarded at the sim's engine call | **CAUGHT** | 2 |
| M6 | knots conversion divides instead of multiplying | **CAUGHT** | 2 |

★ **M1c reproduced the recorded result exactly** — the memory records that mutation as "4 red"; I
measured 4 red, naming the same guard file. That is a two-sided reconstruction of a historical
claim, not a re-assertion of it.

### 1.5 ✅ The sim's payload is genuinely sophisticated
`quality_raw` beside `quality_confirmed` (gate observability) · `why.limiting_factor` with a
**counterfactual** (`score_if_this_were_1_0`) · `geometry.readiness` + `readiness_note` ·
`baseline_delta` naming `held_from_forecast` · `size_verdict` · `rideable_ceiling_ft` ·
`shore_normal_source`. This is better introspection than the commercial surf apps expose at all.

---

## §2 — What I proved is MISSING (2 unguarded defects, both reachable)

A battery that only probes what you expect to be guarded will always report a healthy system. Round 2
deliberately targeted seams. **4 caught, 2 missed.**

### 2.1 ⛔ `score_to_level` — NaN falls through to `'epic'`, and **no guard pins it in either direction**
Reproduced directly:

```
rating_score(NaN surf_h) -> nan  ->  score_to_level(nan) -> 'epic'
```

`score_to_level` iterates `score < upper`; **NaN is never `<` anything**, so it falls past all six
buckets into the open-ended top one. Mutating that behaviour changed **zero** of 601 tests.

**Reachability, measured honestly:** every *current* live caller is protected upstream —
`estimate_surf(NaN)` correctly returns `(None, 'unknown')` via its `Hs_m != Hs_m` guard, and the
sim's own validator refuses NaN at the boundary (§1.3). So this is **latent, not live**.
⚠️ But it is latent in the worst place: the failure mode is *the top rating*, and the repo has
already shipped this class once (recorded: "unguarded → score NaN → level `'epic'`"). The
protection lives in **callers**, which is precisely the distributed-guard shape the 2026-07-19 wind
lesson says leaks. **A terminal `math.isfinite` guard in `score_to_level` costs one line.**

### 2.2 ⛔ The sim's geometry cache key is unpinned — a coarsening would silently merge 487 spot pairs
`sim_rating.spot_geometry` keys `_GEOMETRY_CACHE` on `(round(lat,6), round(lng,6))` (~0.1 m).
I coarsened it to 2 dp (~1.1 km): **601 passed, 0 red.**

Measured reachability over the real catalogue (1,587 spots): **487 spot pairs sit within 1.1 km of
each other.** A 2 dp key would collapse each pair onto **one shore normal** — the #1 Jacobian
variable, whose coarse-vs-fine error was measured in v2 at median 24.7° and **LEVEL differing at
58.1% of spots**.

Nothing collides today. The finding is that **nothing prevents it**: a future cache-hit-rate tuning
would ship silently, and the symptom (neighbouring spots agreeing) reads as plausible.

---

## §3 — My own errors, written down (they are half the value)

Per this repo's rule 11, the record of what was disproven is worth more than the record of what shipped.

1. **⭐ I reported a false "MISSED" and caught it myself.** Round 1's M1 added
   `and _sim_flag("RATING_LOCAL_SIZE")` — but `_sim_flag` **defaults to `"1"`**, so the condition was
   always True and the mutation was **inert**. An inert mutation reads *exactly* like a missed guard.
   Fixed by (a) using the real check `os.environ.get("RATING_LOCAL_SIZE","0")`, and (b) adding an
   assertion that the mutation **landed** before trusting a green run. Round 1's true score is 6/6,
   not 4/6.
2. **⭐ My AST census mis-attributed a call by FILE instead of by enclosing FUNCTION**, and I nearly
   reported the engine's own 12-positional internal delegation as a surface defect. Re-ran with
   enclosing-function attribution; the alarm dissolved.
3. **⭐ My ECMWF ensemble probe returned 404 for everything — and its own control failed.**
   `ifs/enfo` came back 404, but IFS-ENS is certainly on open data. The probe used the `-fc` stem;
   ensembles use `-ef`. Had I not included a known-present control I would have published
   "ensembles unavailable." Corrected probe: control passes, and the finding in §5.1 is the opposite.
4. **A candidate finding died on measurement.** The map rating band omits `break_depth_m` — but the
   omission is **explicitly documented** ("a heatmap cell is a zone, not a spot") and measures
   **0.0 at all 9 test points** when a climatology reference exists. See §4.2 for the narrow
   condition where it survives.

---

## §4 — Findings that are real but bounded

### 4.1 ✅ Memory correction: the sim **does** now gate
The recorded memory says *"⛔ NOT fixed: the hub and the sim still don't gate."* At HEAD,
`sim_rating` carries an explicit `── THE OBSERVATION GATE (#13, owner decision 2026-07-31) ──` block
and emits `quality_raw` / `quality_confirmed`. Gate references per surface:
`sim_rating` 4 · `spot_conditions` 2 · `spot_ratings` 1 · `grid_resolver_surf` 21 · `routes/weather.py` 5.
**The recorded asymmetry has been closed for the sim.**

### 4.2 ⚠️ The map band's `break_depth_m` omission is inert *only while a reference exists*
Same spot, same sea, reference supplied → **0.0 delta at 9/9**. With `reference_size_m=None` — the
band's own documented fallback — it differs at **7 of 9**, signed both ways:

| spot | Hs | with break_depth | without | Δ |
|---|---|---|---|---|
| Cocoa Beach | 8.0 m | 46.6 `fair` | **97.5 `epic`** | **+50.9** |
| Cocoa Beach | 12.0 m | 39.0 `poor_fair` | **97.5 `epic`** | **+58.5** |
| Mavericks | 12.0 m | 96.5 `epic` | 29.9 `poor_fair` | −66.6 |

⇒ A 20 ft closeout at a Florida beach break reads **`epic`** on the map band **iff** the grid
climatology returns None for that cell. Whether that state occurs in production is **UNVERIFIED** —
`grid_size_climatology.reference_for` can return None (no blob, no cell, too few samples), but I
could not measure live cell coverage from this box. **That measurement is the whole finding**; if
coverage is 100%, this is dead.

### 4.3 ⛔ The parity registry claims five surfaces, enforces four, and lists four
`test_rating_composition_parity.py:356`:

```python
assert len(POST_STEP_SURFACES) >= 4, "all five rating surfaces must be listed"
```

`POST_STEP_SURFACES` holds exactly 4. The missing fifth is the **live `/spot-ratings` route** —
`routes/weather.py:389`, which applies the observation gate at 509–527 (`rating_confirmation`,
setting `raw_score` and `confirmed`). It is a genuine gating surface and it is not in the registry.

★ The guard exists precisely so a surface cannot join by simply not being listed — and an omission
is currently passing it, because the assertion's floor (`>= 4`) is below the number its own message
states. The **argument**-parity registry is narrower still: 3 surfaces (`spot_ratings`,
`spot_conditions`, `sim_rating`), so the map band and the live route are argument-unchecked.

⚠️ **In flight:** the concurrent session is editing this exact file. Re-check before acting.

---

## §5 — State of the art: where the simulation actually stands

### 5.1 ⭐⭐⭐ THE GAP: the simulation is **deterministic**, and the free data is **probabilistic**

Live-probed `data.ecmwf.int`, cycle `20260801 00z`, control (`ifs/enfo-ef`) verified reachable first:

| stream | stem | status | members | wave params |
|---|---|---|---|---|
| **`ifs/waef`** | `ef` | **200** | **50** | 13 (incl. all six period bands) |
| `ifs/wave` | `fc` | 200 | deterministic | 13 |
| `aifs-single/wave` | `fc` | 200 | deterministic | 11 |
| `aifs-ens/*` | both | **404** | — | not on free 0p25 |

**`ifs/waef` is a 50-member ensemble wave forecast, free, carrying every parameter the deterministic
stream carries** — including `h1012…h2530`. The repo fetches `swh/mwp/pp1d/mwd` from the
deterministic stream only.

Today the sim answers *"Mavericks will be 9.1 ft, 29.8 `poor_fair`"* — a point estimate with no
distribution. The state of the art is a **distribution**: *"7.4–11.2 ft (p10–p90), 62% chance of
`fair` or better, 8% chance of `epic`."* That is what 50 members give directly, and it is exactly
what a **what-if tool** most needs, because a scenario engine's honest answer to "what if the swell
builds?" is a probability, not a number.

★ The repo already gestures at this: the observation gate licenses good/epic on **"≥2 of 3 models
agreeing"** — a 3-member ensemble used as a crude confidence proxy. A 50-member ensemble is the
principled version of the thing the code is already trying to do.
★ [AIFS-ENS became operational 1 Jul 2025 and added a 51-member wave component on 12 May 2026](https://www.ecmwf.int/en/about/media-centre/news/2026/ifs-cycle-50r1-aifsv2-live),
CRPS-trained — but **measured, it is not on the free 0p25 endpoint yet**. `ifs/waef` is available now.

### 5.2 ★ There is no competitor to benchmark the *simulation* against
Research returned no published state-of-the-art for a surf what-if / scenario engine. The 2026
landscape ([Surfline, Windy, Windguru, surf-forecast.com, LazySurfer](https://www.surfertoday.com/surfing/the-best-surf-forecasting-websites-and-apps))
is forecast **display**, not scenario **simulation**. Surfline leads on cams plus human-checked
forecasts; Windy on map visualisation.

⇒ **The sim is not behind a competitor — it has no competitor.** The bar to clear is set by adjacent
fields (ensemble NWP, digital twins), not by the surf market. That reframes "state of the art" from
*catching up* to *defining it*, and it makes §5.1 the differentiator rather than a parity item.

### 5.3 What the sim already does that is genuinely ahead
Counterfactual explanation (`score_if_this_were_1_0`) · per-spot geometry readiness surfaced to the
user · ungated score retained beside the gated one · provenance carried per spot (`run_time` +
`wind_run_time`, because marine and wind shared a run at **0 of 4** spots) · ranking that demotes
geometry-blind spots because *fail-open inverts in a ranking* · a zero-network what-if path.
None of these are standard practice anywhere I could find.

---

## §6 — Recommendations, ranked by evidence

| # | Action | Evidence | Effort | Risk |
|---|---|---|---|---|
| **S1** | **Terminal `math.isfinite` guard in `score_to_level`** (+ a test asserting NaN does **not** read `epic`) | §2.1 — reproduced; 0 guards pin it | 1 line + 1 test | **LOW** |
| **S2** | **Pin the geometry cache key** — assert 6 dp, with the 487-pair collision count in the test's docstring | §2.2 — 601 tests green under a 1.1 km coarsening | 1 test | **LOW** |
| **S3** | **Add the live `/spot-ratings` route to `POST_STEP_SURFACES`; change `>= 4` to `== 5`** | §4.3 — registry contradicts its own message | small | **LOW** ⚠️ coordinate — file is in flight |
| **S4** | **Measure `grid_size_climatology` live cell coverage.** If it can return None on rated cells, pass `break_depth_m` to the band or floor the oversize gate | §4.2 — +58.5 and `epic` in that state | probe first | **MED** |
| **S5** | ⭐ **Ingest `ifs/waef` (50 members) and make the sim answer with a distribution** | §5.1 — probed live, free, all 13 params | large | **HIGH — product event** |
| **S6** | Widen **argument**-parity from 3 surfaces to all 5 | §4.3 — map band + live route unchecked | medium | **MED** |

### On S5 — the shape that keeps it zero-regression
Reuse the house pattern exactly: the deterministic member stays the served number; the ensemble
adds **new fields** (`p10 / p50 / p90`, `prob_level_at_least`), behind a flag defaulting off, in all
three lanes together. Nothing existing changes value. Sequencing:
1. **Decode and COUNT non-null values per member** — `waef` presence is verified, **values are not**
   (no GRIB decoder on this box; the index is 144 KB vs 2.6 KB deterministic, which *indicates* a
   populated 50-member field but is an inference, not a count). This repo's own scar is exactly this.
2. Cost it: 50 members × the existing marine footprint is the real constraint on a 1-CPU box —
   the recorded `SURF_PARTITIONS` lesson is *"precompute first, measure."*
3. Then the sim's what-if becomes a **distribution shift**, which is what a scenario engine is for.

---

## §7 — Limits of this audit, stated plainly

- **UNVERIFIED:** `ifs/waef` member **values** (presence + payload size only — no GRIB decoder here).
- **UNVERIFIED:** whether `grid_size_climatology.reference_for` returns None on live *rated* cells —
  this decides whether §4.2 is real or dead.
- **NOT TESTED:** the two modules CI excludes by name (`test_weather_sim_mcp*`) genuinely need a live
  MCP server; a stand-in cannot answer for them. Startup/dispatch remains verified only by hand.
- **CATALOGUE:** 1,587 spots from local `dev.db` (~90% of production); not the production list.
- **MUTATION COVERAGE:** 12 mutations across 2 rounds. A clean sweep bounds the *probed* defects, not
  all defects. The two misses were found only because round 2 deliberately hunted for them.
- **The concurrent session's 8 uncommitted files were never measured** — deliberately. My numbers
  describe committed HEAD `f311d8f1`, sim lane, which that session did not touch.

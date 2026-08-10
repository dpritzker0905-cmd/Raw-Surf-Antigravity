# V1 — RE-VERIFY `578e9a1c` (backend parity guard + `breaker_xi` waiver)

**Audited at** HEAD `d1b40987` (working tree clean). **Commit under audit** `578e9a1c`, parent
`9f4f8570`. **Interpreter** `C:/Users/dprit/AppData/Local/Python/bin/python3.exe` (3.14 — the suite
prints its own ENV-PARITY warning: *"a result from this interpreter is evidence about THIS
environment, not about CI or production"*). Everything below was re-derived by execution; nothing
was taken from the commit message.

Probes written for this audit (all read-only w.r.t. the repo):

| probe | purpose |
|---|---|
| `probe_V1_scoping.py` | Q1/Q2 — the band's real call, whole-module vs scoped AST walk |
| `probe_V1_measure.py` | Q5/Q6 — the n=120 band-vs-glyph sweep, the slope/ξ0/quality census |
| `probe_V1_jbay.py` | Q6 — is the waiver's J-Bay slope reproducible? |
| `probe_V1_mutations.py` | Q4 — 10 mutations against the REAL test functions |
| `probe_V1_prose_only.py` | Q7 — AST-minus-docstrings + bytecode equivalence across the commit |
| `probe_V1_settrace.py` | EXTRA — which modules the two behavioural tests actually execute |

---

## Q1 — does `rating_transform_grid` really call `compute_surf_rating`? **YES, exactly as claimed**

CODE FACT. `backend/services/weather_pipeline/surf_rating.py:768-769`:

```python
        score, level = compute_surf_rating(surf, period, wind_speed, wind_from, shore_normal, swell_from,
                                           reference_size_m=reference)
```

Six positional args + one keyword. Resolved against the live signature that is **7 factors**:
`{surf_h_m, tp_s, wind_speed_ms, wind_from_deg, shore_normal_deg, swell_from_deg, reference_size_m}`.
The `break_depth_m` rationale the registry cites as "surf_rating.py:763-767" is at **exactly**
763-767. The score is written into the height channel at `surf_rating.py:786`
(`vec.speed = round(float(score) / 10.0, 4)`), i.e. it does paint the heatmap channel.
The live caller is `grid_resolver_surf.py:87,133` — this is a served path, not dead code.

## Q2 — is the function scoping NECESSARY? **YES. Proven, not asserted.**

`probe_V1_scoping.py` output:

```
=== surf_rating WHOLE MODULE ===
  line 680   rating_score         npos=12  kwargs=-                 -> 12 factors
  line 768   compute_surf_rating  npos=6   kwargs=reference_size_m  ->  7 factors
  call sites: 2 ; ALL AGREE: False        <-- the agreement assert would fire
=== surf_rating SCOPED to rating_transform_grid ===
  line 768 only
=== control: the other three surfaces ===
  spot_ratings  1 site (line 171) | spot_conditions 1 (397) | sim_rating 1 (305)
```

Line numbers, arg counts and factor counts match the commit message exactly. Also verified the
premise the docstring rests on: `inspect.signature(rating_score)` and
`inspect.signature(compute_surf_rating)` have **identical parameter lists in identical order**
(12 names), so resolving positional args for either entry point against one signature is sound.

AST-derived supplied sets at HEAD: reference 12, hub 9, sim 9, band 7.

## Q3 — run the guard. **24 passed in 0.89 s** (`pytest tests/test_rating_composition_parity.py -q`)

The `21 -> 24` claim also checks out: the baseline file (`git show 9f4f8570:…`, run from a scratch
copy) collects **21** tests. (20 passed + 1 failure that is an artifact of my relocating the file —
`_source_of` resolves `weather_sim_mcp.py` relative to `__file__`.) The three new tests are the two
extra registry parametrisations for the band + `test_the_band_diverges_from_the_glyph_and_by_how_much`.

Nine adjacent rating test files at HEAD: **195 passed**.

## Q4 — MUTATION. **10 of 10 go red; control green. The guard is NOT decorative.**

Mutations applied to the live `SURFACES` dict in memory (every test reads it at call time) and, for
the product-side ones, to an imported COPY of `surf_rating.py`. The test functions are the real ones.

| # | mutation | caught by | first assert message |
|---|---|---|---|
| M0 | *control* | — | ALL GREEN |
| M1 | declare waived `break_depth_m` as SUPPLIED | `registry_matches` | "DECLARES it supplies `break_depth_m` but its rating call does not pass it" |
| M2 | delete `partitions` from the entry | `declared_position` | "has no declared position on ['partitions']" |
| M3 | waive `reference_size_m` (which it supplies) | `registry_matches` | "now passes `reference_size_m` — good. Delete its waiver" |
| M4 | remove `function` (the scoping) | `registry_matches` **and** `reference_supplies_most` | "has rating calls that supply DIFFERENT factors" |
| M5 | `function` points at a dead name *(audit extra)* | both | "has no function 'rating_transform_grid_v2'" |
| M6 | waiver ≤ 60 chars *(audit extra)* | `registry_matches` | "the waiver for `tide_norm` must say WHY, and cost" |
| M7 | `SeeAlso` → nonexistent waiver *(audit extra)* | `registry_matches` | "defers to a waiver that does not exist anywhere" |
| M8 | **product**: band starts passing `break_depth_m` *(extra)* | `registry_matches` | "now passes `break_depth_m`" |
| M9 | **product**: band stops passing `reference_size_m` *(extra)* | `registry_matches` | "DECLARES it supplies `reference_size_m` but…" |
| M10 | **product**: a NEW optional factor on `rating_score` *(extra)* | `declared_position` at **all four** surfaces | "has no declared position on ['brand_new_factor']" |

M10 is the guard's whole reason to exist, and the band now participates in it — that is the
substantive content of "enrolment", and it is real.

## Q5 — RE-MEASURE the pin. **32.50 reproduced to the digit, and every sub-figure with it.**

Independent sweep, 4 spots × 6 heights × 5 periods, wind 4.0 m/s, all bearings on the shore normal,
all gated flags unset:

```
  Mavericks          break_depth=22.10  nonzero  0/30  level 0/30  max|d|  0.00
  Lower Trestles     break_depth= 9.30  nonzero  5/30  level 0/30  max|d|  2.20
  Pipeline           break_depth=11.10  nonzero  0/30  level 0/30  max|d|  0.00
  Cocoa Beach Pier   break_depth= 5.90  nonzero  5/30  level 5/30  max|d| 32.50
  ALL: median +0.00, nonzero 10/120, LEVEL differs 5/120 (4.2%)
  WORST: Cocoa Beach Pier 6.0 m / 16.0 s -> glyph 33.9 poor_fair vs band 66.4 fair_good
  MAX |delta| = 32.50  -> inside the pinned (20, 45)
  min delta +0.00, max delta +32.50 — the band NEVER reads low. Sign claim holds.
```

Matches the commit and the test docstring exactly (including the +2.20 at Trestles and the
33.9/66.4 pair). The bound (20, 45) is currently satisfied with ~38% headroom above.

⚠️ **Scope caveat that the test itself states and that must travel with the number:** this is the
rating-factor contribution only. The band also derives its HEIGHT through `surf_transform.estimate_surf`
rather than `resolve_surf_geometry` + `estimate_surf_at`. 32.50 is a lower bound on one contributor,
not the band-vs-point gap. (Relevant to QUEUE E#1, which measured the band 2.3–2.7× above the glyph.)

## Q6 — the `breaker_xi` waiver, EXECUTED

```
slope_available() = True
Teahupo'o   0.1563  xi 1.6572  q 1.0000      J-Bay       0.0052  xi 0.0551  q 0.8665
Nazare      0.0606  xi 0.6425  q 1.0000      Hossegor    0.0071  xi 0.0753  q 0.8726
Trestles    0.0667  xi 0.7072  q 1.0000      Mavericks   0.0066  xi 0.0700  q 0.8710
Pipeline    0.0301  xi 0.3191  q 0.9457      Cocoa Beach 0.0012  xi 0.0127  q 0.8538
answered 8/8 ; q span 0.8538-1.0000 ; NON-neutral at 5 of 8 ; cost if flipped 14.6%
```

Every headline claim holds: `slope_available()` True, 8/8 answered, span 0.854–1.000, non-neutral at
5 of 8, 14.6% cost. Supporting citations also verified: the asset is `fa86fb53` (2026-06-29),
12,960,128 bytes = 12.96 MB; `spot_ratings.py:151` is the `RATING_BREAKER_TYPE` default-`"0"` line;
`science_registry.py:352` is the `*** CONTESTED ***` line naming Moragues 2020 and Díaz-Carrasco 2020.

Waiver length: 1,778 chars (assert is >60). SeeAlso chains resolve: `sim_rating.breaker_xi` and
`band.breaker_xi` both resolve to the rewritten hub waiver; all 11 waiver/SeeAlso entries resolve
and clear the length floor.

**ONE QUOTED DATUM DOES NOT REPRODUCE.** The waiver lists "J-Bay 0.0093" m/m. I measure **0.0052**
at every J-Bay coordinate the repo itself uses — `capture_marine_card_matrix.py:43` (−34.049, 24.928),
`surf_conditions.py:30` (−34.0339, 24.9273), and all four `expand_tahiti_maldives_africa.py` J-Bay
rows — and at my own (−34.0507, 24.9307). `bed_slope_at` is a nearest-0.1°-cell lookup, so the value
is coordinate-sensitive, but no repo coordinate yields 0.0093. The other seven reproduce exactly.
Conclusions (5/8 non-neutral, 0.854 floor, 14.6%) are unaffected — J-Bay is non-neutral either way
and the floor is Cocoa Beach.

## Q7 — did the four prose edits touch an executable line? **NO. Claim holds.**

`probe_V1_prose_only.py`, comparing `578e9a1c^` vs `578e9a1c`:

```
sim_rating.py     raw_AST_same=False  AST_minus_docstrings_same=True  bytecode_same=True  dLOC=+12
spot_ratings.py   raw_AST_same=True   AST_minus_docstrings_same=True  bytecode_same=True  dLOC=+0
surf_rating.py    raw_AST_same=False  AST_minus_docstrings_same=True  bytecode_same=True  dLOC=+0
surf_transform.py raw_AST_same=False  AST_minus_docstrings_same=True  bytecode_same=True  dLOC=+0
```

Docstrings are AST nodes, so the raw dump differs for three files (`<module>` in `sim_rating`,
`breaker_type_quality`, `iribarren`); `spot_ratings` changed a **comment** only, so even the raw AST
is byte-identical. With docstrings stripped, both the AST dump and a recursive code-object signature
(bytecode + names + varnames + non-docstring consts) are identical for all four.
LOC at HEAD: `surf_rating` 796, `spot_ratings` 800, `surf_transform` 800, `sim_rating` 492;
`scripts/check_file_size.py --max-lines 800` reports **0 violations**. CI `flake8` selects only
E9/F63/F7/F82 and is `continue-on-error: true`, so the three new >120-char lines cannot redden it.

---

## FINDINGS AGAINST THE COMMIT

### V1-01 — the renamed test does not execute ANY of the surfaces it now names, and the commit
### re-affirmed a claim the repo has already measured to be FALSE  *(High)*

`test_the_three_POINT_surfaces_agree_exactly_with_flags_off`
(`backend/tests/test_rating_composition_parity.py:350-371`) calls `compute_surf_rating` twice and
`rating_score` once. It never imports or enters `spot_ratings`, `spot_conditions` or `sim_rating`.
My own `sys.settrace` at HEAD:

```
spot_ratings.py EXECUTED = False | spot_conditions.py EXECUTED = False | sim_rating.py EXECUTED = False
surf_rating.py 1929 calls, shore_normal_asset.py 1418
```

This reproduces a measurement the repo already recorded on 2026-08-05 at
`backend/tests/test_three_surfaces_agree_BEHAVIOURALLY.py:1-19`, which says in as many words that
this test's "three surfaces" are one function called three ways and that **"it could not have gone
red for `9b808d05`."** The commit edited this very docstring — and left the sentence *"This is the
assertion that would have gone red for `9b808d05`"* standing, then made the name MORE assertive
("the three POINT surfaces"). The stated reason for the rename was that "a test whose NAME miscounts
the surfaces is the same defect this file exists to catch"; by that standard the rename fixed the
count and preserved the false claim underneath it. Same class as the `breaker_xi` waiver this commit
correctly demolished, in the same file, in the same edit.
**Fix:** replace the `9b808d05` sentence with what the test does test (engine self-consistency across
call styles) and point at `test_three_surfaces_agree_BEHAVIOURALLY.py` for the real end-to-end guard.

### V1-02 — the census the commit says it ran missed the source-of-truth site  *(Medium)*

"Corrected at all four live sites, found by census not memory." A fifth live site still carries the
refuted claim, and it is the definition module the other four point at —
`backend/services/weather_pipeline/bathymetry.py:27-28`:

> `# Optional FINER bed-slope asset (…). Absent`
> `# by default → bed_slope_at returns None → the Iribarren breaker-type rating factor stays neutral`

At HEAD the asset is git-tracked (`fa86fb53`), present in every checkout, and `slope_available()`
returns True — so "Absent by default" is false in precisely the way the commit corrected elsewhere.
Grepped `backend/services`, `backend/scripts`, `backend/tests`, `frontend/src`, `docs`: this is the
only remaining live instance (the `.claude/worktrees/…` copy is a stale separate checkout).

### V1-03 — "there are FOUR surfaces" is the same enumeration shape that was just proven false, and
### nothing tests it  *(Medium)*

`sim_rating.py:9-11` now asserts an exact count of FOUR. A caller census of the engine finds a
**fifth** live call site in the served package:
`backend/services/weather_pipeline/local_size_preview.py:241` —
`compute_surf_rating(ft * _FT, tp, 2.0, 270.0, 90.0, 90.0, reference_size_m=reference_size_m)` — the
identical 7-factor shape as the band, reached from the admin endpoint
`GET /admin/surf-forecast/local-size-preview` (`backend/routes/admin/surf_forecast.py:331-349`),
which returns a rating `level` per owner anchor. Whether a calibration harness *should* be enrolled
is a judgement call (it deliberately holds inputs fixed); what is not a judgement call is that
**no test enumerates callers**. `SURFACES`, `POST_STEP_SURFACES` and `GATE_ARG_CALLERS` are three
hand-written dicts; `test_the_post_step_registry_is_not_silently_empty` only asserts
`len(POST_STEP_SURFACES) >= 4`. The defect the commit diagnosed — "a registry that enumerates is only
as good as its census" — is fixed for one instance and left structurally open for the next.
**Fix:** an AST census test — every module under `services/weather_pipeline` that calls
`compute_surf_rating`/`rating_score` is either in `SURFACES` or on an explicit NOT-A-SURFACE list
with a reason.

### V1-04 — the new 32.50 pin is a HAND-MIRROR of the band's call, not the band  *(Low)*

`test_the_band_diverges_from_the_glyph_and_by_how_much` re-types the band's call
(`compute_surf_rating(h, tp, 4.0, normal, normal, normal, reference_size_m=None)  # the band's actual
call shape`) instead of driving `rating_transform_grid`. `sys.settrace` confirms
`rating_transform_grid entered: False`. It matches the AST-derived shape *today* (verified), and the
registry test would catch a call-shape change — but if the band's call gains a factor and the
registry is updated with it, this test keeps pricing a shape that no longer exists and stays green
on a fictional number. Cheap hardening: derive the band arm's kwargs from `_rating_call(surf_rating,
"rating_transform_grid")` instead of typing them.

### V1-05 — `_resolve` picks a `SeeAlso` target from ANY surface, dict-order first  *(Info,
### pre-existing, two new instances)*

`_resolve` (`:77-88`) scans `SURFACES.values()` and returns the first substantive waiver for the
named factor regardless of surface. Measured: the band's `best_tide` and the sim's `best_tide` both
resolve to the **hub's** `tide_norm` waiver ("The hub does not load the spot row…"), not to their
own — the sim has its own 372-char `tide_norm` waiver that its `best_tide` never reaches. Nothing is
wrong today (all chains resolve, all clear 60 chars) but a reader following the chain gets another
surface's reasoning, and a same-surface waiver could be deleted while its `SeeAlso` keeps passing on
a neighbour's text.

### V1-06 — two registries name "map rating band" at two different modules  *(Info)*

`SURFACES` keys the band to `surf_rating.rating_transform_grid`; `POST_STEP_SURFACES["map rating
band"]` names `services.weather_pipeline.grid_resolver_surf`. Both are correct (callee vs the caller
that injects `gate_fn`), and nothing ties them, so the commit-message line "the SAME file already
listed 'map rating band'" is true of the label but not of the module. Worth one sentence in the file
so the next census does not treat them as the same registration.

---

## WHAT THE COMMIT GOT RIGHT (verified, not conceded)

- The band **is** a real, served fourth rating surface and it **was** absent from the factor registry.
- The scoping is load-bearing, for the stated reason, with the stated line numbers.
- All four claimed mutations go red; six more I invented go red too, including the one that matters
  most (a new engine factor must redden all four surfaces — it does).
- 32.50 and every sub-figure of the n=120 sweep reproduce exactly, including the sign.
- The `breaker_xi` waiver's demolition of the old stale-blocker text is correct on every headline
  number (7 of 8 supporting numbers reproduce exactly; J-Bay does not).
- The four product edits are provably prose-only at the bytecode level.

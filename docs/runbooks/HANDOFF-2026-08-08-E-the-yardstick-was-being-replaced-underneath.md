# HANDOFF — 2026-08-08 (E) · THE YARDSTICK WAS BEING REPLACED UNDERNEATH THE BOUND

**Entry point for a fresh context.** Predecessor: `HANDOFF-2026-08-08-D-VERIFIED-audit-of-the-whole-session.md`
(that document's §6 queue is what I picked up). Reference: `MASTER-AUDIT-10.0`.

> ⭐ **READ §3 FIRST.** My own headline hypothesis was refuted mid-session by a measurement I had not
> thought to run, and the refutation is a better finding than the claim was.

---

## §0 WHAT I FOUND, IN ONE PARAGRAPH

A **fifth scheduled workflow** — `Forecast Calibration Census` — had been failing and appears in no
handoff, queue or audit. Its step 1 gates on named exemplars of the per-spot size climatology, and
Pipeline had crossed a `>= 1.5 m` bound by **0.01 m**. It is not a code regression and not (mainly)
seasonal drift: the **sanctioned ERA5 deepening campaign is replacing each spot's sample population
one spot at a time** (~139,000 historical samples against ~72/day of live inflow), so a backfilled
spot **steps once and then freezes** while an un-backfilled one keeps drifting. The bound has zero
margin and the replacement order is arbitrary, so the gate will keep flipping — and the next breach
will be a **different exemplar in the opposite direction** (§4). Along the way: the gate's entire
operator-facing explanation was unreachable dead code, the retained artifact series is invalid JSON
on exactly the runs that carry a signal, and the science registry's stated coverage contract is
prose rather than code.

---

## §1 THE MEASUREMENTS THAT STAND (all by execution, at HEAD `00354906`)

| # | claim | evidence |
|---|---|---|
| 1 | The census is red on the exemplar step **only**; steps 2/3/4 pass | per-step conclusions, run `31263397122` |
| 2 | The failing exemplar is Pipeline, `ref=1.49 m` against `>= 1.5` — a **0.01 m** miss | `gonogo.txt` artifact (the log's `tail -40` truncates the table; the artifact does not) |
| 3 | Mavericks **stepped −0.07 m in ONE blob write** (08-07T04:36Z) and has read **exactly 1.72 for the last 7 artifacts**, while Pipeline moved in 4 of those same 7 | 29 retained artifacts, parsed |
| 4 | Mavericks' ERA5-banked reference is **1.693 m**; the live spot lane serves **1.694 m** | campaign log line `[126/150] Mavericks: offshore=139032 surfable=139032 … reference=1.693 m` vs `e1_acceptance.txt` |
| 5 | The blob accumulates with **no window, no decay, no eviction, no per-sample time** | AST: exactly two statements write bin counts, both pure addition; merging old-first vs new-first is **byte-identical** |
| 6 | `drift.json` is **invalid JSON on 13 of 25** retained runs, **100% concordant** with "a warning fired" (valid&warning = 0, invalid&no-warning = 0) | `json.loads` over the series |
| 7 | The census's hand-written `::error::` is **unreachable dead code** | script returns 1 on NO-GO; `bash -e` + `pipefail` abort at the pipeline; run annotations contain only the sibling warning and a bare "exit code 1" |
| 8 | Exemplar bounds were written **2026-07-29 at `REF_PERCENTILE = 0.80`**; `e3aedb06` lowered it to **0.50** the next day and nothing was re-derived | `git log -S`, and `git show d8635716:…` reads `REF_PERCENTILE = 0.80` |
| 9 | `oversize_thresholds` returns on the reference **before** reading `break_depth_m`; coverage is **1,821/1,821**, so tier 2 is unreachable | source read + `with_reference == entries` in `drift.json` |
| 10 | At Mavericks that reinstates the block comment's **own stated failure case, verbatim**: 24.7 ft → `good` (71.7), 31 ft → `poor_fair` (40.8), against a tier-2 control of 97.5 `epic` | executed `compute_surf_rating` |
| 11 | **Reach of #10 today is ZERO** — `oversize` was the binding limiter on **0 of 338** served spots | 10 viewports, `valid_time` 2026-08-08T15:00Z |
| 12 | The science registry's coverage contract is **not implemented** | mutation: two unregistered constants planted in `surf_transform.py`, one physically absurd (`9.99`) → **9 passed, green** |
| 13 | **42 constants unregistered vs 11 registered** across 6 chain modules — including `REF_PERCENTILE`, `OVERSIZE_START_MULT`, `OVERSIZE_FLOOR_MULT` | AST scan. ⚠️ I first reported **36 across 7 modules**, from a scan that filtered candidates by a plumbing-name regex and included `local_size_preview.py`. The 42 is the unfiltered count over the declared chain and supersedes it — see §8 |

---

## §2 WHAT SHIPPED

| commit | what | guard |
|---|---|---|
| artifact purity | `::warning::` routed to **stderr** in `climatology_drift_census.py` (2 sites) and `served_freshness_census.py` (1, **latent** — its condition has never fired) | new `test_census_artifact_json_purity.py`: **failed at HEAD** naming all 3; 4/4 mutations killed exactly their own test, restores byte-identical |
| census gate | step 1 captures the pipeline status so the `::error::` can run at all, and **distinguishes crash (exit ≥2) from NO-GO (exit 1)**. The NO-GO text now names the two mechanisms so the next responder does not widen the bound | `bash -n` on the extracted step; YAML parsed |
| stale comment | `surf_rating.py`'s tier-1 description said **"p80 good-day"**; it is p50 typical-day, and the multipliers were chosen against the old quantity | LOC 794/800 after moving the detail here |

⛔ **NO calibration constant, physics constant, exemplar bound or percentile was changed.** Widening
the bound is the one thing the predecessor handoff explicitly warns against, and re-deriving
`OVERSIZE_START_MULT` is an owner call (§5).

---

## §3 ⛔ WHAT I GOT WRONG — my headline hypothesis, refuted by my own artifacts

I reported that the reference series was **seasonal**: Florida rising, North Pacific falling,
Indonesia flat, with Pipeline "**7 down / 0 up over 23 steps — not a random walk**".

**That monotonicity was manufactured by my window.** I built the series from 24 artifacts starting
`2026-08-02T15:41Z` — which is the series' **local maximum**. With the three earlier artifacts
included, Pipeline **rises first** (1.54 → 1.55 → 1.56) and then falls: **up=2, down=7**. Uluwatu is
**up=7, down=12**, not "flat". Three of five exemplars reverse direction inside the window, which no
seasonal forcing produces in eight days.

> ★★★ **A TREND TEST IS ONLY AS GOOD AS THE WINDOW'S INDEPENDENCE FROM THE DATA.** I ran a
> monotonicity *control* — and ran it on a window I had chosen from the same series. The control
> could not fail. This is the repo's "measure the distribution" rule biting the person applying it.

**The better explanation, which I verified myself after it was handed to me:** two historical
backfill campaigns are rewriting the blob spot-by-spot through the inbox. A backfilled spot's
reference **steps once and freezes** (139,032 samples swamp ~72/day); an un-backfilled spot keeps
drifting on live summer frames. Mavericks is in the campaign log at 1.693 and the lane serves 1.694.
Pipeline is **not in the log yet**, so it is still drifting — which is why *it* is the one that
crossed.

Seasonality survives only as the proximate driver for the **un-backfilled** spots. It was never the
whole story, and it was the wrong headline.

**Smaller things I got wrong:**
1. I claimed the stdout annotation might never reach the Actions UI. It does — via the workflow's
   **second, non-`--json`** invocation. Verified on the run before I said it. The loss is the
   artifact, not the alert.
2. My first sensitivity sweep stopped at 3.0 m and reported "+0.6 to +2.5 points". That is the
   **positive lobe only** — it sits entirely below the oversize taper, so it could not see the
   second of the two terms the reference feeds. The honest figure over 0.21–12.0 m is
   **−7.10 to +2.80 points, 34.7% negative, 34.7% provably inert**, with level moves in **both**
   directions. Same class as the predecessor session's "default arguments are a branch".
3. Two scratch scripts died on the recorded Windows taxes — a `write_text` CRLF round-trip and a
   cp1252 stdout. Both are in the standing rules; both bit anyway.

---

## §4 ⛔ THE FORWARD-LOOKING RISK — the next breach is already banked

The campaign log (487 references banked, currently `[61/150]` of the live batch) contains ERA5
references for spots the exemplars resolve near:

| banked spot | ERA5 reference | the exemplar bound it lands against |
|---|---|---|
| Sebastian Inlet – Second Peak | **1.161 m** | Florida `<= 1.1` |
| Sebastian Inlet – Monster Hole | **1.166 m** | Florida `<= 1.1` |
| Uluwatu – Racetrack | 2.057 m | Indonesia `>= 1.0` — clears |
| Mavericks | 1.693 m | California `>= 1.5` — clears |

Sebastian Inlet's live value is **0.81 → 0.85 and rising monotonically (up=4, down=0)**, and its
ERA5 destination is ~1.16.

**Pipeline has no banked value yet, and its neighbours do not let you guess one.** Banked North
Shore Oahu references span nearly 2× within a few kilometres:

    Gas Chambers 0.964   Log Cabins 1.740   Laniakea 1.771   Rocky Point 1.819

i.e. they **straddle the 1.5 bound in both directions**. Per-spot geometry dominates over regional
climate at this scale, so "Pipeline is on the North Shore, it will bank high" is not an inference the
data supports. ⛔ **Do not predict Pipeline's post-campaign reference; wait for the log line.**

⇒ **Expect the census to keep failing, and expect the next failure to be Florida breaching from
ABOVE.** That is a falsifiable prediction; if Florida crosses 1.1 while Pipeline recovers, this
account is right.

⛔ **DO NOT WIDEN THE BOUNDS TO MAKE IT GREEN.** The bounds and the statistic are calibrated against
different populations *and* different percentiles. Widening hides both.

---

## §5 THE QUEUE

0. ⛔ **OWNER — the exemplar bounds vs the campaign.** The bounds encode an *annual-character*
   expectation; the statistic is a *sampling-window* median whose population is mid-replacement.
   They are not the same quantity until the campaign finishes. Options: re-derive the bounds against
   the post-ERA5 population once the campaign completes; or state them as a scale-free *contrast*
   (Pipeline/Florida) rather than absolutes. **Both need the campaign finished first.**
1. ✅ **DONE — the science registry's coverage contract is implemented** (`d12d363c`). See §8.
   ⇒ What remains is the debt it froze: **32 unsourced calibration constants**. The ripest is
   `SHELF_KF_FLOOR` — its own comment already names Ardhuin, so it needs a published range, not
   research. Registering entries makes the ratchet shrink; nothing forces the order.
2. ⛔ **OWNER — `OVERSIZE_START_MULT = 3.5` vs the p50 input.** Reach today is 0 of 338 served spots,
   so this is a **winter** item, not an incident. Re-run the reach census in December; if `oversize`
   starts binding at big-wave spots, the multiplier needs re-deriving against p50 (or tier 1 needs to
   defer to tier 2 where bathymetry is trustworthy).
3. **The drift census's own gate is the same class one level up** — `SPOT_MOVE_SHARE_PCT = 5.0` and
   `PSI_CRITICAL = 0.25` are fixed bounds on a quantity the campaign is replacing. It has been
   warning since 08-05 and reads 14.06% today.
4. **`verify_point_spot_reference.py` gates on a fixed 0.02 m tolerance** against references spanning
   0.4–4.0 m that the campaign moves by up to +229%.
5. Unchanged from the predecessor: **Sim Parity Monitor** (intermittent ~29%, passed its last two),
   the CMEMS pre-warm budget, bilinear spread, the `SURF_TIDE_DEPTH` flip, confidence thresholds.
6. ⛔ **Owner-gated, untouched:** production frontend frozen at `3bd38a83`, Vercel 8/8, the seeded
   `dev-mock-user-id` admin row.

---

## §6 WHAT A SUCCESSOR SHOULD DISTRUST

* ⚠️ **The reach numbers are viewport samples at ONE valid_time in boreal summer.** `0 of 338` for
  `oversize` is a statement about August. Quote the n and the frame.
* ⚠️ **`RATING_LOCAL_SIZE` is ON** (`3263031c`, 2026-08-01) — several memory entries still listed it
  as owner-gated/unflipped. Corrected.
* ⚠️ **Nothing in the repo parses `drift.json`** (repo-wide grep). The purity fix restores a stated
  deliverable and removes a trap I fell into myself; it does not fix a live consumer.
* ⚠️ All local timings/scores are Windows / py3.14; production is Linux / py3.12. **Quote ratios.**
* ⚠️ **I did not read the production blob** — `backend/.env` points at the wrong Supabase project. So
  per-spot sample counts, the exact count of spots at the `0.4 m` floor, and Pipeline's future ERA5
  value are all **unmeasured**, not estimated.
* ⚠️ The census went red **three** times in the window, not twice — the 2026-08-06T16:23Z run failed
  on infrastructure and produced **no artifact**, leaving a hole in the series.

---

## §7 WHAT THIS SESSION DID NOT COVER

- No physics constant, calibration constant, percentile or exemplar bound was changed.
- The registry coverage ratchet (§5 item 1) is **specified and measured but not built**.
- The Sim Parity Monitor was not investigated (it passed its last two runs).
- I did not verify whether the deployed production frontend renders the one frontend-side consumer
  of `reference_size_m` (the map infobox Rating card).
- One refuter reported that the drifting spot blob **does** reach the map band indirectly, via the
  observation gate in `apply_surf_overlay` — I did not independently re-derive that, so it is
  recorded here as unverified rather than as a finding.

---

## §8 THE REGISTRY COVERAGE RATCHET — built (`d12d363c`)

`science_registry.py`'s docstring claimed a guard that did not exist. It now exists, in
`backend/tests/test_science_registry_coverage.py`, as a shrink-only ratchet over a declared
forecast chain.

### The debt it froze

| module | numeric constants | registered | unregistered |
|---|---:|---:|---:|
| `surf_transform.py` | 13 | 5 | 8 |
| **`surf_rating.py`** | **24** | **0** | **24** |
| `spot_size_climatology.py` | 9 | 0 | 9 |
| `wave_physics.py` | 1 | 0 | 1 |
| `surf_height_convention.py` | 1 | 1 | 0 |
| `surf_point.py` | 0 | – | 0 |
| **total** | **48** | **6** | **42** |

Categorised: **32 DEBT** (unsourced calibration), 7 STRUCTURAL, 3 EXACT. The registry holds 11
constants overall, spanning only **3 modules**.

### The design trap, and why the chain list is declared

The obvious implementation scopes the scan to *the modules the registry mentions*. That is circular
— and here it is catastrophic rather than merely inelegant: `surf_rating.py` has **zero** registered
constants and **24** unregistered ones, so a coverage-derived scope puts the worst-covered module
permanently out of reach. Two tests pin both directions:

* `test_no_registry_module_falls_out_of_scope` — a module the registry names can never leave the scan
* `test_scope_is_not_derived_from_coverage` — `surf_rating.py` must stay in it

★ **Deriving a guard's scope from what it already covers makes the uncovered case unreachable by
construction.** Same family as a surface list naming a producer file, and a fixture that could not
enter the branch it guarded.

### Two defects the tests found in themselves

1. **A name is not unique across the chain.** `_HMIN_RIDEABLE_M` is defined in *both* `surf_rating`
   and `spot_size_climatology`. The first draft keyed the grandfather set by name, and the only way
   to hold both entries was a **trailing space** on one. `test_the_grandfather_set_is_shrink_only`
   caught that on its first run. Now keyed by `(module, name)` — and the frozen DEBT count is **32,
   not 31**, because the two copies are separate constants kept equal by a comment rather than code.
2. **A count where a name was needed.** `test_scope_is_not_derived_from_coverage` first asserted
   "at least one chain module has zero registered constants". *Four* modules satisfy that, so
   dropping `surf_rating` left it green. A mutation revealed it; it now names the module.

### Mutation matrix

Byte-exact I/O, every mutant `ast.parse`-checked, restores `sha256`-identical.

| mutation | verdict | tests killed |
|---|---|---|
| **plant 2 unregistered constants (the original experiment)** | **KILLED** | exactly its own |
| drop `surf_rating` from the chain | KILLED | 4 — circularity guard first |
| blind the AST walk | KILLED | 4 — refusal semantics |
| accept any name, not just UPPER_CASE | KILLED | exactly its own |
| plant a STALE grandfather entry | KILLED | 2 |

⭐ **The control is the headline.** The same planted-constants experiment re-run against the *old*
guard alone still returns `rc=0, failed=none` — the green that hid the gap. It now fails.

⚠️ **The stale-entry mutation was rewritten after its first version survived killing nothing.**
Disabling the "no longer exists" arm cannot fail when no entry is stale; the mutation had to *plant*
the stale entry to be reachable. **A surviving mutation can mean the test is weak OR that the
mutation could never fire — check which.**

### Stated limits

* **Function-local constants are out of scope** — module level only. A real gap, named so a
  successor closes it deliberately rather than discovering it.
* **Derived values are out of scope** (`_OVERSIZE_TAPER_SPAN = FLOOR / START`) — they cannot drift
  independently of their inputs, so registering them would double-count.
* **Categories are documentation, not enforcement.** Misfiling one as STRUCTURAL rather than DEBT
  misdescribes the debt; it does not weaken the ratchet, which is the frozen set.
* The chain is **6 modules**. Ingestion, sampling and the marine fetchers are *not* scanned.

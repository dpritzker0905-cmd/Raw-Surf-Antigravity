# HANDOFF 2026-08-01-E — the sim got a cloud presence, RATING_LOCAL_SIZE flipped, and I audited it

**Read alongside** `HANDOFF-2026-08-01-D-sim-reference-audit-and-the-graft-that-outranked-it.md`
(the concurrent session — we worked the SAME defect from opposite ends and both fixes are on `dev`),
plus `-B`, `-C`, and `START-HERE-2026-08-01-THE-ONE-QUEUE.md`.

Branch `dev` @ `575c91e2`. **All four routines green, CI green, working tree holds only the other
session's in-flight work.** Every number below was measured, not inferred; run IDs are given so a
fresh context can re-check rather than trust.

---

## 1. WHAT SHIPPED — three cloud routines where there were none

The weather sim had **zero cloud presence**: every `sim` match in `.github/workflows` was the word
"simply", and **no pytest ran in GitHub Actions at all** (the only pytest anywhere was two
shore-normal tests behind a `workflow_dispatch`).

| routine | file | cadence | proof it works |
|---|---|---|---|
| **Sim Parity Monitor** | `sim-parity-monitor.yml` | cron `20 5,11,17,23` | run `30704387651`: N=9, `_refs_resolved 9/9`, ⎮dScore⎮ median 0.3 max 0.9, `hour_unverified: 0`. **Has fired on `schedule` twice** (not just dispatch). |
| **Forecast Calibration Census** | `forecast-calibration-census.yml` | cron `35 2,8,14,20` | run `30702224848`: exemplars **SANE**, PSI **0.0**, 0/1821 moved, freshness 21,276 spot-hours p99 6.66 h. ⚠️ **First scheduled fire is 20:35 UTC — not yet observed on cron.** |
| **Composition guard suite** | `ci.yml` job `backend-sim-composition-guards` | every push/PR | run @ `575c91e2`: **637 collected / 41 files / 567 passed / 0 failed**. |

Supporting: `backend/requirements-dev.txt` (new — the repo had **no declared test dependency set**,
which is the same fact as "no pytest ever ran"), `served_freshness_census.py`,
`climatology_drift_census.py`, `climatology_baseline.json`, `test_calibration_census.py` (15),
`test_sim_local_size_reference.py` (7).

### The gate asserts what RAN, not the exit code
The wider backend suite **skips 62%** (`1 failed, 1798 passed, 2928 skipped` of 4,727), so a green
exit proves nothing. Floors are shrink-only and pinned by negative controls.
⚠️ **A collection error is not local**: one unimportable module makes pytest exit 2 and collect
NOTHING. That happened (§4) and the ratchet caught it as "0 files collected" where a bare exit code
would have shown one failing test.

---

## 2. RATING_LOCAL_SIZE IS FLIPPED — all three lanes (`3263031c`)

The Jacobian's #1 lever, blocked 21 days. `size_score` saturated at the global 1.2 m reference, so
**4/6/8/10/12 ft scored byte-identically and offshore Hs accuracy was worth 0.0 rating points** —
every hour of height work bought nothing *in the score* until this shipped.

**Verified in all three lanes just now:** `precompute.yml` `'1'` · `forecast-ingest.yml` `'1'` ·
Render env `RATING_LOCAL_SIZE=1` (read live off the Render API).

    A/B over 10,638 spot-hours: 47.6% change LEVEL (4,685 down / 375 up)
    delta median -4.9, p10 -27.6, p90 +1.9

★★★ **Only the named EXEMPLARS could validate it.** An inverted blob (Florida large, Pipeline small)
yields a large, symmetric, entirely plausible delta distribution. Dungeons `epic→poor_fair` at
h=1.64 m vs ref 2.57; Lake Worth (FL) `poor_fair→fair` at h=0.61 m vs ref 0.57. Both directions are
the "relative to the spot's own potential" principle CLAUDE.md mandates.

⚠️ **47.6% is a product event** — taken as an explicit owner decision, not shipped quietly.
**To revert:** `'0'` in **all three** together; a split leaves precomputed glyphs on the global
reference while the band uses the local one.

### Verified live end-to-end (rule 10b), and my first verification method was WRONG
I predicted the A/B would "collapse toward 0% after the rebuild". It read 41.8% — **and that is not
evidence of staleness.** `preview_impact` always computes `global → local` from the persisted score
and cannot know which curve produced it. ⇒ **an A/B that assumes its own baseline cannot verify the
baseline moved.** The check that works is recomputing both curves:

    Kommetjie, served 06:00Z, h=1.497 m / 11.5 s / 5 kt offshore
      GLOBAL (ref None)   -> 76.9  good
      LOCAL  (ref 2.332)  -> 28.1  poor_fair
      SERVED              -> 22.7  poor      <- unambiguously the LOCAL branch

---

## 3. AUDIT — what I checked, and what it found

Run these to re-verify; all passed at handoff time.

| # | check | result |
|---|---|---|
| 1 | `git merge-base --is-ancestor <sha> origin/dev` × 12 commits | **all 12 on origin/dev** |
| 2 | flag in 3 lanes (2 greps + live Render API) | **all `1`** |
| 3 | `/api/weather/point` serves `reference_size_m` | **2.069 at Kommetjie — live** |
| 4 | routine last-runs + `event` field | **4/4 success; parity monitor has fired on `schedule`** |
| 5 | working tree | **clean of my work**; remainder is the other session's |

### ⛔ AUDIT FINDING — the infobox fix is an IMPROVEMENT, NOT PARITY. I over-claimed.
`point_surf_augment` serves the **per-CELL** reference; the glyph uses the **per-SPOT** reference. I
justified that from a docstring ("band and glyph saturate identically where they overlap") and
**never measured it**. That sentence is about the FORMULA (same percentile, min-samples, clamps),
not the VALUES — a 0.25° cell aggregates many spots. Measured over 16 live spots on 4 coasts:

    |cell - spot| reference:  median 25.8%,  max 53.0%  (Hawaii worst)
    score impact at representative conditions: -11.4 to +9.6 points
    LEVEL differs at 2 of 6 cases (Backdoor, Rockpiles — both poor_fair vs poor)

**Before the fix** the badge was on the global curve: up to **58** points off, 47.6% of spot-hours.
**After**, up to **~11** points and a LEVEL flip at 2/6. Real progress; **not closure.**
⇒ **OPEN:** the point endpoint should use the **spot** reference when the coordinate IS a catalogued
spot (a proximity match, as `confirmation_for` already does within 2 km). See §5.

---

## 4. FIVE FAILURES ON THE WAY — all mine, all measured

Written down because each is a class, not an incident.

1. ⭐⭐ **I BUILT ON A SYMBOL THAT EXISTED ONLY IN ANOTHER SESSION'S UNCOMMITTED TREE.**
   `reference_size_for` imported `spot_size_climatology.reference_for_spot`; `git show
   origin/dev:<file>` found nothing. Every local test passed while the deployed lane raised
   **ImportError into my own fail-open `except Exception`** and graded the global curve in silence.
   ★ **FAIL-OPEN HIDES ITS OWN FAILURE** — my own words two commits earlier. ImportError now
   propagates; only data misses fall open.

2. ⭐⭐ **THE SAME CLASS, TWICE MORE.** The CI floor (41/565) was calibrated on a local run that
   counted the other session's **untracked** `test_spot_hub_local_size_reference.py` — origin/dev
   had 40, so the gate was **unmeetable by anything that ships**. And a one-off composition-parity
   red was their **mid-edit** of the file that test AST-parses.
   ⇒ **In a shared tree, ANY measurement that enumerates files or symbols is contaminated.** Numbers
   destined for a CI gate must come from `origin/dev` or from the gate's own output.

3. ⭐⭐ **`git push` CARRIES EVERY ANCESTOR — staging by path protects the INDEX, not the BRANCH.**
   My push shipped the other session's `f504d52b`, which had committed two test files **without the
   module they import**. CI collected nothing. Repaired with the smallest available change (their
   44-insertion, zero-deletion file — purely additive, so it could only complete what was already on
   the branch; reverting would have discarded live work my push had broken).
   ⇒ **`git log origin/dev..dev` and decide about EACH commit before pushing.**

4. ⚠️ **`valid_time` IS NOT AN I/O PERMISSION.** Reusing it to gate the reference lookup left
   `get_weather_forecast` on the global curve while the probe read **GREEN** (a false green on the
   path users read), and switching it on for `sim_window` also enabled the **observation gate**,
   capping at 69.9 and flattening the ranking (winning hour 09:00→06:00, caught by
   `test_sim_daylight`) — the "gating a RANK key" defect `79e1001a` fixed, one lane over.
   ⇒ `allow_reference_lookup` is its own parameter; `valid_time` is the gate's JOIN KEY.

5. ⚠️ **MY NEGATIVE CONTROLS COULD NOT FAIL.** Both "did not dial" spies **raised**, and
   `AssertionError` IS an `Exception`, so the fail-open swallowed them — they passed whether or not
   the lookup happened (proven by mutation). And a test double was an empty `dict` subclass —
   **falsy** — so `reference_map(clim) or {}` discarded it and three tests failed against correct
   code. ★ **A control must be observable THROUGH the code under test, and a double must satisfy the
   same truthiness contract as the thing it stands in for.**

### And two instrument-honesty fixes that came out of it
* The parity monitor **published a divergence it manufactured** (8/9, median 10.7) when it had the
  flag but not `SUPABASE_*`. ★ **The SIGN was the tell**: California **+31.1**, Florida **−10.3** —
  opposite sides of the curve crossover ⇒ a per-spot input went missing, not a constant. It now
  counts resolved references and says *"INSTRUMENT failure, NOT a composition finding"*.
* A LEVEL difference on a rounding-sized gap is a **bucket-edge straddle**. `--level-noise-margin`
  (1.0) suppresses those from the gate while still printing them — **calibrated, not chosen**:
  near-ties measured 0.5–0.9, genuine divergences 10.4–31.1.

---

## 5. OPEN — ranked

1. ⛔ **The infobox uses the CELL reference, the glyph the SPOT reference** — median 25.8% apart,
   LEVEL flips at 2/6 sampled (§3). Fix: proximity-match the coordinate to a catalogued spot in
   `point_surf_augment` and prefer the spot reference. **Measure before and after with the same
   16-spot sample.**
2. ⚠️ **`test_sim_whatif_size_curve_and_io_budget.py` is EXCLUDED from the guard suite**, not
   skipped — it imports `weather_sim_mcp` (⇒ fastmcp, which cannot be installed against the pinned
   httpx/starlette). Convert it to `pytest.importorskip("fastmcp")` (the `test_run_provenance.py`
   pattern) so its guards become **counted skips** instead of absent.
3. ⚠️ **The Calibration Census has not yet fired on cron** (first is 20:35 UTC). Confirm the
   `schedule` event appears; the Sim Parity Monitor's two scheduled runs prove the mechanism.
4. ⚠️ **`climatology_baseline.json` is a point-in-time anchor** (1,821 refs, 13:23Z today). PSI is
   measured against it forever until someone re-anchors with `--write-baseline` (which **refuses**
   on a blob older than 24 h). Re-anchor deliberately after any intended calibration change,
   never to silence a red.
5. ⚠️ **The durable fastmcp fix**: raise httpx/starlette in `requirements.txt` (transitive via
   supabase/openai — wants review), **or** stop importing fastmcp at module level in
   `weather_sim_mcp.py` so the sim's pure logic imports without a server framework. The second is
   smaller and would return six probe guards + item 2 to the gate.
6. ⚠️ **No endpoint exposes the deployed SHA** — version skew can't be detected. Bounded today
   because both lanes track `dev`; it is why the parity monitor is scheduled, not push-triggered.

---

## 6. FOR A FRESH CONTEXT — the shortest path in

```bash
# Is the composition still one composition?
cd backend && python scripts/sim_health_probe.py --regions california,florida,south_africa --per-region 3
# Is the yardstick sane and has it moved?  (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
python scripts/local_size_gonogo.py
python scripts/climatology_drift_census.py --fail-on-drift
python scripts/served_freshness_census.py --fail-on-stale
```

⚠️ **`backend/.env` points at the DEV Supabase project**, which has no `spot_ratings` objects —
reading it instead of production is how "the climatology blob is absent" got believed **twice**.
`local_size_gonogo.py` prefers `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` when set and otherwise
discovers production's credentials through the Render API.

★ **The single most useful habit from this session:** when an instrument goes red, ask *"is this a
finding about the system, or about the instrument?"* before acting. Five of the reds here were the
instrument, and each one was cheap to tell apart the moment the guard printed **which** question
failed instead of merely that something had.

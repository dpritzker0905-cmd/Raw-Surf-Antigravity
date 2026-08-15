# BLOCKERS AND DECISIONS — Program 13.0

Append-only. Each entry states what was decided or blocked, the evidence, and what would reopen it.

---

## D-1 — `confidence` was NOT made a function of `geometry_readiness`

**Date** 2026-08-14 · **Mission** 1 · **Objective** WS-OBJ-207 · **Task** WS-CAN-0062

The canonical register's `Remaining Work` read *"Make confidence (or an explicit field) a function of
geometry_readiness."* **The first option was rejected; the second was taken.**

**Why.** Three orthogonal confidences are served, and the split is deliberate and documented in
`spot_ratings.py`:

| field | grades |
|---|---|
| `confidence` | the **PIN** — `accuracy_flag` / `is_verified_peak` |
| `geometry_readiness` | the **INPUTS** — `full` / `degraded` / `blind` |
| `forecast_confidence` | the **FORECAST** — ensemble spread |

Folding readiness into `confidence` would (a) collapse two axes and destroy a distinction the wire
already carries, and (b) **silently change a served field's meaning with nothing on the wire to
distinguish the old semantic from the new** — which is precisely the one-quantity-two-meanings class
that has `WS-CAN-0005` blocked. Creating a second instance of the defect an adjacent task is blocked
on is not an acceptable repair.

**What was done instead.** An additive caveat appended to `why`, sourced from a new
`spot_geometry_readiness.caveat()` so the readiness vocabulary keeps one owner (WS-OBJ-401). `why`
was chosen over a new payload key because `why` is the only one of the three that reaches a user
today — the production frontend is frozen 85 days (`WS-CAN-0039`), so a new key would land on a
shelf while `why` renders immediately.

**Reopen trigger.** If a product decision makes a single blended trust score the desired readout,
this decision must be revisited **together with** a wire-level provenance marker, not alone.

**Guarded by.** `test_the_verified_pin_still_reads_high__THE_CONTROL` — `confidence` must stay
`high` across all four verdicts. If someone later couples them, that test goes red and names why.

---

## D-2 — The `run_time` DISPLAY half is BLOCKED by `WS-CAN-0005` (new dependency)

**Date** 2026-08-14 · **Objectives** WS-OBJ-202 / WS-OBJ-203

`UPDATED_CRITICAL_PATH.md` position ② scopes *"`WS-CAN-0005` + `WS-CAN-0062` + the newly-found
**display half** of model-run truth"* as **one provenance visit**. Measured at HEAD, the three are
**not co-schedulable**, and the ordering constraint was not previously stated:

> **Rendering `run_time` today would render an ingest wall clock to users under a model-run label.**

Live control, production, 2026-08-14T18:00Z (`evidence/network/live-spot-ratings-raw.json`, n=87):

```
run_time       2026-08-14T12:50:59.674525Z   ×87   (identical to the MICROSECOND)
wind_run_time  2026-08-14T13:20:39.708395Z   ×87   (a second, different wall clock)
```

`12:50:59.674525` is not a `00/06/12/18Z` model cycle, and 87 spots served from regional products on
independent ingest cadences cannot share a cycle to six decimals. This is a **stronger** control than
12.1's LV-05 (4 points / 3 tiles) and 12.2's re-confirmation.

**Consequence for the path.** The display half must be sequenced **after** `WS-CAN-0005`, not
alongside it. Building the display first would ship a false readout and then require a second visit
to correct it — and a *rendered* wrong timestamp is materially worse than an unrendered one, because
it converts a latent data defect into a user-facing claim.

**Status.** `WS-CAN-0005` remains **Not Started / Blocked**. Its own register row records why:
*"NOT a one-sitting change and a PARTIAL fix is worse than none"* — `run_time` is non-Optional on
three schemas, zero callers pass it into the normalizer, and 22,843 stored products carry the ingest
semantic with nothing on the wire to distinguish them. Steps 3–4 of its staged plan are
**owner-facing**.

**Recommended next decision (owner).** Approve or amend the four-step staged plan in `WS-CAN-0005`'s
register row. Nothing in the display half should start before that.

---

## D-3 — The CDN lane would have produced a false negative in browser verification

**Date** 2026-08-14 · **Mission** 1 · Operational, recorded so the next session does not lose an hour

`useSpotRatings.js:299` calls `fetchPublicRatingsObject()` **first** — the public Supabase CDN, which
serves the **production** precompute — and only falls through to the backend endpoint on a miss.
Separately, the local frontend's `BACKEND_URL` points at `raw-surf-antigravity.onrender.com`.

So a local browser check of a backend change renders **production** data and shows the fix absent.
Confirmed live this session: the first rating request went to `raw-surf-antigravity.onrender.com`.

**The two overrides that make local verification honest** (both are the app's own documented
mechanisms, not hacks):

```js
localStorage.setItem('__RAW_DISABLE_RATINGS_CDN__','true');   // spotRatingsCdn.js:36
localStorage.setItem('__BACKEND_URL__','http://127.0.0.1:8000'); // documented in frontend/.env.local
```

After both, the request went to `127.0.0.1:8000` and the repaired string rendered.

---

## L-1 — LEAD (not a finding): the marine tuner overlay intercepts the Surf Rating toggle

**Date** 2026-08-14 · Observed, not investigated, **out of mission scope**

At 961×910 the "Surf Rating" control's centre point resolves to an `INPUT` belonging to the marine
animation tuner panel — `document.elementFromPoint()` returned an element the toggle did not contain,
and a real pointer click at that coordinate did not toggle it. Collapsing the tuner cleared it.

**Why this is a lead and not a finding:** the tuner is plausibly a dev-only diagnostic surface, and
whether it is present in a production build was **not** checked. Do not open a task before
establishing that. If it *is* production-reachable, it is a click-blocking overlay on a primary
control and belongs with the frontend findings gated behind `WS-CAN-0039`.


---

## L-2 — DECISION NEEDED (owner of the CI floors): `backend-estate-coverage` 388 vs 396

**Date** 2026-08-15 · Measured by the other session · **not touched, deliberately** — this is your
lane and `c1566c8b` landed mid-diagnosis. Raised here per the 12.1 rule that an audit updates the
register rather than authoring a report.

`::error::Estate coverage: only 388 passed, floor is 396 — mass-skip or deletion`
Fired **5 times**. **It is neither option the message names.**

| | floor commit `a6e4339a` | now | source |
|---|---|---|---|
| estate passed | 398 | **388** | run logs |
| estate skipped | 2864 | **2865** | run logs |
| collected | 3262 | **3253 (−9)** | derived |
| `def test_` in `backend/tests` | 5444 | **5446 (+2)** | `git grep -c` |
| estate files | 258 | **258** | `--lane estate` |
| lane definition last changed | **2026-08-11** — before the floor was set | | `git log` |

**Definitions went UP by 2. Files did not move. Lanes did not change. Nine fewer tests collect,
with zero failures.** Nine test CASES vanished without any test FUNCTION vanishing.

**Ruled out by measurement:** deletion · mass-skip · file movement · lane redefinition ·
the three non-literal `parametrize` sources in the lane (`POOLED_FETCHERS`, `DISCLOSING_SURFACES`,
`_MEMORY_SAFETY_FAMILY` — all literal tuples, they cannot shrink).

**INFERENCE, not measured:** collection is data- or environment-driven somewhere. The parametrized
source was **not identified**; local reproduction is not possible from the other session's machine
(`check_env_parity` reports python 3.14 vs the declared 3.12 and 28 of 46 pins differing).

### Why it was not simply lowered
1. ⚠️ **`guards` is over-raised too** (`MIN_PASSED 1735 vs 1720 observed`). Two lanes above their
   observations at once looks systematic. Estate is a **COMPLEMENT** — tests moving INTO guards
   should have RAISED the guards reading; it fell instead.
2. ⚠️ **If the inference holds, the count is non-deterministic** and the floor will drift again at
   whatever value is set — lowering would be a temporary silence, not a fix.
3. ★ **No guard catches an over-raise.** `ci_floor_staleness.py` is deliberately one-sided (pinned
   by `test_the_check_is_one_sided`), the lane asserts only after the raise ships, and
   `check_floor_before_push.py` fires only when tests are **ADDED**. Three guards, one uncovered
   direction — worth its own entry regardless of how this instance resolves.

**Decision needed:** lower to 386 and accept the silence, or find the 9 cases first. The other
session has no way to identify them without a CI-equivalent environment.

### ✅ L-2 ANSWERED AND CLOSED — 2026-08-15, by the floor's owner

**The mechanism the entry above could not identify: a module-level `importorskip` on packages CI
never installs.**

`backend/tests/test_trevec_index_gc.py` opens with

```python
pa    = pytest.importorskip("pyarrow", reason="pylance/pyarrow not installed")
lance = pytest.importorskip("lance",   reason="pylance not installed")
```

Both are installed on a dev box — trevec is local code-index tooling — and are pinned in **neither**
`requirements.txt` nor `requirements-dev.txt` (verified by grep, 0 hits in each). On CI the imports
fail, the module is skipped **at collection**, and its **ten** test cases never materialise while
**one** skip is recorded in their place.

That is exactly the signature the entry above measured and could not place:

> *"Nine test CASES vanished without any test FUNCTION vanishing."*

The `def test_` count cannot move, because the functions are still in the file — they are simply
never collected. It is neither a deletion nor a mass-skip, which is why both were correctly ruled
out; the third option, *environment-driven collection*, was inferred and is now **measured**.

| | |
|---|---|
| local | 400 passed / 2864 skipped |
| CI | 388 passed / 2865 skipped |
| files, both sides | 258 |

**Resolution shipped (`5fcdd817`):** estate `MIN_PASSED` 396 → **386** (CI's 388 − this lane's budget
of 2) and `_FLOOR_SET_FROM["estate"]` → **388**. CI green on all 11 jobs.

**The rule, recorded at both edit sites so it cannot repeat:**

> ★ **Set the estate floor from the CI reading, never a local one.** A local run of this lane is
> structurally ~10 higher. `ci.yml`'s own comment history already quotes CI output lines — that was
> the convention, and I broke it twice in one day.

`guards` and `chain` carry no local-only `importorskip`, which is why only `estate` reddened.

⚠️ **Not fully accounted for:** the trevec module explains **ten** of a **twelve**-case gap between my
local 400 and CI's 388. Two cases remain unexplained. The floor is correct regardless — it is now
sourced from CI — but the residual is real and is recorded rather than rounded away.

⇒ **The other half of L-2 (the Calibration Census exiting 1 instead of 2 on a 503) is untouched and
still open.** It is not mine and the one-line fix is already named in that entry.

---

## D-4 — The cap-seam repair ships DARK; the default flip is the owner's, with the census in hand

**Date** 2026-08-15 · **Task** WS-CAN-0072 (Master Codex MC-01 = the 11.0 §3.8 cap seam)

The repair (`SURF_CAP_SEAM_MONOTONE`) is implemented, property-tested (47 tests, mutation matrix
M1–M4), and proven on the audit's own probe (38/48 negative-jump traces → 0/48). It ships with the
flag **default OFF — byte-identical legacy** — although the audit grades the defect P0, because:

1. **The 11.0 disposition for this exact seam** was "flag + winter-frame census + owner sign-off",
   and nothing measured since weakens it: the changed values live only on big-wave frames.
2. **Every push to `dev` is a production deploy**, so a default-ON commit IS the release action —
   which program rule 7 reserves for separate authorization.
3. **The flip is a three-lane act**: precomputed frames bake heights, so Render env +
   forecast-ingest.yml + precompute.yml must move together or frames disagree (the RATING_TIDE
   class). A code-default flip alone cannot ship it correctly anyway.

**What the owner reviews before flipping:** the band census
(`evidence/scientific-validation/mc01-capseam-census.json`): served heights change ONLY inside the
over-ceiling band (corrections up to −21.26%, the theoretical bound), ratings in the band move
median +0.2 with 70/409 sampled cells crossing a bucket. Production reach is bounded by the cap's
0.145%-of-spot-hours bind rate.

**Reopen trigger:** owner flips the flag → run the real-spot winter-frame census + re-baseline the
sim control table in CLAUDE.md (its `8 m → 30.6 ft` row is an over-ceiling artifact and becomes
29.5 ft under the repair).

## D-5 — Lane floors NOT raised in the 2026-08-15 batch, deliberately

**Date** 2026-08-15 · applies to guards (+47 tests), chain (+4), estate (+25)

`ci.yml`'s own convention (twice bitten, L-2 just re-proved it): **floors are measured from CI's
reading on origin/dev, never from a local run or a shared working tree.** This batch is not pushed
(rule 7), so no CI reading containing it can exist yet. Raising floors from local arithmetic would
repeat the exact 5fcdd817 mistake in the same week it was corrected.

**The mechanical step owed after an authorized push:** read the three lanes' pass counts from the
CI run on origin/dev, then make the PAIR of edits per lane (ci.yml `MIN_PASSED` = reading − budget
[6/6/2]; `_FLOOR_SET_FROM` = the reading) in one commit. Until then the floors are merely
conservative, which a shrink-only floor is allowed to be.

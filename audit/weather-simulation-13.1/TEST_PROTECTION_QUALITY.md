# TEST-PROTECTION QUALITY — Audit 13.1

**27 test files added or changed in `791fdf78..568fc2c6`, each read at the assertion level.**

---

## Verdict

> **On assertion craft, this is the strongest test work in the repository's audited history.**
> Differential oracles, named positive controls, single-variable A/Bs, non-vacuity clauses, and
> at least three cases where a new test found and repaired a defect in the repo's **own prior
> guards**.
>
> **The weakness is not in the assertions.** It is that a large fraction of the strongest new
> tests protect code paths that are **dark, dormant, or unreachable by production**, and that
> the CI floors meant to notice coverage disappearing are **themselves stale at HEAD**.

| classification | count |
|---|---|
| **Strong Causal Protection** | **12** |
| Strong Invariant Protection | 5 |
| Strong Invariant Protection (of a dormant path) | 1 |
| Useful Partial Protection | 6 |
| Wrong Runtime Path → repaired | 2 |
| Cannot Detect Known Failure → repaired | 1 |

---

## What is genuinely protected

### `d8c866bd` — the only complete mutation trail in 128 commits

| artifact | result |
|---|---|
| `known-bad-run.txt` | `4 failed, 6 passed` |
| `mutation-repair-disabled.txt` | `2 failed, 8 passed` |
| `repaired-run.txt` | `10 passed` |

**Red → green → red-on-mutation, with artifacts on disk.** This is the standard
`PROGRAM_CONTROL_13.0.md` rules 2 and 3 demand, and it is met exactly once — **by the first
commit of the program**. Nothing in the 127 commits that followed matched it.

### `a1b5aac3` — the model repair of the window

The existing guard opened **one hard-coded path** (`routes/surf_data/alerts.py`, a manual POST
nobody calls) while the **live job** is `scheduler/surf_alerts.py` on a 15-minute
`IntervalTrigger`. The repair:

1. Replaced the hard-coded file list with an **AST census** over all `backend/*.py` for
   `Notification(type="surf_alert")` and `send_push_notification data.type="surf_alert"` — so a
   *new* emitter is graded without editing the guard.
2. Added a second suite that **drives the scheduled task with the composer left real**.
3. Grew the existing suite 7 → 9 top-level tests **with no assertion removed**, including an
   explicit **vacuity control**.

**Eight days of green-on-nothing, found and closed.** This is the correct shape: the guard
discovers its own subjects rather than listing them.

### `a6e4339a` — fixed the fixtures, not the guard

The GRIB Range-integrity defect had two test doubles answering a `Range` request with a **fixed
whole-file body** (`_range_len` in `test_marine_multi_bbox_fetch.py`; the inline equivalent at
`test_noaa_multi_resolution.py:80-88`). A fixture that cannot occur in reality **silently
disarms every physics guard downstream of it**. The repair fixed the fixtures and added a
**census forbidding any test double from answering a Range request with a fixed body**.

That is the correct direction on this repository's most expensive recorded defect shape, and it
closed a **real positional-variable-swap corruption path**, not a hypothetical one.

### Also strong

`bf8fb4cd` / `0509b1ec` (config hardening — a typo can no longer kill a serving module at boot,
and `Semaphore(0)` can no longer deadlock the batch route) · `f44cc87f` (an empty calibration
instrument now **refuses** rather than reporting `available: true` over 60,000 predictions) ·
`489e4f04` (the coverage state machine closed as total, reachable, single-output) ·
`a80a0964` (found that the managed-uniform census **counted two facts with one number — at both
sites**) · `a44bbb60` (the delivered-coverage check was wrap-naive and **failed in the unsafe
direction**) · `ba0e86e5` (the layer-order probe was **blind to the layer it existed to
measure**).

The last three are the pattern worth naming: **three separate cases where a new test found and
repaired a defect in the repo's own prior instrument.** A program that audits its own
instruments is doing the rarest and most valuable kind of test work.

---

## ⛔ The CI floors

### What they gate

`.github/workflows/ci.yml` carries three backend ratchets, each a pair of numbers inside a
Python heredoc parsing that lane's junit XML:

| lane | location | floor at HEAD |
|---|---|---|
| `guards` | `ci.yml:612` | `MIN_FILES, MIN_PASSED = 154, 1782` |
| `chain` | `ci.yml:792` | **`88, 809`** committed · `90, 833` in the working tree |
| `estate` | `ci.yml:1077` | `MIN_PASSED = 433` (no file floor **by design** — the estate is a complement, so moving a file to another lane legitimately shrinks it) |

They gate exactly **two** failure modes: a **file-count drop** (a glob or import selector
stopped matching, so guards silently went unrun) and a **pass-count drop** (mass-skip or
deletion).

> **They gate NOTHING about assertion strength. A file can be gutted to `assert True` and every
> floor stays green.**

### Real-signal half — the floors have caught something real

Each floor is set from an **observed CI reading** at a fixed margin (6 for `guards` and `chain`,
2 for `estate`). The motivating measurement is recorded at `ci.yml:1126-1131` and
`backend/scripts/ci_floor_staleness.py:8-14`: on **2026-08-11 all three floors were stale in one
sweep** — composition by **38 files / 447 tests**, chain by 3 / 89, estate by 36. **Thirty-eight
files could have stopped being collected with the gate still green.** That is a genuine catch
and the floors deserve credit for it.

### Self-referential half — and it is load-bearing

`test_each_lane_budget_matches_the_margin_that_lane_actually_uses`
(`backend/tests/test_ci_floor_staleness.py:266-281`) compares the `ci.yml` floor against
`_FLOOR_SET_FROM` (`:254`).

**Both numbers are written by the same author, in the same commit, by hand.** The test proves
*internal consistency* and **can never prove either number matches CI**.

### The hole, demonstrated at HEAD by measurement — not by reasoning

```
committed HEAD fb50fa6d
  chain floor              = 88 / 809
  _FLOOR_SET_FROM["chain"] = 815      margin 6 = budget 6  ->  the pair test PASSES

  python scripts/ci_test_lanes.py --lane chain   ->  90 files
  python -m pytest $FILES -q --collect-only      -> 839 tests collected
```

> **At HEAD the chain floor is stale by 2 files and 30 tests, and no test in the repository can
> see it.**

`568fc2c6` — the commit that landed **during this audit** — is precisely the fifth manual
correction of this same lane. Its own body records: *"Fifth time this lane has needed the raise,
and the hook has now caught it 5 of 5."* **The pre-push hook is doing the work the test cannot.**
That is a genuine control, but it lives outside CI and outside the repository's own test suite.

### Two frontend floors have nothing watching them at all.

### The repeat offence

`1bcd2241` raised the estate floor in `ci.yml` (`MIN_PASSED 414 → 428`) **without touching
`_FLOOR_SET_FROM`**, which still read `estate: 416`. With `passed_budget = 2`, the pair test
asserts `2 == (416 − 428) = −12` and **must have been red**. `118cfabc` — a commit in the same
window — exists **specifically** to teach that the floor and its `_FLOOR_SET_FROM` entry are a
pair and neither may be edited alone. It was reconciled at HEAD (433/435, margin 2) apparently
**by accident**, via the PR #10 merge, rather than by a locatable deliberate correction.

---

## The structural weakness: strong tests on dark paths

Several of the highest-craft tests in this window protect code that **production cannot reach**:

| test | protects | reachability |
|---|---|---|
| `mc01_capseam` suites | `SURF_CAP_SEAM_MONOTONE` | **default `"0"`** (`surf_height_convention.py:98`; registry `surf_forecast.py:259`) |
| `test_nearshore_validation.py` | WS-CAN-0076 nearshore outcome loop | **imported by nothing** under `backend/routes` or `backend/services` |
| coarse-bridge grace suites | `__RAW_COARSE_BRIDGE_GRACE__` | **unset by default** (`marineCoarseBridgeGrace.js:51`) |

This is **not a criticism of the decision to ship dark** — dark-by-default for science changes
is exactly right, and this audit recommends preserving it. It *is* a caution about reading the
test count as protection of the **served** product: a rising test count on dormant code does not
protect what users receive.

**The concrete cost is visible in Finding 13.1-F1.** The `/conditions/batch` frame lane is
**default ON** and its test (`test_conditions_batch_precompute.py:115,119`) pins **the key set
and the frame's own arithmetic** — never the field's *meaning*. A test asserting six keys exist
passes identically whether those keys carry VHM0 or VHM0_SW1. **The one lane that is live is the
one with the shape-only test.**

---

## What is missing

| gap | why it matters |
|---|---|
| **A meaning test for published fields** | F1 would have been caught at `9d8b2ad9` |
| **A provenance test** — no route may publish a height-shaped field sourced from `marine.point.speed` | the mandate constrains a function, not a route |
| **A selection test** for `region_id` products | F2 shipped labelled inert |
| **A style-layer census on layer switch** | +5 permanent layers is invisible to every test |
| **A lifecycle test for layer-then-model switch** | the +924-buffer super-additive residual is invisible to first-order tests |
| **A settled-camera `LOADING` timeout** | `Raster Source: LOADING` persisted at a settled camera |
| **A floor test that reads the real selector output** | replaces the hand-written pair with a measurement |

---

## Bottom line

**Test protection improved, materially and measurably** — density 0.84 → 0.91, 18 of 27 new
tests rated strong, three prior instruments repaired by their own successors. **Gate 4 is the
one gate that genuinely advanced in this window**, and it advanced on merit.

**But a rising test count with excellent assertions on dark paths is not the same as protecting
the served product** — and the one Critical regression in this audit landed on a default-ON lane
whose test checked the shape of the payload and not the meaning of its fields.

# FINDING 2026-08-14 — splitting the rating reference implementation

**Program 13.0 Mission 2.** `spot_ratings.py` reached the hard 800-LOC ceiling with **three lines of
headroom**, so the next repair to the file CLAUDE.md names as the ONE FORECAST COMPOSITION reference
would have been blocked behind a refactor — the worst moment to be forced into one.

---

## 1. The forensics came before the cut

Three censuses, in this order. Each one changed the plan.

### Census A — who reads this file *as a source string*?

```
git grep -n "spot_ratings.py" -- backend
```

**Ten test files open `spot_ratings.py` BY PATH and assert on its text**: glyph disclosure, flag-lane
parity, reference-generation disclosure, forecast-spread pairing, the three-surface behavioural
census, the climatology self-erase guard, the observation-gate control, the event-loop offload scan.

⭐ **This decided the DIRECTION of the split.** Whichever half keeps the filename keeps those guards
pointed at real code. The majority grade the *rating compute*, so **the compute stayed** and the
precompute lane moved. Splitting the other way would have been the same number of lines and a far
larger blast radius.

⚠️ And the failure mode here is not a crash. `test_flag_lane_parity` scans a hard-coded
`_RATING_SURFACES` list; if a module leaves that list, its flags simply stop being counted. The suite
stays **green** while grading less — the census-is-the-defect class.

### Census B — where is the seam, really?

An AST pass over every top-level def, asking which defs reference which, found exactly **two**
cross-half edges:

| edge | disposition |
|---|---|
| `rate_one_spot()` → `_iso_z()` | `_iso_z` **stayed** with the compute — measured: nothing in the precompute lane uses it |
| `precompute_spot_ratings()` → `rate_one_spot()` | **kept** — this is the correct direction, and the only one |

⇒ the dependency runs **one way**. The lane imports the rating; the rating never imports the lane.
That is now enforced by `test_spot_rating_module_seam.py`, because a seam's failure mode is rotting
back into a tangle, quietly.

### Census C — which science switches move with the code?

The precompute half reads **four**: `RATING_LOCAL_SIZE`, `RATING_TIDE`, `RATING_OBS_GATE`,
`RATING_SIZE_CLIMATOLOGY`. Moving them without adding the new module to `_RATING_SURFACES` would have
made all four invisible to the admin panel and to every lane guard — **silently**.

★ This is the second time in two missions that the flag registry was the trap. Mission 1 added an
undeclared switch and only the full lane caught it. **A file that reads science switches is part of
the flag census, and moving it is a census edit.**

## 2. What moved

| | `spot_ratings.py` | `spot_ratings_precompute.py` |
|---|---|---|
| **owns** | rating a spot — the mandated reference | precompute + Supabase-L2 persistence |
| **symbols** | `spot_confidence`, `rating_why`, `_persist_inputs`, `rate_one_spot`, `_iso_z` | frame select/intern/merge, L2 read/write, REST spot fetch, `precompute_spot_ratings`, `run_spot_ratings_precompute` |
| **LOC** | 800 → **351** | — → **498** |

`SPOT_RATINGS_L2_KEY` / `SPOT_RATINGS_SCHEMA_VERSION` deliberately **stayed**: that key is pinned by
a Supabase storage RLS policy *and* by the frontend CDN client, and the warning about renaming it
belongs beside the constant, not one import away.

## 3. The bug the split exposed

`test_spot_ratings.py` patched `sr.rate_one_spot` and then called `precompute_spot_ratings`. After
the move, `precompute_spot_ratings` lives in the lane module and binds `rate_one_spot` **at import
time** — so the patch reached nothing.

**And the test still passed.**

Because the real `rate_one_spot` swallows resolver failures (`except Exception: logger.debug`) and
returns a well-formed dict, and every assertion in that test was *structural* — frame count, model,
valid_time, spot count. A fake that never ran and a real call that degraded gracefully are
indistinguishable to a structural assertion.

Fixed two ways: the patch now targets the lane, **and** the test asserts `score == 55.0`, a value
only the fake produces. ★ **A test that patches something must assert something only the patch can
cause** — otherwise `from X import name` rebinding will one day quietly neuter it and nothing will
say so.

## 3b. The guard written to catch §3 was itself wrong twice

Worth recording, because both failures are general.

1. **Regex matched its own docstring.** The first draft searched file text for `sr.<moved symbol>`
   and flagged `sr.intern_frame_runs` written as *prose inside its own explanation*. Red on a clean
   tree. ⇒ comments are not AST nodes, **but docstrings are string constants**, and no regex can tell
   an example from a call. It now walks `ast.Attribute` nodes.
2. **`git grep` in a subprocess died — but only in company.** `OSError: [WinError 6] The handle is
   invalid`, raised from `subprocess.Popen`, because an earlier test in the same session had left a
   std handle pytest could not duplicate. **In isolation the test passed.** ⇒ *"passes in isolation"
   is not "passes"*, and a guard that spawns a process can go red for reasons unrelated to the code
   it grades. It now uses `os.walk`.

Both were caught by running the guard **with its neighbours**, not alone — the same lesson as §3,
one level up.

## 4. Guards updated deliberately, never deleted

| guard | why it had to follow |
|---|---|
| `test_climatology_inbox` | slices source from `RATING_SIZE_CLIMATOLOGY`, which moved |
| `test_observation_gate_single_model_surfaces` | its CONTROL asserts the file reads `RATING_OBS_GATE`, which moved |
| `test_flag_lane_parity._RATING_SURFACES` | **added** the new module, or four switches go dark |
| `test_event_loop_offload_guard.BLOCKING_L2_LOADERS` | went red naming the stale entry — updated, as its own message demands |
| `test_data_health`, `test_rating_confirmation` | `monkeypatch` targets that must land on the lane |

⛔ None was weakened, exempted, or narrowed to make a red go away. Three of the five **caught the
refactor themselves** — they are the reason this was a safe change rather than a hopeful one.

## 5. What did not change

`rate_one_spot` is byte-identical and still at its original path. `precompute.rate_one_spot is
spot_ratings.rate_one_spot` — the same object, asserted. No forecast quantity, no constant, no flag
default, no wire field. This is a file boundary, not a behaviour change.

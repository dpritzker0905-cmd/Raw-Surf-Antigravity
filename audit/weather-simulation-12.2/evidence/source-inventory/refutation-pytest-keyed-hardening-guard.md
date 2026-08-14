# Refutation attempt: "test_production_hardening.py asserts the branch the server never takes"

Verified independently at HEAD 791fdf78 (branch dev). Verdict: **CONFIRMED GAP** -- the refutation failed.

## 1. Proof reproduced at HEAD (line numbers re-read, not copied)

| Cited | At HEAD | Match |
|---|---|---|
| open_meteo_provider.py "27-30" | `:28 is_pytest = "pytest" in sys.modules`; `:30 if is_pytest:`; `:31-32 if node_env=="production"... return False`; `:33 else:`; `:37-38 if local_test_fixture: return True` | substance exact, line span off by ~1 |
| scheduler_helpers.py:41-48 | `:40 is_pytest`; `:43 if is_pytest:`; `:50 else:`; `:51-52 if local_test_fixture: is_test = True` | exact |
| copernicus_validator.py:18 | `:18 if is_pytest and is_prod: return False`, ABOVE `:20 LOCAL_TEST_FIXTURE -> return True` | exact |
| test_production_hardening.py:14, :16 | `assert is_test_environment() is False`, `assert flags["is_test_env"] is False` | exact |

`open_meteo_provider.py:27` carries the admission in its own comment:
"Under test runner (pytest), enforce production overrides strictly **to satisfy hardening tests**."

## 2. Decisive non-destructive mutation (observer only; no production source touched)

`scratchpad/test_observer_mutation.py` hides `pytest` from `sys.modules` at CALL time via
`patch.dict(sys.modules, ..., clear=True)`, inside the same pytest interpreter, same env
(`NODE_ENV=production, LOCAL_TEST_FIXTURE=true, TESTING=1`):

```
CONTROL   (pytest visible): False False False   <- exactly what the hardening test asserts
MUTATION  (pytest hidden)  : True  True  True   <- exactly what the server executes
2 passed
```

Standalone probe outside pytest entirely, same env: `True / True / True`. Both directions agree.

## 3. The test is GREEN at HEAD

`pytest tests/test_production_hardening.py -q` -> `3 passed in 2.70s`.
(Env-parity banner fires: python 3.14 != declared 3.12, 28/46 pins differ -- evidence about THIS
interpreter. The branch under test is pure stdlib `os`/`sys`, so the reading transfers.)

## 4. Precision correction the register row must inherit

The test is **not** literally "structurally unable to fail" (SOTA B8's wording): delete the
`is_pytest` branch and it reds. The accurate defect is one step worse and differently shaped --
**the production code contains a branch whose sole purpose is to satisfy this test, and the sibling
branch is what production executes.** The test observes an environment that only exists while the
test is running.

Second, the claimant's proof for `test_store_rejects_test_fixtures_in_production` (:55-87) is half
right. `store_helpers.py:163` is `is_tf = product.provider == "test-fixture" OR is_test_fixture`, so
`normalizer.py:649-660` forcing `is_test_fixture=False` in prod does not alone make it vacuous. The
real mechanism is the SAME root: `store_helpers.py:8` imports `copernicus_validator.is_test_environment`,
which under pytest+prod returns False (guard fires, test passes) and outside pytest+prod+LOCAL_TEST_FIXTURE
returns True (guard never fires at all). One gap, not two.

## 5. Coverage search (absence claim, with positive controls)

Command: `grep -in "pytest|sys.modules|LOCAL_TEST_FIXTURE|hardening|test runner|backend/tests|python test"`
over PROGRAM_OBJECTIVE_REGISTER.csv, CURRENT_CANONICAL_TASK_REGISTER_12.1.csv,
FINISH_LINE_GAP_MATRIX.csv, STATE_OF_THE_ART_TARGET_CONTRACT.md,
WEATHER_SIM_OBJECTIVE_CLOSURE_AND_FINISH_LINE_AUDIT_12.1.md -> **0 hits**.
POSITIVE CONTROL, same five files, same technique: `structurally unable|fixme` -> 1/1/1/2 hits;
`test` -> 4/1/4/15. The search technique works; the absence is real.

Full 65-row title+category scan (csv.DictReader, not grep): every Test-integrity / Test-coverage /
Test-infrastructure task is frontend or CI -- 0018/0019 (test.fixme pixel oracle,
weather-simulation.spec.js:541-578), 0028 (synthetic field harness), 0031/0045 (verdict-cache,
marineMaskShelter.wrapper.test.js), 0059 (E2E route handler), 0027 (playwright video), 0037 (frame
harness), 0065 (CI floor hook). **No task touches backend/tests/ or a Python environment predicate.**

WS-OBJ-502 covers the CLASS ("No test in the estate is structurally unable to fail") but its task
list is `WS-CAN-0018,0019,0028,0031,0045,0059` and its own score line reads "test.fixme still
occupies the pixel-oracle slot" / "Complete or delete the fixme block" -- so **un-fixme-ing 0018
would close B8 while this test survives untouched.** The objective's closure criterion is
under-specified, not satisfied.

## 6. Not recently shipped

`git log --oneline -40` -- nothing touches these files. `git log -S 'is_pytest' -- backend/services/weather_pipeline/ backend/tests/`
-> only `3b815b83`, `f090f5e9` (both old). `git log -S 'satisfy hardening tests'` -> `769ccac2`, `f090f5e9`.

## 7. Not a symptom of a tracked task

Nearest neighbour is **WS-CAN-0040** (OWNER: read the production Render env screen). That would
BOUND whether the hazard is live; it would not repair the test. Note `render.yaml` sets
DATABASE_URL / SUPABASE_URL / SUPABASE_KEY / PYTHON_VERSION / RATING_TIDE / OPENAI_API_KEY /
GEMINI_API_KEY -- and **none of NODE_ENV, IS_PROD, TESTING, LOCAL_TEST_FIXTURE.** So whether
LOCAL_TEST_FIXTURE is set in production is a question the program currently **cannot answer**. That
raises the value of a working test, it does not lower it.

## 8. Scope note found while verifying (not part of this verdict)

`grep -rn "sys.modules" --include=*.py backend/ | grep -v /tests/` -> 7 non-test files sniff the test
runner: server.py:440,465; copernicus_marine_service.py:78; noaa_marine_service.py:27;
copernicus_validator.py:14; open_meteo_provider.py:28; scheduler_helpers.py:40; _fetch_common.py:56.
Only the three cited invert a hardening semantic. The other four disagree with them
(`_fetch_common` and `noaa_marine_service` return False under prod+LOCAL_TEST_FIXTURE; see
`evidence/source-inventory/hidden.md` HID-01). Six disagreeing environment predicates is a separate
architecture question (WS-OBJ-401), not this gap.

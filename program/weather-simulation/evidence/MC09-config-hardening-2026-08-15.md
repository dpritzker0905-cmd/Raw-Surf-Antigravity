# MC-09 slice 1 — startup config hardening + the health fingerprint (WS-CAN-0075)

**Date** 2026-08-15 · **Base** `8454e09a` + working set · **Source** Master Codex Audit 1.0 MC-09
("configuration and exception-state space too large to reason about"), first bounded slice.

## The forensic census (before any edit)

- **130** numeric `int()`/`float()` parses over `os.environ.get` in non-test serving code.
- **22 of them at MODULE level** across 13 files in `routes/` + `services/weather_pipeline/` —
  each an IMPORT-TIME crash on a config typo: the module dies at boot and takes its routes with it.
- **The confirmed sharp edge**: `conditions.py:73` built `asyncio.Semaphore(_BATCH_CONCURRENCY)`
  with **no floor** — `SPOT_RATINGS_CONCURRENCY=0` hangs every `/conditions/batch` request forever
  (the audit's MC-08 deadlock, verified at the line) — while `weather.py:563` clamped the SAME
  variable with `max(1, …)`. One env var, two hardenings: the one-quantity-two-behaviors class.
- No existing env helper anywhere in backend (grep-before-build satisfied).

## The repair

`services/weather_pipeline/config_env.py`: `env_int` / `env_float` — a typo degrades to the
SHIPPED default, loudly (for config, the default is what every lane and calibration ran against;
contrast auth, where fail-closed is right — the asymmetry is deliberate and documented); out-of-
range clamps to the nearest bound, loudly; `NaN` is a typo, not a value (it parses and then
poisons every comparison it meets). All 22 sites routed through it with per-site safety bounds
(floors everywhere; ceilings only where nonsense is dangerous — concurrency 1..64, forecast days
1..16, energy share 0..1). Valid values pass through EXACTLY — config behavior is unchanged for
every correct configuration, pinned by the pass-through control.

`compute_config_fingerprint()`: sha256 (12 hex) over the sorted resolved `name=value` set of the
`_RATING_FLAGS` registry + declared/non-default counts — published on `/api/health` as `config`
(hash and counts only; no value crosses the wire). Incident response can now tell two boxes or
two moments apart. The registry import is a function-scoped services→routes exception, documented
in place, so the declared-flag set has ONE source rather than a drifting copy.

Line-budget notes: `weather.py` (799/800) absorbed its import at net-zero via a `route_helpers`
re-export; `surf_rating.py` 796→797.

## Verification

- Red-first: `test_config_env.py` collection-error red (module absent); census guard red naming
  all 22 sites; semaphore reload test red at `_BATCH_CONCURRENCY=0`. → **12/12 green** after.
- The class guard is AST-based (top-level `Assign` of `int|float` over an `os.environ`/`getenv`
  read) with a POSITIVE CONTROL (a fixture the scanner must find 2 offenders in, and a guarded
  call-time form it must NOT flag) — the scanner cannot go vacuously blind.
- Mutations: **M1** (int floor-clamp removed) → red at BOTH layers — the unit contract AND the
  end-to-end conditions-module reload · **M2** (fingerprint blind to env) → flag-flip test red.
  Unmutated control green, `grep -c MUTATION` = 0.
- Targeted sweep of touched-file suites: **117 passed** — including `test_surf_rating` and
  `test_partition_exposure_energy_share` (the 0.4525/0.50/0.5525 boundary pins), so the mandated
  rating core's constant is value-identical through the new parse.
- Value-preservation for the two production semaphores: default 6 resolves to 6; the owner's
  pending live-value read (WS-CAN-0064) is unaffected.

## Lane results (this tree; local 3.14 interpreter)

- **guards: 1788 passed, 0 failed** (27:16) — UNCHANGED from the pre-sweep reading: 15 serving
  files touched (incl. the mandated `surf_rating.py`) and not one guard moved, which is the
  value-preservation claim proven at lane scale.
- **chain: 790 passed, 0 failed** (13:22) — unchanged (buoy_calibration/wind_ingestion touched).
- **estate: 437 passed, 0 failed** (3:10) — exactly 425 + the 12 new config tests.
- Floor pair at the NEXT push (D-5-corrected convention): estate `_FLOOR_SET_FROM` 413 → 425
  (+12 runtime tests, both new files land in estate), `MIN_PASSED` 411 → 423; guards/chain floors
  unchanged (no new files, no count change).

## Limitations

- 108 call-time numeric parses remain (many already guarded by local try/except); this slice
  closed the import-time class and the confirmed deadlock edge, and the AST guard keeps the
  module-level class closed. Call-time hardening is a later slice.
- The fingerprint covers the DECLARED registry (`_RATING_FLAGS`), not all 351 env names — by
  design: it fingerprints the config the program governs; widening it tracks WS-OBJ-708's
  inventory work.
- `/api/health` still interpolates `str(e)` into `weather_readiness.error` (health.py:103) — a
  public-route internals leak of the MC-07 class, RECORDED HERE AS A LEAD, deliberately not fixed
  in this slice (health diagnostics may be deliberate; needs its own contract check).

## Rollback

One commit; `git revert` restores the bare parses (behavior-identical for valid configs, so the
revert risk is nil). The fingerprint block on health degrades to nulls if the helper import ever
fails — the instrument cannot break the thing it observes.

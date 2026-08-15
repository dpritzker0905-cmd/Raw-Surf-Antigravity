# WS-CAN-0040 — the production Render environment read, reconciled

**Date** 2026-08-15 · **Gate 0 · P0-owner** · owner performed both reads; this is the reconciliation.

Two sources, and they answer **different** questions — neither alone closes this item:

| source | what it reports | coverage |
|---|---|---|
| `/admin/surf-forecast/status` (admin console → **Surf Forecast** tab) | the **effective** value, `os.environ` evaluated **on the serve box** | **42** flags |
| Render dashboard → Environment | which vars are **explicitly set** (overrides only; unset ⇒ code default, invisible here) | all, names only |

The backend reads **311** non-secret env vars. ~31 keys are set on Render, ~18 of them secrets ⇒
**~13 non-secret overrides, so ~298 variables run on code defaults.**

---

## ✅ THE OPEN QUESTION IS ANSWERED — `SPOT_RATINGS_CONCURRENCY` IS NOT SET

It does not appear on the Render Environment screen, and it is **not** among the panel's 42.
⇒ the code default applies, in **both** call sites:

```
backend/routes/surf_data/conditions.py:53   env_int("SPOT_RATINGS_CONCURRENCY", 6, lo=1, hi=64)
backend/routes/weather.py:326               env_int("SPOT_RATINGS_CONCURRENCY", 6, lo=1, hi=64)
```

**Live value = 6**, on both route semaphores. This retires the standing "NEXT = an ADMIN READ" item:
the batch measured LINEAR at 0.380 s/spot, so a concurrency of 6 is buying nothing, and that is now
a measured fact about production rather than an inference about an unread screen.

## ✅ THREE-LANE PARITY IS CLEAN — the `RATING_TIDE`-class trap did NOT fire

Exactly **three** flags carry the panel's `overridden` badge, and they are exactly the three
non-secret `RATING_*` keys on the Render screen. Their declared lanes were then checked in-repo:

| flag | Render | forecast-ingest.yml | precompute.yml | effective |
|---|---|---|---|---|
| `RATING_OBS_GATE` | ✅ set | ✅ | ✅ | **on** |
| `RATING_LOCAL_SIZE` | ✅ set | ✅ | ✅ | **on** |
| `RATING_TIDE` | ✅ set | ✅ | ✅ | **on** |

All three lanes agree. ★ This is the exact failure recorded against `RATING_TIDE` on 2026-07-18
(set to `1` in both ingest lanes while the docs said "Render env") **not** recurring.

## ⭐ THE HEIGHT PAIR IS SET IN *NO* ENVIRONMENT — and that is the strongest parity available

`SURF_HEIGHT_H110`, `SURF_GAMMA_FIELD_CEILING`, `SURF_REFRACTION_KR`, `SURF_CAP_SEAM_MONOTONE`:
**absent from Render, and `grep` returns 0 in both workflows.** They run on code defaults everywhere:

```
SURF_HEIGHT_H110         "1"        SURF_GAMMA_FIELD_CEILING   "1"
SURF_REFRACTION_KR       "0.797"    SURF_CAP_SEAM_MONOTONE     "0"
```

Those defaults ARE the shipped 2026-08-05 height pair. ⇒ **the pair shipped as code defaults, not as
env**, so ★ **a value that exists in no environment cannot differ between environments.** No lane can
drift. (The panel's "where" column names three lanes for these because it is a *flip instruction* —
where you must set it if you ever override — not a state report. The `overridden` badge is the state
report, and it is absent on all four, correctly.)

## ✅ FOUR STANDING QUESTIONS CLOSED BY THE PANEL, FROM PRODUCTION TRUTH

| | live | why it matters |
|---|---|---|
| `SURF_CAP_SEAM_MONOTONE` | **off** | today's dark ship (`WS-CAN-0072`) confirmed inert in production |
| `RATING_BREAKER_TYPE` | **off** | ⭐ **independently confirms the Shark Pit parity diagnosis** |
| `RATING_TIDE` | **on** | ⭐ same — tide was the only armed candidate, now measured not inferred |
| `SURF_TIDE_DEPTH` | **off** | matches the standing owner decision |

★ The parity diagnosis (2026-08-15, `Sim Parity Monitor` run 31882534108) rested on the *inference*
that `RATING_BREAKER_TYPE` defaults `"0"` and is set in no workflow, leaving tide as the only waived
factor that could be armed. **The panel now shows both states live on the serve box.** The inference
is retired and replaced by a reading.

## ✅ TWO HOUSEKEEPING CONFIRMATIONS

- **`STRIPE_WEBHOOK_SECRET` is present on Render** — CLAUDE.md's standing ask ("confirm that secret
  remains configured") is satisfied.
- **`MARINE_PHYSICS_VALIDITY` is not set** ⇒ default `"1"` (`wave_physics.py:52`) ⇒ **the guard is
  ARMED.** The recorded landmine is "never set it to 0"; it is not set at all, which is correct.

## ⚠️ WHAT THIS READ DOES *NOT* ANSWER

1. **Values are masked.** For the three `RATING_*` the panel supplies the effective state, so those
   are complete. For the other ~10 non-secret overrides I know only that they are set:
   `DISABLE_FORECAST_SCHEDULER` · `GFS_ICON_SERIES_FASTPATH` · `PREFETCH_CONCURRENCY` ·
   `PREFETCH_MAX` · `MALLOC_TRIM_THRESHOLD_` · `SHORE_NORMAL_BEARING_RADIUS_KM` ·
   `WAVES_ANIM_DOMINANT_SWELL` · `PYTHON_VERSION` · `STRAVA_CLIENT_ID`.
   ▶ `PREFETCH_CONCURRENCY` / `PREFETCH_MAX` / `MALLOC_TRIM_THRESHOLD_` are the three worth having:
   the first two bound prefetch load and the third is memory tuning on a box with a three-incident
   melt history — all three bear directly on **WS-CAN-0064** (`/api/conditions/batch` > 10 s).
2. **The screen listing may be truncated** — the last row (`WAVES_ANIM_DOMINANT_SWELL`) rendered
   without a value, so entries below the fold cannot be ruled out.
3. **269 variables remain unreported by either source** — set nowhere and not in the panel's 42, so
   they are at code defaults by deduction rather than by disclosure. That is sound, but it is an
   inference, and the panel could close it by widening past the 42 rating flags.

## Disposition

The item's intended outcome — *"bounds several flag-state questions in minutes"* — is **met**: one
open landmine answered, three-lane parity proven clean, the height pair proven undriftable, and two
inferences in this week's forensics replaced by production readings. Residual is the value of ~10
non-secret overrides, which is a second, smaller ask, not a re-run of this one.

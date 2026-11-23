# 2026-11-22 · `RATING_MISSING_SAMPLE_UNKNOWN` ON (#1181): bug-hunt B

**Author:** research lead. Append-only.

## Owner word
- "Yes, ship #1181 on". David typed it in the advisor session; the director relayed it on 2026-11-22.
- Confirmed by David in the director session (local_d6b521eb) on 2026-11-22: "Yes, ship it on".

## What ships
- `RATING_MISSING_SAMPLE_UNKNOWN`'s code default goes from `'0'` to `'1'`, in `runtime_flags.GUARDED` and `_RATING_FLAGS`.
  - In `routes/admin/surf_forecast.py`, the existing line was changed. The file stays at 800 lines, the hook's cap.
- **With it on, a sampler placeholder is MISSING, never a measured zero.**
  - A placeholder is the `unavailable` / `out_of_bounds_fallback` sample: speed 0, period 0.
  - Wind: the engine's neutral for unknown wind (the failed-resolve path), never glassy.
  - Marine: no height and no rating (level `unknown`).
  - It is wired at the shared chain's entry points only: `augment_with_surf`, `rate_one_spot`, and the sim's `/point` read.
- **Kill:** `'0'`, through the runtime manifest (flag-guardrail) or env. `test_skip_is_on_by_default_and_the_kill_turns_it_off` and `test_off_keeps_the_old_reading` pin it.

## Guardrail
- **BLIND** (`scripts/flag_guardrail.py`): the flag moves only spot-hours whose sample was a placeholder, and the replay never serves one. The live guardrail cannot see a difference, so it cannot auto-disable this flag on evidence.

## History filter (D-065)
- `default-on-filter.yml` runs on this PR, because the GUARDED default moves to `'1'`.
- The flag is not in `eval_replay.UNREPLAYABLE`, so the filter replays it OFF and ON through the reference chain.
- **Expected reading:** inert (no change). The cached replay window is built from real samples, and a placeholder changes nothing on a real sample (pinned by `test_real_samples_are_untouched_when_on`).
- **The filter's actual result is appended below when it reports.** If it cannot run (no cache for the window), its SKIP message is appended instead.

## Not measured
- **Frequency:** how often production serves a placeholder for the rated catalogue. The precompute does not record the sample method.
- **Committed next PR, after this merges:** a per-run tally of placeholder samples (marine and wind, by model) in the precompute summary. Until then the blast radius is unknown, in both directions: how many ratings were inflated, and how many will now read `unknown`.

## Results appended after this point

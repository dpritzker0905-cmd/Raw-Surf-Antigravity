# 2026-11-05 · claude · SURF_NEARSHORE_MOP ON by default (D-069)

Branch `claude/zen-goodall-6f6smk` from dev `136ff08b`. This is the same session as
`2026-11-05-claude-spectral-k-fresh-retest.md` (#727): one log per PR, because the two branches never share a file.
Authority: the owner, 2026-11-05: "yes switch things on that help us and make sense logically".

## Why

#727's diagnostics (that log, §5 and §8) showed that the GFS-driven K's input is the defect at Rodeo, measured against
CDIP's own MOP reference. They pointed at CDIP's operational product, which `SURF_NEARSHORE_MOP` serves and which was
built but dark.

## Evidence (no new scoring needed)

- `mop-nearshore-ingest.yml` has archived every MOP run since 2026-09-27: 258 runs, all succeeding.
- The nearshore judge (`nearshore-validation.yml`, armed: `NEARSHORE_VAL_ENABLED` is set) grades those archives
  against CDIP buoys on every scheduled run.
- An earlier reading in this session said "ARMED OFF". That was a grep of the script's own echoed source text, not
  its output; the run titles say "Nearshore requested". The owner caught it.
- 86 runs (2026-10-09..11-04), from the log line `MOP_GRID_AB`:

  | | served (bulk chain) | MOP grid (candidate) |
  |---|---|---|
  | MAE | 0.250 m | 0.096 m |
  | bias | −0.175 m | −0.011 m |

  - MOP is better in 86/86 runs and 27/27 days.
  - 5-day block gains: 0.242, 0.148, 0.132, 0.131, 0.198, 0.223. Mean +0.179 m, t(5) 95% [0.128, 0.230].
  - Raw per-run lines: `evidence/2026-11-05-nearshore-mop/judge-grid-arm.json`.

## Change

- `runtime_flags.GUARDED["SURF_NEARSHORE_MOP"] = "1"`, so the guardrail watches it.
- `mop_serving.enabled` and `point_surf_augment` read it through `_rf.on`.
- `_RATING_FLAGS` default `'1'`.
- forecast-ingest, precompute, sim-parity-monitor and spot-series declare `''`, deferring to the manifest.
- Tests: the kill switch never asks MOP and stays parametric; the default is ON and guarded.
- ⚠️ Render env: if Render sets `SURF_NEARSHORE_MOP=0` explicitly, that is a hard override and the flag stays off
  there. This session cannot see or change Render env; the owner checks at merge.

## Not done

Nothing merged, no deploy, no env or secret change. `SURF_SPECTRAL_K` stays OFF (#727).

## Update: scoped to the EURO member (owner: "yes", 2026-11-05)

As first built, the flag was model-blind (`nearshore_for_point` takes no model). Every member at a covered California
spot would have shown the same ECMWF-driven height. That would have:
- emptied the model picker of meaning there;
- let RATING_OBS_GATE's ">= 2 of 3 models agree" pass on one shared input;
- collapsed the member spread.

Fix: `mop_serving.MOP_MEMBERS = {"EURO"}` and `applies_to(model)`. `point_surf_augment` asks MOP only for EURO.

Tests:
- `test_gfs_and_icon_keep_their_own_chain_the_three_members_stay_independent` (GFS, ICON): never asks MOP, stays
  parametric;
- the existing flag-on test now runs as EURO.

The chain floor was re-derived with `--add 3`.

Still open:
- the judge compared MOP with the served bulk chain; the EURO-chain-vs-MOP comparison needs confirming;
- MOP's forecast horizon, and the hand-off to EURO's chain at its end.

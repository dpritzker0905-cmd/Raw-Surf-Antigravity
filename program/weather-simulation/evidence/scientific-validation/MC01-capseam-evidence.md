# MC-01 — the cap seam repaired, dark (`SURF_CAP_SEAM_MONOTONE`, default OFF)

**Date** 2026-08-15 · **Tree** `5fc7d4bd` + working set · **Defect lineage** Master 11.0 §3.8 /
E1-03 ("the H1/10 cap seam") = WS-CAN-0052's named blocker = Master Codex Audit 1.0 MC-01.

## The defect, reproduced before repair

`estimate_surf` compared the PRE-conversion height against the γ·d cap but returned the
POST-conversion (×1.27, H1/10) value on the unsaturated branch — so the published surf height
climbed to 1.27·cap, then FELL onto cap as offshore Hs rose 0.01 m.

Independent audit probe (`jacobian_probe.py`, unmodified) at HEAD `c1566c8b`:
**38 of 48 traces contained a negative jump**; largest **8.2294 → 6.4800 m** for Hs 9.40 → 9.41 m
(steep shelf, Tp 10 s, 45° offset). 6.48 = 0.81 × 8.0 m = the cap itself; 8.2294/6.48 = **1.270**
= the H1/10 factor — the mechanism confirms itself numerically.
Artifact: `mc01-jacobian-probe-legacy.json`.

## The repair

`surf_height_convention.publish_surf_height` — the statistic module now owns how its statistic
saturates: **convert, then compare** — publish `min(converted, γ·d)`. One shared point; every
caller reaches it through `estimate_surf`'s single return. The cap stays UNconverted (γ·d is an
individual-maximum-wave criterion; converting it double-counts — rationale moved verbatim from
`estimate_surf`). Flag OFF (default) is byte-identical legacy, over-ceiling values included.
`surf_transform.py` 800 → 795 LOC (was AT the ratchet ceiling).

## Evidence

| claim | instrument | result |
|---|---|---|
| Monotone: 0 negative jumps, 48/48 traces | audit probe, repair armed | `negative_jump_count = 0` (was 38) — `mc01-jacobian-probe-repaired.json` |
| Rating physics untouched (control) | same probe, rating section | perturbation table byte-equal (shore-normal +15°: 0.5/8.0/23.3/13.23%) |
| Seam derivative gone | same probe | steep-shelf max dH/dHs 34.91 → **1.99** (physical shoaling) |
| Band bounded by theory | `mc01_capseam_census.py` | correction inside band: median −10.9%, **max −21.26% = 1 − 1/1.27 exactly** |
| Band occupancy (synthetic sweep) | census | 7,356 / 57,168 swept cells = 12.87% — **sweep-relative, NOT production traffic**; production reach is the 0.145%-of-spot-hours cap-bind neighbourhood (n=227,088, 2026-08-07) |
| Rating migration in band | census (probe rating conventions) | score Δ median +0.2, range −3.4 … +14.5; **70/409 sampled cells cross a bucket** — clipping oversized heights mostly RAISES scores via the oversize gate |
| Repair only ever lowers | census assertion | zero raised cells |
| 47 property/control tests | `tests/test_surf_cap_seam_monotone.py` | red-first 44F/3P on the unrepaired tree → 47/47 green repaired; adjacent guards (height anchors, convention, owner anchors, flag-lane parity) 102 green total |
| Mutation matrix | Edit-tool mutations, per-mutation targeted runs | M1 dead switch → 3 tests red (monotone, band-theorem, registry) · M2 double conversion → band-theorem red (monotone alone is blind — by design) · M3 dropped conversion → band-theorem red · M4 inert kill switch (legacy converts first) → flag-off golden red · unmutated control 66/66 green, `grep -c MUTATION` = 0 |

## Exact commands

```
cd backend && python -m pytest tests/test_surf_cap_seam_monotone.py -q          # 44F/3P pre, 47P post
python program/weather-simulation/evidence/scientific-validation/mc01_capseam_census.py \
    > mc01-capseam-census.json
SURF_CAP_SEAM_MONOTONE=1 python "<audit_tools>/jacobian_probe.py" > mc01-jacobian-probe-repaired.json
```
Interpreter: local python 3.14.4 (declared 3.12 — the standing environment caveat; CI remains the
authority on the lanes).

## Limitations, stated

- The census grid is the audit probe's synthetic envelope: it establishes the property, not
  population prevalence. The real-spot band census belongs to the flip decision.
- Rating migration used probe conventions (`reference_size_m=1.2`); production supplies per-spot
  references, so served deltas will differ in magnitude, not in mechanism.
- The repair is DARK. Nothing served changes until the owner flips
  `SURF_CAP_SEAM_MONOTONE=1` — and the flip must reach **all lanes together** (Render env +
  forecast-ingest.yml + precompute.yml), because precomputed frames bake heights.

## Also fixed in the same visit (registry truth)

`_RATING_FLAGS["SURF_HEIGHT_H110"]` declared default `"0"` while the code default has been `"1"`
since 2026-08-05 — `/admin/surf-forecast/status`, the ONE instrument that can read Render,
reported the height convention OFF whenever the env did not set it. Corrected to `"1"`; registry
default == code default now pinned by
`test_surf_cap_seam_monotone.py::test_the_h110_registry_default_matches_the_code_default`.

## Rollback

Flag already OFF: revert = delete nothing, flip nothing. If the commit itself must be reverted:
`git revert <sha>` — the change is self-contained (2 pipeline files, 1 registry dict, 2 test
files); byte-identity of the OFF path is pinned by
`test_flag_off_is_byte_identical_legacy_including_the_defect`.

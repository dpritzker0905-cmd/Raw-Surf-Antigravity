# 2026-11-22 wind long-range v2: build PR 1 (session `local_318ba0a1`, branch `claude/wind-long-range-v2-build`)

Task (director): build, dark, with tests and floor fragments, what the frozen registration needs; nothing runs before the owner's word. Registration `gates/wind-long-range-v2.md` (gate PASS 8ea5fd219) is not edited. Findings go in `gates/wind-long-range-v2-amendment-1.md`.

## Built (backend/scripts, all `wind_lr2_*`)
`runs` (FIT 4-day 00Z list, TEST 90 runs, missed-freeze rule, bins, centres, regions), `collect` (AIGEFS/GEFS/IFS ENS member readers, drop-never-fill, shard, no network at import), `truth` (FIT/TEST truth sources, snapshots, pairing), `clim` (ERA5 by-hour interpolation, CDS request, attribution), `fit` (ridge toward the raw pool, leave-block-out CV, lead interpolation, GF, sha256 freeze), `stats` (moving-block bootstrap, Holm, F1 20 / F3 6 / F1c, gatekeeping, floors, control primitives). 42 tests, none touches the network.

## Found while building (listings only, no forecast values)
- GEFS 0.25 deg member files stop at f240; past that only 0.5 deg (`pgrb2ap5`), gust in `pgrb2bp5`. Amendment A1.
- No `CDS_API_KEY` in this session, and `10m_wind_speed` in the by-hour ERA5 product is unverified. Amendment A2: collection must not start until that is checked; a failure needs a further amendment.

## Not built (second build PR, before any freeze): amendment A5.
## Record: nothing collected, fitted or scored; no served number changed; no secret value in any file.

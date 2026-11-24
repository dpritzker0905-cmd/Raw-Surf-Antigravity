# 2026-11-23 · check lane: publish-time frame physics check (report-only) + P0 fix plans

Session: the check lane started by the director (local_d6b521eb) after the owner chose "Start check lane
(Recommended)". Evidence: the inspection lane's data-and-physics rescan (side notes
`SOTA-RESCAN-DATA-AND-PHYSICS-2026-11-23.md`). Branch `claude/frame-physics-check`.

## Step 1 · the check (built, report-only, ON, kill `FRAME_PHYSICS_CHECK=0`)
- `backend/services/frame_physics_check.py` (pure rules), `backend/scripts/frame_physics_report.py` (reads
  latest.json, the GFS / ICON / EURO world marine indexes and a frame sample: lead 0, then every 24 h), new step in
  `forecast-ingest-pilots.yml` after both frames steps, `continue-on-error`, artifact `frame-physics-report-<run>`.
- Rules: R1 partition Hs <= total + 0.05 m; R2 sum(p^2) <= 1.1 H^2 (cells with total > 0.25 m); R3 no valid cell at
  0 m with 0 s / no period; R4 one source and one run per model button over authoritative + native_time_interpolation
  frames (the locked tail blends are listed, not failed; an interpolation's `estimated_interpolation` label is not a
  second source).
- Never blocks or changes a value: it writes nothing to any bucket and exits 0 on any finding or failure (pinned by
  tests: the published tree is byte-identical after a run; a missing credential becomes `error` in the report).
- Tests: `backend/tests/test_frame_physics_check.py`, 23 tests, a planted violation and a clean twin per rule, run
  twice from `backend/` (23 passed both times). Mutation check: breaking each rule's comparison turns 4 / 3 / 2 / 1
  tests red.
- Workflow-reading tests (52 files): 27 fail locally both with and without this change (Python 3.14, packages
  absent); the same 27 with the base workflow file, so none is from this PR. Hosted CI is the authority.

## First real read (public bucket, anonymous GETs; the live API box was not called)
Run against `v1/latest.json` written 2026-11-23T23:31:06Z: 162 frames, 10,220,794 bytes.

| Model | R1 swell <= total | R2 energy closure | R3 valid zeros | R4 one source + run |
|---|---|---|---|---|
| EURO | 14,323 / 126,607 cells (11.3 %), worst 23.7 % @ 12-07T12Z | 22,836 (18.0 %), worst 31.6 % @ 12-07T12Z | wind_waves 4,522 / 119,535 (3.8 %) | 2 sources (ecmwf_wam025 total, CMEMS MFWAM partitions), 5 runs |
| GFS | 3,572 / 142,536 (2.5 %), worst 2.9 % | 31,362 (22.0 %), worst 25.1 % | 0 | ok |
| ICON | 16,341 / 143,800 (11.4 %), worst 28.2 % @ 12-06T12Z | 21,082 (14.7 %), worst 36.5 % @ 12-05T12Z | waves 7.7 %, swell_1 6.9 %, wind_waves 7.9 % | ok |

This reproduces the rescan's findings 1, 2, 4, 5 and 11 with an independent instrument. EURO runs: 12Z (65 frames),
00Z (227, the CMEMS partitions), and 4 frames each from the 11-20, 11-21, 11-22 12Z runs (finding 4's
interpolations).

## Step 2 · fix plans (no code)
`docs/weather-program/research/P0-PHYSICS-FIX-PLANS-2026-11-23.md`: tail closure projection (blend untouched), EURO
partition source (step 0: does ECMWF open data carry partitions; else label + run alignment, closure dark), MOP jack
cap (interim dark patch, target: linear shoaling to breaking). All three are BLIND to today's replay (GFS-only, no
partitions or MOP archived), so each ships dark under D-090 rule 4 as well as under the advisor's ruling.
SubQ and Reflection: APPROVE WITH CHANGES on all three; their changes are in the plan's amendments. LongCat not
sent (its submit needs the owner's approval of the payload hash). Checked with the repo's own
`shoaling_coefficient`: Ks dips to 0.913 (6.5 s, 10.5 m), so SubQ's "Ks >= 1 always" was wrong; recorded.

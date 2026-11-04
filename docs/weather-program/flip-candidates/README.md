# Flip candidates: the declaration a flip PR carries

A PR that proposes flipping a served flag gets an INFORMATIONAL scorecard comment when it carries the label
`flip-candidate` and changes exactly ONE declaration here, `<slug>.json` (job `flip-scorecard` in
`.github/workflows/eval-harness.yml`; contract in `backend/scripts/flip_scorecard.py` and
`docs/weather-program/evaluation-harness.md`). It is not a required check and it never activates a flag, merges,
deploys, changes an env or dispatches anything; the owner decides the flip.

```json
{
  "schema": "raw-surf/flip-candidate/0",
  "slug": "<the file name without .json; lowercase a-z 0-9 ->",
  "flags": {"FLAG_NAME": "value"},
  "window": {"start": "2026-10-16T00:00Z", "end": "2026-10-29T18:00Z"},
  "leads": [24, 48, 72],
  "primary": "hs_station",
  "rationale": "one line: why this flip"
}
```

Rules (each refusal is named in the comment): the window is PINNED in the past (ends at least 3 days before the
run), covers at least 14 UTC target days and spans at most 14 days (D-066: 00Z day 1 .. 18Z day 14), bounds on 00/06/12/18Z; the plan fits 400 byte-range downloads; flags must be replayable
(`eval_replay.UNREPLAYABLE` are refused). The base arm is the merge base's served env (its `precompute.yml`); the
candidate is that env plus `flags`. The head's own `precompute.yml` env must equal the base env (a dark proposal) or
the base env plus `flags` (the flip itself). A PR that also changes served backend code is REFUSED (one code version
replays both arms). Outcomes: PASS / FAIL / REFUSED (no change, underpowered, substitutions, code drift, budget) /
INVALID (declaration, env mismatch, broken controls, an error).

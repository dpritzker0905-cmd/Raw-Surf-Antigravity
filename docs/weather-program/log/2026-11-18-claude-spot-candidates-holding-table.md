# 2026-11-18 Claude: the surf-spot holding table (PR 1 of 4)

Session: surf-spot adviser lane (`466af216`). Branch `claude/spot-candidates-holding-table`. A new private table, the
duplicate-tier rule and a dry-run loader. No served number moves. Nothing was written to any database. No spot was
added, moved or hidden.

## 2026-11-18 22:25Z What was done, and why

**Asked for by David**, typed in this session: "we should put those spots into a separate holding table that can hold
the 23,732 spots to be reviewed. And we should create a helper tool that helps us place them at least in the nearest
known location first, before we confirm them. This tech should work with our surf spot admin, logically."

**Assigned by the director** (cross-session, 2026-11-18), in this order: schema plus holding table, then admin paging,
then the placement helper, then the map marking. Rules: candidates live in the holding table only; nothing enters
`surf_spots` without a person's promotion; no bulk import; nothing overwrites an existing pin; no served forecast
number changes; a production migration is a data write (guarded SQL, the advisor's read, David's word, a ledger line).

**What this PR adds.**

- `backend/models/spot_candidates.py`: table `surf_spot_candidates`. Identity is (source, source record id). The
  source's name and coordinate are never edited; a person's better position goes in `proposed_*`. Status is one of
  pending / held / rejected / duplicate / promoted, and a promoted row must name its spot (one candidate, at most one
  spot). Spot ids are plain strings, not foreign keys, so the existing merge tools (which hard-delete from a hand-kept
  list of referencing tables) are not given a 25th table to miss. Private on Postgres: row security on, no
  anon/authenticated grants, the service key may only read.
- `backend/services/spot_candidates.py`: the tier rule A-F, first that applies, using the shared name matcher
  (`spot_duplicates.names_match`); a grid index that wraps at the antimeridian; the business filter.
- `backend/scripts/load_spot_candidates.py`: dry run by default. With `--commit` it inserts into the holding table
  only and never touches a candidate that is already there. It reads `surf_spots` and cannot write it.
- `backend/tests/test_spot_candidates.py`: 30 tests (guards lane, 1 file).

## Measured

- **Reproduces the recorded tier counts exactly.** The loader's dry run over the Foursquare pull (30,013 records)
  against the repo's 2026-08-12 catalogue snapshot (1,773 rows): 3,705 businesses left out, 26,308 candidates,
  A 49 · B 444 · C 357 · D 1,460 · E 266 · F 23,732. Same numbers as the 2026-11-18 research dry run, which used a
  different distance formula. Instrument: `python scripts/load_spot_candidates.py <pull> … --catalogue-json
  audit/weather-simulation-12.0/evidence/runtime-verification/RV-12_spot_catalogue_20260812.json` (no `--commit`).
- **Tests go red on a planted fault.** Three mutants, one at a time: tier-A radius 0.1 → 0.05 km (1 failed), the
  antimeridian wrap removed (1 failed), the tier-B rule disabled (3 failed). Unmutated: 30 passed.
- Local checks: flake8 gate clean, file-size check 0 violations, `ci_test_lanes.py --assert-partition` OK. The local
  interpreter is not the declared environment (4 packages absent); hosted CI is the authority.

## What a reader must know before merging

- **Merging this creates the empty table on production at the next backend deploy.** `server.py`
  `ensure_database_tables()` runs `create_all` at startup for any model table that is missing (the same way
  `surf_truth_anchors` arrived). That is a schema change on production with no rows written. If the director wants
  that step held for David's word, the merge is the step to hold.
- **Not in this PR:** any route, any admin screen, the promote action, the placement helper, the map marking, paging.
  Candidate-against-candidate near pairs (about 10,000 pairs within 0.8 km inside tier F) are not grouped yet.
- **Not done:** no candidate has been loaded anywhere. A committed load on production needs David's word in the
  session that runs it.

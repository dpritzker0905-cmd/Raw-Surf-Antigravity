# 2026-11-23 · admin truth: every switch, its true state, verification view (Fable inspection P0-3, P1-4, P1-6)

Lane `claude/admin-truth-switches-verification`, started by the director on the owner's approval through the
inspection lane. Scope is exactly P0-3, P1-4 and P1-6 of `SOTA-GAP-INSPECTION-2026-11-23` (shared notes); nothing else.
**No served number moves**: everything here is a read-only admin view plus one read-only CI job. No SCOREBOARD row.

## P0-3: the admin now shows every switch's true state and source

Before: the flag board listed the 138 hand-written `_RATING_FLAGS` rows and read only this server's env, so
`GFS_WORLD_FULL_HORIZON`, `ECMWF_WAVE_LAND_CENTRE_BLOCK` (repo variables 1), `MARINE_EXT_CEILING_MARGIN_H` (12) and
`MANIFEST_PUBLISH_ONE_STEP` (a literal `'1'` in four workflows) showed "Off, code default".

After:
- `backend/services/switch_scan.py` (pure, stdlib) SCANS the code (`os.environ.get` / `getenv` / guarded `flag()` /
  the project's `env_int`-style and `_flag` helpers with a 0/1 or numeric default) and the workflows (literal,
  `${{ vars.X || 'fb' }}`, other expressions, and `if: vars.X` job gates). Local run on `15a1e8472`: 575 rows
  (356 switches, 219 settings), 139 registered, 436 not; every one of the 118 `vars.*` names the workflows read is
  attached to a row.
- `GET /admin/surf-forecast/switches` (admin only, read-only; `routes/admin/surf_switches.py`): per switch, what THIS
  server reads (env > runtime manifest for GUARDED > code default) and, per workflow lane, the literal, the repo
  variable's value, the workflow fallback when the variable is unset, or "set in CI" when no snapshot was read (or
  the snapshot is older than 18 h: a stale value is not shown as current). A
  summary state (on / off / mixed / unknown / setting) and `differs_from_default` over those answers. An hours margin
  whose lanes read 12 is a setting, not "On". Guarded flags carry their guardrail coverage class.
- Repository variables: the server cannot read them, so `admin-ops-snapshot.yml` (every 6 h, kill
  `ADMIN_OPS_SNAPSHOT=0`) hands `${{ toJSON(vars) }}` to `scripts/admin_ops_snapshot.py`, which drops credential-like
  names and keeps a value only when it is 0/1, a number or a boolean word (DEFAULT-DENY: anything else is "set, value
  not shown"), and the stdlib step uploads `admin/ops-snapshot.json`.
  Secrets are never in `vars`; no secret is read except the storage key, by name, in the one stdlib step.
- `admin_flag_board.serve_box_reads` no longer treats the word "manifest" as the runtime manifest ("the manifest
  writers" are ingest lanes): `MANIFEST_ONE_ENTRY_PER_OBJECT` now carries the "read by a workflow lane" caveat.
- Parity: `tests/test_switch_scan_parity.py` runs a BROADER pattern (any function named env/flag/switch, any literal
  default) and every repo variable the workflows read; each must be in the registry, so a new switch cannot go
  unlisted. It also pins that no credential-like name is ever listed.
- The client `SwitchBoard.js` replaces the registered-flag board (which stays as the fallback when `/switches` fails);
  it opens on "Changed from default".

Not done here: `RATING_REF_PRIOR`'s registry text still opens "[D-065 held OFF ...]" (inspection pass 4 lead). The new
board shows its effective value and source beside it; whether STATE's "ON through the manifest since 2026-11-13" is
still true was not read (the manifest is private and this lane makes no live read). Left for the registry owner.

## P1-4: guardrail coverage, which flags are blind, and why

Measured with `scripts/flag_guardrail.coverage()` over `runtime_flags.GUARDED` at `15a1e8472` (import only; this lane
does not edit `flag_guardrail.py`, which #1221 / #1223 / #1226 have open; coordinated with that session).
**33 guarded flags: 24 BLIND, 4 rating, 3 replay, 1 volume, 1 ledger.** (The inspection's "25 of about 36" counted
entries in the COVERAGE table, which also pre-declares flags that are not guarded, such as `WIND_LANE_SKILL_WEIGHTS`.)
16 of the 24 BLIND flags have code default ON:

| BLIND and ON | Can the guardrail be given coverage? |
|---|---|
| `SURF_BIGHT_HS_CONSENSUS` | **Feasible, proposed**: a LEDGER arm like `CONSENSUS_DIRECTION_VECTOR`'s (the skill ledger already scores EURO/ICON/consensus at the Bight buoys); needs a judge in `consensus_ledger_guard` and a COVERAGE edit after #1221/#1223/#1226 land |
| `SAMPLER_UNRESOLVED_STATIONS` | **Feasible, proposed**: a LEDGER presence check (46267 must have no served rows; the per-buoy split already counts it as unanswered) |
| `SURF_NEARSHORE_MOP` | **Feasible, proposed**: the `nearshore-validation.yml` mop_grid arm (MOP vs CDIP) is the instrument; it is dispatch-only, so it needs a schedule before it can strike |
| `SURF_TIDE_OWN`, `SURF_TIDE_WINDOW_FIX` | Not yet: no instrument scores the served tide against observed water; the G4 tide gate will. The replay's tide is Open-Meteo by date |
| `RATING_MISSING_SAMPLE_UNKNOWN` | Not by skill: it moves only placeholder spot-hours the replay never serves. A placeholder census per precompute is the possible sanity check |
| `RATING_OBS_GATE` | Not by skill: applied after rating in the precompute merge; no observed rating exists (would be RATING class at best) |
| `SPOT_HUB_RATE_ONE_SPOT`, `SURF_SEA_INPUTS_EVERY_CALLER`, `SIDE_PATHS_THROUGH_CHAIN`, `RATING_BAND_ONE_CHAIN`, `HUB_NOW_NEAREST_HOUR`, `BAND_PARTITION_HEIGHT_ONLY` | Not by the replay: each makes another surface agree with the glyph the replay already scores; their instrument is the parity tests. An offline post-ship parity probe on the precomputed frames would be the guardrail form |
| `SURF_FACE_RANGE` | No: no physical breaker truth exists (its gate is NOT RUNNABLE) |
| `MANIFEST_PRUNE_TOMBSTONES` | Not a forecast number: manifest membership. The dangling-entry count is the sanity signal |
| `WEATHER_ACCOUNT_RATE_LIMIT` | Not a forecast number: load control. Not applicable |

Also found: `FRAME_WIND_GFS_HOURLY` (default ON, "guardrail BLIND" in its registry text) is not in `GUARDED` at all, so
the guardrail cannot even turn it off through the manifest; its kill is the repo variable. Recorded, not changed.
No COVERAGE entry was added in this PR (the file is in flight elsewhere); the three proposals above are the follow-up.
The admin now shows each guarded flag's class and the "ON now and BLIND" list (`/verification` → coverage).

## P1-6: Verification and skill panel (read-only)

`GET /admin/surf-forecast/verification` + `VerificationPanel.js`, from the same snapshot: skill-ledger pending queue
(entries / cap / headroom before eviction / rows beyond 48 h, the ones evicted first), served-wave verify (the LOCKED
holdout state in words, `NOT_READ` until #1199's list is frozen; sampler, truth and score object COUNTS only, never a
station id), gust-verify object counts, last runs of the tide gates, scorers, collectors and guardrail (conclusion,
time, link), guardrail coverage, memory_audit's overdue read-backs, the newest SCOREBOARD rows, and an `alerts` list
reserved for the research lead's drift rules (told; empty today and said so). The serve box reads one small object,
cached a minute; it never lists a bucket or downloads the 8 MB queue.

Local dry run of the repo half (no credentials, `--no-runs` off): 289 SCOREBOARD rows, memory_audit 0 FAIL / 390
WARN / 77 overdue / 18 open, holdout NOT_READ, `PENDING_MAX_ENTRIES` 68000 read from source. The bucket half has not
run anywhere yet: it first runs after merge, from the schedule or a dispatch.

## Design review (SubQ, Reflection, LongCat; the same public design text, no code values or secrets)

All three ranked the same two items first, and both are fixed in this PR:
1. **A credential under a benign name** would have passed the first value filter (`[A-Za-z0-9._:+-]{0,40}` admits
   `sk_live_...`, hex tokens, host names). Now default-deny: only 0/1, numbers and boolean words are ever shown, on
   the server, in the snapshot builder and for workflow literals (`switch_scan.safe_value`; test with four such values).
2. **A stale snapshot shown as current**: past 18 h the lanes read "not known here" (test), and the board says why.
Also from the review: a `vars.X` job gate is labelled as gating the job (a variable's value does not prove the job ran;
the Verification panel's run table is where that shows). Accepted limits, written here rather than fixed: switches set
by `echo X=1 >> $GITHUB_ENV` inside a `run:` step, computed names (`os.environ[f"..."]`), config objects and
client-only `window.__RAW_*` kill switches are not scanned; the parity test's broad pattern catches new helpers whose
name says env/flag/switch, not every conceivable read. The ~1 s scan runs once per process in a worker thread, only on
an admin request; the serve box never lists a bucket.

## Visual check (temporary local harness on fixture payloads produced by the real endpoint code; harness not committed)
Dark desktop, light phone (375 px) and beach phone: no horizontal scroll, filters are a keyboard radio group (Tab in,
arrows move, visible ring, live count), `GFS_WORLD_FULL_HORIZON` reads On from its repo variable,
`MARINE_EXT_CEILING_MARGIN_H` reads Setting 12. Shots in the shared notes folder `admin-truth-switches-2026-11-23/`.

## Post-merge read-back owed (commitment in this PR's ledger fragment)
One `admin-ops-snapshot.yml` run (schedule or dispatch) is green and its log line shows a non-null skill-pending
count; then one admin read of `/admin/surf-forecast/switches` shows `GFS_WORLD_FULL_HORIZON` with a lane value from
the repo variable (not "set in CI"). No load test; one read, `/api/health` before and after.

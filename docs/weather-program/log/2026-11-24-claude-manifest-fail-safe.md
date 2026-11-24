# 2026-11-24 · reliability lane, PR 1: the flags manifest fails safe (D-090)

Lane: reliability (owner approved "Separate reliability lane (Recommended)"; brief from the director session).
Evidence: inspection findings 6 and 7 (SOTA-INSPECTION-TIME-AND-FAILURE-2026-11-23, both panels raised 7 to P0).

## Measured before the change (offline: a fake `requests`, no network, the real `_fetch_bucket`)

`SURF_NEARSHORE_MOP` killed in the manifest (`state: off`), then:

| case | before | after |
|---|---|---|
| warm, 200 | `0` manifest | `0` manifest |
| warm, then HTTP 400 | `1` default, error None (silent) | `0` manifest, error `HTTP 400` |
| warm, then HTTP 404 | `1` default, error None (silent) | `0` manifest, error `HTTP 404` |
| warm, then HTTP 500 | `0` manifest (last good) | `0` manifest |
| cold, HTTP 400/404/500 | `1` default | `0` snapshot when the committed snapshot holds the kill; the code default when it holds none |

The guardrail writer had the same 400/404 read (`flag_guardrail.read_manifest`): an enforce run during an auth or
bucket failure (Supabase answers 400 for those too) would have rewritten `control/flags.json` without every kill.

## What changed

- `runtime_flags._fetch_bucket`: any non-200 raises `ManifestUnreadable` (unknown): the last good read holds.
- Cold start (no good read in this process): the 'off' entries of the committed `services/runtime_flags_snapshot.json`
  hold as a floor until the first good read, which replaces the floor entirely (an owner re-enable wins).
- `flag_guardrail.read_manifest`: any non-200 raises (red run); `--allow-missing-manifest` bootstraps, by hand only.
- `flag_guardrail.snapshot_drift`: live kills vs committed kills; drift opens the guardrail issue with the exact file.
- `test_runtime_flags.py` old line-60 test (unreadable -> code default on a cold process) changed deliberately, D-090.

## Design (SubQ subq-savant-1.4 + Reflection Beam-1.0, 2026-11-24; LongCat not used)

Both: a fresh 200 is authoritative; a committed kills snapshot is the cross-process floor; reject a bucket mirror (same
outage domain) and an env var (the guardrail cannot write it without a new secret). They differed on the extra layer:
SubQ a local file cache, Reflection a raw-GitHub fetch of the committed file. Neither is here (pick where they agree).
The snapshot cannot be refreshed automatically without a PAT (a new secret), so drift is reported, not committed.

## State at merge

The live manifest (guardrail run 45307619337, dry-run mode) holds 0 kills and 2 owner 'on' entries, so the committed
snapshot holds no kills and no served value moves. No SCOREBOARD row: no served number changes.

## Correction (2026-11-24 ~19:00Z)

"guardrail run 45307619337, dry-run mode" above is WRONG. That run's report reads `mode: enforce` (the repo variable
`FLAG_GUARDRAIL_ENFORCE` is `1`, set 2026-11-05T01:01Z); I misread the printed `enforce False` (mode, then
`changed=False`) as "dry-run". The guardrail ENFORCES: a WORSE verdict writes a real kill to `control/flags.json`. The
manifest facts stand (0 kills, 2 owner 'on' entries at that run), so the committed snapshot holding no kills was still
correct. Do not rely on the guardrail being dry.

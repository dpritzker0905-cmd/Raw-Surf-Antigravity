# 2026-11-04: manifest egress, the publisher read back its own writes (claude, branch claude/manifest-egress)

Trigger: Supabase cached-egress warning. Codex's estimate (Content-Length, not billed) for 2026-11-03T20:03Z..11-04T20:03Z:
weather manifests 34.03 GB uncached + 2.09 GB cached over 1,637 GETs, about 21 MB each.

## Evidence (Supabase edge_logs, project prod, same window, read-only)

| Source (cf asOrganization) | GETs of `manifests/manifest-g*` | GB (Content-Length) | Cache |
|---|---|---|---|
| GitHub Actions runners (Microsoft Limited + Microsoft Corporation) | 1,564 (1,503 MISS + 61 HIT) | 35.2 | ~96% MISS |
| Render (the serve box: pointer reader at boot/restore) | 50 | 1.1 | 29 HIT |
| Amazon Ireland (unattributed, not our code path) | 23 | 0.4 | |
| `snapshots/core/*/_manifest.json` | 3 | 0.06 | |

- 1,462 DISTINCT keys for the runner GETs: almost one GET per generation. Per hour, runner GETs equal runner POSTs of new
  generations (e.g. 05Z 222 GET / 217 POST; 13Z 177 / 174).
- Key by key (12Z..16Z sample of 60 generations): each `manifest-g<N>-<uuid>.json` shows `POST@ip` then `GET@same ip`.
  The one-step publisher (`manifest_publish_step._attempt_once`) GETs the head every publish, and on a single-writer run the
  head is the object THIS process uploaded one publish earlier. It downloads its own 22 MB write back.
- Proof of duplicate, per key over the window: of 1,637 versioned GETs, 1,393 (85%) came from the SAME IP that POSTed that
  key (1,393 x ~22 MB ~ 31 GB); 237 from another IP (Render, other runners: expected reads of a new generation, untouched);
  7 of keys POSTed before the window. 0 keys POSTed twice (create-only holds in practice; the code sends x-upsert false and
  never remembers an unacknowledged upload). Same IP = same runner job; same PROCESS is inferred from the 1:1 POST->GET
  rhythm, not logged.
- Pointer: every versioned GET is preceded by a pointer GET (1,561 vs 1,564 runner-side); 1,532 pointer PATCHes = 1,532
  publications/day. Cadence: not 3 h. The manifest and pointer advance on EVERY coalesced product save (bursts of 100-220/h
  during ingest/validator runs, ~0 between), each a new ~22 MB generation.
- Render: 50 versioned GETs (1.1 GB), some repeats of one key (Codex: g169264 GET 7x from one Render IP). Separate, not fixed here.
- Limits: Content-Length estimates, not billed bytes; cf cache HIT/MISS as logged; no workflow/run id in the logs (attribution
  is by ASN + IP + timing); x-upsert is not in the edge logs (write policy is from code).
- No conditional GET anywhere (no If-None-Match in the logs); the root `manifest.json` is not GET at all in the window.
- PR CI (`ci.yml`) carries no Supabase secret: not a source.

## Fix (ON, kill switch `MANIFEST_SELF_READ_CACHE=0`)

New-data detection is unchanged: the pointer row is still read fresh before every publish; a changed pointer names another
key, which is a miss and is GET immediately. No TTL exists or is extended. Same-key overwrite: only unique uuid keys from an
acknowledged create-only upload (or a 200 GET of that key) are held. A miss, a kill switch, or a failed GET falls through to
today's GET; failures are never held.

`manifest_pointer.remember_manifest_object` holds ONE (key, bytes) pair: set by `store._upload_to_supabase` after an
ACKNOWLEDGED create-only (`overwrite=False`) upload of a `manifests/manifest-g<12 digits>-<uuid4 hex>.json` key, and by a
200 from `fetch_manifest_object`. `fetch_manifest_object(key)` answers from it only on exact key equality. Unique keys are
immutable, so the bytes are the object: freshness (another writer's head has another key, so it GETs), run identity and the
CAS are untouched. Legacy upserted `manifest-g<gen>.json` keys are never held. Memory: one manifest (the publisher already
holds `pending.merged`). No served number moves; no scoreboard row.

Expected: up to the 1,393 self-read GETs/day (~31 GB declared) go, less one cold GET per runner process; ~25-31 GB/day.
Measure after merge: the same edge_logs query, runner GETs vs POSTs per hour (expect GETs << POSTs).

Tests: `backend/tests/test_manifest_self_read_cache.py` (6), guards floor re-derived (3454 -> 3460).

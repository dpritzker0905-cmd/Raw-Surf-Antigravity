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

## Reconciliation with Codex (181 repeated-key GETs, ~4 GB)

Both counts are right. Codex counts a GET as a repeat only when the key was already GET before; a runner's GET of the key it
POSTed seconds earlier is a FIRST read in that count. It is still a duplicate transfer, because the runner already holds
those exact bytes (it sent them, create-only, acknowledged). So: ~4 GB repeated reads (mostly Render and cross-runner) +
~31 GB own-write read-backs (this PR) are disjoint.

## Why a publication every 6-8 s during runs (analysis only, no build)

- Mechanism: every `save_product` calls `submit_manifest_publish`; the slot coalesces, ONE drain job publishes the newest
  snapshot and loops while a newer one is pending. One publish = pointer GET + head GET (22 MB) + unique POST (22 MB) +
  PATCH + legacy `manifest.json` POST (22 MB). Trace 11-04 13:14Z, one runner: a full cycle every 5-11 s. The cadence is the
  publish's own duration, not product arrival: each commit carries the products saved during the previous cycle (a).
- No-op evidence (b): 648 of 1,532 generations (42%) have the SAME byte length as the generation before (627 by the same
  writer); in the 13:14Z trace g169824..g169831 are all 22,612,415 bytes. Same length is NOT proof of no change (a run-keyed
  filename replacing an older one keeps the width; `last_manifest_update` always changes), so 42% is an upper bound on
  no-op product sets. The publisher has no "merged == head" check; proving it needs a products-only hash at publish time.
- Contention (c): 69 of 1,532 pointer PATCHes (4.5%) answered `content-range */*` (0 rows: CAS lost), vs 1,463 `0-0/*`.
  Up to 4 writer IPs per hour. Each loss wastes one 22 MB POST plus one re-GET.
- Immutable contract (code): `_attempt_once` names `manifests/manifest-g<g+1:012d>-<uuid4().hex>.json`, uploads strict
  `overwrite=False` (x-upsert false), and CASes with `expected_key=head`; logs show 0 keys POSTed twice.

## Options that keep every new product visible at once

1. Skip a no-op: if the merged products (ignoring `last_manifest_update`) hash equal to the head's, skip POST/PATCH/legacy
   POST. Saves up to 42% of publishes; zero freshness cost.
2. Drop the per-publish legacy `manifest.json` POST in the loop; refresh it once at drain end / exit. Readers are
   pointer-first; ~22 MB of upload per publish; the fallback lags by one drain.
3. Coalesce within a step: drain at the end of a batch helper / fetcher step instead of per save. New products visible at
   step end (seconds to a minute), not 3 h.
4. Lane serialization (one writer per concurrency group) removes the 4.5% CAS losses.

## Built in #724 (options 1 and 2; module `manifest_publish_economy.py`)

- No-op skip (`MANIFEST_SKIP_NOOP_PUBLISH=0` kills): sha256 of the canonical manifest without `last_manifest_update` /
  `written_by`, order-sensitive. When the merge against the REAL head (never the legacy fallback) equals the head, nothing is
  uploaded, swapped or PUT; the head already serves those products; counter `noop_skips`, logged per skip. `last_manifest_update`
  readers (products_response, series_page_memo) key memos on it: unchanged stamp + unchanged products = still valid.
- Legacy refresh at drain end (`MANIFEST_LEGACY_REFRESH_DEFERRED=0` kills). Reader audit: every reader is pointer-first
  (store_helpers get_manifest restore, store._fetch_remote_manifest_products, the publisher); manifest.json is read only when the
  pointer read fails, the pointed head is MISSING/unusable (`_legacy_products`), or MANIFEST_POINTER=0. No reader depends on its
  freshness in the normal path, but those fallbacks do, so the held bytes are also PUT whenever older than 60 s
  (`LEGACY_MAX_LAG_SECONDS`): the fallback lags the pointer by at most 60 s (was ~7 s) during a burst, 0 at drain end.
- Expected extra saving: up to 42% fewer publishes (each a 22 MB GET + 22 MB POST + 22 MB legacy POST; egress part ~0.9 GB/day
  of head GETs not already covered by the self-read copy, more if other writers' heads are no-ops); legacy POSTs drop from
  ~1,532/day to about one per minute of burst (upload/ingress, not egress). Storage writes and CPU fall accordingly.
- Tests: `test_manifest_publish_economy.py` (7); the chain harness runs its older pins with both switches OFF. Guards floor 3454 -> 3467.

# 2026-11-24 · reliability lane, PR 4: a storage 401/403 fails loud and opens an issue

Evidence: inspection 2026-11-23 finding 3. On 11-19/20 Supabase answered 401 "Legacy API keys are disabled". Ingest
44634365112, precompute 44631582271 and guardrail 44507284595 went red (read from their logs: the guardrail's
`401 Client Error: Unauthorized for url: .../control/flags.json`). A red scheduled run notifies nobody, and every lane
stayed down for 21-25 h.

## Measured (this project, 2026-11-24, deliberately invalid keys, one GET each)

`GET /storage/v1/bucket/weather-products`:
- an unknown `sb_secret_` key -> HTTP **400** "headers must have required property 'authorization'";
- a bad JWT -> HTTP **400** "signature verification failed".

So "401/403" alone would have missed both. The classifier also takes a 400 whose body names an auth cause.

## What changed

`scripts/storage_auth_check.py` runs right after Python setup in forecast-ingest, the pilots, precompute and the flag
guardrail. It is stdlib only and runs before `pip install`.
- **Rejected:** `::error`, then ONE `storage-auth` + `severity:critical` issue assigned to `REPO_OWNER_LOGIN`
  (commented on if one is already open). Exit 2, so the lane stops in seconds.
- **Accepted:** any open storage-auth issue is closed with a recovery comment.
- **A blip** (network, 5xx, bucket not found): a warning only.
- The key never reaches the log or the issue; the issue names the secret by NAME.
- Jobs get `issues: write` (GITHUB_TOKEN; no new secret). Kill switch: repo variable `STORAGE_AUTH_CHECK=0`.

## Not verified

A VALID key against the bucket endpoint was not tried here (no service key on this machine). The first lane run after
merge prints "storage credential accepted" or an inconclusive warning; read it.

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

## Advisor limits folded in (2026-11-24, before merge)

- **Allow-list, not keywords.** A rejection is a 401/403, an inner statusCode 401/403, or one of "Legacy API keys are
  disabled", "signature verification failed", "Invalid API key", "Invalid Compact JWS", "Unauthorized". The 400
  "headers must have required property 'authorization'" is a request-shape answer, graded UNKNOWN: it warns only.
- **Confirmed twice.** A rejection must repeat about 10 s later.
- **Modes.** `STORAGE_AUTH_CHECK`: `warn` is the workflow default at merge (issue, exit 0); `block`/`1` exits 2; `0` is
  off. Moving the default to `block` is a variable change for the owner's word, via the director. Not done here.
- **Same read as production.** The probe reads `control/flags.json` with `supabase_headers`, the same request
  `runtime_flags` and the guardrail make, so a valid key's 200 is the known case.
- **Verification after merge.** The first lane run inside `supabase-service` logs "storage credential accepted (HTTP
  200, control/flags.json)". Read it.
- **Scrubbing.** The key value and any `sb_secret_` / `sb_publishable_` / `eyJ` token are scrubbed from Supabase's
  message before it is printed or posted.

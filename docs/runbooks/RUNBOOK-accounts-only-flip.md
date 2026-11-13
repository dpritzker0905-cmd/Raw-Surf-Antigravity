# Runbook: the accounts-only flip (forecast data for accounts only)

Owner rule, 2026-11-12: "we do not want non-account holders to access the data. Free account holders should still have
to go through signed URLs." **Nothing here is done yet. Every step is David's call.** Written 2026-11-12. Reviewed by
Reflection and LongCat; their notes are in the PR.

## What changes for whom

- **Signed out:** forecast reads get 401. Spot pages still load (the spot, photos, reports), with no forecast. No
  page redirects to sign-in.
- **Free account:** GFS for 3 days, from signed URLs only. Paid tiers get their own window, also from signed URLs.
- **Scheduled jobs:** read as premium with `X-Raw-Service-Key`.

## Before you start (all of these are required)

1. **On `dev` and deployed:** #782, #783 and #815 (merged), plus #828 (job key), #837 (hub, conditions and tides) and
   #842 (spot ratings). Netlify serves the client halves. Each one does nothing until a switch below is turned on.
2. **One secret.** Generate a value of at least 32 characters, for example with
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Store it as `WEATHER_SERVICE_KEY` in Render env
   AND as a GitHub Actions secret of the same name. Never put it in a file.
3. **Tier copies exist.** A precompute cycle has written `weather-products/spot_ratings/tier/free.json` and
   `basic.json`.
4. **Baseline.** Record `/api/health` and Render CPU. Don't load-test the live box.

## The order, and why it isn't "migration → purge → switches"

The purge refuses to run until **every** frame set has a private index. Only the publisher writes private indexes, and
only with `FRAME_ENTITLEMENT=1`. If the publisher went first, with the signer off, every client would fall back to
`/grid` on the 1-CPU box. So the switches come before the publisher, and the purge comes last:

| # | Step | Command / place | Reverse |
|---|---|---|---|
| 1 | **Frames migration**: the private bucket, with no user policy (the SQL raises if one exists). Prod, then dev. | `backend/migrations/2026-11-11_weather_frames_private_bucket.sql` | Bucket unused while the flags are off |
| 2 | **Switches**, at a **low-traffic hour**: `WEATHER_TIER_CLAMP` on and `FRAME_ENTITLEMENT` (signer) on, **together**. The rate limit is already `1`. | runtime manifest `weather-products/control/flags.json`, `state: "on"`; live within 300 s | `state: "off"` (≤ 300 s) |
| 3 | **Publisher, right after step 2**: merge `FRAME_ENTITLEMENT: '1'` into `forecast-ingest-pilots.yml` env, then **dispatch the workflow** instead of waiting for the cron | each run rebuilds sets privately; until a set is rebuilt, its hours may read `/grid` (the CPU window to keep short) | env `'0'` |
| 4 | **Purge** the pre-flip public frames, once, after the gate passes | `python scripts/purge_public_frame_bins.py` (dry run; the gate must list no set; **save its output as the record of what is deleted**), then `--apply` | **Not reversible.** With the publisher at `'0'`, the next public run republishes |
| 5 | **Drop the anon spot-ratings read** | `supabase_scripts/storage_rls_spot_ratings_drop_anon.sql` (prod, dev) | re-run `storage_rls_spot_ratings_scoped_read.sql` |

## What to watch (first hour, then after each ingest cycle)

- **Box load:** `/api/health` and Render CPU, against the baseline, plus p95 latency and 5xx/timeouts on `/grid_series`
  and `/grid`. A rise means clients are falling back to `/grid` (unsigned hours). Signer telemetry is
  `window.__RAW_FRAME_SIGNER__` (`applied` against `skipped`, and its skip reasons).
- **Refusals:**
  - 401s with `X-Raw-Tier-Clamp: account`: expected for signed-out callers. From signed-in users, it means the token
    is not being sent.
  - 429s with `X-Raw-Tier-Clamp: rate_limited`: should be near zero. The measured heavy session peaked at 52 reads/min
    against a 600 burst.
- **Jobs green:**
  - calibration census step 4;
  - nearshore validation;
  - sim-parity monitor;
  - data-health run-age census;
  - accuracy monitor.

  A 401 in any of them means the secret is missing on one side.
- **Spot ratings:** `window.__SPOT_RATINGS_DIAG__.source` in a signed-in browser should stay `precomputed_cdn`. A
  switch to `live` or the endpoint means the signed lane failed.
- **Product:** sign-ups, and the share of map sessions that are signed in.

## Rollback

- **Fastest (≤ 300 s):** set `WEATHER_TIER_CLAMP` and `FRAME_ENTITLEMENT` to `state: "off"` in the runtime manifest.
  The client follows the server's header and stops sending tokens. Signed-out users get data again. The rollback is
  **done** only when a signed-out `curl -sI` of any `/api/weather/` route no longer shows `X-Raw-Tier-Clamp-On`. Until
  then, processes are still on the old manifest.
- **Emergency override:** set Render env `WEATHER_TIER_CLAMP=0` (env beats manifest, but needs a restart).
- **Publisher:** `FRAME_ENTITLEMENT: '0'` in `forecast-ingest-pilots.yml`, and new runs publish publicly again. Until
  the next run, hours whose public frames were purged read `/grid`.
- **Spot ratings:** re-run the scoped anon-read SQL. The client uses the anon lane whenever the clamp is off.
- **A leaked job key:** rotate it in Render and GitHub together. Until then it reads what a premium account reads,
  with no writes.

## Not covered by this flip

- A sign-in prompt in the empty forecast area of the spot pages (a UI follow-up).
- The live route-coverage test in #837 fails if a new public forecast route appears outside the clamp.

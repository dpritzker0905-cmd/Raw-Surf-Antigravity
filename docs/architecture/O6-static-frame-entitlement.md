# O6: entitlement for the static weather frames

Status: built, **held OFF** (`GUARDED["FRAME_ENTITLEMENT"] = "0"`). Merges after #782 (the API tier clamp), which it builds on.

**Accounts only (owner, 2026-11-12):** "we do not want non-account holders to access the data. Free account holders should still have to go through signed URLs, which will encourage people to create free accounts." So **no forecast frame stays in the public bucket**. Free accounts get the free class (GFS, 3 days) by signed URL, and a signed-out caller gets nothing. This supersedes the 2026-11-11 design, which kept guest-window GFS public.

## The gap
#782 clamps every forecast **API** read to the caller's JWT tier, and with accounts only refuses a caller who has no account. The static frames bypass the API by design: the publisher writes them to the **public** Supabase bucket `weather-frames`, and each run index lists every frame's path, so whoever holds an index can fetch all of it from the CDN.

Measured on the live `v1/latest.json`, 2026-11-11 ~07:10 EST (one CDN read of each index, nothing on the backend):

| | value |
|---|---|
| sets published | 152 (world `global_mid` per-frame sets, regional byte-range bundles, filled variants) |
| frames listed | 12,732 |
| frames beyond 72 h (outside free) | 8,332 (65%) |
| EURO / ICON frames (paid at every hour: free = GFS only) | 16 sets (10 EURO, 6 ICON), 1,874 frames |
| index size | median 53 KB, up to 270 KB |
| layouts | world sets: one `.bin` per frame; regional: one bundle per set, entries carry `offset`/`length` |

Tier rules (`forecast_tier_window`, the pinned echo of `LayerAccessResolver.js`):
- **Signed out:** nothing (accounts only; #782 answers 401).
- **Free:** GFS, 3 days.
- **Basic:** GFS, EURO and ICON, 7 days.
- **Premium:** all three models, 14 days (locked).

## Options weighed

| option | how it gates | requests per map load (entitled) | box CPU | CDN hit rate | verdict |
|---|---|---|---|---|---|
| A. per-request signed URLs | backend signs each frame when asked | +1 per frame | 1 sign per frame GET | ~0: each token is its own CDN key (Supabase Smart CDN docs) | rejected: defeats the reason frames exist |
| B. CDN / edge check | Netlify edge function verifies the JWT and proxies each frame | same count, every one through the edge | none on the box, but an edge invocation and JWT verify per frame (~130 per scrub) | cache must vary by tier, so frames are effectively uncached | rejected: the cost scales with frame GETs, and adds a second copy of the identity logic at the edge |
| C. obscurity (unlisted paths) | none: `sha12` paths are in the public index | 0 | 0 | unchanged | rejected: not entitlement |
| **D. class split + shared signed URLs (chosen)** | every frame in a private bucket; one signed URL per frame per signing window, shared by all users of the class | +1 per pinned index (one `/frame-urls` call per set per run per session) | 37 µs per request (cached), batch signing ≤ 152 sets × 3 classes per 6 h | one cold miss per frame per edge per 6 h signing window | **chosen** |

## The design (D)
**Classes** are fixed per frame at publish, from the model and the forecast lead `valid - run`. No new ladder: the days and models come from `forecast_tier_window`. Every class lives in the private bucket.

| class | rule | readable by |
|---|---|---|
| free | free models (GFS), lead ≤ 3 d + 24 h | free, basic, premium |
| basic | basic models, lead ≤ 7 d + 24 h | basic, premium |
| premium | the rest, to the locked 14 days | premium |

**Why the +24 h margin (`RUN_MARGIN_H`).** The class is fixed at publish (frames are content-addressed and carried over across runs), but the tier window rolls from *now*. A served run is up to about a day old, so the margin keeps the free class covering now + 72 h without ever copying objects.
- **Cost:** a free account can read up to 24 h past 72 h of GFS by signed URL. The API clamp and the UI still gate it.
- **If a run goes stale beyond the margin,** the last free hours fall back to `/grid`, which #782 serves at the caller's tier.

**The publisher is untouched.** `frame_entitlement.EntitledSink` wraps its sink, in `publish_frame_images.py` (the wind-lane rebuild included) and, for the raster sets (pressure, temperature, cloud cover), `publish_raster_frames.py`:
- **The public bucket is an allowlist.** It receives only the path-free index copies and `PUBLIC_POINTERS` (`v1/latest.json`, `v1/wind_lane.json`).
- **Everything else is private,** in the bucket `weather-frames-private`: per-frame `.bin`, bundles, the PNG proof and its `manifest.json`, and anything of an unknown shape (fail closed).
- **Index:** written twice.
  - The **full** copy goes to the private bucket, for the signer and the next run's carry-over.
  - The **public** copy keeps every entry's `valid_time` and decode metadata, drops `path` (bundle sets: `offset`, `length`, `sha12`) and adds `entitlement: "<class>"`. It names no bundle.
- **Regional bundle:** buffered, then re-cut into one bundle per class at its index write, all private. The mixed bundle is never written.
- **Retention:** `list` is the union of both buckets, `delete` deletes from both, and the re-cut bundles of the current and previous run are protected.
- **Index reads use the private copy only.** A miss is a miss, never the public copy: before the flip, the public copy names frames in the public bucket, and carrying them over would keep their bytes public. So the first entitled run rebuilds every set privately.

**The public bucket afterwards** holds `latest.json`, the path-free index copies and the HRRR wind-lane pointer: metadata, no forecast values. The PNG proof (`frameImageProof.js`, a diagnostic) is private too, so it reads as unavailable.

**Today's client already degrades safely.** An entry with no `path` (or `offset: null` in a bundle) is "unbuilt", and the client asks `/grid` for that hour, which #782 clamps (or refuses signed out).

**The signer** is `GET /api/weather/frame-urls?index=<path>`, held OFF and private:
- **No verified account:** 401 `sign_in_required`, with `X-Raw-Tier-Clamp: account`, the same marker as the weather reads, so the client's expired-session prompt keys on it.
- **Any account:** the JWT tier (#782's `resolve_tier`; a verified account is at least free) gives the allowed classes.
- **Index reads:** the full index is read once per path (immutable; LRU of 512).
- **Signing:** each (index, class) is signed **once per 6 h** by **one** Supabase batch call (`createSignedUrls`). Tokens are valid 36 h, so every URL handed out has ≥ 30 h left.
- **Sharing:** the same URLs go to every user of the class, which keeps the CDN warm.
- **Path check:** the index path is validated against a strict pattern, so the signer can never read anything but a frame index.

**Leak bounds.**
- **A signed URL that escapes** works for ≤ 36 h. Its CDN-cached response outlives the token until retention deletes the object (about two runs, ~12 h), so it can only reveal a forecast already being replaced.
- **The private bucket** is governed by `backend/migrations/2026-11-11_weather_frames_private_bucket.sql` (*not applied*): private, no `storage.objects` policy at all, and a guard that fails if one appears. Only the service role (publisher, signer) touches it.

## Costs, per map load
- **Signed out:** nothing to fetch. `/map` is behind `ProtectedRoute` anyway.
- **Any account:** the same `latest.json` (≤ every 2 min) and one index per active set, plus **one** `/frame-urls` call per pinned index. Frame GET count is unchanged.
  - **Calls:** typically 1–3 per load, cached for the run.
  - **Size:** ~17 KB of JSON uncompressed for a premium 129-frame world set (gzip in front).
  - **Box CPU:** 37 µs per call, measured on the cached path.
  - **New since 2026-11-12:** free accounts now make these calls too.
- **Publisher (runner, not the box):** +0.23 ms per set per run to split an index; bundles re-cut in memory (0.03–2.5 MB each). Each frame is stored once; indexes are stored twice (53–270 KB each).
- **Signing:** ≤ 152 sets × 3 classes per 6 h per process, one HTTPS call each, independent of user count.

## Rollout (each step reversible; none taken by this PR)
1. **Merge #782, then this PR.** Flags OFF: nothing changes.
2. **Client half: built in this PR** (`frontend/src/components/map/staticFrameSigner.js`, kill switch `window.__RAW_DISABLE_FRAME_SIGNER__`).
   - **When it calls:** `staticFrames.loadIndex` loads an index with unsigned `entitlement` entries and **any** user is signed in. It calls `/frame-urls` once, **before the index resolves**, so every consumer sees one consistent index.
   - **What each entry gets:** per-frame entries get `path` (the private object, the cache key) and `url`. Bundle entries get a slice record on the signed class bundle, still sha12-checked.
   - **Fetch sites:** `frame.url || base + frame.path` (`staticFrames.sharedParsedLoad`) and `bundle.url || base + path` (`staticRegional.bundleFor`).
   - **No token:** no call, and nothing is served.
   - **Failures:** any error, timeout (4 s) or 404 leaves the hours unbuilt, so they go to `/grid`. A 404 (server held off) backs off 10 minutes.
   - **401 with the account marker:** the session expired, and the client raises the sign-in-again prompt (`lib/weatherSession.js`, #782).
   - **Token life:** signed tokens (≥ 30 h left) outlive the objects (~12 h retention), so no client re-sign is needed.
3. **Apply the migration.** It creates the private bucket, with no user policy.
4. **Turn on #782's `WEATHER_TIER_CLAMP` and this signer together.** Set runtime manifest `WEATHER_TIER_CLAMP` on and `FRAME_ENTITLEMENT` on.
5. **Turn on the publisher.** Set `FRAME_ENTITLEMENT=1` in `forecast-ingest-pilots.yml` env. The next runs rebuild every set privately; until a set is rebuilt, its hours read `/grid`.
6. **Purge the pre-flip public frames, once:**
   ```bash
   python scripts/purge_public_frame_bins.py
   ```
   ```bash
   python scripts/purge_public_frame_bins.py --apply
   ```
   Run the first command (a dry run) before `--apply`. Old frames are never retention-deleted, because the first entitled run cannot read their public index. The script removes every public object that is neither a pointer nor an index (frames, the PNG proof and its manifest), and refuses until every set in `latest.json` has its full index in the private bucket.
7. **Undo:** publisher env `0` (new runs public again), then manifest `off`.

## Not covered
- **Public metadata:** `latest.json`, the path-free indexes and the HRRR wind-lane pointer stay public. They carry no forecast values.
- **Spot ratings by anon key:** `spot_ratings/latest.json` in `weather-products` is readable with the anon key, by the scoped RLS policy `anon_read_spot_ratings_latest_only` (`spotRatingsCdn.js`). These are per-spot scores, readable without an account. That is the owner's call, outside the frames bucket. **Closed at the flip (flip blocker 3, 2026-11-12):** with the clamp on, the map reads its tier's copy (`spot_ratings/tier/<tier>.json`, latest.json for premium) through `GET /api/weather/spot-ratings-url` (`services/spot_ratings_entitlement.py`), and `supabase_scripts/storage_rls_spot_ratings_drop_anon.sql` (an owner action, at the flip) drops the anon policy.
- **The spot hub:** `/tides/{spot_id}` and `/explore/*` are outside `/api/weather/` (#782).

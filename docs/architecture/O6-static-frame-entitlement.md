# O6: entitlement for the static weather frames

Status: built, **held OFF** (`GUARDED["FRAME_ENTITLEMENT"] = "0"`). Merges after #782 (the API tier clamp), which it builds on.

## The gap
#782 clamps every forecast **API** read to the caller's JWT tier. The static frames bypass the API by design: the
publisher writes them to the **public** Supabase bucket `weather-frames`, and each run index lists every frame's path,
so whoever holds an index can fetch all of it from the CDN.

Measured on the live `v1/latest.json`, 2026-11-11 ~07:10 EST (one CDN read of each index, nothing on the backend):

| | value |
|---|---|
| sets published | 152 (world `global_mid` per-frame sets, regional byte-range bundles, filled variants) |
| frames listed | 12,732 |
| frames beyond 72 h (outside guest/free) | **8,332 (65%)** |
| EURO / ICON frames (paid at **every** hour: guest/free = GFS only) | 16 sets (10 EURO, 6 ICON), 1,874 frames |
| index size | median 53 KB, up to 270 KB |
| layouts | world sets: one `.bin` per frame; regional: one bundle per set, entries carry `offset`/`length` |

Tier rules (`forecast_tier_window`, the pinned echo of `LayerAccessResolver.js`):
- guest and free: GFS, 3 days;
- basic: GFS, EURO and ICON, 7 days;
- premium: all three models, 14 days (locked).

## Options weighed

| option | how it gates | requests per map load (entitled) | box CPU | CDN hit rate | verdict |
|---|---|---|---|---|---|
| **A. per-request signed URLs** | backend signs each frame when asked | +1 per frame | 1 sign per frame GET | **~0**: each token is its own CDN key (Supabase Smart CDN docs) | rejected: defeats the reason frames exist |
| **B. CDN / edge check** | Netlify edge function verifies the JWT and proxies each frame | same count, every one through the edge | none on the box, but an edge invocation and JWT verify per frame (~130 per scrub) | cache must vary by tier, so paid frames are effectively uncached | rejected: the cost scales with frame GETs, and adds a second copy of the identity logic at the edge |
| **C. obscurity** (unlisted paths) | none: `sha12` paths are in the public index | 0 | 0 | unchanged | rejected: not entitlement |
| **D. class split + shared signed URLs (chosen)** | guest-window GFS stays public; paid frames go to a private bucket; one signed URL per frame per signing window, **shared by all entitled users** | **+1 per pinned index** (one `/frame-urls` call per set per run per session) | **37 µs per request** (cached), batch signing ≤ 152 sets × 2 classes per 6 h | public: unchanged; paid: one cold miss per frame per edge per 6 h signing window (public: one per run, also ~6 h) | **chosen** |

## The design (D)
**Classes** are fixed per frame at publish, from the model and the forecast lead `valid - run`. No new ladder: the days and models come from `forecast_tier_window`.

| class | rule | bucket |
|---|---|---|
| public | guest models (GFS), lead ≤ 3 d + 24 h | `weather-frames` (public, as today) |
| basic | basic models, lead ≤ 7 d + 24 h | `weather-frames-paid` (private) |
| premium | the rest, to the locked 14 days | `weather-frames-paid` |

**Why the +24 h margin (`RUN_MARGIN_H`).** The class is fixed at publish (frames are content-addressed and carried over across runs), but the tier window rolls from *now*. A served run is up to about a day old, so the margin keeps the public set covering now + 72 h without ever copying objects between buckets.
- **Cost:** a guest can read up to 24 h past 72 h of GFS straight from the CDN. The API clamp and the UI still gate it.
- **If a run goes stale beyond the margin,** guests' last hours fall back to `/grid`, which #782 serves at their tier.

**The publisher is untouched.** `frame_entitlement.EntitledSink` wraps its sink:
- **Per-frame `.bin`:** routed by the class its path names (run and valid stamps).
- **Index:** written twice. The **full** copy goes to the private bucket, for the signer and the next run's carry-over. The **public** copy keeps every entry's `valid_time` but drops `path` (and `offset`) from paid entries, adding `paid: "<class>"`.
- **Regional bundle:** buffered, then re-cut into one bundle per class at its index write. Public bytes stay in the public bucket, and the mixed bundle is never written.
- **Retention:** `list` is the union of both buckets, `delete` deletes from both, and the re-cut bundles of the current and previous run are protected.

**Today's client already degrades safely.** An entry with no `path` (or `offset: null` in a bundle) is "unbuilt", and the client asks `/grid` for that hour, which #782 clamps. So the public index can hide paid frames without breaking any client.

**The signer** is `GET /api/weather/frame-urls?index=<path>`, held OFF and private:
- the JWT tier (via #782's `resolve_tier`) gives the allowed classes; guest and free get none;
- the full index is read once per path (immutable; LRU of 512);
- each (index, class) is signed **once per 6 h** by **one** Supabase batch call (`createSignedUrls`), with tokens valid 36 h, so every URL handed out has ≥ 30 h left;
- the same URLs are shared by every entitled user, which is what keeps the CDN warm;
- the index path is validated against a strict pattern, so the signer can never read anything but a frame index.

**Leak bounds.**
- **A signed URL that escapes** works for ≤ 36 h. Its CDN-cached response outlives the token until retention deletes the object (about two runs, ~12 h), so it can only reveal a forecast already being replaced.
- **A guest** reads GFS to ≤ 96 h from the CDN.
- **Everything else needs the private bucket**, whose storage policy (`backend/migrations/2026-11-11_weather_frames_paid_bucket.sql`, *not applied*) is: private, no `storage.objects` policy at all, and a guard that fails if one appears. Only the service role (publisher, signer) touches it.

## Costs, per map load
- **Guest / free:** unchanged. Same `latest.json` (≤ every 2 min), one index per active set, frame GETs on demand (≤ 4 in flight). Paid hours read `/grid`, exactly as #782 serves them.
- **Basic / premium:** the same, plus **one** `/frame-urls` call per pinned index:
  - typically 1–3 per load, cached for the run;
  - ~17 KB of JSON uncompressed for a premium 129-frame world set (gzip in front);
  - **37 µs** of box CPU each, measured on the cached path.

  Frame GET count unchanged.
- **Publisher (runner, not the box):** +0.23 ms per set per run to split an index; bundles re-cut in memory (0.03–2.5 MB each). Each frame is stored once, in one bucket; indexes are stored twice (53–270 KB each).
- **Signing:** ≤ 152 sets × 2 classes per 6 h per process, one HTTPS call each, independent of user count.

## Rollout (each step reversible; none taken by this PR)
1. **Merge #782**, then this PR (flag OFF: nothing changes).
2. **Client half (follow-up PR, not in Codex-reserved files):** after pinning an index whose entries carry `paid`, call `/frame-urls` once and give those entries `url` (and bundle slice coordinates). Fetch `frame.url || base + frame.path` in `staticFrames.js` (`fetchFrameBytes` call site, line ~387) and `staticRegional.js` (`regionalFrameBytes` / `bundleFor`).
   - **Without it, entitled users fall back to `/grid` for paid hours**: correct, but that load on the box is exactly what frames avoid. So the flip waits for it.
3. **Apply the migration** (creates the private bucket; no user policy).
4. **Turn the signer on** (runtime manifest `FRAME_ENTITLEMENT` on), then the **publisher** (`FRAME_ENTITLEMENT=1` in `forecast-ingest-pilots.yml` env). New runs publish split; old public runs age out in about two runs.
5. **Undo:** publisher env `0` (new runs public again), then manifest `off`.

## Not covered
- `latest.json`, the PNG proof and the HRRR wind-lane pointer stay public. They carry no paid hours.
- A determined guest can still scrape `/grid` within their own window. That is their entitlement.

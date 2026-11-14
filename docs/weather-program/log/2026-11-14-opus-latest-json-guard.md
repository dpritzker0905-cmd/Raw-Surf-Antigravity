# 2026-11-14 — opus: latest.json write guard

Session: the frame-carry side session. The director's priority (relayed 06:2xZ): the advisor's red-team of #888 found a
pre-existing risk in the static-frames publishers. More publishers are switching on tonight (GFS temperature since 04:57Z,
then GFS rain, then EURO rain), so the director holds the #888 variables until this lands. Branch `opus/latest-json-guard` from
dev `64c5dcc2d`.

## The risk (read from the code)

`publish_frame_images.SupabaseSink.read` returned None for EVERY HTTP 400 and 404. Both writers then started from an empty
document: `publish_frame_sets` (`json.loads(raw) if raw else {"version": 1, "sets": {}}`) and `frame_set_raster.publish` (same,
twice: the first read and the re-read before the write). So one failed read, any 400 that is not "object not found", would write
a latest.json holding only that run's sets. Every client would lose every other set until its publisher ran again, and
retention would then treat those frames as unreferenced.

Measured on the public CDN at 06:2xZ: Supabase answers a missing object with **HTTP 400** and
`{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}`, and a missing bucket with 400 and
`"code":"NoSuchBucket"`. So "treat 404 as absent" alone would refuse every legitimate first write. The body has to be read.

## The fix (`backend/services/frame_latest_guard.py`, ON; kill switch `FRAME_LATEST_GUARD=0`)

- **Strict read for latest.json** (`SupabaseSink.read_strict`; `LocalSink` and `EntitledSink` too). ABSENT = HTTP 404, or HTTP
  400 whose body says NoSuchKey / `not_found`. Everything else is UNKNOWN and raises `LatestUnknown`: another 400 (bad JWT, no
  bucket, an HTML error page), a 5xx or a timeout after the existing retries, a body that is not a JSON object with `sets`. Then
  nothing is written. The world writer returns before it uploads a single frame. The raster writer returns before building, or,
  if the re-read fails, after uploading frames and an index that nothing names (its next retention removes them).
  `SupabaseSink.read` (every other caller) is unchanged.
- **Absent is believed only on a FRESH bucket**: no object under `v1/` (one list call, `has_any`). latest.json missing beside
  published objects is a fault, not a first run, and is refused. `FRAME_LATEST_REBUILD=1` rebuilds it after an operator's check.
- **Never drop a set record**: `check_write(new, base)` refuses a document missing any set key the document it was built from
  holds. That is stronger than a count: one set swapped for another is refused too. On a refusal the world writer runs no
  retention.
- A refusal is visible: the world writer reports `__latest__: {refused: true, reason}`, which makes the step exit 1;
  `publish_raster_frames.py` exits 1 on `latest_unknown` / `latest_refused`. continue-on-error keeps the ingest cycle green, as for
  every frames step.
- `.github/workflows/forecast-ingest-pilots.yml`: job-level `FRAME_LATEST_GUARD: ${{ vars.FRAME_LATEST_GUARD || '1' }}`, so every
  publishing step sees it. Only the pilots lane writes latest.json. The core lane's `--wind-lane-rebuild` reads it and never
  writes it.

## Evidence

`backend/tests/test_frame_latest_guard.py`, 22 tests, estate lane:
- only a real not-found is absent (9 status/body cases, including NoSuchBucket, an HTML 400 and a 500 with a not-found body);
- the strict read raises on a 400 that is not not-found, while the loose read is unchanged;
- a 400 on latest.json makes the world writer write NOTHING (not one object) and keep every other set;
- a fresh bucket takes its first latest.json;
- a missing latest.json beside objects is refused, and allowed with FRAME_LATEST_REBUILD=1;
- the world writer keeps every other set, and consults the shrink check before writing (a refusal writes nothing and deletes
  nothing);
- the shrink check refuses fewer records, a swapped record and the empty-document rebuild;
- a corrupt latest.json is unknown;
- the raster writer refuses on an unknown first read, on an unknown RE-read, and on a refused shrink check;
- the kill switch restores the old read;
- the entitled sink reads latest.json strictly from the public bucket;
- the pilots job passes the guard ON.

Mutants, each alone, then restored:

| mutant | result |
|---|---|
| any 400 = absent (the original bug) | 6 fail |
| world writer back to the loose read | 2 fail |
| count-only shrink check | 1 fail |
| no fresh-bucket check | 1 fail |
| raster re-read back to the loose read | 1 fail (this mutant first SURVIVED; the re-read test was added for it) |

Not done: no live read of the bucket beyond the public not-found probe. The pilots run after merge is the first real use.

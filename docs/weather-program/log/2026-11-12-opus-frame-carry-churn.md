# 2026-11-12 — opus: static-frame rebuild churn (content-keyed carry)

Session: side session of the move-3 static-frames session (follow-up "Not fixed here" item 1 of
`log/2026-11-12-opus-move3-publish-order.md`, on #816's branch). Branch `opus/frame-carry-content-key`, from dev `37b85b463`.
Owner approval relayed by the parent session: remove the rebuild churn so the EURO swell sets cost little.

## What was measured (before)

- **Run logs**, 10 `forecast-ingest-pilots.yml` runs 11-11 00:14Z .. 11-12 14:37Z (`gh run view --log`; the frames step prints a
  `parity ok` line per BUILT frame, flushed per set). In the 5 runs that reached the EURO swell sets, every set built every entry:
  74 / 116 / 117 / 117 / 118 frames per set, 0 carried. Set seconds (timestamp gaps between set flushes): plain sets 19-37 s
  (mean 28.7, n 14), filled sets 20-42 s (mean 34.7, n 8). Six sets ~190 s a run. The other 5 runs skipped them on the 960 s budget.
- **CDN** (public `weather-frames`, read 11-12 ~20Z): `EURO/marine/swell_1/global_mid` current vs previous index (written 06:37Z):
  116 paired frames; `run_time` differs on **116**, `ingested_at` on 73, `model_run_time` on 43; **73 have the same sha256**.
  Same picture for swell_2 and wind_waves (73 of 116 each). The filled twins (written 03:50Z): 0 of 109 same sha, because their
  GFS donor moved to a new cycle (correct: the fill rewrites masked nodes from the donor).
- So the churn has two volatile fields, not one: `run_time` (the manifest REGISTRATION time, re-stamped by every re-ingest) and
  `ingested_at`. A key that kept either would carry nothing.
- **Per-frame cost** (synthetic 180 x 85 world product, 2.66 MB JSON, `frame_set_content` vs the build path, local venv):
  JSON parse 41-62 ms, encode + parity 164-495 ms, masked content hash 14 ms, raw sha 1.4 ms.

## What changed

`backend/services/frame_set_content.py` (new) + a 20-line hook in `frame_set.publish_set`. When a frame's source identity differs
from the previous index's, the publisher reads the product bytes (it read them anyway) and computes a CONTENT KEY: sha256 of the
bytes with the VALUES of the top-level `run_time` and `ingested_at` blanked. If the key, the code fingerprint and (filled sets) the
donor's key equal the previous frame's `content` record, the frame is carried: same path, sha, bytes and grid; meta `run_time` /
`ingested_at` rewritten from the bytes. That is what a rebuild writes when the sha comes out unchanged (the `unchanged` branch),
minus parse, fill, encode and parity. Every built frame now records `content` in the index (~120 bytes a frame).

The identity, field by field (also in the module docstring; "fail" = what goes wrong if the choice is wrong):

| field | in/out | why; failure if wrong |
|---|---|---|
| product bytes | in | everything the encoder, parity gate, fill and `product_meta` can read. Fail: a field left out changes pixels under a carried frame. |
| `run_time`, `ingested_at` values | out | neither encoder (reads `valid_time`, `model_run_time`) nor fill reads them; meta copies are rewritten. Fail (if in): nothing carries. Guard: each key exactly once, at brace depth 1, value equal to the manifest entry's, else rebuild. |
| `model_run_time` | in | written into the frame header; the stale-copy guard compares it. Also must equal the previous frame's source. Fail: a new cycle rides an old frame. |
| filename | in | it is the meta's `product_id`. |
| code fingerprint | in | sha of `frame_binary`, `frame_set`, `frame_set_fill`, `frame_set_content`, `coarse_gulf_fill`. Fail: an encoder or fill fix would not reach CMEMS frames until the daily run rolls (today's churn hid this). |
| donor filename, `model_run_time`, manifest `resolution`, donor content key | in (filled) | the fill rewrites masked nodes from the donor; the filename is in the `coarse_fill` stamp; `apply_fill` reads the manifest resolution. The donor's `run_time` must pass `coarse_gulf_fill._same_run`, as on a rebuild. Fail: a new donor's values never reach the filled frame. |
| `KEY_VERSION` | in | bump to rebuild every content-carried frame once. |

Not eligible (identity carry only, unchanged): wind sets (HRRR lane), rated sets (rating chain), Bight-composed frames.
Known difference from a rebuild: the index's set-level `parity_max_abs_err` covers frames CHECKED this run, as it already does for
identity-carried frames. `TailDownloads.prefetch` (dark, `FRAME_TAIL_DOWNLOAD`) still compares identities, so with tails on it
downloads re-ingested tails and then content-carries them (no saving on that download; not changed here).

Ships ON: code default `'1'`, `FRAME_CONTENT_CARRY: ${{ vars.FRAME_CONTENT_CARRY || '1' }}` in the pilots frames step; kill switch
repo variable `FRAME_CONTENT_CARRY=0` (every changed identity rebuilds, today's path). No served number moves: a carried frame is
byte-identical to the frame a rebuild would publish, and the parity gate ran when it was built.

## Evidence

- `backend/tests/test_frame_set_content.py`, 12 tests, estate lane (the direct `coarse_gulf_fill` import would have put it in
  chain; it reaches the donor LRU through `frame_set_fill`). The parity claim: for plain AND filled targets, compact and spaced
  JSON, a re-ingest with new `run_time` + `ingested_at` is content-carried (built 0, uploads 0) and its frames, `common_meta`
  and `grid` EQUAL the OFF path's rebuild from the same previous index (once the `content` field is stripped). Also: changed bytes rebuild
  only that frame; a new `model_run_time` with the same field rebuilds; a new GFS donor cycle rebuilds; a donor whose bytes alone
  changed rebuilds; OFF keeps today's counts (built 3, unchanged 3) and writes no `content`; a new code fingerprint rebuilds; a
  disk copy whose `ingested_at` is not the manifest's rebuilds; the masking refuses absent, repeated and nested keys; the workflow
  wires the switch ON.
- Mutants (each applied alone to `frame_set_content.py`, then restored): no carry 5 fail; donor out of the key 1; model_run_time
  masked too 1; flag ignored 5; meta not refreshed 4; no code fingerprint 1; no registration check 1.
- Existing frame suites unchanged: 94 passed (`test_publish_frame_sets`, `_fill`, `_bight`, `_wind`, `_rating`, `_bundle`,
  `_bundle_euro_icon`, `_wind_rebuild`, `test_frame_binary`).

## Saving (estimate, not yet measured live)

- Plain sets (swell_1, swell_2, wind_waves): on a run where the CMEMS cycle did not roll, every frame carries, ~29 s -> ~1-2 s a
  set, **~80 s a run**. On the roll run (about 1 in 6), the CDN pair above says 73 of 116 carry: ~50 s.
- Filled sets: carry only when the GFS donor cycle is unchanged since the previous run. The observed pair had a new cycle (0
  carried). GFS cycles every 6 h against pilots fires 2.2-7.4 h apart, so roughly a third of runs keep the donor cycle: then
  ~35 s -> ~2 s a set, ~100 s. **Expected over runs: ~80 + ~35 ≈ 110 s of the ~190 s**, and ~180 s on runs where the donor holds.
- Unverified assumptions: real CMEMS product files hold `run_time` and `ingested_at` once, at the top level (pydantic
  `NormalizedProduct.model_dump_json`; no nested model has those fields). If not, `content_carried` stays 0 and the run behaves
  as today; the step's `content_carried` stat is the live instrument. First run after merge rebuilds once (no `content` recorded yet).

## Not fixed here

1. The regional bundles (`frame_set_bundle`) and the wind lane-window rebuild keep their own carry rules; neither was measured
   for this churn.
2. `TailDownloads.prefetch` could skip downloading a re-ingested tail whose previous frame has `content`, but it cannot know the
   bytes without downloading them; left as is (dark lane).

## 2026-11-15 15:41Z: measured live, and a correction to the estimate above

**How:** the per-set JSON report (`{"frame_sets": ...}`) IS printed into the pilots frames step log. `gh run view --log` cuts
the job log at about 10 MB (in run 43709308169 it stopped mid-frames-step, before every raster step). The full job log from
`gh api --allow-escape-sequences repos/<owner>/<repo>/actions/jobs/<job id>/logs` holds it (49,803 lines). My 11-15 status note
to the director ("the step log never prints the report") was wrong. No code change is needed to attribute per set.

**Measured,** five pilots runs after #832 merged (11-14 17:18Z .. 11-15 11:31Z), the six EURO swell sets:

| run | plain sets (3): built / content_carried / identity carried, s | filled sets (3): built / content_carried, s | total s |
|---|---|---|---|
| 43620395353 | 1 / 116 / 0 each, ~7 s each | 117 / 0 each, 38-40 s | 139.6 |
| 43637758695 | 118, 78, 118 built / 0 / 0, 19-36 s | 118, 78, 118 / 0, 27-40 s | 195.1 |
| 43653114830 | 0, 40, 0 / 75 / 42, 2, 42; 0.7-14 s | 117 / 0 each, 58-75 s | 219.0 |
| 43676991030 | 45 / 73 / 0 each, 19-21 s | 118 / 0 each, 47-51 s | 205.2 |
| 43709308169 | 79 / 0 / 37 each, 17-18 s | 111 / 0 each, 45-52 s | 198.8 |

- **The plain sets carry as designed.** A fully carried set took ~7 s instead of ~35 s, and every rebuilt frame had new content
  (`unchanged` 0 in every run: no rebuild wrote an identical frame).
- **The filled sets never carried:** 111-118 frames rebuilt in every run, `unchanged` 0, so their bytes really change each run:
  the GFS donor (a new GFS cycle per pilots fire) rewrites the masked nodes. That is a real content change, and the content key
  correctly refuses to carry it.

**Correction (ledger.d/opus--frame-carry-measured.jsonl:1):** the estimate in "Saving" above (~110 of ~190 s a run, filled sets
carrying "about one run in three") was wrong on the filled half. The donor changes every run, not every other. Measured saving: the
plain sets only, about 0-85 s a run depending on whether the CMEMS run rolled (full carry once in five runs, partial twice).
The six sets still cost 140-219 s a run; the filled half (~45-75 s a set) is now most of it. A filled frame can only get cheaper
by making the rebuild itself cheaper, not by carrying it.

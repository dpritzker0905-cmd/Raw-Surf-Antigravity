# 2026-10-19 — claude — GFS/EURO/ICON model-spread DATA collector for the world wave field (dark, data only)

Session: side session started from the scrub/viz lead (memory `sota-research-2026-10-20`). Branch
`claude/musing-pascal-f8f397`, cut from dev `a4a020334` (#399). Backend + one workflow step. Serves nothing, draws nothing.

## Why

The 2026-10-20 outside cross-check of our GFS-Wave world field: within 3% in calm swell, 29% off in a Southern Ocean storm
and 37% off at a typhoon (an ensemble's own confidence 47% there). A model-spread confidence layer matters most where heights
are largest. Reflection reviewed the plan and advised collecting the spread DATA first, before any UI, so a layer's
thresholds come from a measured distribution.

## What changed

- `backend/services/weather_pipeline/model_spread.py` (new, PURE). For each valid time at which GFS, EURO and ICON all
  have an AUTHORITATIVE `global_mid` marine waves product (latest run each; estimated tails excluded, their agreement is
  manufactured from other models), on the GFS `global_mid` lattice, per node: mean, min, max, spread = max - min, and
  cv = population std (ddof 0) / mean (None where the mean is 0). Each member value is
  `consensus_product.member_answer`, the served /point read at the node, the same read the CONSENSUS shadow averages.
  A node counts only where GFS is valid ocean and every member answers; misses are counted per member, never filled.
  Per-frame digest (spread median / p90 / max, cv median / p90, the max-spread node with its three member values) and a
  decile report by MEAN height, plus a top-1% tail row (storms are a few percent of sea nodes; inside decile 10 they
  only move its p90).
- `backend/scripts/publish_model_spread.py` (new). Reads the published `manifest.json` (cache-busted), picks the
  aligned valid times at GFS lead 0, 24, 48 ... h (`MODEL_SPREAD_LEAD_STEP_H` 24, at most `MODEL_SPREAD_MAX_FRAMES` 8),
  skips frames already collected for the same three member runs, loads products through `ProductStore.load_product`
  (the ingest step's files from the runner's disk cache, the rest from L2), refuses a member whose loaded copy is not the
  run the manifest names, and writes to the PRIVATE `weather-products` bucket:
  `model_spread/global_mid/<valid>/g<run>_e<run>_i<run>.json.gz` (immutable) and `model_spread/global_mid/index.json`
  (no-cache; every frame's key, members, counts, digest and the latest decile report). Frames older than
  `MODEL_SPREAD_RETAIN_DAYS` (21) by valid time leave the index and are deleted. Namespaced prefix: the designated-writer
  gate is not involved and the pipeline manifest is never written. The decile report goes to the Actions step summary.
- `.github/workflows/forecast-ingest.yml`: one step after ingestion, only when the repository variable
  `MODEL_SPREAD_PUBLISH` is `'1'` (the `FRAME_IMAGES_PUBLISH` pattern; not a rating lane, so not in `_RATING_FLAGS`),
  `continue-on-error`, 20 min timeout. Not in the pilots lane or precompute (pinned by a test).
- `tests/test_consensus_product.py`: the memoized-sampler allowlist gains the two new one-shot sites (one sampler per
  frame, dropped with it).

## Validation (offline; neither the live backend nor the bucket was contacted)

`tests/test_model_spread.py`, 14 tests (chain lane):
- NULL control: three identical models over a 0.6-5.6 m field -> spread 0 and cv 0 at all 231 nodes. It caught a real
  defect first: a float mean of 3 x 0.8 is 0.8000000000000002 and cv read 1.4e-16, so identical members now return
  exactly 0 (and `math.fsum` otherwise).
- POSITIVE controls: EURO +0.5 m / ICON -0.5 m -> spread 1.000 at every node and mean = GFS; EURO x1.2 / ICON x0.8 ->
  cv 0.1633 at every node (sqrt(0.08/3)) and spread/mean 0.40 in every decile; members on 0.5 and 1.0 deg offset lattices
  read +0.3 m at the GFS nodes.
- Node rule (land + a member that stops short), refusals (valid time, layer, missing member), pairing (estimated,
  older run, wrong tier excluded), lead-step pick, write-once (a second run builds and loads nothing), stale-member skip,
  retention prune + delete, and the workflow gate.
- Mutations, each RED: cv with ddof 1 (2 failed), estimated tails admitted (1), older run wins (1), a missing member
  filled with GFS's value (1), spread = max - mean (5).

Offline end-to-end run of the script itself (`--store-dir/--out-dir`) on a world-size synthetic store (GFS 2 deg, EURO
1.5 deg offset 0.25, ICON 2 deg offset 1; calm members within ~2-4%, a planted Southern Ocean storm +29% EURO / -10% ICON
and a typhoon +37% / -5%; NOT real data): 8 frames, 106,656 nodes, 9.4 s including 24 product loads, 46.6-47.1 KB per
gzip frame (smooth synthetic field: real data will compress less). The max-spread node is the planted storm centre on
every day (-51, 40 -> 48 -> 56 E, members 11.03 / 13.55 / 9.94 m). A second run: `already 8, built 0, 0.0 s`.

| decile | mean Hs (m) | nodes | spread median (m) | spread p90 (m) | spread/mean median | cv median | cv p90 |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | 0.91 - 1.22 | 10665 | 0.04 | 0.05 | 0.040 | 0.016 | 0.016 |
| 10 | 2.14 - 11.52 | 10666 | 0.09 | 0.91 | 0.040 | 0.016 | 0.098 |
| top 1% | 4.24 - 11.52 | 1067 | 1.91 | 3.21 | 0.284 | 0.121 | 0.137 |

(Synthetic: it shows the report finds a planted tail, nothing about the real ocean.)

## Not done / owed

- No real-data report yet: this machine holds no storage credentials, and running forecast-ingest.yml from a PR branch
  would write the production manifest. The first real decile report is the step summary of the first core cycle after
  the owner sets `MODEL_SPREAD_PUBLISH = '1'` (ledger commitment).
- Cost when armed: per new GFS run up to 8 frames x 3 products; the ingest step's own files are disk-cache hits, the
  rest are ~1.7 MB L2 reads each. Storage at the defaults is bounded by retention (21 days x <= 32 frames/day).
- No UI and no serving: a confidence layer, and its thresholds, come after real distributions are read.

## Ledger

seq 1498 pr_open (#401), seq 1499 commitment (first real decile report, due 2026-10-27).


Re-chained 2026-10-20 by the lead session after #395 merged: ledger lines 1463/1464 became 1498/1499 (same content).

# An instrument must not tax the product it measures: sampling the shadow-A/B `inputs` payload

**Found** 2026-08-09, by pricing my own change ~50 minutes before the precompute would have shipped it.
**Code** `backend/services/weather_pipeline/spot_ratings.py` → `_persist_inputs` + the `inputs` block
**Tests** `backend/tests/test_rating_shadow_ab.py` → the sampling block

## What I nearly shipped

`44cc2ddd` added a per-row `inputs` dict to every spot-hour so the shadow A/B
(`scripts/science_shadow_ab.py`) could replay served ratings offline. Correct for the instrument,
and unpriced for the product.

Measured on a realistic row, compact-serialised exactly as the uploader does:

| | bytes |
|---|---|
| row without `inputs` | 320 |
| row with `inputs` | 457 |
| **added** | **137 B, +42.8%** |

Across a ~10,600-row blob that is **~1.4 MB added** to `spot_ratings/latest.json` — an object
**every client downloads**. For scale, the `run_time` / `wind_run_time` pair was interned out of this
same object because a raw ISO pair per spot cost **+23%**. I had added a payload nearly **twice** as
expensive as the one the codebase had already gone to the trouble of removing.

## Why sampling, and why 5%

The A/B reports a **level-change rate** — what fraction of served spot-hours would change colour
under a candidate config. That is a proportion, and proportions do not need the population.

| sample | blob cost | replayable rows per blob |
|---|---|---|
| 100% | +42.8% | ~10,600 |
| 20% | +8.6% | ~2,100 |
| 10% | +4.3% | ~1,060 |
| **5% (default)** | **+2.1%** | **~530** |

~530 rows is ample for a rate, and the A/B always prints `rows_seen` beside `rows_replayable`, so
the sample can never masquerade as the population. `SPOT_RATINGS_INPUTS_SAMPLE_PCT` raises it
(`100` for a one-off deep run) or disables it (`0`).

## Why md5 and not `hash()`

The sample must be **deterministic in the spot id** for two independent reasons:

1. **Across cycles** — the same spots carry inputs every run, so a candidate replayed today and next
   week grades the same population. A fresh roll each cycle would turn population churn into
   apparent movement.
2. **Across processes** — `PYTHONHASHSEED` randomises `str` hashing per process, and more than one
   worker writes this blob. With `hash()` the two would disagree about which rows carry inputs, so a
   row's provenance would blink in and out between cycles for no observable reason.

Verified: identical selection under `PYTHONHASHSEED=1` and `PYTHONHASHSEED=99`, and pinned by
`test_the_sample_is_stable_across_processes_not_hash_seeded`, which recomputes the contract
independently of the implementation.

## The general rule

**An instrument may not tax the product it measures.** Provenance is cheap per row and expensive per
population; the question is never "is this field useful?" but "what does it cost on the object a user
downloads, and what is the smallest sample that still answers the question?" The tell here was
precedent sitting in the same file: something had already been interned out of this blob for being
20% cheaper than what I was adding.

Sibling of the LOC ratchet lesson (relocate rationale, never delete it) — both are cases where a
limit measured the right thing and the honest response was to pay it, not widen it.

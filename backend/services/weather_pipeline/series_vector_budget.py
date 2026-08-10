"""
series_vector_budget.py — bound a grid_series response by VECTORS (audit v7 §3/§3b, 2026-08-03).

WHY A VECTOR BUDGET AND NOT A TIME BUDGET. grid_series_helper already has a time budget
(`OVERALL_DEADLINE`, default 20 s) written so a long build "degrades to a PARTIAL page instead of
nothing". Measured live 2026-08-03, it does not fire on the case that matters: every oversized
response returned `frame_count: 48` AND 48 actual frames, in 25.8-35.3 s. The deadline bounds the
per-hour BUILD LOOP; it does not bound serialisation and transfer of a 40 MB document, which is
where an oversized response actually spends its time. A time budget cannot see a 40 MB document.
A vector budget cannot miss one.

THE COST THIS BOUNDS, measured from the served payload rather than estimated:

    one vector  = an 11-key dict (lat lng speed direction u v period gust value is_valid
                  dir_confidence) = 1,226 B deep getsizeof
    a MISS      = 5,670 vectors/frame x 48 frames = 272,160 vectors = ~334 MB of live Python
    the client fires 3 pages on settle  ->  ~1 GB from ONE user's ONE zoom-out
    the serve box limit is 2 GiB, and it OOM-killed itself at 1,579 MB on 2026-08-03.

`store.py` caps the whole process at 120,000 vectors. A single unbounded response materialised
272,160 - 2.27x the entire process-wide budget, in one request. That is not a cache-sizing problem;
it is an unbounded fallback.

CALIBRATION. The default is set from measurement so it binds on every observed MISS and on no
observed HIT (vectors per frame, live, 48-frame series):

    HIT   span 1     25        HIT   span 40   441 / 1,056        <- never decimated
    HIT   span 9.8   200       HIT   span 360  300
    MISS  span 80  2,236       MISS  span 183  5,670              <- decimated

    80,000 / 48 frames = 1,666 vectors/frame, above every HIT and below every MISS.

Decimation is a STRIDE over the frame's own cols/rows, so the grid stays rectangular and the
`len(vectors) == cols * rows` invariant that every downstream transform relies on is preserved --
and is ASSERTED here rather than assumed. A frame whose vectors do not equal cols*rows (a masked or
sparse product) is LEFT ALONE: this module may only make a response smaller, never wrong.

Kill switch: SERIES_VECTOR_BUDGET=0 (disables entirely).
"""
import logging
import os

logger = logging.getLogger(__name__)

DEFAULT_VECTOR_BUDGET = 80_000


def _budget() -> int:
    try:
        return int(os.environ.get("SERIES_VECTOR_BUDGET", DEFAULT_VECTOR_BUDGET))
    except (TypeError, ValueError):
        return DEFAULT_VECTOR_BUDGET


def _stride_for(cols: int, rows: int, frames: int, budget: int) -> int:
    """Smallest stride s >= 1 such that ceil(cols/s) * ceil(rows/s) * frames <= budget."""
    s = 1
    while s < max(cols, rows):
        c = -(-cols // s)
        r = -(-rows // s)
        if c * r * frames <= budget:
            return s
        s += 1
    return s


def stride_for(cols, rows, frames, budget=None) -> int:
    """The stride this module would apply to `frames` frames of `cols` x `rows`.

    PUBLIC so the BUILD can bound itself with the SAME number the end-stage bound would pick.
    One quantity reached by two routes is the recorded "ONE QUANTITY, TWO FLOORS" defect class;
    `test_series_build_time_bound.py` pins these two paths equal across every measured geometry.
    Returns 1 when the budget is off, the geometry is unusable, or the series already fits.
    """
    b = _budget() if budget is None else budget
    if b <= 0:
        return 1
    try:
        cols, rows, frames = int(cols), int(rows), int(frames)
    except (TypeError, ValueError):
        return 1
    if cols <= 0 or rows <= 0 or frames <= 0 or cols * rows * frames <= b:
        return 1
    return _stride_for(cols, rows, frames, b)


def decimate_vectors(vectors, cols, rows, stride):
    """Stride a rectangular vector grid. Returns (new_vectors, new_cols, new_rows), or None.

    ⚠️⚠️ RETURNS A NEW LIST — THE CALLER MUST REBIND, AND MUST NEVER MUTATE THE INPUT IN PLACE.
    `ProductStore.load_product` hands out `product.model_copy()` with `grid = grid.model_copy()`,
    and BOTH are shallow (store.py:759-761) — so a resolved product's `grid.vectors` IS the list
    object sitting in `_product_cache`. `vectors[:] = out` would decimate the CACHED product and
    every later reader of it, on a fraction of requests, which is the worst available failure
    shape: intermittent, silent, and wrong rather than absent. Rebinding leaves the cache intact.

    Returns None (leave it alone) whenever the rectangular invariant `len(vectors) == cols * rows`
    does not hold, so a masked/sparse product is never silently reshaped.
    """
    if stride is None or stride <= 1:
        return None
    if not isinstance(vectors, list) or not isinstance(cols, int) or not isinstance(rows, int):
        return None
    if cols <= 0 or rows <= 0 or len(vectors) != cols * rows:
        return None                                   # not a full grid — this module stays out
    kept_cols = range(0, cols, stride)
    kept_rows = range(0, rows, stride)
    out = [vectors[r * cols + c] for r in kept_rows for c in kept_cols]
    assert len(out) == len(kept_cols) * len(kept_rows)  # the invariant, asserted not assumed
    return out, len(kept_cols), len(kept_rows)


def _decimate_frame(frame: dict, stride: int) -> bool:
    """Stride a frame's rectangular vector grid in place. Returns True if it was rewritten.

    Leaves the frame untouched (returning False) whenever the rectangular invariant does not hold,
    so a masked/sparse product is never silently reshaped.
    """
    if not isinstance(frame, dict):
        return False
    out = decimate_vectors(frame.get("vectors"), frame.get("cols"), frame.get("rows"), stride)
    if out is None:
        return False
    frame["vectors"], frame["cols"], frame["rows"] = out
    frame["decimated_stride"] = stride
    return True


def stamp_build_time_bound(resp: dict, stride: int, frames_rewritten: int, vectors_before: int) -> dict:
    """Stamp the bound diagnostics for a response already bounded DURING the build.

    The key set must match `apply_vector_budget`'s exactly — a client must never be asked to read
    two vocabularies for one fact. `bounded_at` is the only addition, and it is the whole point:
    it distinguishes vectors that were NEVER ALLOCATED ('build') from vectors that were allocated
    in full and then thrown away ('response'). Those cost the same bytes on the wire and differ by
    ~4x in peak RSS, which is the difference between serving and OOM-killing the box.
    """
    if not isinstance(resp, dict) or stride <= 1:
        return resp
    resp["vector_budget"] = _budget()
    resp["decimated_stride"] = stride
    resp["decimated_frames"] = frames_rewritten
    resp["vectors_before_bound"] = vectors_before
    resp["bounded_at"] = "build"
    first = next((f for f in (resp.get("frames") or [])
                  if isinstance(f, dict) and f.get("decimated_stride")), None)
    if first is not None:
        resp["cols"] = first.get("cols")
        resp["rows"] = first.get("rows")
    return resp


def apply_vector_budget(resp: dict) -> dict:
    """Bound `resp` to the per-response vector budget, and stamp the coverage mode.

    Additive and total: mutates only `frames[*].vectors/cols/rows` and adds diagnostic keys. Every
    response gains `coverage` ('hit' | 'miss') so the mode stops being invisible -- today a client
    cannot tell a cheap correct answer from a 30x-more-expensive correct one, because the only tell
    (served bounds wider than requested) was never surfaced.
    """
    if not isinstance(resp, dict):
        return resp
    frames = resp.get("frames")
    if not isinstance(frames, list) or not frames:
        return resp

    total = 0
    for f in frames:
        v = f.get("vectors") if isinstance(f, dict) else None
        if isinstance(v, list):
            total += len(v)
    resp["vectors_total"] = total

    budget = _budget()
    if budget <= 0 or total <= budget:
        return resp

    # Stride is computed from the LARGEST frame so one pass bounds the whole response; frames that
    # are not full rectangles are skipped and counted, never reshaped.
    max_cols = max((f.get("cols") or 0) for f in frames if isinstance(f, dict))
    max_rows = max((f.get("rows") or 0) for f in frames if isinstance(f, dict))
    if max_cols <= 0 or max_rows <= 0:
        return resp
    stride = _stride_for(max_cols, max_rows, len(frames), budget)
    if stride <= 1:
        return resp

    rewritten = 0
    for f in frames:
        if isinstance(f, dict) and _decimate_frame(f, stride):
            rewritten += 1

    after = sum(len(f["vectors"]) for f in frames
                if isinstance(f, dict) and isinstance(f.get("vectors"), list))
    resp["vectors_total"] = after
    resp["vector_budget"] = budget
    resp["decimated_stride"] = stride
    resp["decimated_frames"] = rewritten
    resp["vectors_before_bound"] = total
    # ⚠️ 'response' means these vectors WERE materialised in full and then discarded — the wire got
    # smaller, peak RSS did not. Only 'build' (stamp_build_time_bound) means they never existed.
    resp["bounded_at"] = "response"
    if rewritten:
        first = next((f for f in frames if isinstance(f, dict) and f.get("decimated_stride")), None)
        if first is not None:
            resp["cols"] = first.get("cols")
            resp["rows"] = first.get("rows")
    logger.warning(
        "[series-budget] %s/%s/%s: %d vectors over budget %d -> stride %d, %d/%d frames "
        "rewritten, now %d vectors",
        resp.get("model"), resp.get("domain"), resp.get("layer"),
        total, budget, stride, rewritten, len(frames), after,
    )
    return resp


# ⛔ `stamp_coverage` LIVED HERE AND WAS REMOVED THE SAME DAY IT SHIPPED (2026-08-03).
#
# It stamped `coverage: hit|miss` by testing whether the SERVED bounds equalled the REQUESTED bbox,
# on the claim that "served bounds == request => a product was clipped; wider => the dynamic
# fallback ran". THAT CLAIM IS FALSE, and its own control caught it within the hour:
#
#   * The backend SNAPS every request to the product grid (`get_snapped_bbox`, 1 deg for GFS, 2 deg
#     otherwise), so served bounds NEVER equal a raw request and the field said "miss" for
#     everything — including the genuine hits it existed to distinguish.
#   * Widening it to an inflation RATIO does not rescue it either. Measured live the same day:
#         1 deg request  -> served 2x1 deg    = 2.00x in longitude   (a HIT)
#         9.8 deg request-> served 16x12 deg  = 1.63x                (a HIT)
#         80 deg request -> served 102x84 deg = 1.28x                (a MISS)
#     THE MISS INFLATED LESS THAN THE HITS. Bounds cannot discriminate; the original rule was
#     generalised from a handful of samples that happened to agree.
#
# ★ The REAL signal exists but is not in this layer: `viewport_helper` sets
#   `is_dynamic_viewport_product = True` on exactly the fallback path (`:427`). Threading that flag
#   out through the resolver into each frame is the correct fix and is deliberately NOT done here —
#   a diagnostic that answers when it cannot know is worse than none, which is the whole reason this
#   function is a comment instead of code.
# ★ `vectors_total` / `decimated_stride` below are unaffected: they are MEASURED, not inferred.

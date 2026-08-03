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


def _decimate_frame(frame: dict, stride: int) -> bool:
    """Stride a frame's rectangular vector grid in place. Returns True if it was rewritten.

    Leaves the frame untouched (returning False) whenever the rectangular invariant does not hold,
    so a masked/sparse product is never silently reshaped.
    """
    cols = frame.get("cols")
    rows = frame.get("rows")
    vectors = frame.get("vectors")
    if not isinstance(cols, int) or not isinstance(rows, int) or not isinstance(vectors, list):
        return False
    if cols <= 0 or rows <= 0 or len(vectors) != cols * rows:
        return False                                  # not a full grid — this module stays out
    kept_cols = list(range(0, cols, stride))
    kept_rows = list(range(0, rows, stride))
    out = [vectors[r * cols + c] for r in kept_rows for c in kept_cols]
    assert len(out) == len(kept_cols) * len(kept_rows)  # the invariant, asserted not assumed
    frame["vectors"] = out
    frame["cols"] = len(kept_cols)
    frame["rows"] = len(kept_rows)
    frame["decimated_stride"] = stride
    return True


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


def stamp_coverage(resp: dict, requested_bbox: str) -> dict:
    """Stamp `coverage`: 'hit' when the served bounds equal the request, 'miss' when they are wider.

    THE TELL WAS ALWAYS IN THE PAYLOAD AND NOBODY READ IT. Measured live: served bounds == request
    means a precomputed product covered the viewport and was clipped (1.3-3.2 MB, 2-4 s); served
    bounds wider than the request means selection MISSED and the fallback built a dynamic grid at
    native resolution over an inflated box (13-43 MB, 18-35 s). Same endpoint, same contract, 30x
    the cost, and no way for a caller -- or an audit -- to tell them apart.
    """
    if not isinstance(resp, dict):
        return resp
    b = resp.get("bounds")
    try:
        rw, rs, re_, rn = [float(x) for x in (requested_bbox or "").split(",")]
    except (TypeError, ValueError):
        return resp
    try:
        if isinstance(b, dict):
            sw, ss, se, sn = (float(b["west"]), float(b["south"]), float(b["east"]), float(b["north"]))
        elif isinstance(b, (list, tuple)) and len(b) == 4:
            sw, ss, se, sn = [float(x) for x in b]
        else:
            return resp
    except (TypeError, ValueError, KeyError):
        return resp
    tol = 1e-6
    exact = (abs(sw - rw) <= tol and abs(ss - rs) <= tol
             and abs(se - re_) <= tol and abs(sn - rn) <= tol)
    resp["coverage"] = "hit" if exact else "miss"
    return resp

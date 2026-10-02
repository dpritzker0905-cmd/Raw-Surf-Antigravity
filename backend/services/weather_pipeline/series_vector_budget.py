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

THINNING MODE (2026-10-01). A pure stride keeps every k-th cell and DROPS the rest, so a swell narrower
than the stride's lattice can fall between kept cells and vanish at far zoom (the owner's "bigger swell
for Florida is missing at the further-out zoom"). `SERIES_DECIMATE_MODE=max` thins marine height layers
by block MAXIMUM on the SAME lattice instead -- see the section below `decimate_vectors`. Off by default.
"""
import logging
import os

logger = logging.getLogger(__name__)

DEFAULT_VECTOR_BUDGET = 80_000

# Layers whose scalar is a HEIGHT, where "the largest value near this cell" is the right one-number summary.
# Wind, pressure and temperature are not in this set on purpose: a maximum would bias them.
PEAK_PRESERVING_LAYERS = frozenset({"waves", "swell", "swell_1", "swell_2", "wind_waves"})

# Above this many cells a grid is thinned by the plain stride even when max thinning is on: the pool reads every
# cell, and the serve box has one CPU. A 2-deg world grid is ~15k cells; a 40-deg 0.25-deg tile is ~26k.
_MAX_POOL_MAX_VECTORS_DEFAULT = 60_000


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


# ── PEAK-PRESERVING THINNING (2026-10-01, the far-zoom Florida swell) ────────────────────────────
# MEASURED (Wed 2026-10-07 15Z, the owner's "Next Wed"): the exact 2-deg frame reads 3.23 m at 30N 80W; the
# stride-4 world page (an 8-deg lattice, 46 x 21) has NO cell inside the Florida box and reads 1.05 m there once
# interpolated; 427 of 10,355 ocean nodes read more than 1 m low, up to 5 m (Southern Ocean). Zooming in fetches the
# exact frame, which is why "closer up is right". Owner decision 2026-10-01: thin by block MAXIMUM instead.
#
# SAME LATTICE, DIFFERENT VALUES. The kept cells -- so cols, rows, every lat/lng and the bounds -- are exactly the
# stride's. Only the VALUE at a kept cell changes: it becomes the cell holding the LARGEST valid `speed` in the window
# around it (`_pool_half`; all of that cell's fields travel together, so speed/direction/period/u/v stay one coherent
# sample, never a mix across cells). A kept cell that already holds the largest value comes back UNCHANGED (the same
# object), so a calm or flat field is byte-identical to the stride, and an all-invalid window (land) keeps the kept
# cell as it was.
#
# THE PRICE, MEASURED (live Wed 2026-10-07 15Z, stride 4, 10,378 ocean nodes, thinned lattice interpolated back to the
# 2-deg nodes; audit evidence api/thinning_variants.json). A maximum cannot be free: every kept cell now speaks for its
# whole neighbourhood, so the picture is a high envelope of the truth.
#     thinning                   nodes under >1 m   nodes over >1 m   mean bias   mean abs err   30N 79.5W (exact 2.33)
#     stride (today)                    454               173           -0.08 m       0.30 m          1.34 m
#     max, 3x3 window (default)          23             1,291           +0.46 m       0.51 m          2.37 m
#     max, 5x5 window (HALF=2)            3             3,403           +0.88 m       0.89 m          3.00 m
# The 5x5 window fixes Florida and reads the whole ocean 0.9 m high; 3x3 puts Florida within 5% of exact at half the bias.
#
# DARK BY DEFAULT. A served number flips on the owner's word: `SERIES_DECIMATE_MODE=max` turns this on; unset or any
# other value is the plain stride that has served since 2026-08-03. Only PEAK_PRESERVING_LAYERS qualify -- a maximum is
# the right summary for a height, not for wind, pressure or temperature. Every site that thins a series frame (the mid
# tier's clip, the build-time stride, the end-stage bound, the load-time raw-dict stride) asks `thinning_mode` for its
# mode and passes it to `decimate_vectors`, so all of them still pick ONE set of cells and ONE set of values.
def thinning_mode(layer=None, domain=None) -> str:
    """'max' when a series frame of this layer should be thinned by block maximum, else 'stride'.

    Never raises: anything unreadable means 'stride', the behaviour that existed before this switch.
    """
    try:
        if os.environ.get("SERIES_DECIMATE_MODE", "stride").strip().lower() != "max":
            return "stride"
        if domain is not None and str(domain).strip().lower() not in ("", "marine"):
            return "stride"
        return "max" if str(layer or "").strip().lower() in PEAK_PRESERVING_LAYERS else "stride"
    except Exception:  # noqa: BLE001 -- a thinning switch must never take a response down
        return "stride"


def _pool_half(stride: int) -> int:
    """Half-width, in cells, of the window a kept cell pools over: the largest odd window not wider than the stride.

    stride 2 -> 3x3, 3 -> 3x3, 4 -> 3x3, 5 -> 5x5, 8 -> 7x7. A window wider than the stride overlaps its neighbours and
    only adds bias (see the measured table above); one much narrower leaves blind cells. `SERIES_MAX_POOL_HALF` (an int
    >= 1) overrides it: 2 is the 5x5 window at stride 4, which keeps every narrow swell and reads the ocean high.
    """
    try:
        h = int(os.environ.get("SERIES_MAX_POOL_HALF", ""))
        if h >= 1:
            return h
    except (TypeError, ValueError):
        pass
    return max(1, (int(stride) - 1) // 2)


def _max_pool_cap() -> int:
    try:
        return int(os.environ.get("SERIES_MAX_POOL_MAX_VECTORS", _MAX_POOL_MAX_VECTORS_DEFAULT))
    except (TypeError, ValueError):
        return _MAX_POOL_MAX_VECTORS_DEFAULT


def _max_pool(vectors, cols, rows, stride):
    """The stride's kept cells, each carrying the largest valid cell in the window around it. List, or None.

    Returns None (the caller then strides) when it cannot be done safely: a grid over the cell cap, or cells that are
    neither dicts (the response / raw-JSON paths) nor models (the build path) with a numeric `speed`. That direction is
    the only safe one: a plain stride is only ever coarser, never wrong.

    ⚠️ Never mutates a cell. A changed cell is a COPY of the winning cell with the kept cell's lat/lng, because the
    input cells may be the very objects sitting in `_product_cache` (see decimate_vectors).
    """
    if len(vectors) > _max_pool_cap():
        return None
    first = vectors[0]
    is_dict = isinstance(first, dict)
    if not is_dict and not (hasattr(first, "speed") and hasattr(first, "model_copy")):
        return None
    neg = float("-inf")
    speeds = []
    put = speeds.append
    if is_dict:
        for v in vectors:
            s = v.get("speed")
            put(float(s) if (v.get("is_valid", True) is not False and isinstance(s, (int, float)) and s == s) else neg)
    else:
        for v in vectors:
            s = v.speed
            put(float(s) if (v.is_valid is not False and isinstance(s, (int, float)) and s == s) else neg)
    half = _pool_half(stride)
    out = []
    for r in range(0, rows, stride):
        ra, rb = max(0, r - half), min(rows - 1, r + half)
        for c in range(0, cols, stride):
            ca, cb = max(0, c - half), min(cols - 1, c + half)
            best, bi = neg, -1
            for rr in range(ra, rb + 1):
                base = rr * cols
                seg = speeds[base + ca: base + cb + 1]
                m = max(seg)
                if m > best:
                    best, bi = m, base + ca + seg.index(m)
            ki = r * cols + c
            kept = vectors[ki]
            if bi < 0 or speeds[ki] == best:
                out.append(kept)           # an all-invalid window, or the kept cell already is the peak: untouched
            elif is_dict:
                cell = dict(vectors[bi])
                cell["lat"], cell["lng"] = kept["lat"], kept["lng"]
                out.append(cell)
            else:
                out.append(vectors[bi].model_copy(update={"lat": kept.lat, "lng": kept.lng}))
    return out


def decimate_vectors(vectors, cols, rows, stride, mode="stride"):
    """Thin a rectangular vector grid. Returns (new_vectors, new_cols, new_rows), or None.

    `mode` is 'stride' (every k-th cell, the default and the behaviour since 2026-08-03) or 'max' (the same kept cells,
    each carrying the largest valid cell in the window around it: see the section above). A 'max' request that cannot be
    honoured safely is served as the plain stride.

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
    if mode == "max":
        pooled = _max_pool(vectors, cols, rows, stride)
        if pooled is not None:
            assert len(pooled) == len(kept_cols) * len(kept_rows)   # same lattice as the stride, asserted
            return pooled, len(kept_cols), len(kept_rows)
    out = [vectors[r * cols + c] for r in kept_rows for c in kept_cols]
    assert len(out) == len(kept_cols) * len(kept_rows)  # the invariant, asserted not assumed
    return out, len(kept_cols), len(kept_rows)


def _decimate_frame(frame: dict, stride: int, mode: str = "stride") -> bool:
    """Thin a frame's rectangular vector grid in place. Returns True if it was rewritten.

    Leaves the frame untouched (returning False) whenever the rectangular invariant does not hold,
    so a masked/sparse product is never silently reshaped.
    """
    if not isinstance(frame, dict):
        return False
    out = decimate_vectors(frame.get("vectors"), frame.get("cols"), frame.get("rows"), stride, mode=mode)
    if out is None:
        return False
    frame["vectors"], frame["cols"], frame["rows"] = out
    frame["decimated_stride"] = stride
    return True


def stamp_build_time_bound(resp: dict, stride: int, frames_rewritten: int, vectors_before: int,
                           mode: str = "stride") -> dict:
    """Stamp the bound diagnostics for a response already bounded DURING the build.

    The key set must match `apply_vector_budget`'s exactly — a client must never be asked to read
    two vocabularies for one fact. `bounded_at` is the only addition, and it is the whole point:
    it distinguishes vectors that were NEVER ALLOCATED ('build') from vectors that were allocated
    in full and then thrown away ('response'). Those cost the same bytes on the wire and differ by
    ~4x in peak RSS, which is the difference between serving and OOM-killing the box.

    `decimated_mode: "max"` is stamped ONLY when max thinning was in force, so a response served under the
    default stride is byte-identical to what it was before the switch existed.
    """
    if not isinstance(resp, dict) or stride <= 1:
        return resp
    resp["vector_budget"] = _budget()
    resp["decimated_stride"] = stride
    resp["decimated_frames"] = frames_rewritten
    resp["vectors_before_bound"] = vectors_before
    resp["bounded_at"] = "build"
    if mode == "max":
        resp["decimated_mode"] = "max"
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

    mode = thinning_mode(resp.get("layer"), resp.get("domain"))
    rewritten = 0
    for f in frames:
        if isinstance(f, dict) and _decimate_frame(f, stride, mode):
            rewritten += 1

    after = sum(len(f["vectors"]) for f in frames
                if isinstance(f, dict) and isinstance(f.get("vectors"), list))
    resp["vectors_total"] = after
    resp["vector_budget"] = budget
    resp["decimated_stride"] = stride
    resp["decimated_frames"] = rewritten
    resp["vectors_before_bound"] = total
    if mode == "max" and rewritten:
        resp["decimated_mode"] = "max"
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


# ── LOAD-TIME STRIDE (2026-08-10, the grid_series cold-path cost) ─────────────────────────────
# Rationale, measurements and the four guarded hazards:
#   docs/research/DESIGN-2026-08-10-the-grid-series-load-time-stride.md
# One line: grid_series bounds RETENTION but not ALLOCATION, and a cold global series constructs
# ~525k GridVectors for ~210 MB resident. These helpers let a caller that will stride the grid
# ANYWAY say so before `model_validate`, so the discarded cells are never modelled.
def effective_load_stride(stride) -> int:
    """Normalise a requested stride to an int >= 1, honouring the SERIES_LOAD_STRIDE=0 kill switch.

    Fails OPEN (returns 1) on anything unparseable: a load-time bound must serve the FULL grid when
    in doubt, because failing closed would silently serve a coarser forecast.
    """
    try:
        if int(os.environ.get("SERIES_LOAD_STRIDE", "1")) == 0:
            return 1
    except (TypeError, ValueError):
        pass
    try:
        s = int(stride)
    except (TypeError, ValueError):
        return 1
    return s if s > 1 else 1


def stride_raw_grid_dicts(data, stride: int) -> bool:
    """Decimate `data['grid']['vectors']` in the PARSED-JSON dicts, before any model exists.

    Cell selection is delegated to `decimate_vectors` so the load-time and build-time strides are
    ONE expression picking ONE set of cells (the ONE QUANTITY, TWO FLOORS class). Refuses on
    anything that is not a full rectangular grid: this may make a product smaller, never wrong.
    """
    if stride <= 1 or not isinstance(data, dict):
        return False
    grid = data.get("grid")
    if not isinstance(grid, dict):
        return False
    out = decimate_vectors(grid.get("vectors"), grid.get("cols"), grid.get("rows"), stride,
                           mode=thinning_mode(data.get("layer"), data.get("domain")))
    if out is None:
        return False
    grid["vectors"], grid["cols"], grid["rows"] = out
    # ⚠️ STAMP IT, because the caller CANNOT tell by looking. grid_series applies its own stride to
    # every hour as it lands; without this marker it re-strides an already-strided grid and the
    # frame comes back stride^2 too coarse (measured: 966 cells -> 72, a 13.9x materialisation
    # ratio that looked like the fix had failed). The consumer keys off this, never off geometry —
    # geometry cannot distinguish "already strided by 4" from "natively this small".
    diag = grid.get("diagnostics")
    if not isinstance(diag, dict):
        diag = {}
        grid["diagnostics"] = diag
    diag["load_stride"] = stride
    return True

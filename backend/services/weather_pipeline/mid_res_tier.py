"""
mid_res_tier.py

Step 3.6 MID-RES GLOBAL TIER for grid_resolver (extracted 2026-07-05 to keep grid_resolver.py under
the 800-LOC ceiling, and upgraded to MIRROR the extended-estimate blend structure of the coarse
products).

The tier serves the pre-computed `global_mid` (~2°) product CLIPPED to the viewport for marine
requests up to the wide/global view (span ≤15°). The ≤2° tight-zoom floor was dropped 2026-07-12 so
cold / freshly-panned surf zooms still get an instant coastal rating band instead of the band-less
global-coarse preview (see try_serve_mid_res_tier). Two rules keep the FORECAST TIMELINE consistent
with the coarse siblings (the "mirror"):

  • AUTHORITATIVE-FIRST, THEN ESTIMATED: native mid hours serve the authoritative global_mid; hours
    past a model's native horizon (EURO 240→336h extended estimates, tails) serve the ESTIMATED
    global_mid built by the same machinery as the coarse blends — provenance flows from the product
    unmodified (is_estimated / estimate_basis / source_dataset), so real reads real and estimates
    read estimated at every hour.
  • REPLACE-COARSE-GLOBAL ONLY: at estimated hours Step 3 short-circuits (an estimated manifest item
    sets use_manifest_product=True) and serves the UNCLIPPED 10° global_coarse before Step 3.6 is
    reached — so the tier also runs as a REPLACE pass: it may swap an unclipped GLOBAL-span product
    for the clipped mid, but NEVER replaces a regional/finer product.

`split_mid_candidates` additionally removes global_mid items from the GENERIC candidate lists:
select_best_candidate ties globals on intersection+coverage area and falls to list order, so leaving
global_mid in made the world-zoom product (and the Step 3.7/stale-fallback previews) an ORDER-LUCK
draw between a 629-vector coarse and a ~15k-vector mid. global_mid is served ONLY by this tier,
clipped. Kill switch: MARINE_MID_RES_TIER=0; band tunable MARINE_MID_RES_{MIN,MAX}_SPAN.
"""
import asyncio
import logging
import os

from services.weather_pipeline.reval_queue import reval_key, schedule_revalidation
from services.weather_pipeline.route_helpers import filter_grid_to_bbox, get_snapped_bbox
from services.weather_pipeline.series_vector_budget import thinning_mode
from services.weather_pipeline.viewport_helper import _is_oversized_grid

logger = logging.getLogger(__name__)

_MID_LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")


def split_mid_candidates(authoritative_candidates, estimated_candidates):
    """Partition (product, diff) candidate lists into (generic_auth, generic_est, mid_auth, mid_est).

    global_mid items must never compete in the generic selection (world-zoom tie / preview order-luck
    above) — the tier below is their single serving path.
    """
    def _split(cands):
        generic, mid = [], []
        for pair in cands:
            p = pair[0]
            (mid if getattr(p, "region_id", None) == "global_mid" else generic).append(pair)
        return generic, mid

    generic_auth, mid_auth = _split(authoritative_candidates)
    generic_est, mid_est = _split(estimated_candidates)
    return generic_auth, generic_est, mid_auth, mid_est


def _request_span(req_w, req_s, req_e, req_n):
    if req_w <= req_e:
        span_lng = req_e - req_w
    else:
        span_lng = (180.0 - req_w) + (req_e + 180.0)
    return max(span_lng, abs(req_n - req_s))


def _grid_span(product):
    try:
        b = product.grid.bounds
        return (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
    except Exception:
        return 0.0


def pick_mid_item(mid_auth, mid_est):
    """Authoritative mid first (native hours); else estimated mid (the mirror's blend/tail hours).
    Within a class, smallest time-diff wins."""
    for cands in (mid_auth, mid_est):
        if cands:
            return min(cands, key=lambda pair: pair[1])[0]
    return None


# ── THE WORLD-SCALE SERIES COST (2026-09-30, commitment 228) ─────────────────────────────────────
# Owner report: "not showing the swell [at far zoom] until I zoom in, on forecasts". Replayed live with
# the client's exact request (GLOBAL_REQUEST_BBOX, 48 three-hourly offsets): page 0 came back with 30 of
# 48 frames in 24.7 s alone and 16 of 48 with its sibling page in flight -- OVERALL_DEADLINE (20 s)
# drops the tail of every page, so +46..+139 h were missing and the client cached the partial page.
# Profiled locally on the live manifest + 16 real global_mid files (cProfile, 16-frame world page):
# 10.3 of 12.9 s was `copy.deepcopy` HERE -- the clip-cache store below deep-copies the whole clipped
# product, sized in July for "tiny, ~dozens of cells". MAX_SPAN 400 (2026-07-23) made the world clip
# the WHOLE ~15k-vector grid, so every world frame paid a 15k-model deepcopy (and every cache hit
# another), then grid_series threw 8 of 9 cells away. Two changes, both serving byte-identical cells:
#   1. A clip above MARINE_MID_CLIP_CACHE_MAX_VECTORS is not cached. The returned product is the same
#      object as before (the clip, never the cache entry); only the useless deep copy goes. It also
#      frees up to 24 x 15k deep-copied vectors (~150 MB) the cache could pin on the 2 GB box.
#   2. A series frame (series_stride > 1) is strided right after the clip, with the SAME
#      `decimate_vectors` call grid_series would make on the same grid a few steps later, so every
#      per-cell step in between runs on 1/stride^2 of the cells. `load_stride` is stamped so the series
#      does not stride twice (see grid_series_helper._load_stride_of).
_CLIP_CACHE_MAX_VECTORS_DEFAULT = "5000"   # a 40 deg band clip with its 12 deg pad is ~1k cells


def _clip_cacheable(product) -> bool:
    """True when a clipped product is small enough for the deep-copying clip cache."""
    try:
        cap = int(os.environ.get("MARINE_MID_CLIP_CACHE_MAX_VECTORS", _CLIP_CACHE_MAX_VECTORS_DEFAULT))
    except ValueError:
        cap = int(_CLIP_CACHE_MAX_VECTORS_DEFAULT)
    grid = getattr(product, "grid", None)
    return len(getattr(grid, "vectors", None) or []) <= cap


def _series_stride(series_stride) -> int:
    """The series decimation to apply after the clip, or 1 (none). Fails open like grid_resolver._load_kw:
    a stride that cannot be read serves the full clip, which is what the tier did before."""
    if os.environ.get("MARINE_MID_SERIES_STRIDE", "1") == "0":
        return 1
    try:
        s = int(series_stride)
    except (TypeError, ValueError):
        return 1
    return s if s > 1 else 1


def _stride_clipped_grid(product, stride: int, mode: str = "stride") -> bool:
    """Decimate the clip's OWN grid container exactly as grid_series._apply_build_stride would.

    `filter_grid_to_bbox` returns a private grid container over SHARED vector objects, so rebinding
    `vectors` here cannot reach the L1 product; `diagnostics` is still the shared dict, so it is copied
    before `load_stride` is written (a stamp leaking into L1 would make a later full read look strided).

    `mode` is `thinning_mode(layer, domain)`, the SAME value grid_series passes: this is where the world
    page's far-zoom frames are thinned, so 'max' here is what keeps the Florida swell on an 8-deg lattice.
    """
    from services.weather_pipeline.series_vector_budget import decimate_vectors
    grid = getattr(product, "grid", None)
    if grid is None:
        return False
    out = decimate_vectors(grid.vectors, grid.cols, grid.rows, stride, mode=mode)
    if out is None:
        return False
    grid.vectors, grid.cols, grid.rows = out
    diagnostics = dict(grid.diagnostics or {})
    diagnostics["load_stride"] = stride
    grid.diagnostics = diagnostics
    return True


# ── THE STRIDED WORLD READ (2026-10-02, commitment 228's par2 residual) ──────────────────────────────
# After #210 a world series frame still READ the whole global_mid: on an L1 miss, parse + validate 15,023
# cells, clip all of them (the world clip keeps every one), then keep 966. And it always missed: L1 holds
# 120k vectors, 8 global_mid products, so a 48-hour page evicts each before it is asked for again (0 of 32
# loads hit, measured). One core, 16 real files, stride 4: 2.3-3.4 s of CPU per page, 0.9-1.4 s of it gen2
# GC; two such pages at once overran the 20 s deadline on the box (S11 par2 68.1% / 59.3%). When the clip
# is provably the identity, this lane reads the file with the store's load-time stride instead (same
# `decimate_vectors` cells, 16x smaller L1 entry, ~1 ms validate): 0.8-1.2 s cold, 0.2 s repeated (15 of 16
# hits). Proof obligations: series_vector_budget.global_lattice (every raw cell on its lattice position)
# and _identity_clip_bounds (the clip rebuilds exactly that lattice). Kill: MARINE_MID_SERIES_LOAD_STRIDE=0.
def _store_takes_stride(store) -> bool:
    """True when `store.load_product` accepts `stride` (ProductStore does; older test doubles do not)."""
    import inspect
    try:
        params = inspect.signature(store.load_product).parameters
    except (TypeError, ValueError, AttributeError):
        return False
    return "stride" in params or any(p.kind is p.VAR_KEYWORD for p in params.values())


def _window_covers(clip, coverage) -> bool:
    """True when the clip window contains the product's whole coverage: the only windows that can clip it
    to itself, so the only ones worth a strided read."""
    from services.weather_pipeline.route_helpers import clamp_and_normalize_bbox, parse_bbox
    try:
        w, s, e, n = clamp_and_normalize_bbox(*parse_bbox(clip))
        return (w <= e and w <= coverage.west and e >= coverage.east
                and s <= coverage.south and n >= coverage.north)
    except Exception:
        return False


def _identity_clip_bounds(product, clip, stride):
    """The bounds `filter_grid_to_bbox(<the FULL grid>, clip)` would serve when that clip keeps every cell in
    stored order, which makes clip-then-stride exactly this load-strided grid. None means not proven: read
    the grid whole. PURE.

    `global_lattice` proved at load time that every full-grid cell sits at (lat0 + r*res, lng0 + c*res), so
    the clip's cell map holds each lattice cell once. If the window's lattice (the clip's own arithmetic,
    `clip_lattice`) is that same lattice, the clip fills nothing, drops nothing and reorders nothing.
    """
    from services.weather_pipeline.route_helpers import clamp_and_normalize_bbox, clip_lattice, parse_bbox
    from services.weather_pipeline.schemas import CoverageBounds
    try:
        grid = product.grid
        diag = grid.diagnostics or {}
        lat = diag.get("load_stride_lattice")
        if diag.get("load_stride") != stride or not isinstance(lat, dict):
            return None
        # The spacing filter_grid_to_bbox builds its lattice at: the declared resolution, else the one it derives
        # from the cells, which global_lattice derived the same way from the same cells.
        res = product.resolution or 0.0
        if res <= 0 and lat.get("res_derived"):
            res = lat["res"]
        if res <= 0 or float(lat["res"]) != res:
            return None
        rows, cols, lat0, lng0 = lat["rows"], lat["cols"], lat["lat0"], lat["lng0"]
        west, south, east, north = clamp_and_normalize_bbox(*parse_bbox(clip))
        if west > east:
            return None
        lats, lons = clip_lattice(lat0, lng0, res, west, south, east, north)
        if (lats != [round(lat0 + r * res, 4) for r in range(rows)]
                or lons != [round(lng0 + c * res, 4) for c in range(cols)]
                or (grid.cols, grid.rows) != (len(range(0, cols, stride)), len(range(0, rows, stride)))
                or len(grid.vectors or []) != grid.cols * grid.rows):
            return None
        return CoverageBounds(west=min(lons), south=min(lats), east=max(lons), north=max(lats))
    except Exception:
        return None


def _apply_identity_clip(product, clip, bounds) -> None:
    """Write what `filter_grid_to_bbox` writes when it keeps every cell, and what `_stride_clipped_grid`
    leaves in diagnostics. `product` came from load_product, so its grid container is its own; the
    diagnostics dict is still the L1 entry's, so it is copied (and the internal lattice stamp dropped)."""
    grid = product.grid
    grid.bounds = bounds
    product.requested_bbox = clip
    product.served_bbox = f"{bounds.west:.4f},{bounds.south:.4f},{bounds.east:.4f},{bounds.north:.4f}"
    product.coverage = grid.bounds
    grid.diagnostics = {k: v for k, v in (grid.diagnostics or {}).items() if k != "load_stride_lattice"}


def _schedule_sharpen(product, *, model, domain, layer, bbox, span, viewport_service, valid_time,
                      target_dt, background_tasks):
    """Ask the sharpen queue for this hour and viewport; label `product` only when one is pending.

    Called per request, on a clip-cache hit as well as on a fresh clip (2026-10-09)."""
    # SWR SHARPEN (2026-07-05, #2 — the Irvine straddle second pass): the mid grid is the INSTANT
    # covering preview; schedule the SAME background fine-viewport revalidation Step 3.7 uses so a
    # dwelling viewport sharpens 2° → 0.25° on the next request (pre-mid, fine WAS the steady state
    # for these spans — Step 3.6 serving before Step 4 had silently removed that). SPAN-CAPPED
    # (MARINE_MID_REVAL_MAX_SPAN, default 5°): wide zoom-outs keep the mid steady-state — a 15° fine
    # upstream fetch is a heavy call the pre-mid path never made either. is_viewport_enabled also
    # gates model horizons (EURO 240h / ICON 168h), so estimated tail hours never spawn dead fetches.
    # 8.0 (was 5.0, 2026-07-05 same-day fix): the frontend's 30% gesture fetch-pad (41bfebca) grows
    # the REQUESTED span — a raw ~3.1-3.8° viewport now requests 5-6.1°, and the 5° cap silently
    # stopped its fine sharpen (live: z7.20→7.35 off LA flips mid↔fine = a visible color step at the
    # cap boundary). 8° ≈ the old 5° raw reach × the pad factor; a ~1k-cell background fine fetch.
    # Per-domain reval caps. WIND (2026-07-20): the mid serves INSTANTLY at every span — that is
    # what makes cold starts and zoom-outs feel immediate — but without a reval the mid tier
    # silently KILLED the wind fine lane (probed: an 11x8-deg request served 8x7 mid cells where
    # the dynamic lane had served 0.5-deg). Close-zoom wind viewports therefore schedule the same
    # background sharpen marine uses; wide spans keep the mid steady state (a 40-deg fine build
    # is a heavy upstream call nobody's zoom benefits from). Side effect: the dynamic lane now
    # runs almost only from revals — open-meteo pressure drops accordingly.
    if (domain or "").lower() == "wind":
        _reval_cap = float(os.environ.get("WIND_MID_REVAL_MAX_SPAN", "20.0"))
    else:
        _reval_cap = float(os.environ.get("MARINE_MID_REVAL_MAX_SPAN", "8.0"))
    # QUEUE CAP (2026-07-05 OOM #3): a 17-hour grid_series scheduled 17 revals in one burst — the
    # semaphore serialized them but the queue ground the box for minutes. Cap the OUTSTANDING reval
    # queue; skipped hours sharpen on a later request (the user dwells on one hour at a time anyway).
    # Who gets a slot (2026-10-09): reval_queue.schedule_revalidation. A grid_series frame never takes
    # the slot kept for the hour being viewed, and registers no key unless its fetch will run.
    _reval_queue_max = int(os.environ.get("MARINE_REVAL_QUEUE_MAX", "2"))
    if (
        viewport_service is not None and valid_time is not None
        and span <= _reval_cap
        and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox, target_dt=target_dt)
        and schedule_revalidation(
            viewport_service, background_tasks, model, domain, layer, valid_time, target_dt, bbox,
            reval_key(model, domain, layer, target_dt, bbox),
            queue_max=_reval_queue_max,
        )
    ):
        product.stale = True
        product.staleReason = "swr_revalidation_pending"
        product.cache_hit = "mid_res_preview"


async def try_serve_mid_res_tier(
    store,
    *,
    model,
    domain,
    layer,
    bbox,
    req_w, req_s, req_e, req_n,
    mid_auth,
    mid_est,
    current_product,
    viewport_service=None,
    valid_time=None,
    target_dt=None,
    background_tasks=None,
    series_stride=None,
):
    """Serve (or replace with) the clipped global_mid when the request sits in the mid span band.

    Returns the mid product to use, or None to keep `current_product` / fall through. Never replaces
    a regional/finer product — only fills a hole (current_product None) or upgrades an UNCLIPPED
    GLOBAL-span grid (the 10° coarse the estimated-hour Step 3 shortcut serves).

    ``series_stride`` (>1, grid_series frames only, never surf): the clip is decimated before it is
    returned and never enters the clip cache, whose key does not carry a stride.
    """
    if not bbox or req_w is None:
        return None
    dom = (domain or "").lower()
    if dom == "marine":
        if os.environ.get("MARINE_MID_RES_TIER", "1") == "0":
            return None
        if layer.lower() not in _MID_LAYERS:
            return None
        _lo_env, _lo_def = "MARINE_MID_RES_MIN_SPAN", "0.0"
        # MAX_SPAN 15.0 → 40.0 (2026-07-22, the "TS Bertha vanishes on zoom-out to z5.35" report):
        # a compact storm (~3.1m Hs core) lives in ONE 2° mid cell but gets block-averaged into the
        # ~0.7-1.8m ambient of a 10° global_coarse cell — so at the 15° cliff (≈z6.2 on a desktop map)
        # zooming out dropped the mid tier and the storm smeared into the background (GFS/ICON) or hit
        # the enclosed-sea mask (EURO). 40° keeps the pre-baked global_mid (clipped to the viewport,
        # LRU + semaphore guarded — cheap) active down to ~z5, the natural regional/storm-watch band;
        # genuine continental/world views (>40°) still take the 10° coarse. The clip stays tiny (a 40°
        # box @2° ≈ 400 vectors, far under _MAX_SERVEABLE_GRID_VECTORS=250k). Frontend match: the
        # request-side ceiling __RAW_MARINE_GLOBAL_SPAN__ (backendWeatherServiceClientCoverage.js) is
        # raised in lockstep so GFS/ICON/EURO request the viewport bbox (not the global bbox) up to 40°.
        # Kill / revert: MARINE_MID_RES_MAX_SPAN=15.
        # 40 → 400 (2026-07-23, USER "Bertha STILL clears further out than you tested" — the far-zoom
        # residual, forensically rooted): past 40° span the request drops to the 10° global_coarse, which
        # (a) block-averages a compact storm into the ambient — Bertha's sharp 2.74m core smears to the
        # ~1.65m of a 10° cell 4° away → she visually "clears" — and (b) STRUCTURALLY MASKS EURO's
        # enclosed-sea Gulf (is_valid=False → the frontend inflates the hole = wrong colors). The 2°
        # global_mid has NEITHER problem (Gulf valid, Bertha 2.74m). The WIND sibling already solved this
        # exact class by serving its 2° global field at EVERY zoom (WIND_MID_RES_MAX_SPAN=400, lines
        # ~147-150): "the 2-deg field IS the base at every zoom, so no box edge can exist anywhere". Do the
        # same for marine — 400° serves the FULL global_mid at world span too (the frontend globalizes to
        # the WORLD bbox past its own 40° ceiling, __RAW_MARINE_GLOBAL_SPAN__, so the tier gets a 360°
        # request → clips to world = the whole 2° field, NOT a viewport box → no clip edge, no held-clip
        # grid-patch; that box-edge is exactly why the earlier 120° VIEWPORT-clip attempt was reverted).
        # A full global_mid is ~15k vectors (180×90), far under the 250k serve cap and the same payload the
        # wind overlay already carries. USER-confirmed direction 2026-07-23 (chose "2° detail at all zooms,
        # match wind" over the lighter storm-punch-through option). Kill / revert to the coarse-at-world
        # decision: MARINE_MID_RES_MAX_SPAN=40 (or =15 for the original z6 cliff).
        _hi_env, _hi_def = "MARINE_MID_RES_MAX_SPAN", "400.0"
    elif dom == "wind":
        # WIND MID TIER (2026-07-20, queue #3 — "the clamp must fit the entire map"). The wind
        # sibling of the marine tier: serves the cron's ~2-deg wind global_mid CLIPPED wherever
        # the request would otherwise get the 10-deg coarse — wide spans past the dynamic gate
        # (WIND_DYNAMIC_MAX_SPAN_DEG), world zoom, and every dynamic-lane failure window (the
        # tier is cron-fed from quota-free NOAA, so it never rate-limits). The replace-guard
        # below keeps any regional/finer product untouched — the mid only fills holes and
        # upgrades unclipped globals. Kill: WIND_MID_RES_TIER=0.
        if os.environ.get("WIND_MID_RES_TIER", "1") == "0":
            return None
        if layer.lower() != "wind":
            return None
        # hi default 400: WORLD-SPAN wind requests (360 deg — the client's global base fetch)
        # serve the FULL global_mid (~15k vectors, far under _MAX_SERVEABLE_GRID_VECTORS) —
        # "the overlay needs to be global" (user, 2026-07-20): the 2-deg field IS the base at
        # every zoom, so no box edge can exist anywhere; fine boxes only sharpen on top.
        _lo_env, _lo_def = "WIND_MID_RES_MIN_SPAN", "0.0"
        _hi_env, _hi_def = "WIND_MID_RES_MAX_SPAN", "400.0"
    else:
        return None

    span = _request_span(req_w, req_s, req_e, req_n)
    # MIN_SPAN 2.0 → 0.0 (2026-07-12): tight surf zooms (≤2°) previously fell BELOW this floor to
    # Step 3.7's band-less global-coarse preview, so a cold / freshly-panned viewport showed NO rating
    # band for ~10-90s until the dynamic lane warmed (probed worldwide: FL pilot rated, but Taghazout /
    # Chicama / Namibia / Fiji all cold-served the 360° coarse → coarse_extent skip). The mid tier is
    # INSTANT (resident global_mid, no upstream fetch), always COVERS the viewport (padded clip → no
    # floating rectangle) and rates the coastal cells while masking/washing offshore — exactly the
    # coastal ribbon the band is — then the SWR reval below sharpens 2°→0.25° on dwell. The replace-
    # guard (below) still keeps a WARM fine viewport untouched, so this only fills a COLD hole; serving
    # mid at every zoomed span also keeps the band CONTINUOUS while panning (each new snapped viewport
    # clips instantly). Restore the old resolution cliff with MARINE_MID_RES_MIN_SPAN=2.0.
    lo = float(os.environ.get(_lo_env, _lo_def))
    hi = float(os.environ.get(_hi_env, _hi_def))
    if not (lo < span <= hi):
        return None

    # Replace-guard: only fill a hole or upgrade an unclipped global-span product.
    if current_product is not None and _grid_span(current_product) < 350.0:
        return None

    mid_item = pick_mid_item(mid_auth, mid_est)
    if mid_item is None:
        return None

    # LOAD GUARDS (2026-07-05, the 18:56Z Render OOM during a timeline scrub): a grid_series request
    # resolves 17 hours, and EACH hour L1-missed a global_mid → downloaded + parsed the FULL ~15k-vector
    # product (~15MB of Python objects) just to clip it to a few dozen cells — concurrently ≈ 250MB+
    # transient on the 512MB box. (a) A small LRU of CLIPPED results (tiny) kills repeat parses for the
    # same hour+viewport; (b) a load semaphore bounds concurrent full-product parses to 2.
    global _CLIP_CACHE, _LOAD_SEM
    try:
        _CLIP_CACHE
    except NameError:
        _CLIP_CACHE = {}
        _LOAD_SEM = asyncio.Semaphore(max(1, int(os.environ.get("MARINE_MID_LOAD_CONCURRENCY", "2"))))
    _snap = get_snapped_bbox(bbox, model)
    _ckey = f"{mid_item.filename}|{_snap}"
    _stride = _series_stride(series_stride)
    # A strided frame never reads the cache: a hit is a full-size deep copy, the cost this lane removes.
    _hit = _CLIP_CACHE.get(_ckey) if _stride <= 1 else None
    _sharpen = dict(model=model, domain=domain, layer=layer, bbox=bbox, span=span,
                    viewport_service=viewport_service, valid_time=valid_time, target_dt=target_dt,
                    background_tasks=background_tasks)
    if _hit is not None:
        import copy as _copy
        product = _copy.deepcopy(_hit)  # callers mutate (surf transform) — never hand out the cached object
        # The sharpen is THIS request's to ask for (2026-10-09). The hit used to return here, so whichever
        # request built the clip decided every later one: a timeline frame that did not sharpen (or a
        # /grid turned away by a full queue) left the viewed hour on the 2-degree clip for good.
        _schedule_sharpen(product, **_sharpen)
        return product

    # PAD BY ONE MID CELL (2026-07-05, the San Diego "clamp+clear" second-pass report): the clip keeps
    # vectors whose CENTERS fall inside the bbox, and the served grid.bounds are the outermost cell
    # centers — losing up to a HALF-CELL (~1°) ring versus the viewport. Depending on alignment the
    # coverage fraction lands under the display gate's 0.8 (live: SD viewport 29.34..34.49 vs served
    # 30..34 → ~0.73 → hidden at z<7 → wash/clamp). Pad the snap by one full mid cell each side so the
    # served grid always OVERHANGS the viewport ≥ half a cell → coverage ~1.0 deterministically.
    try:
        from services.weather_pipeline.route_helpers import parse_bbox as _pb
        _sw, _ss, _se, _sn = _pb(get_snapped_bbox(bbox, model))
        # ZOOM-OUT COVERAGE OVERHANG (2026-07-22, USER "Bertha clears + heatmap changes as I zoom
        # out"): a FIXED 2° pad let the committed mid BARELY cover the viewport, so on zoom-out the
        # growing viewport outran it and the engine's coarse-bridge promoted the 10° global for the
        # mid fetch-latency window (EURO Copernicus lag ~7-10s) = the ~5s storm-clearing flash
        # (zoomlab-proven). Overhang the clip PROPORTIONALLY to the span so the served mid keeps
        # COVERING as the viewport grows a step — this defeats the bridge's frac<0.6 trigger AT THE
        # SOURCE (coverage stays high) without touching the fortified bridge/reject/arbiter. Cheap:
        # a resident-product slice (≤~800 cells at the 40° ceiling, far under the serve cap). The 2°
        # floor keeps CLOSE zoom tight (a 1.5° surf zoom still pads 2°, not 0.75°). Kill/tune:
        # MARINE_MID_CLIP_PAD_DEG (set = old fixed pad, disables the proportional term) ·
        # MARINE_MID_CLIP_PAD_FRAC (default 0.5 → clip ≈ 2× viewport ≈ covers a 2× zoom-out step) ·
        # MARINE_MID_CLIP_PAD_MAX (cap, default 12°).
        _pad_fixed = os.environ.get("MARINE_MID_CLIP_PAD_DEG")
        if _pad_fixed is not None:
            _pad = float(_pad_fixed)
        else:
            _frac = float(os.environ.get("MARINE_MID_CLIP_PAD_FRAC", "0.5"))
            _cap = float(os.environ.get("MARINE_MID_CLIP_PAD_MAX", "12.0"))
            _pad = min(_cap, max(2.0, _frac * span))
        _pw = max(-180.0, _sw - _pad); _ps = max(-80.0, _ss - _pad)
        _pe = min(180.0, _se + _pad); _pn = min(85.0, _sn + _pad)
        _clip = f"{_pw:.4f},{_ps:.4f},{_pe:.4f},{_pn:.4f}"
    except Exception:
        _clip = None    # clipped to the snapped bbox below, as before

    # A world series frame reads the file pre-strided when the clip will provably keep every cell (THE
    # STRIDED WORLD READ above); anything unproven reads the grid whole, exactly as before.
    _try_strided = (_stride > 1 and _clip is not None and os.environ.get("MARINE_MID_SERIES_LOAD_STRIDE", "1") != "0"
                    and _window_covers(_clip, mid_item.coverage) and _store_takes_stride(store))
    _identity = None
    async with _LOAD_SEM:
        if _try_strided:
            candidate_product = await asyncio.to_thread(store.load_product, mid_item.filename, stride=_stride)
            _identity = _identity_clip_bounds(candidate_product, _clip, _stride) if candidate_product else None
            if _identity is None and candidate_product and candidate_product.grid and \
                    (candidate_product.grid.diagnostics or {}).get("load_stride"):
                candidate_product = await asyncio.to_thread(store.load_product, mid_item.filename)
        else:
            candidate_product = await asyncio.to_thread(store.load_product, mid_item.filename)
    if not candidate_product or not candidate_product.grid:
        return None
    if _is_oversized_grid(candidate_product):
        logger.warning(f"[Grid Resolver] Skipping oversized global_mid product {mid_item.filename} in Step 3.6.")
        return None

    product = candidate_product
    product.product_id = mid_item.filename
    product.coverage_scope = "regional"      # served clipped → regional-like on the client
    product.coverage_mode = "regional_tile"  # so filter_grid_to_bbox clips it below
    product.partial_coverage = False
    product.requested_bbox_original = bbox
    product.query_bbox = bbox
    product.requested_bbox = bbox
    if _identity is not None:
        _apply_identity_clip(product, _clip, _identity)
        _strided = True
    else:
        try:
            if _clip is None:
                raise ValueError("no padded clip window")
            product = filter_grid_to_bbox(product, _clip)
        except Exception:
            product = filter_grid_to_bbox(product, get_snapped_bbox(bbox, model))
        _strided = _stride > 1 and _stride_clipped_grid(product, _stride, thinning_mode(layer, domain))
    if product.grid:
        # The clip's grid is its own container, but its `diagnostics` is still the L1 entry's dict
        # (load_product and filter_grid_to_bbox copy one level), and stored grids carry a non-None
        # one. Copy it before stamping, as #210's _stride_clipped_grid does for `load_stride`: an
        # in-place write put this key, and the resolver's per-request stamps after it, into the
        # cached global_mid, and one request's stamps into another's response (2026-10-01,
        # tests/test_mid_tier_shared_diagnostics.py).
        diagnostics = dict(product.grid.diagnostics or {})
        diagnostics["mid_res_tier"] = True  # surf gate keeps this coarse-ish tier honest
        product.grid.diagnostics = diagnostics
        if product.grid.bounds:
            product.served_bbox = (
                f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},"
                f"{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
            )
    # Store the fully-built CLIPPED product in the LRU; hits deepcopy it out. Only a SMALL clip: a world
    # clip is the whole ~15k-vector grid, so its deep copy cost more than rebuilding it (see
    # _clip_cacheable). A strided series frame never goes in -- the key has no stride, and /grid reads it.
    # Stored BEFORE the sharpen: its SWR stamps belong to this request, never to the cache (2026-10-09).
    if not _strided and _clip_cacheable(product):
        try:
            import copy as _copy2
            _CLIP_CACHE[_ckey] = _copy2.deepcopy(product)
            if len(_CLIP_CACHE) > int(os.environ.get("MARINE_MID_CLIP_CACHE_MAX", "24")):
                _CLIP_CACHE.pop(next(iter(_CLIP_CACHE)))  # FIFO evict oldest
        except Exception:
            pass
    _schedule_sharpen(product, **_sharpen)
    logger.info(
        f"[Grid Route] Mid-res tier: serving global_mid '{mid_item.filename}' clipped to viewport "
        f"({span:.1f}°) for {model} {layer}"
        + (" [estimated mirror hour]" if getattr(mid_item, "is_estimated", False) else "")
        + (" [replaced unclipped global]" if current_product is not None else "")
        + (" [SWR → fine reval scheduled]" if getattr(product, "cache_hit", None) == "mid_res_preview" else "")
        + " — regional-quality at zoom-out."
    )
    return product

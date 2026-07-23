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

from services.weather_pipeline.route_helpers import filter_grid_to_bbox, get_snapped_bbox
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
):
    """Serve (or replace with) the clipped global_mid when the request sits in the mid span band.

    Returns the mid product to use, or None to keep `current_product` / fall through. Never replaces
    a regional/finer product — only fills a hole (current_product None) or upgrades an UNCLIPPED
    GLOBAL-span grid (the 10° coarse the estimated-hour Step 3 shortcut serves).
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
    _hit = _CLIP_CACHE.get(_ckey)
    if _hit is not None:
        import copy as _copy
        product = _copy.deepcopy(_hit)  # callers mutate (surf transform) — never hand out the cached object
        return product

    async with _LOAD_SEM:
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
        product = filter_grid_to_bbox(product, f"{_pw:.4f},{_ps:.4f},{_pe:.4f},{_pn:.4f}")
    except Exception:
        product = filter_grid_to_bbox(product, get_snapped_bbox(bbox, model))
    if product.grid:
        if product.grid.diagnostics is None:
            product.grid.diagnostics = {}
        product.grid.diagnostics["mid_res_tier"] = True  # surf gate keeps this coarse-ish tier honest
        if product.grid.bounds:
            product.served_bbox = (
                f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},"
                f"{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
            )
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
    if dom == "wind":
        _reval_cap = float(os.environ.get("WIND_MID_REVAL_MAX_SPAN", "20.0"))
    else:
        _reval_cap = float(os.environ.get("MARINE_MID_REVAL_MAX_SPAN", "8.0"))
    # QUEUE CAP (2026-07-05 OOM #3): a 17-hour grid_series scheduled 17 revals in one burst — the
    # semaphore serialized them but the queue ground the box for minutes. Cap the OUTSTANDING reval
    # queue; skipped hours sharpen on a later request (the user dwells on one hour at a time anyway).
    _reval_queue_max = int(os.environ.get("MARINE_REVAL_QUEUE_MAX", "2"))
    if (
        viewport_service is not None and valid_time is not None
        and span <= _reval_cap
        and len(getattr(viewport_service, "ACTIVE_REVALIDATIONS", ())) < _reval_queue_max
        and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox, target_dt=target_dt)
    ):
        product.stale = True
        product.staleReason = "swr_revalidation_pending"
        product.cache_hit = "mid_res_preview"
        reval_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{valid_time}_{bbox}"
        if reval_key not in viewport_service.ACTIVE_REVALIDATIONS:
            viewport_service.ACTIVE_REVALIDATIONS.add(reval_key)
            if background_tasks:
                background_tasks.add_task(
                    viewport_service._revalidate_fetch,
                    model, domain, layer, valid_time, target_dt, bbox, reval_key
                )
            else:
                asyncio.create_task(
                    viewport_service._revalidate_fetch(
                        model, domain, layer, valid_time, target_dt, bbox, reval_key
                    )
                )
    # Store the fully-built CLIPPED product (tiny, ~dozens of cells) in the LRU; hits deepcopy it out.
    try:
        import copy as _copy2
        _CLIP_CACHE[_ckey] = _copy2.deepcopy(product)
        if len(_CLIP_CACHE) > int(os.environ.get("MARINE_MID_CLIP_CACHE_MAX", "24")):
            _CLIP_CACHE.pop(next(iter(_CLIP_CACHE)))  # FIFO evict oldest
    except Exception:
        pass
    logger.info(
        f"[Grid Route] Mid-res tier: serving global_mid '{mid_item.filename}' clipped to viewport "
        f"({span:.1f}°) for {model} {layer}"
        + (" [estimated mirror hour]" if getattr(mid_item, "is_estimated", False) else "")
        + (" [replaced unclipped global]" if current_product is not None else "")
        + (" [SWR → fine reval scheduled]" if getattr(product, "cache_hit", None) == "mid_res_preview" else "")
        + " — regional-quality at zoom-out."
    )
    return product

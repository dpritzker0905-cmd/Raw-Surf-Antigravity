"""The offline harness's STALE WINDOW (split from serve_synthetic.py 2026-11-09, unchanged; it re-exports these names)."""


# STALE WINDOW (2026-10-21, the client's SWR_BACKOFF ladder): production answers a viewport whose fine grid is still being built
# with an instant coarse preview labelled stale ("swr_revalidation_pending": grid_resolver Step 3.5 / 3.7, mid_res_tier), and only
# the CLIENT's re-ask pulls the sharpened grid once the background revalidation lands. The synthetic store never answered stale, so
# that loop could not be replayed. With a window armed, every matching /grid reply (never a /grid_series frame) is the resolver's
# own product made stale and coarse (every `stride`-th latitude and longitude, so the fresh reply is told apart by its cols) until
# the window ends; then the same request is answered fresh. Arm it per step over HTTP (the lab does), or from the command line:
#   GET /__lab/stale?seconds=N&scope=world|regional|any&model=GFS&layer=waves&stride=3   (re)arms NOW for N s and clears the log
#   GET /__lab/stale/status                                                              the window and every matching /grid
#   --stale-seconds N [--stale-scope ... --stale-model ... --stale-layer ... --stale-stride ...]   arms at the first matching /grid
# scope: world = a /grid whose bbox spans >= 340 deg of longitude (or no bbox), regional = narrower, any = both.
STALE = {"armed_at": None, "until": None, "seconds": 0.0, "scope": "any", "model": None, "layer": None, "stride": 3,
         "arm_on_first": False, "log": []}


def _lng_span(bbox):
    try:
        w, _s, e, _n = (float(x) for x in str(bbox).split(","))
    except (TypeError, ValueError):
        return 360.0
    return e - w if e > w else e + 360.0 - w


def stale_window_matches(model, domain, layer, bbox, cfg=None):
    """Does a /grid request fall under the configured window's filter (marine only)?"""
    cfg = cfg or STALE
    if str(domain).lower() != "marine" or not cfg["seconds"]:
        return False
    if cfg["model"] and str(model).upper() != cfg["model"].upper():
        return False
    if cfg["layer"] and str(layer) != cfg["layer"]:
        return False
    world = bbox is None or _lng_span(bbox) >= 340.0
    return cfg["scope"] == "any" or (cfg["scope"] == "world") == world


def coarsen_stale(product, stride):
    """A copy of `product` as production's SWR preview looks: stale, staleReason swr_revalidation_pending, on every `stride`-th
    latitude and longitude of the served lattice (bounds from the kept cells). None when there is no grid to coarsen."""
    grid = getattr(product, "grid", None)
    vectors = list(getattr(grid, "vectors", None) or [])
    if not vectors:
        return None
    keep_lat = set(sorted({v.lat for v in vectors})[::stride])
    keep_lng = set(sorted({v.lng for v in vectors})[::stride])
    kept = [v for v in vectors if v.lat in keep_lat and v.lng in keep_lng]
    bounds = type(grid.bounds)(west=min(keep_lng), south=min(keep_lat), east=max(keep_lng), north=max(keep_lat))
    new_grid = grid.model_copy(update={
        "vectors": kept, "cols": len(keep_lng), "rows": len(keep_lat), "bounds": bounds,
        "diagnostics": {**(grid.diagnostics or {}), "source": "lab_stale_window", "lab_stride": stride}})
    return product.model_copy(update={
        "grid": new_grid, "stale": True, "staleReason": "swr_revalidation_pending", "cache_hit": "lab_stale_window",
        "served_bbox": f"{bounds.west:.4f},{bounds.south:.4f},{bounds.east:.4f},{bounds.north:.4f}"})


def arm_stale_window(seconds, scope="any", model=None, layer=None, stride=3, now=None):
    """(Re)arm the window from `now` (epoch s) for `seconds`, with an empty log. Returns the state."""
    import time
    now = time.time() if now is None else now
    if scope not in ("world", "regional", "any"):
        raise ValueError("scope must be world, regional or any")
    STALE.update({"armed_at": now, "until": now + float(seconds), "seconds": float(seconds), "scope": scope,
                  "model": model or None, "layer": layer or None, "stride": max(2, int(stride)), "arm_on_first": False,
                  "log": []})
    return stale_status()


def stale_status():
    return {k: STALE[k] for k in ("armed_at", "until", "seconds", "scope", "model", "layer", "stride", "arm_on_first")} | {
        "log": list(STALE["log"])}


def install_stale_window(app):
    """Wrap grid_resolver.resolve_grid (the /grid route imports it per call) and add the /__lab/stale control routes."""
    import time
    from fastapi.responses import JSONResponse
    from services.weather_pipeline import grid_resolver
    original = grid_resolver.resolve_grid

    memo = {}   # --stale-fast: one resolve per request while the window is on (production serves its SWR preview from cache)

    async def resolve_grid(store, viewport_service, **kw):
        t_in = time.time()
        request = kw.get("request")
        path = getattr(getattr(request, "url", None), "path", "") or ""
        if not path.endswith("/weather/grid") or not stale_window_matches(kw.get("model"), kw.get("domain"), kw.get("layer"),
                                                                          kw.get("bbox")):
            return await original(store, viewport_service, **kw)
        if STALE["arm_on_first"]:
            arm_stale_window(STALE["seconds"], STALE["scope"], STALE["model"], STALE["layer"], STALE["stride"], now=t_in)
        stale = STALE["until"] is not None and t_in < STALE["until"]
        key = tuple(str(kw.get(k)) for k in ("model", "domain", "layer", "valid_time", "bbox", "surf"))
        if stale and STALE.get("fast") and key in memo:
            product = memo[key]
        else:
            product = await original(store, viewport_service, **kw)
            if stale and STALE.get("fast"):
                memo[key] = product
        cols = getattr(getattr(product, "grid", None), "cols", None)
        served = coarsen_stale(product, STALE["stride"]) if stale else None
        STALE["log"].append({"t_in_ms": round(t_in * 1000), "t_out_ms": round(time.time() * 1000), "stale": served is not None,
                             "valid_time": kw.get("valid_time"), "bbox": kw.get("bbox"), "fresh_cols": cols,
                             "served_cols": served.grid.cols if served is not None else cols,
                             "resolver_stale": bool(getattr(product, "stale", False))})
        return served if served is not None else product
    grid_resolver.resolve_grid = resolve_grid

    async def lab_stale(seconds: float = 0.0, scope: str = "any", model: str = "", layer: str = "", stride: int = 3):
        try:
            return JSONResponse(arm_stale_window(seconds, scope, model, layer, stride))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

    async def lab_stale_status():
        return JSONResponse(stale_status())
    app.add_api_route("/__lab/stale", lab_stale, methods=["GET"])
    app.add_api_route("/__lab/stale/status", lab_stale_status, methods=["GET"])

"""
Step 3.6 MID-RES GLOBAL TIER (grid_resolver.resolve_grid), the z6-7 coarse-lattice quality upgrade.

Between the close-zoom regional 0.25° tiles and the 10° global_coarse there was a resolution cliff: a
z6-7 viewport (span 2-15°) wider than any regional tile fell to the 10° global — <1 cell across an ~8°
viewport, a uniform crest lattice + flat color. The resolver must instead serve the pre-computed
`global_mid` product CLIPPED to the viewport, so its served span<350 and the client renders it as a
regional-quality fine grid. These tests exercise the tier directly (it is gated off under is_test_env).
"""
import asyncio
import types
from datetime import datetime, timezone

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)
from services.weather_pipeline import grid_resolver

_VT = "2026-06-21T12:00:00Z"
_VT_DT = datetime(2026, 6, 21, 12, 0, 0, tzinfo=timezone.utc)


def test_mid_jobs_run_in_pilots_lane():
    """The mid-res jobs moved to the PILOTS lane (2026-07-05): in the core cycle their ~45-55 min tipped
    run 28726329418 into the 165-min timeout during the calibration tail. Lock them inside pilot_jobs
    (after the pilots comment block, before the core wind trio would re-appear) so a refactor can't
    silently move them back and re-break the core budget."""
    import inspect
    from scheduler import forecast
    src = inspect.getsource(forecast.ingest_marine_forecast_task)
    for fn in ("ingest_gfs_marine_global_mid", "ingest_icon_marine_global_mid", "ingest_euro_marine_global_mid"):
        assert fn in src, f"{fn} is not scheduled in ingest_marine_forecast_task"
        assert src.index("pilot_jobs = [") < src.index(fn), \
            f"{fn} must live in pilot_jobs (the pilots workflow budget), not core_jobs (165-min timeout)"


def test_extended_estimates_covers_global_mid_region():
    """The EURO 240→336h estimated extension must MIRROR onto the mid tier: the region-parameterized
    extended-estimates machinery has to iterate region 'global_mid' (a per-layer no-op until EURO mid
    anchors exist)."""
    import inspect
    from services.weather_pipeline.scheduler_helpers import ingest_euro_marine_extended_estimates_impl
    src = inspect.getsource(ingest_euro_marine_extended_estimates_impl)
    assert '"global_mid"' in src, "extended-estimates must process region 'global_mid' (the blend mirror)"


def test_scheduler_exposes_all_mid_res_methods():
    """Guard the ingest side of the tier: a typo'd/renamed method would be swallowed by the task's
    per-job try/except and silently ship no global_mid product (so the resolver tier stays a no-op)."""
    import inspect
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    for name in ("ingest_gfs_marine_global_mid", "ingest_icon_marine_global_mid", "ingest_euro_marine_global_mid"):
        m = getattr(WeatherPipelineScheduler, name, None)
        assert m is not None, f"WeatherPipelineScheduler is missing {name}"
        assert inspect.iscoroutinefunction(m), f"{name} must be async"


def _make_mid_product():
    """A ~2° global GFS-waves product whose vectors span the CA coast viewport (lng -126..-118, lat 32..40)."""
    vecs = []
    lat = 32.0
    while lat <= 40.0:
        lng = -126.0
        while lng <= -118.0:
            vecs.append(GridVector(lat=lat, lng=lng, speed=1.7, u=1.0, v=0.5))
            lng += 2.0
        lat += 2.0
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)  # global extent in storage
    grid = NormalizedGrid(bounds=bounds, cols=180, rows=90, vectors=vecs)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id="gfs_marine_waves_global_mid_x.json",
    )


def _mid_manifest_item():
    return types.SimpleNamespace(
        model="GFS", domain="marine", layer="waves",
        valid_time_start=_VT_DT, is_estimated=False,
        coverage=CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0),
        filename="gfs_marine_waves_global_mid_x.json",
        region_id="global_mid", coverage_mode="global_tile",
    )


class _FakeStore:
    def __init__(self, items, product):
        self._items = items
        self._product = product
        self.loaded = []

    def get_manifest(self):
        return types.SimpleNamespace(products=self._items)

    def load_product(self, filename):
        self.loaded.append(filename)
        return self._product


class _FakeViewport:
    def __init__(self):
        self.ACTIVE_REVALIDATIONS = set()
        self.upstream_called = False
        self.preview_called = False

    def is_viewport_enabled(self, *a, **k):
        return True

    async def get_cached_dynamic_product(self, **k):
        return None

    async def _find_any_cached_product(self, *a, **k):
        self.preview_called = True
        return None

    async def _revalidate_fetch(self, *a, **k):
        pass

    async def fetch_viewport_grid_upstream(self, **k):
        self.upstream_called = True
        return None


def _resolve(store, vp, monkeypatch, bbox):
    import services.weather_pipeline.store as store_mod
    monkeypatch.setattr(store_mod, "is_test_environment", lambda: False)
    # The clipped-result LRU keys by filename (content identity in prod) — fakes reuse filenames
    # across tests with different payloads, so clear it per resolve.
    from services.weather_pipeline import mid_res_tier as _mrt
    if hasattr(_mrt, "_CLIP_CACHE"):
        _mrt._CLIP_CACHE.clear()
    return asyncio.run(grid_resolver.resolve_grid(
        store, vp, model="GFS", domain="marine", layer="waves",
        valid_time=_VT, bbox=bbox,
    ))


def test_mid_res_tier_serves_global_mid_clipped_at_zoom_out(monkeypatch):
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    # ~8° viewport (z6-7): wider than any regional tile, narrower than a continental view.
    out = _resolve(store, vp, monkeypatch, bbox="-126,32,-118,40")

    assert out is not None
    assert out.coverage_scope == "regional"                       # served clipped → regional-like
    assert out.grid.diagnostics.get("mid_res_tier") is True
    # Clipped: served longitude span must be well under the 350° global threshold.
    b = out.grid.bounds
    span = (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
    assert span < 350.0
    assert vp.upstream_called is False                            # did NOT block on upstream
    assert vp.preview_called is False                             # took precedence over the coarse preview


def test_mid_res_tier_serves_tight_surf_zoom(monkeypatch):
    """TIGHT-ZOOM COLD BAND (2026-07-12): a ≤2° surf-zoom viewport must ALSO get the instant mid
    coastal band (MIN_SPAN floor dropped 2.0 → 0.0). Before, spans ≤2° fell below the floor to the
    band-less global-coarse preview → a cold / freshly-panned viewport showed NO rating band until the
    dynamic lane warmed. This guards the floor from silently creeping back up and re-opening that gap."""
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-125,33,-123.5,34.5")  # 1.5° span — the old dead-zone

    assert out is not None
    assert out.grid.diagnostics.get("mid_res_tier") is True, "tight surf zoom must serve the mid band"
    assert out.cache_hit == "mid_res_preview"                     # instant + stale, sharpens on dwell
    assert len(vp.ACTIVE_REVALIDATIONS) == 1, "fine-viewport revalidation must be scheduled"
    assert vp.upstream_called is False                            # did NOT block on upstream
    assert vp.preview_called is False                             # took precedence over the coarse preview


def test_mid_res_tier_min_span_floor_restorable(monkeypatch):
    """The old resolution cliff stays available as a kill switch: MARINE_MID_RES_MIN_SPAN=2.0 restores
    the pre-2026-07-12 behavior where a 1.5° span skips the mid tier (falls to the coarse preview)."""
    monkeypatch.setenv("MARINE_MID_RES_MIN_SPAN", "2.0")
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-125,33,-123.5,34.5")  # 1.5° span < 2.0 floor
    assert not (out is not None and out.grid and out.grid.diagnostics
                and out.grid.diagnostics.get("mid_res_tier")), "1.5° must skip mid when floor=2.0"
    assert vp.preview_called is True


def test_mid_res_tier_skipped_for_continental_view(monkeypatch):
    """A wide (>120°) view is a genuine world/hemispheric zoom-out — keep the coarse path, not the
    mid tier (ceiling raised 15→40→120 for the EURO enclosed-sea zoom-out; a 159×90° view is past it)."""
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-179,-40,-20,50")  # ~159°×90° hemispheric
    # Mid tier must NOT fire → falls through to the coarse-preview path (which returns None here).
    assert not (out is not None and out.grid and out.grid.diagnostics
                and out.grid.diagnostics.get("mid_res_tier"))


def _make_gulf_mid_product():
    """A ~2° global-extent mid product with vectors spanning a wide Gulf/W-Atlantic box
    (lng -100..-70, lat 14..40), carrying a compact 'Bertha' storm peak (3.1m) at (28,-88).
    Used to prove the z5 zoom-out (span ~30°) keeps the storm-resolved 2° mid, not the 10° coarse."""
    vecs = []
    lat = 14.0
    while lat <= 40.0:
        lng = -100.0
        while lng <= -70.0:
            # Compact storm core at (28,-88): 3.1m; calm ambient elsewhere: 0.7m
            h = 3.1 if (abs(lat - 28.0) < 1.5 and abs(lng - (-88.0)) < 1.5) else 0.7
            vecs.append(GridVector(lat=lat, lng=lng, speed=h, u=h, v=0.0))
            lng += 2.0
        lat += 2.0
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)  # global extent in storage
    grid = NormalizedGrid(bounds=bounds, cols=180, rows=90, vectors=vecs)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id="gfs_marine_waves_global_mid_gulf.json",
    )


def test_mid_res_tier_serves_at_z5_zoomout_keeping_storm_resolved(monkeypatch):
    """THE FIX (2026-07-22, "TS Bertha vanishes on zoom-out to z5.35"): a ~30° span (≈z5 on a
    desktop map) must now serve the clipped 2° mid — NOT drop to the 10° coarse where a compact
    storm smears into the ambient. Ceiling default is 40°, so a 30° request is inside the band."""
    store = _FakeStore([_mid_manifest_item()], _make_gulf_mid_product())
    vp = _FakeViewport()
    # ~30°×22° viewport over the Gulf/Florida — the z5.35 zoom the user reported.
    out = _resolve(store, vp, monkeypatch, bbox="-99,17,-69,39")

    assert out is not None
    assert out.grid.diagnostics.get("mid_res_tier") is True, "z5 zoom-out must serve the 2° mid tier"
    assert out.coverage_scope == "regional"
    # Clipped, not the unclipped 10° global.
    b = out.grid.bounds
    span = (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
    assert span < 350.0
    # The storm survives at 2° resolution: the (28,-88) core is still 3.1m in the served grid.
    peak = max((v.speed for v in out.grid.vectors), default=0.0)
    assert peak >= 3.0, f"storm core must survive the 2° mid clip (got peak {peak})"


def test_mid_res_tier_z5_reverts_to_coarse_under_kill_switch(monkeypatch):
    """Kill switch / A-B pin: MARINE_MID_RES_MAX_SPAN=15 restores the pre-fix cliff — the same 30°
    zoom-out then SKIPS the mid tier (falls through to the coarse path), reproducing the bug."""
    monkeypatch.setenv("MARINE_MID_RES_MAX_SPAN", "15.0")
    store = _FakeStore([_mid_manifest_item()], _make_gulf_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-99,17,-69,39")  # 30° span > 15° cap
    assert not (out is not None and out.grid and out.grid.diagnostics
                and out.grid.diagnostics.get("mid_res_tier")), "30° must skip mid when ceiling=15"


def _make_wide_mid_product():
    """A ~2° global-extent mid product with vectors across a WIDE W-Atlantic/Gulf box
    (lng -140..-40, lat 0..50) — wide enough to exercise the zoom-out coverage OVERHANG pad."""
    vecs = []
    lat = 0.0
    while lat <= 50.0:
        lng = -140.0
        while lng <= -40.0:
            vecs.append(GridVector(lat=lat, lng=lng, speed=0.9, u=0.9, v=0.0))
            lng += 2.0
        lat += 2.0
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    grid = NormalizedGrid(bounds=bounds, cols=180, rows=90, vectors=vecs)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id="gfs_marine_waves_global_mid_wide.json",
    )


def _served_span(out):
    b = out.grid.bounds
    return (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)


def test_mid_clip_overhang_proportional_on_zoomout(monkeypatch):
    """ZOOM-OUT COVERAGE OVERHANG (2026-07-22, "Bertha clears + heatmap changes as I zoom out"): a
    wide (24°) mid serve must OVERHANG the viewport by the proportional pad (~0.5×span, cap 12°) so
    it keeps COVERING as the viewport grows a step — this is what defeats the engine coarse-bridge
    (frac<0.6) that cleared the storm on the (slow-fetch) EURO zoom-out. Served span >> the old
    fixed-2°-pad span."""
    store = _FakeStore([_mid_manifest_item()], _make_wide_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-96,16,-72,38")  # 24° span
    assert out is not None and out.grid.diagnostics.get("mid_res_tier") is True
    assert _served_span(out) > 24 + 6, f"served mid must overhang the 24° viewport past the old 2° pad (got {_served_span(out):.1f}°)"


def test_mid_clip_pad_floor_keeps_tight_zoom_tight(monkeypatch):
    """The proportional pad has a 2° FLOOR: a 1.5° surf zoom must NOT balloon (stays ~viewport+2°)."""
    store = _FakeStore([_mid_manifest_item()], _make_wide_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-81,27,-79.5,28.5")  # 1.5° span
    assert out is not None and out.grid.diagnostics.get("mid_res_tier") is True
    assert _served_span(out) < 1.5 + 8, "tight zoom must stay tight (2° floor, not proportional)"


def test_mid_clip_pad_fixed_kill_switch(monkeypatch):
    """MARINE_MID_CLIP_PAD_DEG restores the OLD fixed pad (disables the proportional overhang)."""
    monkeypatch.setenv("MARINE_MID_CLIP_PAD_DEG", "2.0")
    store = _FakeStore([_mid_manifest_item()], _make_wide_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-96,16,-72,38")  # 24° span
    assert _served_span(out) < 24 + 10, f"fixed-pad kill-switch serves ~viewport+2°/side (got {_served_span(out):.1f}°)"


def _make_coarse_product(is_estimated=False):
    """A 10° global_coarse product (global extent, 37x17-ish sparse vectors over the CA viewport)."""
    vecs = []
    lat = 30.0
    while lat <= 40.0:
        lng = -130.0
        while lng <= -110.0:
            vecs.append(GridVector(lat=lat, lng=lng, speed=1.2, u=0.8, v=0.4))
            lng += 10.0
        lat += 10.0
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    grid = NormalizedGrid(bounds=bounds, cols=37, rows=17, vectors=vecs)
    p = NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=_VT_DT, valid_time=_VT_DT,
        is_forecast_authoritative=not is_estimated, is_estimated=is_estimated, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800,
        product_id="gfs_marine_waves_global_coarse_x.json",
    )
    return p


def _coarse_manifest_item(is_estimated=False):
    return types.SimpleNamespace(
        model="GFS", domain="marine", layer="waves",
        valid_time_start=_VT_DT, is_estimated=is_estimated,
        coverage=CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0),
        filename="gfs_marine_waves_global_coarse_x.json",
        region_id="global_coarse", coverage_mode="global_tile",
    )


def _mid_manifest_item_estimated():
    it = _mid_manifest_item()
    it.is_estimated = True
    return it


class _FakeMultiStore:
    """Store serving multiple products keyed by filename (Step 3 loads coarse; Step 3.6 loads mid)."""
    def __init__(self, items, products_by_filename):
        self._items = items
        self._products = products_by_filename
        self.loaded = []

    def get_manifest(self):
        return types.SimpleNamespace(products=self._items)

    def load_product(self, filename):
        self.loaded.append(filename)
        return self._products.get(filename)


def test_estimated_hour_serves_estimated_mid_replacing_unclipped_coarse(monkeypatch):
    """THE BLEND MIRROR: at an hour where only ESTIMATED products exist (EURO tails / extended
    estimates), Step 3's estimated shortcut serves the UNCLIPPED 10° coarse global — the tier must
    REPLACE it with the clipped estimated global_mid so scrubbing past a native horizon keeps mid-res
    quality, with estimate provenance flowing from the product unmodified."""
    mid = _make_mid_product()
    mid.is_estimated = True
    mid.is_forecast_authoritative = False
    store = _FakeMultiStore(
        [_coarse_manifest_item(is_estimated=True), _mid_manifest_item_estimated()],
        {
            "gfs_marine_waves_global_coarse_x.json": _make_coarse_product(is_estimated=True),
            "gfs_marine_waves_global_mid_x.json": mid,
        },
    )
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-126,32,-118,40")

    assert out is not None
    assert out.grid.diagnostics.get("mid_res_tier") is True, "estimated hour must serve the mid mirror"
    assert out.is_estimated is True, "estimate provenance must flow through unmodified"
    b = out.grid.bounds
    span = (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
    assert span < 350.0, "the replacing mid must be served CLIPPED"


def test_world_zoom_never_serves_global_mid(monkeypatch):
    """DETERMINISM GUARD: global_mid ties with global_coarse in the generic selection (same coverage,
    same valid_times) and would win/lose by MANIFEST ORDER — a wide/world request must ALWAYS serve the
    629-vector coarse, never the ~15k-vector mid, regardless of manifest ordering."""
    for order in ("mid_first", "coarse_first"):
        items = [_mid_manifest_item(), _coarse_manifest_item()] if order == "mid_first" \
            else [_coarse_manifest_item(), _mid_manifest_item()]
        store = _FakeMultiStore(items, {
            "gfs_marine_waves_global_coarse_x.json": _make_coarse_product(),
            "gfs_marine_waves_global_mid_x.json": _make_mid_product(),
        })
        vp = _FakeViewport()
        out = _resolve(store, vp, monkeypatch, bbox="-179,-40,-20,50")  # ~159°x90° world/hemispheric (> 120° ceiling)
        assert out is not None, f"({order}) wide request must serve a product"
        assert out.product_id == "gfs_marine_waves_global_coarse_x.json", \
            f"({order}) wide request must serve global_coarse, got {out.product_id}"
        assert not (out.grid and out.grid.diagnostics and out.grid.diagnostics.get("mid_res_tier")), \
            f"({order}) mid tier must not fire on a wide request"


def test_mid_res_tier_swr_revalidation_for_small_spans(monkeypatch):
    """#2 SWR sharpen: spans ≤ MARINE_MID_REVAL_MAX_SPAN (5°) serve the mid INSTANTLY but stale, with a
    background fine-viewport revalidation scheduled (the pre-mid steady state for these spans was the
    0.25° dynamic product — the tier must not silently remove that)."""
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-124,33,-121,36")  # 3° span ≤ 5° cap

    assert out is not None
    assert out.grid.diagnostics.get("mid_res_tier") is True
    assert out.stale is True
    assert out.staleReason == "swr_revalidation_pending"
    assert out.cache_hit == "mid_res_preview"
    assert len(vp.ACTIVE_REVALIDATIONS) == 1, "fine-viewport revalidation must be scheduled"


def test_mid_res_tier_no_revalidation_for_wide_spans(monkeypatch):
    """Wide zoom-outs (span > 8° — the cap tracks the frontend's 30% fetch-pad: raw ~5° × pad) keep
    the mid steady-state — a >8° fine upstream fetch is a heavy call the pre-mid path never made."""
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-128,30,-116,42")  # 12° span > 8° cap

    assert out is not None
    assert out.grid.diagnostics.get("mid_res_tier") is True
    assert getattr(out, "cache_hit", None) != "mid_res_preview"
    assert len(vp.ACTIVE_REVALIDATIONS) == 0, "no heavy fine fetch for wide spans"


def test_mid_res_tier_kill_switch(monkeypatch):
    monkeypatch.setenv("MARINE_MID_RES_TIER", "0")
    store = _FakeStore([_mid_manifest_item()], _make_mid_product())
    vp = _FakeViewport()
    out = _resolve(store, vp, monkeypatch, bbox="-126,32,-118,40")
    # Disabled → tier never serves the mid product; the preview path runs instead.
    assert not (out is not None and out.grid and out.grid.diagnostics
                and out.grid.diagnostics.get("mid_res_tier"))
    assert vp.preview_called is True

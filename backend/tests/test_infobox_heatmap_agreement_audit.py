"""Infobox vs heatmap: do they show the SAME, CORRECT number? (audit 2026-10-27, offline only)

Owner, 2026-10-27: "Display correct data on heat map and in infobox." This file is the offline
instrument for that audit. It never touches the network or the live backend.

Three parts:

A. GOLDEN VALUES through the ONE chain. `/point` produces `surf_height_m` at exactly one site
   (`point_surf_augment.augment_with_surf`) and the reference rating is `spot_ratings.rate_one_spot`,
   which reads that same response. A fake resolver feeds a pinned offshore sea through the REAL
   augment, then `rate_one_spot`. Agreement between surfaces proves consistency, not truth; these
   rows pin what the chain says so a drift is caught. The Pipeline rows are CLAUDE.md's sweep
   (14 s, 315 deg, 5 kt from 45 deg).

B. NUMERIC AGREEMENT between what `/point` returns (the infobox's offshore Swell) and what the
   heatmap paints at the same coordinate. The heatmap is one RGBA8 texel per stored node, height in
   the B byte (dark: floor(h / 10 * 255); light/beach: round(h / 16 * 255)), sampled by the GPU with
   LINEAR filtering (WebGLMarineTextureEncoder.js:341-346, :490). `/point` is `PointSampler.sample_point`.

C. BOUNDARY FRAME PICKS. Which stored frame answers a given hour: `/point` uses
   `manifest_point_selection.choose_for_point` (an estimate within 30 min beats an authoritative frame
   farther than 30 min). The world/mid-zoom heatmap uses `mid_res_tier.pick_mid_item` (authoritative
   first, MID_RES_EXACT_TIME_ESTIMATE=0 default) and the CDN frame store `staticFrameCodec.pickIndexFrame`
   (authoritative first within 3 h, earlier frame on a tie), ported below.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.schemas import (  # noqa: E402
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedPointDetail,
    NormalizedPointResponse, NormalizedProduct,
)

T0 = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
VT = "2026-10-27T12:00:00Z"
M_TO_FT = 3.28084

# Flags that change the chain's numbers. Pinned to their code defaults so the golden rows describe
# the default composition, whatever the developer's shell exports.
_CHAIN_FLAGS = (
    "SURF_TRANSFORM", "SURF_PARTITIONS", "SURF_TIDE_DEPTH", "SURF_NEARSHORE_MOP", "RATING_LOCAL_SIZE",
    "RATING_TIDE", "RATING_BREAKER_TYPE", "SURF_CAP_SEAM_MONOTONE", "SHORE_NORMAL_ASSET",
    "SURF_V3_NORMAL_OVERRIDES", "SAMPLER_SCALAR_HEIGHT", "SAMPLER_SCALAR_HEIGHT_MODELS",
    "MID_RES_EXACT_TIME_ESTIMATE", "POINT_RES_TIEBREAK",
)


@pytest.fixture
def default_flags(monkeypatch):
    for name in _CHAIN_FLAGS:
        monkeypatch.delenv(name, raising=False)


# ── A. GOLDEN VALUES ───────────────────────────────────────────────────────────────────────────

def _point_response(domain, layer, speed, direction, period, model="GFS"):
    return NormalizedPointResponse(
        model=model, provider="open-meteo", domain=domain, layer=layer, run_time=T0, valid_time=T0,
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=0, requested_lng=0, sampled_lat=0, sampled_lng=0,
                                    speed=speed, direction=direction, u=0.0, v=0.0, period=period,
                                    interpolation_method="exact_match"),
        value_kind="wave_height" if domain == "marine" else "wind_speed",
        value_unit="m" if domain == "marine" else "kn", display_unit_hint="ft",
        source_variables=["x"], freshness_sec=0)


class _SeaResolver:
    """`resolve_point` stand-in: the marine answer goes through the REAL surf augment (the only
    producer of surf_height_m), the wind answer is the pinned wind point (knots, as served)."""

    def __init__(self, hs_m, tp_s, swell_from, wind_kt, wind_from):
        self.sea = (hs_m, tp_s, swell_from)
        self.wind = (wind_kt, wind_from)

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str, **_kw):
        from services.weather_pipeline.point_surf_augment import augment_with_surf
        if domain == "marine":
            hs, tp, d = self.sea
            r = _point_response("marine", layer, hs, d, tp, model)

            async def _no_partitions(*_a, **_k):
                return None
            return await augment_with_surf(r, model, domain, layer, lat, lng, valid_time_str, _no_partitions)
        kt, wd = self.wind
        return _point_response("wind", "wind", kt, wd, None, model)


def _one_chain(lat, lng, hs, tp, swell_from, wind_kt, wind_from):
    from services.weather_pipeline.spot_ratings import rate_one_spot
    spot = {"id": "golden", "name": "golden", "latitude": lat, "longitude": lng}
    return asyncio.run(rate_one_spot(_SeaResolver(hs, tp, swell_from, wind_kt, wind_from), spot, "GFS", VT))


PIPELINE = (21.6650, -158.0500)

# (offshore Hs m) -> (breaking ft, 0-100 score): CLAUDE.md "Pipeline sweep at dev 52e0ec53".
PIPELINE_SWEEP = [
    (0.5, 3.6, 78.0),
    (1.0, 6.4, 86.5),
    (4.0, 19.3, 86.5),
    (8.0, 29.5, 61.2),
    (10.0, 29.5, 61.2),
    (12.0, 29.5, 61.2),
]


@pytest.mark.parametrize("hs,ft,score", PIPELINE_SWEEP)
def test_golden_pipeline_sweep_matches_claude_md(default_flags, hs, ft, score):
    item = _one_chain(*PIPELINE, hs, 14.0, 315.0, 5.0, 45.0)
    assert round(item["surf_height_m"] * M_TO_FT, 1) == ft
    assert item["score"] == pytest.approx(score, abs=0.05)


# Realistic seas at four recorded spots (inputs pinned here, outputs measured 2026-10-27 on dev
# 4bd90d0d9). (name, lat, lng, Hs m, Tp s, swell from, wind kt, wind from) -> (surf m, ft, score, level)
GOLDEN_SPOTS = [
    ("Cocoa Beach",     28.3200,  -80.6076, 1.2, 10.0,  75.0, 5.0, 270.0, 1.933,  6.3, 81.5, "good"),
    ("Sebastian Inlet", 27.8586,  -80.4472, 1.5, 11.0,  80.0, 6.0, 250.0, 3.280, 10.8, 85.0, "epic"),
    ("Trestles",        33.3825, -117.5889, 1.5, 15.0, 210.0, 4.0,  45.0, 2.760,  9.1, 98.9, "epic"),
    # J-Bay: the ETOPO shore normal is 102.9 deg, so a 225 deg groundswell is 122 deg off-normal: the
    # height keeps 7.9 ft (height exposure floor) while the quality reads very_poor (quality floor).
    # That is the recorded `directional_conflict` (schemas.py), pinned here, not endorsed.
    ("Jeffreys Bay",   -34.0310,   24.9310, 2.5, 14.0, 225.0, 8.0, 300.0, 2.416,  7.9,  9.1, "very_poor"),
]


@pytest.mark.parametrize("name,lat,lng,hs,tp,sd,wkt,wd,surf_m,ft,score,level", GOLDEN_SPOTS)
def test_golden_spots_through_the_one_chain(default_flags, name, lat, lng, hs, tp, sd, wkt, wd,
                                            surf_m, ft, score, level):
    item = _one_chain(lat, lng, hs, tp, sd, wkt, wd)
    assert item["surf_height_m"] == pytest.approx(surf_m, abs=0.0015), name
    assert round(item["surf_height_m"] * M_TO_FT, 1) == ft, name
    assert item["score"] == pytest.approx(score, abs=0.05), name
    assert item["level"] == level, name
    # The rating graded the SAME breaking height the payload carries (one sea state, one hour).
    assert item["offshore_hs_m"] == pytest.approx(hs, abs=1e-6), name


def test_the_infobox_surf_row_is_the_augment_not_the_offshore_speed(default_flags):
    """The infobox Surf card reads `/point`'s surf_height_m (backendWeatherServiceClientPoint.js:613),
    which is this augment's output; the Swell card reads point.speed. At Cocoa they differ by 1.6x,
    so a swap would be visible, and the chain must never hand back the offshore number as surf."""
    r = asyncio.run(_SeaResolver(1.2, 10.0, 75.0, 5.0, 270.0).resolve_point(
        "GFS", "marine", "waves", 28.3200, -80.6076, VT))
    assert r.point.speed == 1.2
    assert r.surf_height_m is not None and abs(r.surf_height_m - r.point.speed) > 0.5
    assert r.surf_regime not in (None, "open_ocean", "calm", "unknown")


# ── B. /point vs THE HEATMAP TEXTURE ───────────────────────────────────────────────────────────

def _vec(lat, lng, h, d, period=12.0, valid=True):
    import math
    rad = math.radians(d)
    return GridVector(lat=lat, lng=lng, speed=h, direction=d, u=-h * math.sin(rad), v=-h * math.cos(rad),
                      period=period, is_valid=valid)


def _product(model, nodes, *, valid_time=T0, is_estimated=False, west=0.0, south=0.0, cols=2, rows=2, step=1.0):
    """nodes: row-major from the SOUTH row, [(h, dir), ...]."""
    vecs = []
    for j in range(rows):
        for i in range(cols):
            h, d = nodes[j * cols + i]
            vecs.append(_vec(south + j * step, west + i * step, h, d))
    b = CoverageBounds(west=west, south=south, east=west + (cols - 1) * step, north=south + (rows - 1) * step)
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer="waves", run_time=T0, valid_time=valid_time,
        is_forecast_authoritative=not is_estimated, is_estimated=is_estimated, coverage=b,
        grid=NormalizedGrid(bounds=b, cols=cols, rows=rows, vectors=vecs),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", product_id=f"{model}_test.json",
        source_variables=["wave_height"], freshness_sec=0)


def _gpu_height(product, lat, lng, scale):
    """What the heatmap shader decodes at (lat, lng): per-node byte (dark floors /10, light and beach
    round /16), bilinear in BYTE space (GL LINEAR on an RGBA8 texture), decoded byte / 255 * scale."""
    g = product.grid
    b = g.bounds
    fx = (lng - b.west) / (b.east - b.west) * (g.cols - 1)
    fy = (lat - b.south) / (b.north - b.south) * (g.rows - 1)
    x0, y0 = int(fx), int(fy)
    x1, y1 = min(g.cols - 1, x0 + 1), min(g.rows - 1, y0 + 1)
    dx, dy = fx - x0, fy - y0

    def byte(v):
        enc = max(0.0, min(1.0, v.speed / scale)) * 255
        return round(enc) if scale > 10 else int(enc)

    def at(i, j):
        return byte(g.vectors[j * g.cols + i])
    val = (at(x0, y0) * (1 - dx) * (1 - dy) + at(x1, y0) * dx * (1 - dy)
           + at(x0, y1) * (1 - dx) * dy + at(x1, y1) * dx * dy)
    return val / 255.0 * scale


def _point(product, lat, lng):
    from services.weather_pipeline.sampler import PointSampler
    return PointSampler().sample_point(product, lat, lng).point


DARK, LIGHT = 10.0, 16.0


def test_at_a_node_the_infobox_and_the_dark_heatmap_differ_only_by_one_byte(default_flags):
    p = _product("GFS", [(1.23, 270.0), (1.23, 270.0), (1.23, 270.0), (1.23, 270.0)])
    pt = _point(p, 0.0, 0.0)
    assert pt.interpolation_method == "exact_match" and pt.speed == pytest.approx(1.23)
    dark = _gpu_height(p, 0.0, 0.0, DARK)
    light = _gpu_height(p, 0.0, 0.0, LIGHT)
    # Dark FLOORS: always at or below the point, never by more than one 10/255 m step (0.13 ft).
    assert 0.0 <= pt.speed - dark < DARK / 255
    # Light/beach ROUND: within half a 16/255 m step either way.
    assert abs(pt.speed - light) <= LIGHT / 255 / 2 + 1e-9


def test_above_the_dark_cap_the_heatmap_paints_10m_while_the_infobox_says_12m(default_flags):
    p = _product("GFS", [(12.0, 300.0)] * 4)
    assert _point(p, 0.0, 0.0).speed == pytest.approx(12.0)
    assert _gpu_height(p, 0.0, 0.0, DARK) == pytest.approx(10.0)           # clamp: h / 10 > 1
    assert _gpu_height(p, 0.0, 0.0, LIGHT) == pytest.approx(12.0, abs=LIGHT / 255)


ISLAND_CORNERS = [(1.5, 75.0), (1.5, 189.0), (1.4, 120.0), (1.6, 160.0)]   # the Mokapu-class spread


def _interior_gap(model, monkeypatch, scalar_flag=None, models=None):
    if scalar_flag is not None:
        monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", scalar_flag)
    if models is not None:
        monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT_MODELS", models)
    p = _product(model, ISLAND_CORNERS)
    pt = _point(p, 0.5, 0.5)
    return pt.speed, _gpu_height(p, 0.5, 0.5, LIGHT), pt.interpolation_method


def test_between_nodes_euro_and_icon_infobox_reads_lower_than_the_heatmap(default_flags, monkeypatch):
    """`/point` bilinears (u, v) and reports |mean vector| (sampler.py:449); the GPU bilinears the
    scalar height byte. Where corner directions diverge the infobox Swell is LOWER than the colour
    under the pin. Live config 2026-10-17: SAMPLER_SCALAR_HEIGHT=1 with MODELS=GFS (STATE.md), so
    GFS agrees and EURO/ICON keep the vector mean."""
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT_MODELS", "GFS")
    for model in ("EURO", "ICON"):
        speed, gpu, method = _interior_gap(model, monkeypatch)
        assert method == "bilinear"
        # Measured: the map paints 1.506 m (4.9 ft), the infobox Swell says 1.110 m (3.6 ft): 26% low.
        assert speed == pytest.approx(1.110, abs=0.005), model
        assert gpu == pytest.approx(1.506, abs=0.005), model
    speed, gpu, _ = _interior_gap("GFS", monkeypatch)
    assert abs(gpu - speed) <= LIGHT / 255, (speed, gpu)        # GFS: scalar both sides


def test_with_uniform_direction_the_two_agree_for_every_model(default_flags):
    for model in ("GFS", "EURO", "ICON"):
        p = _product(model, [(1.0, 270.0), (2.0, 270.0), (1.5, 270.0), (2.5, 270.0)])
        pt = _point(p, 0.25, 0.75)
        assert abs(_gpu_height(p, 0.25, 0.75, LIGHT) - pt.speed) <= LIGHT / 255, model


# ── C. BOUNDARY FRAME PICKS ────────────────────────────────────────────────────────────────────

RUN = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)


def _mp(model, step_h, *, estimated=False, res=2.0, region="global_mid"):
    vt = RUN + timedelta(hours=step_h)
    return ManifestProduct(
        model=model, provider="estimated" if estimated else "open-meteo", domain="marine", layer="waves",
        run_time=RUN, valid_time_start=vt, valid_time_end=vt + timedelta(hours=1), resolution=res,
        freshness_sec=0, is_forecast_authoritative=not estimated, is_estimated=estimated,
        coverage=CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0),
        filename=f"{model.lower()}_{'est' if estimated else 'auth'}_{step_h:03d}.json", region_id=region)


def _euro_manifest():
    """EURO as the live index read 2026-10-27 (log 2026-10-27-claude-euro-step-nearest.md): 3-hourly
    authoritative to step 144, 6-hourly authoritative to 240 with estimated `native_time_interpolation`
    frames at the 3-h steps between (lattice_fill.py), all estimated from 243."""
    prods = [_mp("EURO", h) for h in range(132, 145, 3)]
    prods += [_mp("EURO", h) for h in range(150, 241, 6)]
    prods += [_mp("EURO", h, estimated=True) for h in range(147, 238, 6)]
    prods += [_mp("EURO", h, estimated=True) for h in range(243, 349, 3)]
    return SimpleNamespace(products=prods)


def _icon_manifest():
    """ICON: native to step 168 (GWAM), stored estimate (icon_marine_extension) 3-hourly to 348."""
    prods = [_mp("ICON", h) for h in range(150, 169, 3)]
    prods += [_mp("ICON", h, estimated=True) for h in range(171, 349, 3)]
    return SimpleNamespace(products=prods)


def _point_pick(manifest, model, step_h):
    from services.weather_pipeline.manifest_point_selection import choose_for_point, point_candidates
    item = choose_for_point(point_candidates(manifest, model, "marine", "waves", RUN + timedelta(hours=step_h)), 20.0, -40.0)
    return None if item is None else (round((item.valid_time_start - RUN).total_seconds() / 3600), item.is_estimated)


def _mid_pick(manifest, model, step_h):
    """The world/mid-zoom heatmap: mid_res_tier.pick_mid_item over grid_resolver_selection's candidates."""
    from services.weather_pipeline.grid_resolver_selection import find_candidates
    from services.weather_pipeline.mid_res_tier import pick_mid_item
    auth, est = find_candidates(manifest, model, "marine", "waves", RUN + timedelta(hours=step_h))
    item = pick_mid_item(auth, est)
    return None if item is None else (round((item.valid_time_start - RUN).total_seconds() / 3600), item.is_estimated)


def _frame_store_pick(manifest, step_h):
    """Port of staticFrameCodec.pickIndexFrame: authoritative pass then estimated, |diff| <= 3 h,
    strict `<` so the earlier frame (index order) wins a tie."""
    target = RUN + timedelta(hours=step_h)
    frames = sorted(manifest.products, key=lambda p: p.valid_time_start)
    for estimated in (False, True):
        best, best_diff = None, None
        for f in frames:
            if bool(f.is_estimated) != estimated:
                continue
            diff = abs((f.valid_time_start - target).total_seconds())
            if diff <= 3 * 3600 and (best_diff is None or diff < best_diff):
                best, best_diff = f, diff
        if best is not None:
            return (round((best.valid_time_start - RUN).total_seconds() / 3600), best.is_estimated)
    return None


# (step) -> (point pick, heatmap pick). Model step = hours since the run, which is what the lattice
# follows; the wheel hour is step minus the run's age.
EURO_ROWS = [
    (144, (144, False), (144, False)),   # last 3-hourly authoritative step: same frame
    (145, (144, False), (144, False)),
    (146, (144, False), (144, False)),
    (147, (147, True), (144, False)),    # DISAGREE: infobox = interpolated estimate "(est.)", map = 144 "nearest stored"
    (148, (150, False), (150, False)),
    (150, (150, False), (150, False)),
    (153, (153, True), (150, False)),    # DISAGREE (every odd-3 step to 237)
    (240, (240, False), (240, False)),   # last authoritative step
    (243, (243, True), (240, False)),    # DISAGREE: first estimated tail hour; the map still shows 240
    (244, (243, True), (243, True)),
]


@pytest.mark.parametrize("step,point_pick,map_pick", EURO_ROWS)
def test_euro_boundary_rows(default_flags, step, point_pick, map_pick):
    m = _euro_manifest()
    assert _point_pick(m, "EURO", step) == point_pick
    assert _mid_pick(m, "EURO", step) == map_pick
    assert _frame_store_pick(m, step) == map_pick       # the CDN frame store agrees with the mid tier


ICON_ROWS = [
    (168, (168, False), (168, False)),   # last native ICON step
    (170, (168, False), (168, False)),   # 171 is 1 h away: outside the 30-min estimate preference, so 168
    (171, (171, True), (168, False)),    # DISAGREE: first estimated step; the map still shows 168
    (172, (171, True), (171, True)),
]


@pytest.mark.parametrize("step,point_pick,map_pick", ICON_ROWS)
def test_icon_boundary_rows(default_flags, step, point_pick, map_pick):
    m = _icon_manifest()
    assert _point_pick(m, "ICON", step) == point_pick
    assert _mid_pick(m, "ICON", step) == map_pick
    assert _frame_store_pick(m, step) == map_pick


def test_the_existing_dark_flag_aligns_the_mid_tier_with_the_point(default_flags, monkeypatch):
    """MID_RES_EXACT_TIME_ESTIMATE=1 routes the mid tier through select_best_candidate (the point's
    30-min estimate rule), so the world/mid heatmap and the infobox would draw the SAME frame at the
    disagreeing steps. The CDN frame store (client) would need the same rule to follow."""
    monkeypatch.setenv("MID_RES_EXACT_TIME_ESTIMATE", "1")
    m = _euro_manifest()
    for step in (147, 153, 243):
        assert _mid_pick(m, "EURO", step) == _point_pick(m, "EURO", step)


def test_day14_hold_past_the_stored_tail_neither_lane_has_a_frame(default_flags):
    """Past run + 348 nothing is within 3 h: the heatmap HOLDS its last frame and says "Holding ...'s
    forecast" (#578/#587), while /point falls to the direct upstream lane (point_resolution.py:351+),
    which for EURO beyond ECMWF's 10-day file returns no coverage, so the infobox reads
    "No Copernicus coverage" beside a held, labelled frame."""
    m = _euro_manifest()
    assert _point_pick(m, "EURO", 352) is None
    assert _mid_pick(m, "EURO", 352) is None
    assert _frame_store_pick(m, 352) is None


def test_point_reports_the_served_frame_and_estimate_flag_at_a_boundary(default_flags):
    """At an off-lattice ask the point says which frame answered (served_valid_time, frame_substituted)
    and whether it is an estimate. The INFOBOX reads neither the served time (only a diagnostic
    receipt, backendWeatherServiceClientPoint.js:603) nor shows any time in its header when a spot is
    selected (MapForecastOverlay.js:615-617)."""
    from services.weather_pipeline.grid_resolver import stamp_frame_honesty
    from services.weather_pipeline.sampler import PointSampler
    est147 = _product("EURO", [(2.0, 270.0)] * 4, valid_time=RUN + timedelta(hours=147), is_estimated=True)
    r = PointSampler().sample_point(est147, 0.5, 0.5)
    ask = RUN + timedelta(hours=146)
    stamp_frame_honesty(r, ask, ask.strftime("%Y-%m-%dT%H:%M:%SZ"))
    assert r.is_estimated is True
    assert (r.frame_offset_hours, r.frame_substituted) == (1.0, True)

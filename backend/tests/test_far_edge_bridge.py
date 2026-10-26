"""FAR_EDGE_BRIDGE (2026-10-26, dark): past an ICON/EURO 2-deg blend's end, GFS 2-deg + w * (Blend(T0) - GFS(T0)).

Measured on real CDN frames (log/2026-10-24-claude-day14-end.md "Research: the seam"): at ICON's last blend frame the blend is
MAE 0.98 m off GFS; a hard switch would step 0.973 m MAE (10x GFS's own 3 h step), the 24 h bridge's worst step is 0.146 m.
These tests pin the math (continuity at T0, convergence to GFS, unit-circle direction, nearest period, land, no negative
heights) and the rails (dark, past the 2-deg lane only, bounded, both GFS frames on the same lattice, never over a regional
product, never for GFS).
"""
import asyncio
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.weather_pipeline import far_edge_bridge as feb
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

T0 = datetime(2026, 11, 8, 18, 0, tzinfo=timezone.utc)       # ICON's last 2-deg blend frame, measured
RUN = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("FAR_EDGE_BRIDGE", "FAR_EDGE_BRIDGE_DECAY_H", "FAR_EDGE_BRIDGE_MAX_H"):
        monkeypatch.delenv(k, raising=False)


def _vec(lat, lng, h, d, period=10.0, valid=True, conf=0.9):
    rad = math.radians(d)
    return GridVector(lat=lat, lng=lng, speed=h, direction=d, u=-h * math.sin(rad), v=-h * math.cos(rad), period=period,
                      is_valid=valid, dir_confidence=conf)


# ── the math ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_weight_is_one_at_t0_and_falls_linearly_to_zero_at_the_decay():
    assert feb.bridge_weight(0, 24) == 1.0 and feb.bridge_weight(6, 24) == 0.75
    assert feb.bridge_weight(24, 24) == 0.0 and feb.bridge_weight(40, 24) == 0.0
    assert feb.bridge_weight(3, 0) == 0.0


def test_continuous_at_t0_and_pure_gfs_once_the_weight_is_zero():
    anchor = [_vec(0, 0, 3.0, 250.0, 14.0), _vec(0, 2, 1.0, 90.0, 6.0)]
    gfs = [_vec(0, 0, 2.0, 270.0, 12.0), _vec(0, 2, 1.5, 100.0, 7.0)]
    at_t0 = feb.bridge_vectors(anchor, gfs, gfs, 1.0)              # t = T0: GFS(t) == GFS(T0)
    assert [round(v.speed, 4) for v in at_t0] == [3.0, 1.0] and [v.direction for v in at_t0] == [250.0, 90.0]
    assert [v.period for v in at_t0] == [14.0, 6.0]
    later = [_vec(0, 0, 2.4, 280.0, 13.0), _vec(0, 2, 1.2, 110.0, 8.0)]
    done = feb.bridge_vectors(anchor, gfs, later, 0.0)
    assert [(v.speed, v.direction, v.period) for v in done] == [(2.4, 280.0, 13.0), (1.2, 110.0, 8.0)]


def test_the_departure_is_carried_on_the_gfs_trend():
    anchor, g0, gt = [_vec(0, 0, 3.0, 250.0)], [_vec(0, 0, 2.0, 250.0)], [_vec(0, 0, 2.6, 250.0)]
    (v,) = feb.bridge_vectors(anchor, g0, gt, 0.5)
    assert v.speed == pytest.approx(2.6 + 0.5 * 1.0)


def test_direction_blends_on_the_unit_circle_never_as_degrees():
    (v,) = feb.bridge_vectors([_vec(0, 0, 1, 350.0)], [_vec(0, 0, 1, 10.0)], [_vec(0, 0, 1, 10.0)], 0.5)
    assert min(v.direction, 360 - v.direction) < 1e-6                  # 0 deg, not the degree average 180
    rad = math.radians(v.direction)
    assert v.u == pytest.approx(-v.speed * math.sin(rad), abs=1e-3) and v.v == pytest.approx(-v.speed * math.cos(rad), abs=1e-3)


def test_period_switches_at_half_weight_and_is_never_blended():
    a, g = [_vec(0, 0, 1, 0, period=16.0)], [_vec(0, 0, 1, 0, period=8.0)]
    assert feb.bridge_vectors(a, g, g, 0.5)[0].period == 16.0
    assert feb.bridge_vectors(a, g, g, 0.49)[0].period == 8.0


def test_land_stays_land_a_missing_anchor_takes_gfs_and_heights_never_go_negative():
    anchor = [_vec(0, 0, 2.0, 0), _vec(0, 2, 0, 0, valid=False), _vec(0, 4, 0.1, 0)]
    g0 = [_vec(0, 0, 2.0, 0), _vec(0, 2, 1.0, 0), _vec(0, 4, 3.0, 0)]
    gt = [_vec(0, 0, 0, 0, valid=False), _vec(0, 2, 1.3, 45), _vec(0, 4, 0.5, 0)]
    out = feb.bridge_vectors(anchor, g0, gt, 1.0)
    assert out[0].is_valid is False                                   # GFS land
    assert (out[1].speed, out[1].direction) == (1.3, 45.0)             # no anchor value: GFS as it is
    assert out[2].speed == 0.0                                         # 0.5 + (0.1 - 3.0) clamps at 0
    assert anchor[0].speed == 2.0 and gt[1].speed == 1.3               # inputs untouched


# ── the rails, on a fake store ───────────────────────────────────────────────────────────────────────────────────────────

def _grid(values, lat0=0.0):
    vecs = [_vec(lat0, 2.0 * i, h, d) for i, (h, d) in enumerate(values)]
    return NormalizedGrid(bounds=CoverageBounds(west=-180, south=-80, east=180, north=84), cols=len(vecs), rows=1, vectors=vecs)


def _product(model, vt, values, estimated, lat0=0.0, region="global_mid"):
    return NormalizedProduct(model=model, provider="estimated" if estimated else "open-meteo", domain="marine", layer="waves",
                             run_time=RUN, model_run_time=RUN, valid_time=vt, is_forecast_authoritative=not estimated,
                             is_estimated=estimated, coverage=CoverageBounds(west=-180, south=-80, east=180, north=84),
                             grid=_grid(values, lat0), value_kind="wave_height", value_unit="m", display_unit_hint="ft",
                             source_variables=["wave_height"], freshness_sec=3600, region_id=region, coverage_mode="global_tile")


class _Store:
    def __init__(self):
        self.items, self.files = [], {}

    def add(self, model, vt, values, estimated=False, lat0=0.0, region="global_mid"):
        name = f"{model.lower()}_marine_waves_{region}_{vt:%Y%m%dT%H%M%SZ}{'_estimated' if estimated else ''}.json"
        self.items.append(SimpleNamespace(model=model, domain="marine", layer="waves", region_id=region,
                                          coverage_mode="global_tile", valid_time_start=vt, is_estimated=estimated,
                                          filename=name))
        self.files[name] = _product(model, vt, values, estimated, lat0, region)
        return self

    def get_manifest(self):
        return SimpleNamespace(products=self.items)

    def load_product(self, filename):
        return self.files.get(filename)


def _icon_store(gfs_lat0=0.0):
    s = _Store()
    s.add("ICON", T0 - timedelta(hours=3), [(2.9, 250.0)], estimated=True)
    s.add("ICON", T0, [(3.0, 250.0)], estimated=True)
    s.add("ICON", T0, [(9.9, 0.0)], estimated=True, region="global_coarse")   # another tier: not the 2-deg lane
    for h in range(0, 49, 3):
        s.add("GFS", T0 + timedelta(hours=h), [(2.0 + 0.01 * h, 270.0)], lat0=gfs_lat0)
    return s


def _bridge(store, target, model="ICON", current=None):
    return asyncio.run(feb.try_far_edge_bridge(store, model, "marine", "waves", target, current_product=current))


def test_dark_by_default():
    assert _bridge(_icon_store(), T0 + timedelta(hours=6)) is None


def test_bridges_past_the_2deg_lane_with_honest_labels(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_BRIDGE", "1")
    p = _bridge(_icon_store(), T0 + timedelta(hours=6))
    assert p is not None and p.model == "ICON" and p.provider == "estimated"
    assert p.is_estimated is True and p.is_forecast_authoritative is False
    b = p.estimate_basis
    assert b["type"] == "far_edge_bridge" and b["weight_anchor"] == 0.75 and b["gap_hours"] == 6.0 and b["decay_hours"] == 24.0
    assert b["anchor_product_id"].endswith("20261108T180000Z_estimated.json") and "global_mid" in b["anchor_product_id"]
    assert b["gfs_target_product_id"].endswith("20261109T000000Z.json")
    assert p.grid.vectors[0].speed == pytest.approx(2.06 + 0.75 * (3.0 - 2.0))
    assert any(w.startswith("far_edge_bridge:+6.0h") for w in p.warnings)
    assert p.region_id == "global_mid" and p.model_run_time == RUN


def test_never_inside_the_lane_never_a_mid_range_hole_never_past_the_bound(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_BRIDGE", "1")
    assert _bridge(_icon_store(), T0) is None
    assert _bridge(_icon_store(), T0 - timedelta(hours=2)) is None
    hole = _icon_store().add("ICON", T0 + timedelta(hours=12), [(1.0, 0.0)], estimated=True)
    assert _bridge(hole, T0 + timedelta(hours=6)) is None              # 2-deg coverage beyond the target: not the far edge
    assert _bridge(_icon_store(), T0 + timedelta(hours=80)) is None    # past FAR_EDGE_BRIDGE_MAX_H (72)
    monkeypatch.setenv("FAR_EDGE_BRIDGE_MAX_H", "100")
    assert _bridge(_icon_store(), T0 + timedelta(hours=80)) is None    # ... and no GFS frame there (48 h in this store)


def test_needs_both_gfs_frames_on_the_same_lattice(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_BRIDGE", "1")
    no_gfs = _Store().add("ICON", T0, [(3.0, 250.0)], estimated=True)
    assert _bridge(no_gfs, T0 + timedelta(hours=6)) is None
    assert _bridge(_icon_store(gfs_lat0=1.0), T0 + timedelta(hours=6)) is None


def test_never_over_a_regional_product_and_never_for_gfs(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_BRIDGE", "1")
    regional = SimpleNamespace(grid=SimpleNamespace(bounds=CoverageBounds(west=-82, south=25, east=-72, north=35)))
    assert _bridge(_icon_store(), T0 + timedelta(hours=6), current=regional) is None
    world = SimpleNamespace(grid=SimpleNamespace(bounds=CoverageBounds(west=-180, south=-80, east=180, north=85)))
    assert _bridge(_icon_store(), T0 + timedelta(hours=6), current=world) is not None   # e.g. EURO's 10-deg fill
    assert _bridge(_icon_store(), T0 + timedelta(hours=6), model="GFS") is None


def test_the_decay_is_tunable(monkeypatch):
    monkeypatch.setenv("FAR_EDGE_BRIDGE", "1")
    monkeypatch.setenv("FAR_EDGE_BRIDGE_DECAY_H", "12")
    p = _bridge(_icon_store(), T0 + timedelta(hours=6))
    assert p.estimate_basis["weight_anchor"] == 0.5


def test_the_resolver_bridges_after_the_mid_tier_and_before_the_hold():
    src = (Path(feb.__file__).parent / "grid_resolver.py").read_text(encoding="utf-8")
    mid = src.index("_mid_product = await try_serve_mid_res_tier(")
    bridge = src.index("await try_far_edge_bridge(store, model, domain, layer, target_dt, current_product=product)")
    hold = src.index("product = await hold_before_upstream(store, model, domain, layer, target_dt, req_w")
    assert mid < bridge < hold


def test_registered_dark():
    import ast
    reg_src = (Path(feb.__file__).parents[2] / "routes" / "admin" / "surf_forecast.py").read_text(encoding="utf-8")
    reg = next(ast.literal_eval(n.value) for n in ast.walk(ast.parse(reg_src))
               if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in n.targets))
    assert reg["FAR_EDGE_BRIDGE"][0] == "0" and reg["FAR_EDGE_BRIDGE"][2] == "Render env"

"""SAMPLER_SCALAR_HEIGHT (dark): a marine height is interpolated as the scalar it is.

The bilinear branches average the corners' (u, v) and report sqrt(u^2 + v^2) as the point's height. For wind,
a vector, that is right. For a significant wave height it can only shrink the answer, by as much as the corners'
directions diverge, which is where surf spots are. The fixture is REAL: the four GFS-Wave 0.25-deg nodes around
NDBC 51202 (Mokapu Point, Oahu) in `gfs_marine_waves_hawaii_20261001T030000Z.json`, read from production /grid on
2026-09-30: a 14 s south swell (189 deg) on two corners and an 8 s east trade sea (75-84 deg) on the other two.
Served /point there read 0.9795 m; Open-Meteo's same-model cell read 1.44 m; the corners are 1.39-1.57 m.
"""
import math
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from services.weather_pipeline.sampler import PointSampler, scalar_marine_height_enabled
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct,
)

BACKEND = Path(__file__).resolve().parents[1]
BUOY = (21.417, -157.679)   # NDBC 51202's position as sampled on 2026-09-30

# (lat, lng): (speed m, direction deg FROM, u, v, period s), verbatim from the production product
MOKAPU = {
    (21.25, -157.75): (1.57, 189.25, 0.2524, 1.5496, 14.45),
    (21.25, -157.5): (1.42, 144.32, -0.8282, 1.1534, 14.06),
    (21.5, -157.75): (1.43, 75.1, -1.3819, -0.3677, 7.86),
    (21.5, -157.5): (1.39, 83.56, -1.3812, -0.1559, 10.26),
}


def _vec(lat, lng, speed, direction, u=None, v=None, period=10.0, valid=True):
    if u is None:
        u = -speed * math.sin(math.radians(direction))
        v = -speed * math.cos(math.radians(direction))
    return GridVector(lat=lat, lng=lng, speed=speed if valid else 0.0, direction=direction if valid else 0.0,
                      u=u if valid else 0.0, v=v if valid else 0.0, period=period if valid else 0.0,
                      is_valid=valid)


def _product(vectors, domain="marine", layer="waves"):
    cov = CoverageBounds(west=-157.75, south=21.25, east=-157.5, north=21.5)
    now = datetime(2026, 10, 1, 3, tzinfo=timezone.utc)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain=domain, layer=layer, run_time=now, valid_time=now,
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=2, rows=2, vectors=vectors),
        value_kind="wave_height" if domain == "marine" else "wind_speed", value_unit="m", display_unit_hint="ft",
        product_id="gfs_marine_waves_hawaii_20261001T030000Z.json", source_variables=["wave_height"],
        freshness_sec=1800, region_id="hawaii", coverage_mode="regional_tile",
    )


def _mokapu(domain="marine", layer="waves"):
    return _product([_vec(la, lo, s, d, u, v, p) for (la, lo), (s, d, u, v, p) in MOKAPU.items()], domain, layer)


def _pt(product, lat=BUOY[0], lng=BUOY[1]):
    return PointSampler().sample_point(product, lat, lng).point


def test_dark_by_default_the_served_answer_is_the_vector_mean(monkeypatch):
    """Null control: with the flag unset nothing moves; this is the number production serves today."""
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    p = _pt(_mokapu())
    assert p.interpolation_method == "bilinear"
    assert p.speed == pytest.approx(0.9795, abs=1e-4)


def test_on_the_height_is_the_scalar_mean_and_the_direction_is_unchanged(monkeypatch):
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    off = _pt(_mokapu())
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_mokapu())
    assert on.interpolation_method == "bilinear"
    assert on.speed == pytest.approx(1.4547, abs=1e-4)          # inside the corners' 1.39-1.57 m
    assert min(s for s, *_ in MOKAPU.values()) <= on.speed <= max(s for s, *_ in MOKAPU.values())
    assert on.direction == pytest.approx(off.direction, abs=0.01)
    assert on.period == off.period
    # u/v are rebuilt from the height and direction, so the point is one self-consistent vector
    assert math.hypot(on.u, on.v) == pytest.approx(on.speed, abs=2e-4)
    assert math.degrees(math.atan2(-on.u, -on.v)) % 360 == pytest.approx(on.direction, abs=0.02)


def test_aligned_corners_give_the_same_answer_either_way(monkeypatch):
    """The fix acts only where directions diverge: an open-ocean cell with one swell reads identically."""
    vecs = [_vec(21.25, -157.75, 1.6, 300.0), _vec(21.25, -157.5, 1.2, 300.0),
            _vec(21.5, -157.75, 1.4, 300.0), _vec(21.5, -157.5, 1.1, 300.0)]
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
    off = _pt(_product(vecs))
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_product(vecs))
    assert on.speed == pytest.approx(off.speed, abs=1e-4)
    assert on.direction == pytest.approx(off.direction, abs=0.01)


def test_wind_is_a_vector_and_stays_one(monkeypatch):
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    assert not scalar_marine_height_enabled("wind")
    assert not scalar_marine_height_enabled("weather")
    assert scalar_marine_height_enabled("marine") and scalar_marine_height_enabled("MARINE")
    p = _pt(_mokapu(domain="wind", layer="wind"))
    assert p.speed == pytest.approx(0.9795, abs=1e-4)


def test_the_ocean_masked_branch_takes_the_scalar_mean_of_its_surviving_corners(monkeypatch):
    items = list(MOKAPU.items())
    vecs = [_vec(la, lo, s, d, u, v, p) for (la, lo), (s, d, u, v, p) in items[:3]]
    (la, lo), _ = items[3]
    vecs.append(_vec(la, lo, 0.0, 0.0, valid=False))            # a land corner
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
    off = _pt(_product(vecs))
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_product(vecs))
    assert on.interpolation_method == off.interpolation_method == "bilinear_ocean_masked"
    lat, lng = BUOY
    t = (lng - -157.75) / 0.25
    u = (lat - 21.25) / 0.25
    w = [(1 - t) * (1 - u), t * (1 - u), (1 - t) * u]
    expected = sum(wi * s for wi, ((_, _), (s, *_)) in zip(w, items[:3])) / sum(w)
    assert on.speed == pytest.approx(expected, abs=1e-4)
    assert on.speed > off.speed
    assert on.direction == pytest.approx(off.direction, abs=0.01)


def test_a_perfectly_cancelling_mean_takes_the_heaviest_corners_direction(monkeypatch):
    """Two equal, opposite seas at the cell centre: the vector mean is zero and has no direction."""
    vecs = [_vec(21.25, -157.75, 1.0, 90.0), _vec(21.25, -157.5, 1.0, 270.0),
            _vec(21.5, -157.75, 1.0, 270.0), _vec(21.5, -157.5, 1.0, 90.0)]
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
    assert _pt(_product(vecs), 21.375, -157.625).speed == pytest.approx(0.0, abs=1e-4)
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
    on = _pt(_product(vecs), 21.375, -157.625)
    assert on.speed == pytest.approx(1.0, abs=1e-4)
    assert on.direction in (90.0, 270.0)


def test_the_scalar_answer_is_never_below_the_vector_answer(monkeypatch):
    """|sum w_i h_i e_i| <= sum w_i h_i: the defect is one-sided (a low bias), so the fix only raises."""
    import random
    rnd = random.Random(20260930)
    for _ in range(200):
        vecs = [_vec(la, lo, rnd.uniform(0.2, 4.0), rnd.uniform(0, 360), period=rnd.uniform(5, 18))
                for la in (21.25, 21.5) for lo in (-157.75, -157.5)]
        lat, lng = rnd.uniform(21.26, 21.49), rnd.uniform(-157.74, -157.51)
        monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "0")
        off = _pt(_product(vecs), lat, lng).speed
        monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")
        on = _pt(_product(vecs), lat, lng).speed
        assert on >= off - 1e-4


def test_every_lane_that_samples_a_point_declares_the_switch_dark_and_equal():
    """Glyphs (precompute, core ingest) and the consensus builder (pilots) sample through this code; a flip
    in one lane alone would serve two interpolations of the same sea."""
    values = {}
    for wf in ("forecast-ingest.yml", "forecast-ingest-pilots.yml", "precompute.yml"):
        d = yaml.safe_load((BACKEND.parent / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"]["SAMPLER_SCALAR_HEIGHT"] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and "SAMPLER_SCALAR_HEIGHT" in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    assert set(values.values()) == {"0"}, values


# ─── THE LEDGER'S SCALAR SHADOW LANE: paired buoy truth for the flip ─────────────────────────────────────────────

def test_force_scalar_height_is_a_context_and_touches_only_marine(monkeypatch):
    from services.weather_pipeline.sampler import force_scalar_height
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    assert _pt(_mokapu()).speed == pytest.approx(0.9795, abs=1e-4)
    with force_scalar_height():
        assert _pt(_mokapu()).speed == pytest.approx(1.4547, abs=1e-4)
        assert _pt(_mokapu(domain="wind", layer="wind")).speed == pytest.approx(0.9795, abs=1e-4)
    assert _pt(_mokapu()).speed == pytest.approx(0.9795, abs=1e-4)      # restored on exit


def test_the_ledger_grades_a_scalar_lane_only_while_the_switch_is_dark(monkeypatch):
    from services.weather_pipeline import forecast_skill as fs
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    monkeypatch.delenv("SAMPLER_SCALAR_LEDGER", raising=False)
    assert fs.GFS_SCALAR not in fs.compare_models("GFS")
    monkeypatch.setenv("SAMPLER_SCALAR_LEDGER", "1")
    assert fs.GFS_SCALAR in fs.compare_models("GFS")
    assert fs.GFS_SCALAR not in fs.compare_models("EURO")
    assert fs.source_for(fs.GFS_SCALAR, "GFS") == "raw_surf:GFS_SCALAR"
    monkeypatch.setenv("SAMPLER_SCALAR_HEIGHT", "1")                    # served: the shadow would double-count
    assert fs.GFS_SCALAR not in fs.compare_models("GFS")


def test_the_scalar_lane_resolves_gfs_with_a_scalar_sampler_and_the_served_lane_does_not(monkeypatch):
    import asyncio
    from services.weather_pipeline import buoy_calibration as bc
    from services.weather_pipeline import forecast_skill as fs
    monkeypatch.delenv("SAMPLER_SCALAR_HEIGHT", raising=False)
    monkeypatch.setenv("SAMPLER_SCALAR_LEDGER", "1")
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "")
    monkeypatch.setenv("FORECAST_SKILL_PERSISTENCE", "0")
    monkeypatch.delenv("CONSENSUS_INGEST", raising=False)
    monkeypatch.delenv("CONSENSUS_SERVE", raising=False)
    seen = []

    async def fake_calibrate(resolver, spots, model, target):
        seen.append((model, scalar_marine_height_enabled("marine")))
        return {"spots": []}

    async def no_coords():
        return {}
    monkeypatch.setattr(bc, "calibrate_spots", fake_calibrate)
    monkeypatch.setattr(bc, "fetch_ndbc_station_coords", no_coords)
    monkeypatch.setattr(bc, "load_calibration_rows_l2", lambda *a, **k: ([], False))
    monkeypatch.setattr(bc, "upload_calibration_l2", lambda *a, **k: None)
    try:
        asyncio.run(fs.run_skill_ledger(None, None, [], "GFS", {"spots": []}))
    except Exception:
        pass                                              # only the lane resolution is under test here
    assert ("GFS", False) in seen and ("GFS", True) in seen   # served lane vector; GFS_SCALAR lane scalar
    assert all(m == "GFS" for m, _ in seen)
    assert not scalar_marine_height_enabled("marine")         # nothing leaks out of the lane


def test_both_ledger_lanes_declare_the_scalar_shadow_equal():
    values = {}
    for wf in ("forecast-ingest.yml", "precompute.yml"):
        d = yaml.safe_load((BACKEND.parent / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"]["SAMPLER_SCALAR_LEDGER"] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and "SAMPLER_SCALAR_LEDGER" in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    assert len(set(values.values())) == 1, values

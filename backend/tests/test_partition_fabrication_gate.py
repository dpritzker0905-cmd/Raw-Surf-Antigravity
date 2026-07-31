"""The ratio-fabrication gate — a missing swell train's honest answer is ABSENCE, not invention.

USER-REPORTED LIVE (2026-07-30): the map showed a "NE swell" on swell_2 over Florida while the
infobox said ESE — and upstream had NO secondary swell there at all (h=0 everywhere probed). The
normalizer had been INVENTING the partition wherever a point's payload lacked the real variables:
swell_2 = 35% of the TOTAL height with the total's direction ROTATED +40°. Two tiers fabricated
from different build-time totals (runs an hour apart), so the rendered world grid (FROM 20.5°) and
the regional-tile infobox (FROM 107.6°) contradicted each other about a train that did not exist —
both stamped `is_estimated=False, is_forecast_authoritative=True` with `estimate_basis` attached,
because one native point anywhere laundered the whole mixed product.

Three fixes, each pinned here:
  1. The fabrication is gated MARINE_PARTITION_RATIO_FALLBACK (default OFF): missing partition
     variables now yield INVALID cells (transparent on the map, absent in the infobox).
  2. When the fallback IS deliberately enabled, ANY fabricated point stamps the product
     estimated — a partly-invented product is not authoritative anywhere.
  3. Both partition SUPPLIERS to the spectral rating (point lane + hub) refuse ratio-derived
     trains by provenance — reconcile rescales energy and the represent gate checks coverage, but
     only `estimate_basis` can detect fabrication.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.normalizer import WeatherNormalizer

TARGET = datetime(2026, 7, 31, 0, 0, tzinfo=timezone.utc)
BBOX = {"west": -82.0, "south": 26.0, "east": -78.0, "north": 30.0}


def _point(lat, lng, with_secondary=None):
    """One raw upstream point. `with_secondary=None` omits the partition variables entirely
    (the fabrication trigger); a list supplies them natively."""
    hourly = {
        "time": ["2026-07-31T00:00"],
        "wave_height": [1.0],
        "wave_direction": [90.0],
        "wave_period": [8.0],
    }
    if with_secondary is not None:
        hourly["secondary_swell_wave_height"] = [with_secondary[0]]
        hourly["secondary_swell_wave_direction"] = [with_secondary[1]]
        hourly["secondary_swell_wave_period"] = [with_secondary[2]]
    return {"latitude": lat, "longitude": lng, "hourly": hourly,
            "hourly_units": {"wave_height": "m"}}


def _normalize(raw):
    return WeatherNormalizer().normalize(
        model="GFS", provider="open-meteo", domain="marine", layer="swell_2",
        raw_results=raw, bbox=BBOX, resolution=2.0, target_time=TARGET)


def test_a_missing_train_is_ABSENT_not_invented(monkeypatch):
    """Default (flag off): no secondary-swell variables -> INVALID cells and a clean provenance.
    The pre-fix behavior served 35%-of-total rotated +40 deg as a real train."""
    monkeypatch.delenv("MARINE_PARTITION_RATIO_FALLBACK", raising=False)
    prod = _normalize([_point(28.0, -80.0), _point(28.0, -78.0)])
    assert prod is not None
    assert all(not v.is_valid for v in prod.grid.vectors), (
        "cells with no real train must be invalid/transparent, never fabricated")
    assert prod.is_estimated is False
    assert prod.estimate_basis is None


def test_the_flag_restores_the_fallback_and_stamps_it_estimated(monkeypatch):
    """MARINE_PARTITION_RATIO_FALLBACK=1 (coverage emergency): the old ratios come back — and the
    product SAYS so."""
    monkeypatch.setenv("MARINE_PARTITION_RATIO_FALLBACK", "1")
    prod = _normalize([_point(28.0, -80.0)])
    assert prod is not None
    valid = [v for v in prod.grid.vectors if v.is_valid]
    assert valid, "the fallback must produce cells when deliberately enabled"
    v = valid[0]
    assert v.speed == pytest.approx(0.35, abs=0.01)          # 35% of the 1.0 m total
    assert v.direction == pytest.approx(130.0, abs=0.1)      # total 90 + the +40 rotation
    assert prod.is_estimated is True
    assert (prod.estimate_basis or {}).get("method") == "wave_component_ratio_estimation"


def test_one_native_point_can_no_longer_launder_a_mixed_product(monkeypatch):
    """The measured contradiction: estimate_basis attached AND is_estimated False on the same
    product, because `and not has_native_points` let any native point mark the whole grid
    authoritative. Mixed now means estimated."""
    monkeypatch.setenv("MARINE_PARTITION_RATIO_FALLBACK", "1")
    prod = _normalize([_point(28.0, -80.0),                       # fabricated
                       _point(28.0, -78.0, with_secondary=(0.5, 120.0, 9.0))])  # native
    assert prod is not None
    assert prod.is_estimated is True, (
        "a product with ANY invented cell is not authoritative anywhere")
    assert (prod.estimate_basis or {}).get("method") == "wave_component_ratio_estimation"


def test_native_trains_pass_through_untouched(monkeypatch):
    monkeypatch.delenv("MARINE_PARTITION_RATIO_FALLBACK", raising=False)
    prod = _normalize([_point(28.0, -80.0, with_secondary=(0.5, 120.0, 9.0))])
    assert prod is not None
    valid = [v for v in prod.grid.vectors if v.is_valid]
    assert valid and valid[0].speed == pytest.approx(0.5)
    assert valid[0].direction == pytest.approx(120.0)
    assert prod.is_estimated is False and prod.estimate_basis is None


# ── the SUPPLIERS refuse fabricated trains by provenance ────────────────────────────────────────

class _Pt:
    def __init__(self, speed, period, direction):
        self.speed, self.period, self.direction = speed, period, direction


@pytest.mark.asyncio
async def test_the_point_lane_refuses_a_ratio_derived_train(monkeypatch):
    from services.weather_pipeline.point_resolution import PointResolutionService
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    svc = PointResolutionService.__new__(PointResolutionService)

    class _R:
        def __init__(self, pt, basis=None):
            self.point = pt
            self.estimate_basis = basis

    fabricated = {"method": "wave_component_ratio_estimation", "type": "gfs_derived_fallback"}

    async def fake_internal(model, domain, layer, lat, lng, valid_time_str, **kw):
        if layer == "swell_2":
            return _R(_Pt(0.35, 5.9, 130.0), basis=fabricated)     # the phantom
        return _R(_Pt(0.8, 10.0, 90.0))                            # real trains

    monkeypatch.setattr(svc, "_resolve_point_internal", fake_internal, raising=False)
    out = await svc._resolve_partitions("GFS", "waves", 28.25, -80.5, "t", 1.0)
    assert out is not None
    assert all(p["tp"] != 5.9 for p in out), "the fabricated train must not reach the rating"
    assert len(out) == 2


@pytest.mark.asyncio
async def test_the_hub_refuses_a_ratio_derived_product(monkeypatch):
    from services.weather_pipeline import spot_conditions
    monkeypatch.setenv("SURF_PARTITIONS", "1")

    class _Prod:
        def __init__(self, basis=None):
            self.estimate_basis = basis

    fabricated = _Prod({"method": "wave_component_ratio_estimation"})
    native = _Prod()

    class _Hub:
        def __init__(self):
            self.sampled = []
            self.sampler = self

        async def find_cached_grid_product(self, model, domain, layer, lat, lng, dt):
            return fabricated if layer == "swell_2" else native

        def sample_point(self, prod, lat, lng):
            self.sampled.append(prod)
            class _Res:
                point = _Pt(0.8, 10.0, 90.0)
            return _Res()

    hub = _Hub()
    out = await spot_conditions._spectral_partitions(hub, "GFS", 28.25, -80.5, None, 1.0)
    assert fabricated not in hub.sampled, "a fabricated product must not even be sampled"
    assert out is not None and len(out) == 2

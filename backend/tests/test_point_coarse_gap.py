"""
Regression: the Gulf-of-Mexico /point coverage gap (HANDOFF-2026-07-03 night-2 §4.1).

Live failure this encoded: Galveston TX (29.2,-94.7) has no regional tile and every bracketing
10-deg coarse center is land, so the manifest path served the nearest "ocean" cell — an ATLANTIC
cell at (30,-80), 14.7 deg away, off Florida — labeled inside_regional_tile / grid_parity=true.
Gulf users saw Atlantic water presented as authoritative.

The resolver must now:
  1. label global-coarse manifest serves honestly (inside_global_coarse, not inside_regional_tile);
  2. treat a DEGRADED marine sample from the global coarse (nearest_ocean_coarse_masked /
     unavailable / nearest fallback) as a coverage gap and prefer the true 0.25-deg upstream
     point (PATH 2c) — coverage_status coarse_gap_direct_point;
  3. keep the degraded coarse sample only as a fail-open last resort when upstream fails,
     flagged fallback_attempted + coarse_sample_degraded_direct_point_failed + grid_parity=false.
"""
import asyncio
from datetime import datetime, timezone
from pathlib import Path

from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
    ManifestProduct, PipelineManifest,
)

VALID_TIME = datetime(2026, 7, 3, 18, 0, 0, tzinfo=timezone.utc)
VALID_TIME_STR = "2026-07-03T18:00:00Z"
COARSE_FILENAME = "gfs_marine_waves_global_coarse_test.json"


def _coarse_global_product():
    """10-deg coarse grid reproducing the live Gulf pattern: the northern-Gulf centers
    (30, -90/-100) are land-masked; the Atlantic column at -80, the southern rows at 10/20 are
    valid — so Galveston gets a MASKED bilinear (the smear class) and (35,-95) gets nothing."""
    cov = CoverageBounds(west=-100.0, south=10.0, east=-80.0, north=40.0)
    valid = {(10, -100), (10, -90), (10, -80), (20, -100), (20, -90), (20, -80), (30, -80), (40, -80)}
    vectors = []
    for la in (10, 20, 30, 40):
        for lo in (-100, -90, -80):
            ok = (la, lo) in valid
            vectors.append(GridVector(
                lat=float(la), lng=float(lo),
                speed=(0.92 if ok else 0.0), direction=(96.0 if ok else 0.0),
                u=(-0.91 if ok else 0.0), v=(0.1 if ok else 0.0),
                period=(7.6 if ok else 0.0), is_valid=ok,
            ))
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=VALID_TIME, valid_time=VALID_TIME,
        is_forecast_authoritative=True, is_estimated=False, coverage=cov,
        grid=NormalizedGrid(bounds=cov, cols=3, rows=4, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        product_id=COARSE_FILENAME,
        source_variables=["wave_height"], freshness_sec=3600,
        region_id="global_coarse", coverage_mode="global_tile",
    )


def _manifest():
    return PipelineManifest(
        last_manifest_update=VALID_TIME,
        products=[ManifestProduct(
            model="GFS", provider="open-meteo", domain="marine", layer="waves",
            run_time=VALID_TIME, valid_time_start=VALID_TIME, valid_time_end=VALID_TIME,
            resolution=10.0, freshness_sec=3600, is_forecast_authoritative=True,
            coverage=CoverageBounds(west=-100.0, south=10.0, east=-80.0, north=40.0),
            filename=COARSE_FILENAME,
        )],
    )


class _FakeStore:
    def __init__(self, product, manifest):
        self._product = product
        self._manifest = manifest
        self.cache_dir = Path(".")

    def load_product(self, filename):
        return self._product if filename == self._product.product_id else None

    def get_manifest(self):
        return self._manifest


class _FakeDynamicIndex:
    def find_product_containing(self, **kwargs):
        return None


class _FakeProvider:
    FORECAST_MODELS = {"GFS": "gfs_seamless", "EURO": "ecmwf_ifs025", "ICON": "icon_seamless"}

    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    async def fetch_point(self, model, domain, layer, lat, lng, *args, **kwargs):
        self.calls.append((model, domain, layer, lat, lng))
        if self.fail:
            raise RuntimeError("upstream down")
        return {
            "latitude": lat,
            "longitude": lng,
            "hourly": {
                "time": [VALID_TIME_STR],
                "wave_height": [1.37],
                "wave_direction": [140.0],
                "wave_period": [6.2],
            },
        }


def _service(provider):
    return PointResolutionService(
        store=_FakeStore(_coarse_global_product(), _manifest()),
        dynamic_index=_FakeDynamicIndex(),
        provider=provider,
    )


def _resolve(service, lat, lng):
    return asyncio.run(service._resolve_point_internal(
        model="GFS", domain="marine", layer="waves",
        lat=lat, lng=lng, valid_time_str=VALID_TIME_STR,
    ))


def test_gulf_degraded_coarse_prefers_direct_point():
    # Galveston: a MASKED bilinear at 10-deg (2 land corners) renormalizes onto whatever open-ocean
    # neighbors exist — the smear class (Gulf of Oman read 3.07 m where GFS says 0.66 m). The
    # resolver must prefer the true upstream 0.25-deg point instead.
    provider = _FakeProvider()
    resp = _resolve(_service(provider), 29.2, -94.7)
    assert provider.calls, "expected the direct point API to be consulted"
    assert resp.source == "backend_direct_point"
    assert resp.coverage_status == "coarse_gap_direct_point"
    assert resp.fallback_attempted is True
    assert resp.fallback_reason == "coarse_sample_degraded"
    assert resp.point.speed == 1.37
    assert resp.point.direction == 140.0
    assert resp.grid_parity is False


def test_gulf_direct_point_failure_falls_back_to_coarse_sample():
    # Upstream down: fail OPEN with the degraded coarse sample (better than a 404), but honestly
    # flagged so diagnostics can see it is NOT the user's water.
    provider = _FakeProvider(fail=True)
    resp = _resolve(_service(provider), 29.2, -94.7)
    assert provider.calls, "expected the direct point API to be attempted first"
    assert resp.source == "grid_file"
    assert resp.coverage_status == "inside_global_coarse"
    assert resp.fallback_attempted is True
    assert resp.fallback_reason == "coarse_sample_degraded_direct_point_failed"
    assert resp.point.interpolation_method == "bilinear_ocean_masked"
    assert resp.grid_parity is False
    assert resp.gridParity is False


def test_global_coarse_full_bilinear_keeps_grid_serve_with_honest_label():
    # (15,-95): ALL 4 bracketing corners valid -> honest open-ocean bilinear (no land in the
    # block, no smear possible). Stays grid-served — no upstream call; only the label changed
    # (inside_global_coarse, was the inside_regional_tile mislabel).
    provider = _FakeProvider()
    resp = _resolve(_service(provider), 15.0, -95.0)
    assert not provider.calls, "healthy full-bilinear coarse sample must not hit upstream"
    assert resp.source == "grid_file"
    assert resp.coverage_status == "inside_global_coarse"
    assert resp.fallback_attempted is False
    assert resp.point.interpolation_method == "bilinear"
    assert resp.point.speed > 0.0
    assert resp.grid_parity is True


class _NullProvider(_FakeProvider):
    """Upstream responds, but with NULL wave heights (GFS does not model this point — inland)."""
    async def fetch_point(self, model, domain, layer, lat, lng, *args, **kwargs):
        self.calls.append((model, domain, layer, lat, lng))
        return {
            "latitude": lat, "longitude": lng,
            "hourly": {
                "time": [VALID_TIME_STR],
                "wave_height": [None],
                "wave_direction": [None],
                "wave_period": [None],
            },
        }


def test_deep_inland_null_upstream_never_serves_zeros():
    # (35,-95) Kansas-class: every bracketing corner masked AND nearest valid ocean >15 deg ->
    # sampler 'unavailable' -> falls through to direct point -> upstream returns NULLs (GFS does
    # not model land). The resolver must NOT coerce null->0.0 and serve it as data (live
    # regression probe 2026-07-03: Kansas read "0.0 m @ 0" as coarse_gap_direct_point); it must
    # return the stashed unavailable sample, whose 'unavailable' interpolation the frontend
    # conforms to "--".
    provider = _NullProvider()
    resp = _resolve(_service(provider), 35.0, -95.0)
    assert provider.calls, "direct point should be attempted"
    assert resp.source == "grid_file"
    assert resp.point.interpolation_method == "unavailable"
    assert resp.fallback_attempted is True

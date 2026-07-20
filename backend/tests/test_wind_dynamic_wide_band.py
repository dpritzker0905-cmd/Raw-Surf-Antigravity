"""WIND DYNAMIC WIDE BAND (2026-07-20 — "the clamp must fit the map").

THE ROOT: decide_manifest_product's global branch served the 10-degree global manifest for ANY
request span > 15.0 in EITHER axis. The client's fine tier therefore stopped asking for real
data above 15-deg viewports (z <~ 5.6): everything outside a leftover fine box was the 10-deg
smear — the user's "partially inaccurate / missing data" band. But the dynamic viewport lane's
choose_adaptive_resolution ladder handles wide spans natively (40x30 -> 2.0-deg cells,
90x67 -> 5.0-deg) at the SAME ~400-point upstream cost, so serving dynamic products for wide
WIND spans costs nothing extra and kills the smear everywhere below world zoom.

THE CHANGE (wind-scoped — marine's 15-deg gate feeds its own global_mid tier and is untouched):
wind requests use WIND_DYNAMIC_MAX_SPAN_DEG (default 100.0) as the manifest cut instead of 15.0.
Env-revert: WIND_DYNAMIC_MAX_SPAN_DEG=15 restores the old boundary exactly.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline.grid_resolver_selection import decide_manifest_product
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct


def _global_item(domain="wind", model="GFS", target_dt=None):
    target_dt = target_dt or datetime(2026, 7, 20, 3, 0, 0, tzinfo=timezone.utc)
    cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    return ManifestProduct(
        model=model, provider="open-meteo", domain=domain, layer="wind" if domain == "wind" else "waves",
        run_time=target_dt, valid_time_start=target_dt, valid_time_end=target_dt,
        resolution=10.0, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=cov, filename="prod_global.json", product_id="prod_global.json",
        region_id="global_coarse", coverage_mode="global_tile",
    )


TARGET = datetime(2026, 7, 20, 3, 0, 0, tzinfo=timezone.utc)


def _decide(item, w, s, e, n, domain, model="GFS", target_dt=TARGET):
    return decide_manifest_product(item, w, s, e, n, domain, model, target_dt)


class TestWindWideBand:
    def test_wind_40deg_span_prefers_dynamic(self):
        """The z~4 continental view: 40x30 deg. Old behavior: manifest (10-deg smear).
        New: dynamic (2.0-deg adaptive product)."""
        _, _, use_manifest, _ = _decide(_global_item(), -110.0, 5.0, -70.0, 35.0, "wind")
        assert use_manifest is False

    def test_wind_16deg_span_prefers_dynamic(self):
        """The exact 2026-07-20 user viewport (z5.55, 16.1 deg): was manifest, now dynamic."""
        _, _, use_manifest, _ = _decide(_global_item(), -87.83, 22.84, -71.73, 34.8, "wind")
        assert use_manifest is False

    def test_wind_beyond_wide_band_serves_manifest(self):
        """World-ish spans stay on the global manifest (dynamic res would be no better)."""
        _, _, use_manifest, _ = _decide(_global_item(), -170.0, -60.0, 170.0, 80.0, "wind")
        assert use_manifest is True

    def test_wind_small_span_still_dynamic(self):
        """The proven fine band is untouched."""
        _, _, use_manifest, _ = _decide(_global_item(), -85.0, 24.0, -74.0, 32.0, "wind")
        assert use_manifest is False

    def test_marine_gate_unchanged_at_15(self):
        """Marine's 15-deg boundary feeds its global_mid tier — a 16-deg marine request must
        still take the manifest path (where Step 3.6 swaps in the clipped mid)."""
        _, _, use_manifest, _ = _decide(_global_item(domain="marine"), -87.83, 22.84, -71.73, 34.8, "marine")
        assert use_manifest is True

    def test_env_revert_restores_15(self, monkeypatch):
        monkeypatch.setenv("WIND_DYNAMIC_MAX_SPAN_DEG", "15")
        _, _, use_manifest, _ = _decide(_global_item(), -87.83, 22.84, -71.73, 34.8, "wind")
        assert use_manifest is True

    def test_env_invalid_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("WIND_DYNAMIC_MAX_SPAN_DEG", "not-a-number")
        _, _, use_manifest, _ = _decide(_global_item(), -110.0, 5.0, -70.0, 35.0, "wind")
        assert use_manifest is False

    def test_icon_wind_horizon_guard_applies_inside_wide_band(self):
        """ICON wind past its 5-day native horizon must serve the manifest even in the widened
        band — the dynamic lane cannot build those hours."""
        far = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=9)
        _, _, use_manifest, _ = _decide(
            _global_item(model="ICON", target_dt=far), -110.0, 5.0, -70.0, 35.0, "wind",
            model="ICON", target_dt=far,
        )
        assert use_manifest is True

    def test_icon_wind_inside_horizon_wide_band_dynamic(self):
        near = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=2)
        _, _, use_manifest, _ = _decide(
            _global_item(model="ICON", target_dt=near), -110.0, 5.0, -70.0, 35.0, "wind",
            model="ICON", target_dt=near,
        )
        assert use_manifest is False

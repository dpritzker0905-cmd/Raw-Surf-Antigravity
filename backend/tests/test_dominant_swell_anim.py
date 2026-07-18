"""§3 Option A goldens — dominant-swell animation channel (WAVES_ANIM_DOMINANT_SWELL).

The TOTAL waves layer stamps direction/u/v from the dominant swell partition when that
partition carries >= WAVES_ANIM_SWELL_MIN_FRAC (default 0.35) of total wave energy
(height² ratio). Height (speed) stays TOTAL. Default OFF — flag unset must be a no-op.
"""
import math
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.normalizer import WeatherNormalizer

BBOX = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}
RESOLUTION = 6.0
TARGET_TIME = datetime(2026, 6, 1, 21, 0, tzinfo=timezone.utc)
UNITS = {
    "wave_height": "m", "wave_direction": "°", "wave_period": "s",
    "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
    "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°",
    "secondary_swell_wave_period": "s",
    "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s",
}


def _point(lat, lng, total_h, total_dir, s1_h=None, s1_d=None, s2_h=None, s2_d=None,
           include_swell_fields=True):
    hourly = {
        "time": ["2026-06-01T21:00:00Z"],
        "wave_height": [total_h], "wave_direction": [total_dir], "wave_period": [10.0],
    }
    if include_swell_fields:
        hourly["swell_wave_height"] = [s1_h]
        hourly["swell_wave_direction"] = [s1_d]
        hourly["swell_wave_period"] = [8.0]
        hourly["secondary_swell_wave_height"] = [s2_h]
        hourly["secondary_swell_wave_direction"] = [s2_d]
        hourly["secondary_swell_wave_period"] = [6.0]
        hourly["wind_wave_height"] = [0.2]
        hourly["wind_wave_direction"] = [300.0]
        hourly["wind_wave_period"] = [4.0]
    return {"latitude": lat, "longitude": lng, "hourly_units": UNITS, "hourly": hourly}


def _normalize(raw, layer="waves"):
    return WeatherNormalizer().normalize(
        model="GFS", provider="open-meteo", domain="marine", layer=layer,
        raw_results=raw, bbox=BBOX, resolution=RESOLUTION, target_time=TARGET_TIME,
    )


def _vec_at(product, lat, lng):
    for v in product.grid.vectors:
        if v.lat == lat and v.lng == lng:
            return v
    raise AssertionError(f"no vector at ({lat},{lng})")


def test_flag_off_is_noop(monkeypatch):
    monkeypatch.delenv("WAVES_ANIM_DOMINANT_SWELL", raising=False)
    raw = [_point(24.0, -85.0, 1.0, 90.0, s1_h=0.8, s1_d=100.0, s2_h=0.3, s2_d=110.0)]
    product = _normalize(raw)
    vec = _vec_at(product, 24.0, -85.0)
    assert vec.direction == 90.0
    assert "animChannel" not in product.grid.diagnostics


def test_flag_on_stamps_dominant_swell_direction_and_uv(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    # swell energy 0.8²/1.0² = 0.64 >= 0.35 -> stamp
    raw = [_point(24.0, -85.0, 1.0, 90.0, s1_h=0.8, s1_d=100.0, s2_h=0.3, s2_d=110.0)]
    product = _normalize(raw)
    vec = _vec_at(product, 24.0, -85.0)
    assert vec.direction == 100.0
    # height stays TOTAL, u/v recomputed from swell direction with total magnitude
    assert vec.speed == 1.0
    rad = math.radians(100.0)
    assert vec.u == pytest.approx(-1.0 * math.sin(rad), abs=1e-3)
    assert vec.v == pytest.approx(-1.0 * math.cos(rad), abs=1e-3)
    assert product.grid.diagnostics["animChannel"] == "dominant_swell"
    assert product.grid.diagnostics["swellStampedCount"] == 1


def test_flag_on_below_threshold_keeps_total_direction(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    # dominant swell energy 0.4²/1.0² = 0.16 < 0.35 -> keep total
    raw = [_point(24.0, -85.0, 1.0, 90.0, s1_h=0.4, s1_d=100.0, s2_h=0.3, s2_d=110.0)]
    product = _normalize(raw)
    vec = _vec_at(product, 24.0, -85.0)
    assert vec.direction == 90.0
    assert product.grid.diagnostics["swellStampedCount"] == 0


def test_flag_on_secondary_swell_wins_when_larger(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    # secondary 0.9 > primary 0.5; 0.9²/1.0² = 0.81 >= 0.35 -> stamp with secondary dir
    raw = [_point(24.0, -85.0, 1.0, 90.0, s1_h=0.5, s1_d=100.0, s2_h=0.9, s2_d=210.0)]
    product = _normalize(raw)
    vec = _vec_at(product, 24.0, -85.0)
    assert vec.direction == 210.0


def test_flag_on_without_partitions_is_noop(monkeypatch):
    """EURO WAM-style payload: totals only — the gate must never fire."""
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    raw = [_point(24.0, -85.0, 1.0, 90.0, include_swell_fields=False)]
    product = _normalize(raw)
    vec = _vec_at(product, 24.0, -85.0)
    assert vec.direction == 90.0
    assert product.grid.diagnostics["swellStampedCount"] == 0


def test_flag_on_component_layers_untouched(monkeypatch):
    """The stamp applies to the TOTAL waves layer only."""
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    raw = [_point(24.0, -85.0, 1.0, 90.0, s1_h=0.8, s1_d=100.0, s2_h=0.3, s2_d=110.0)]
    product = _normalize(raw, layer="swell_1")
    vec = _vec_at(product, 24.0, -85.0)
    assert vec.direction == 100.0  # swell_1's own direction, not restamped
    assert "animChannel" not in product.grid.diagnostics


def test_threshold_env_override(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    monkeypatch.setenv("WAVES_ANIM_SWELL_MIN_FRAC", "0.9")
    # 0.64 energy fraction < 0.9 override -> keep total
    raw = [_point(24.0, -85.0, 1.0, 90.0, s1_h=0.8, s1_d=100.0, s2_h=0.3, s2_d=110.0)]
    product = _normalize(raw)
    vec = _vec_at(product, 24.0, -85.0)
    assert vec.direction == 90.0


# ── §5i AVAILABILITY-COHERENCE goldens (2026-07-17 Driver-B stitching audit) ─────────────────────
# Upstream partition availability can END mid-product at an internal model edge; per-cell stamping
# painted a direction cliff there (the photographed offshore seam). Deferred stamping applies only
# when partitions exist over ≥95% of wave-active cells — seamless-or-unstamped. The per-cell ENERGY
# gate is untouched physics. Kill: WAVES_ANIM_SWELL_COHERENT=0.

def test_availability_edge_suppresses_stamping(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    raw = [
        _point(24.0, -85.0, 2.0, 90.0, s1_h=1.9, s1_d=200.0),                        # partition avail
        _point(24.0, -79.0, 2.0, 90.0, s1_h=None, s1_d=None, s2_h=None, s2_d=None),  # edge: no partitions
    ]
    p = _normalize(raw)
    d = p.grid.diagnostics
    assert d["swellStampSuppressed"] is True
    assert d["swellStampedCount"] == 0
    assert d["swellAvailFrac"] == pytest.approx(0.5)
    assert _vec_at(p, 24.0, -85.0).direction == pytest.approx(90.0)  # kept TOTAL — seamless


def test_full_availability_still_stamps(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    raw = [
        _point(24.0, -85.0, 2.0, 90.0, s1_h=1.9, s1_d=200.0),
        _point(24.0, -79.0, 2.0, 90.0, s1_h=1.8, s1_d=210.0),
    ]
    p = _normalize(raw)
    d = p.grid.diagnostics
    assert d["swellStampedCount"] == 2
    assert d["swellStampSuppressed"] is False
    assert d["swellAvailFrac"] == pytest.approx(1.0)
    assert _vec_at(p, 24.0, -85.0).direction == pytest.approx(200.0)


def test_coherence_kill_switch_restores_percell(monkeypatch):
    monkeypatch.setenv("WAVES_ANIM_DOMINANT_SWELL", "1")
    monkeypatch.setenv("WAVES_ANIM_SWELL_COHERENT", "0")
    raw = [
        _point(24.0, -85.0, 2.0, 90.0, s1_h=1.9, s1_d=200.0),
        _point(24.0, -79.0, 2.0, 90.0, s1_h=None, s1_d=None),
    ]
    p = _normalize(raw)
    assert p.grid.diagnostics["swellStampedCount"] == 1               # legacy per-cell (the seam)
    assert _vec_at(p, 24.0, -85.0).direction == pytest.approx(200.0)

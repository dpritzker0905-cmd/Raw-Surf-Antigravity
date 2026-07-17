"""SURF v3 acceptance tests (2026-07-17 nearshore-science audit).

Anchored to same-day ground truth (Surfline et al., 2026-07-17):
  - Flagler Ave NSB: offshore 0.35 m @ 7.4 s -> real-world knee (~0.3-0.45 m face). v2 said 0.18 m.
  - New Smyrna/Ponce Inlet: knee+ to thigh — ~1.4x its neighboring beach (the user's wave-magnet anchor).
  - Pipeline-class steep coast, long-period: surf JACKS above offshore Hs (v2 could never exceed it).
Each v3 leg is env-kill-switched; legacy parity under the kills is locked exactly.
"""
import math
import pytest

from services.weather_pipeline.surf_transform import (
    estimate_surf, shelf_dissipation, shoaling_coefficient, komar_breaker_height,
)
from services.weather_pipeline.surf_magnets import magnet_factor_at

# FL-class shelf cell (audit inputs): wide shallow shelf
FL = dict(Hs=0.35, Tp=7.4, depth=15.0, width=90.0)
V3_OFF = {"SURF_V3_KOMAR": "0", "SURF_V3_SHELF_RECAL": "0", "SURF_V3_EXPOSURE": "0", "SURF_V3_MAGNETS": "0"}


def _set(monkeypatch, env):
    for k, v in env.items():
        monkeypatch.setenv(k, v)


def test_legacy_parity_under_kill_switches(monkeypatch):
    """All v3 switches off == the exact v2 chain (Kf * Ks * Hs, unscaled CF)."""
    _set(monkeypatch, V3_OFF)
    surf, regime = estimate_surf(FL["Hs"], FL["Tp"], FL["depth"], coastal=True, shelf_width_km=FL["width"])
    Kf = shelf_dissipation(FL["Tp"], FL["depth"], FL["width"])
    Ks = shoaling_coefficient(FL["Tp"], FL["depth"])
    assert surf == pytest.approx(Kf * Ks * FL["Hs"], rel=1e-9)
    assert regime in ("shelf", "shoaling")


def test_fl_beach_reads_knee_class_not_half(monkeypatch):
    """v3 ON: FL-class beach lands in the real-world knee band (0.28-0.60 m), not v2's ~0.18 m."""
    surf, regime = estimate_surf(FL["Hs"], FL["Tp"], FL["depth"], coastal=True, shelf_width_km=FL["width"])
    assert surf is not None
    assert 0.28 <= surf <= 0.60, f"FL surf {surf:.3f} m outside knee band"
    # and it must beat the v2 underread
    _set(monkeypatch, V3_OFF)
    v2, _ = estimate_surf(FL["Hs"], FL["Tp"], FL["depth"], coastal=True, shelf_width_km=FL["width"])
    assert surf > v2 * 1.5


def test_steep_coast_long_period_jacks_above_offshore():
    """Pipeline-class: steep/narrow shelf + long-period groundswell -> surf EXCEEDS offshore Hs
    (the reef-jack v2 could never produce), bounded by the jack cap."""
    Hs, Tp = 2.0, 14.0
    surf, regime = estimate_surf(Hs, Tp, 30.0, coastal=True, shelf_width_km=2.0)
    assert surf > Hs, f"long-period steep-coast surf {surf:.2f} should jack above offshore {Hs}"
    assert surf <= 2.0 * Hs + 1e-9
    assert regime == "shoaling"


def test_jack_is_bounded_for_short_period_chop():
    """Komar over-amplification of tiny short-period chop is clamped by SURF_V3_JACK_MAX."""
    surf, _ = estimate_surf(0.10, 5.0, 30.0, coastal=True, shelf_width_km=2.0)
    assert surf <= 2.0 * 0.10 + 1e-9


def test_exposure_head_on_beats_angled():
    """Swell-angle exposure on the HEIGHT: head-on swell reads bigger than 80-degrees-off swell;
    unknown geometry fails open (no penalty)."""
    head_on, _ = estimate_surf(1.0, 10.0, 20.0, coastal=True, shelf_width_km=5.0,
                               swell_from_deg=90.0, shore_normal_deg=90.0)
    angled, _ = estimate_surf(1.0, 10.0, 20.0, coastal=True, shelf_width_km=5.0,
                              swell_from_deg=90.0, shore_normal_deg=10.0)
    unknown, _ = estimate_surf(1.0, 10.0, 20.0, coastal=True, shelf_width_km=5.0)
    assert head_on > angled
    assert unknown == pytest.approx(head_on, rel=1e-9)   # fail-open == head-on (factor 1.0)


def test_exposure_kill_switch(monkeypatch):
    monkeypatch.setenv("SURF_V3_EXPOSURE", "0")
    angled, _ = estimate_surf(1.0, 10.0, 20.0, coastal=True, shelf_width_km=5.0,
                              swell_from_deg=90.0, shore_normal_deg=10.0)
    plain, _ = estimate_surf(1.0, 10.0, 20.0, coastal=True, shelf_width_km=5.0)
    assert angled == pytest.approx(plain, rel=1e-9)


def test_magnet_table_nsb_inlet_vs_flagler():
    """The user's anchor: New Smyrna Inlet ~1.4x; Flagler Ave (7 km south) is OUTSIDE the radius."""
    f_inlet, name_inlet = magnet_factor_at(29.0650, -80.9180)
    f_flagler, name_flagler = magnet_factor_at(29.0266, -80.9050)
    assert f_inlet == pytest.approx(1.40)
    assert "Smyrna" in name_inlet
    assert f_flagler == 1.0 and name_flagler is None


def test_magnet_scales_the_estimate(monkeypatch):
    base, _ = estimate_surf(FL["Hs"], FL["Tp"], FL["depth"], coastal=True, shelf_width_km=FL["width"])
    boosted, _ = estimate_surf(FL["Hs"], FL["Tp"], FL["depth"], coastal=True, shelf_width_km=FL["width"],
                               magnet_factor=1.40)
    assert boosted == pytest.approx(base * 1.40, rel=1e-9)
    monkeypatch.setenv("SURF_V3_MAGNETS", "0")
    killed, _ = estimate_surf(FL["Hs"], FL["Tp"], FL["depth"], coastal=True, shelf_width_km=FL["width"],
                              magnet_factor=1.40)
    assert killed == pytest.approx(base, rel=1e-9)


def test_depth_cap_still_binds():
    """Depth-limited breaking still caps everything (a huge swell on a 2 m cell breaks at gamma_b*depth)."""
    surf, regime = estimate_surf(4.0, 12.0, 2.0, coastal=True, shelf_width_km=5.0)
    assert regime == "breaking"
    assert surf <= 1.05 * 2.0 + 1e-9   # GAMMA_MAX * depth


def test_non_coastal_and_calm_regimes_unchanged():
    assert estimate_surf(1.5, 9.0, 20.0, coastal=False) == (1.5, "open_ocean")
    assert estimate_surf(0.0, 9.0, 20.0) == (0.0, "calm")
    assert estimate_surf(None, 9.0, 20.0) == (None, "unknown")

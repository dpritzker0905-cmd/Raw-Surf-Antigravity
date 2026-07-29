"""Which wave-height STATISTIC do we call "the surf"?

`services/weather_pipeline/surf_height_convention.py`. Researched 2026-07-29: the published surf
standard is H1/10 (UHSLC; Caldwell 2007) and we emit Hs — a ~21% under-read. See
`docs/research/SURF-FORECASTING-SCIENCE.md` §1.

THE PROPERTIES THAT MUST HOLD:
  1. OFF is byte-identical. This flag changes every displayed height in the app; the disabled path
     must be provably unchanged, not approximately unchanged.
  2. It applies ONLY where the value is an unsaturated SIGNIFICANT height. The 'breaking' regime is
     already a γ·d individual-wave criterion — converting it double-counts.
  3. It lives at the ONE function every caller passes through, so a convention cannot be applied on
     the spot hub and not the map band (CLAUDE.md: ONE FORECAST COMPOSITION).
"""
import importlib
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import surf_height_convention as SHC   # noqa: E402
from services.weather_pipeline.surf_transform import estimate_surf    # noqa: E402


# ── THE PURE CONVERSION ─────────────────────────────────────────────────────────────────────────

def test_off_is_a_no_op(monkeypatch):
    monkeypatch.delenv("SURF_HEIGHT_H110", raising=False)
    for regime in ("shelf", "shoaling", "breaking", "open_ocean", "calm", "unknown"):
        assert SHC.to_surf_convention(1.234, regime) == 1.234


def test_on_converts_only_the_unsaturated_regimes(monkeypatch):
    monkeypatch.setenv("SURF_HEIGHT_H110", "1")
    assert SHC.to_surf_convention(1.0, "shelf") == pytest.approx(1.27)
    assert SHC.to_surf_convention(1.0, "shoaling") == pytest.approx(1.27)
    # ⚠️ The load-bearing exclusions.
    assert SHC.to_surf_convention(1.0, "breaking") == 1.0, (
        "the depth cap is already an individual-wave criterion — converting it double-counts")
    assert SHC.to_surf_convention(1.0, "open_ocean") == 1.0, "open ocean is not surf"
    assert SHC.to_surf_convention(0.0, "calm") == 0.0


def test_it_never_raises_on_junk(monkeypatch):
    monkeypatch.setenv("SURF_HEIGHT_H110", "1")
    assert SHC.to_surf_convention(None, "shelf") is None
    assert SHC.to_surf_convention("x", "shelf") == "x"
    assert SHC.to_surf_convention(float("nan"), "shelf") != SHC.to_surf_convention(1.0, "shelf")
    assert SHC.to_surf_convention(-1.0, "shelf") == -1.0


def test_describe_says_which_statistic_is_live(monkeypatch):
    """A height must be able to say what statistic it is — the provenance lesson."""
    monkeypatch.delenv("SURF_HEIGHT_H110", raising=False)
    assert SHC.describe()["surf_height_statistic"] == "Hs"
    assert SHC.describe()["factor_applied"] == 1.0
    monkeypatch.setenv("SURF_HEIGHT_H110", "1")
    assert SHC.describe()["surf_height_statistic"] == "H1/10"


# ── WIRED INTO THE TRANSFORM ────────────────────────────────────────────────────────────────────

# (Hs, Tp, depth, width) cases that exercise shelf / shoaling without hitting the depth cap.
CASES = [(1.0, 9.0, 25.0, 90.0), (1.5, 12.0, 40.0, 30.0), (0.5, 7.0, 20.0, 80.0),
         (2.0, 14.0, 100.0, 44.0), (0.8, 8.0, 60.0, 10.0)]


@pytest.mark.parametrize("hs,tp,depth,width", CASES)
def test_the_transform_is_byte_identical_when_off(monkeypatch, hs, tp, depth, width):
    """Property 1. Not 'close' — identical."""
    monkeypatch.delenv("SURF_HEIGHT_H110", raising=False)
    a = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width)
    monkeypatch.setenv("SURF_HEIGHT_H110", "0")
    b = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width)
    assert a == b


@pytest.mark.parametrize("hs,tp,depth,width", CASES)
def test_the_transform_scales_by_the_rayleigh_factor_when_on(monkeypatch, hs, tp, depth, width):
    monkeypatch.delenv("SURF_HEIGHT_H110", raising=False)
    off_h, off_regime = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width)
    monkeypatch.setenv("SURF_HEIGHT_H110", "1")
    on_h, on_regime = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width)
    assert on_regime == off_regime, "the convention must not change the REGIME, only the statistic"
    if off_regime in ("shelf", "shoaling"):
        assert on_h == pytest.approx(off_h * SHC.H110_OVER_HS)
    else:
        assert on_h == off_h


def test_open_ocean_is_untouched_even_when_on(monkeypatch):
    """A point with no shore carries swell, not surf — callers hide it, and it must not be inflated
    into looking like a bigger wave than the model said."""
    monkeypatch.setenv("SURF_HEIGHT_H110", "1")
    h, regime = estimate_surf(2.0, 12.0, 3000.0, coastal=False)
    assert regime == "open_ocean" and h == pytest.approx(2.0)


def test_a_depth_capped_break_is_not_inflated_past_its_cap(monkeypatch):
    """Property 2, end to end. Whatever the flag says, a depth-limited wave cannot exceed the
    physical cap — otherwise the convention would manufacture surf a shallow bank cannot hold."""
    monkeypatch.setenv("SURF_HEIGHT_H110", "1")
    h, regime = estimate_surf(6.0, 16.0, 2.0, coastal=True, shelf_width_km=1.0, break_depth_m=2.0)
    assert regime == "breaking"
    from services.weather_pipeline.surf_transform import breaker_index
    assert h <= breaker_index(16.0, slope=2.0 / 1000.0) * 2.0 + 1e-9


def test_the_conversion_is_at_the_single_shared_function():
    """Property 3, structurally. Every surf-height caller reaches `estimate_surf`; asserting the
    call site is IN that function is what stops the spot hub and the map band from disagreeing —
    the defect class that made the hub wrong by 93%."""
    import inspect
    from services.weather_pipeline import surf_transform
    src = inspect.getsource(surf_transform.estimate_surf)
    assert "to_surf_convention" in src, (
        "the convention has moved out of estimate_surf — every caller must share it")

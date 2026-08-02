"""ECMWF period bands -> partitions: the converter must not invent a sea.

The bands are `h1012`..`h2530` — six significant heights by period, published free on the ECMWF
Open-Data endpoint `ecmwf_opendata_fetcher` already uses, and currently unfetched. They matter
because `estimate_surf` is strongly NON-LINEAR in period, so transforming a sea at one blended Tp
is not the same operation as transforming it band by band.

These tests pin the three ways a converter like this goes wrong:
  1. it fabricates energy the model never reported (residual bigger than the total allows)
  2. it hides its own assumptions (the sub-10 s residual has NO published period or direction)
  3. it lets a non-finite value through, which renders as the TOP rating

⚠️ The bands carry NO direction — only `mwd` exists — so this is NOT a directional decomposition.
A test below pins that explicitly, because reading a band list as one would silently degrade the
per-train shore-normal exposure that makes the spectral path valuable.
"""
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.period_bands import (  # noqa: E402
    BAND_MIN_H_M, ECMWF_PERIOD_BANDS, band_centre_period, bands_represent, bands_to_partitions,
)

# A groundswell-dominated sea: most energy at 14-17 s, a little wind chop underneath.
_GROUNDSWELL = {"h1012": 0.30, "h1214": 0.55, "h1417": 1.20, "h1721": 0.40,
                "h2125": 0.00, "h2530": 0.00}


def _quad(*hs):
    return math.sqrt(sum(h * h for h in hs))


# ── SHAPE ───────────────────────────────────────────────────────────────────────────────────────

def test_band_centre_periods_are_inside_their_own_band():
    for name, lo, hi in ECMWF_PERIOD_BANDS:
        c = band_centre_period(lo, hi)
        assert lo < c < hi, f"{name} centre {c} outside [{lo},{hi}]"


def test_each_band_becomes_one_swell_train_at_its_own_period():
    """THE POINT OF THE WHOLE EXERCISE: six periods reach the transform instead of one."""
    parts, diag = bands_to_partitions(_GROUNDSWELL, total_h_m=None)
    assert diag["bands_used"] == 4                       # two bands are 0.0 and drop out
    tps = sorted(p["tp"] for p in parts)
    assert tps == [11.0, 13.0, 15.5, 19.0]
    assert all(p["kind"] == "swell" for p in parts)
    assert {p["band"] for p in parts} == {"h1012", "h1214", "h1417", "h1721"}


def test_a_band_below_the_low_energy_floor_is_dropped_not_kept_as_noise():
    parts, _ = bands_to_partitions({"h1012": BAND_MIN_H_M / 2, "h1417": 1.0}, total_h_m=None)
    assert [p["band"] for p in parts] == ["h1417"]


# ── THE RESIDUAL: the sub-10 s sea the bands do not resolve ─────────────────────────────────────

def test_the_residual_is_the_quadrature_complement_of_the_total():
    total = 1.8
    parts, diag = bands_to_partitions(_GROUNDSWELL, total_h_m=total, mean_period_s=7.5)
    expect = math.sqrt(total ** 2 - _quad(0.30, 0.55, 1.20, 0.40) ** 2)
    assert diag["residual_h"] == pytest.approx(expect, abs=1e-3)
    ws = [p for p in parts if p["kind"] == "windsea"]
    assert len(ws) == 1 and ws[0]["band"] == "estimated_residual"


def test_the_residual_period_is_stamped_as_estimated_and_kept_below_the_band_floor():
    """There is NO published period for the sub-10 s part. Using the sea's mean period is an
    assumption; it must be labelled and it must not masquerade as a 10 s+ train."""
    parts, _ = bands_to_partitions(_GROUNDSWELL, total_h_m=1.8, mean_period_s=13.0)
    ws = [p for p in parts if p["kind"] == "windsea"][0]
    assert ws["band"] == "estimated_residual"
    assert ws["tp"] < ECMWF_PERIOD_BANDS[0][1], "residual must sit below the lowest band's top"


def test_bands_exceeding_the_total_CLAMP_and_say_so_instead_of_going_imaginary():
    """THE FABRICATION GUARD. sqrt of a negative is where a converter invents a sea."""
    parts, diag = bands_to_partitions({"h1417": 2.0}, total_h_m=1.0, mean_period_s=8.0)
    assert diag["residual_clamped"] is True
    assert diag["residual_h"] == 0.0
    assert not [p for p in parts if p["kind"] == "windsea"], "a clamped residual must not ship"
    assert all(isinstance(p["h"], float) and p["h"] == p["h"] for p in parts)


def test_a_negligible_residual_is_dropped_rather_than_shipped_as_phantom_windsea():
    parts, diag = bands_to_partitions({"h1417": 1.0}, total_h_m=1.0005, mean_period_s=8.0)
    assert diag["covers_windsea"] is False
    assert not [p for p in parts if p["kind"] == "windsea"]


# ── HONESTY ABOUT WHAT THE BANDS ARE NOT ────────────────────────────────────────────────────────

def test_every_band_inherits_the_SAME_direction_because_bands_carry_none():
    """Pinned deliberately. ECMWF publishes one `mwd` for the whole sea, so this is NOT a
    directional decomposition and the per-train exposure factor is degenerate. If a future feed
    ever supplies per-band direction, THIS test is the one that should fail and be rewritten."""
    parts, _ = bands_to_partitions(_GROUNDSWELL, total_h_m=1.8, mean_dir_deg=295.0, mean_period_s=7.0)
    assert {p["dir"] for p in parts} == {295.0}


def test_missing_direction_and_period_degrade_instead_of_raising():
    parts, diag = bands_to_partitions(_GROUNDSWELL, total_h_m=1.8)
    assert parts and diag["bands_used"] == 4
    assert all(p["dir"] is None for p in parts)


# ── FAIL OPEN + NON-FINITE ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad", [None, {}, {"h1012": None}, {"h1012": float("nan")},
                                 {"h1012": "x"}, "not a dict"])
def test_unusable_input_yields_no_partitions_rather_than_an_exception(bad):
    parts, diag = bands_to_partitions(bad, total_h_m=1.5)
    assert [p for p in parts if p["kind"] == "swell"] == []
    assert diag["bands_used"] == 0


def test_a_NaN_band_never_reaches_the_partition_list():
    """NaN defeats `not h` AND `h <= 0`; only self-inequality catches it, and a NaN reaching the
    engine renders as 'epic'."""
    parts, _ = bands_to_partitions({"h1012": float("nan"), "h1417": 1.0}, total_h_m=None)
    assert [p["band"] for p in parts] == ["h1417"]


def test_a_NaN_total_does_not_produce_a_residual():
    _parts, diag = bands_to_partitions(_GROUNDSWELL, total_h_m=float("nan"))
    assert diag["residual_h"] is None and diag["covers_windsea"] is False


# ── THE GATE ────────────────────────────────────────────────────────────────────────────────────

def test_bands_representing_only_the_groundswell_are_still_VALID():
    """Unlike the CMEMS trains, bands legitimately carry only the >= 10 s part. On a wind-swell day
    that is a small fraction of the total and it is CORRECT — so there is no lower bound."""
    assert bands_represent({"h1417": 0.3}, total_h_m=2.0) is True


def test_bands_exceeding_the_total_are_REJECTED():
    assert bands_represent({"h1417": 3.0}, total_h_m=2.0) is False


@pytest.mark.parametrize("total", [None, 0, -1, float("nan"), "x"])
def test_the_gate_fails_CLOSED_on_an_unusable_total(total):
    assert bands_represent({"h1417": 1.0}, total_h_m=total) is False


def test_no_bands_is_not_a_decomposition():
    assert bands_represent({}, total_h_m=2.0) is False


# ── IT MUST PLUG INTO THE EXISTING CHAIN UNCHANGED ──────────────────────────────────────────────

def test_the_output_is_consumable_by_the_production_spectral_transform():
    """The whole point is to reuse `estimate_surf_partitioned`, never to add a second path."""
    from services.weather_pipeline.surf_transform import estimate_surf_partitioned
    parts, _ = bands_to_partitions(_GROUNDSWELL, total_h_m=1.8, mean_dir_deg=225.0, mean_period_s=7.0)
    h, regime = estimate_surf_partitioned(parts, depth_m=60.0, coastal=True, shelf_width_km=40.0,
                                          shore_normal_deg=225.0, break_depth_m=8.0)
    assert h is not None and h > 0 and isinstance(regime, str)


def test_it_survives_the_production_reconciler_unchanged():
    """`reconcile_partitions` is the SCALE half — the total stays authoritative. A band list must
    pass through it without special-casing."""
    from services.weather_pipeline.surf_transform import reconcile_partitions
    parts, _ = bands_to_partitions(_GROUNDSWELL, total_h_m=1.8, mean_period_s=7.0)
    out = reconcile_partitions(parts, 1.8)
    assert len(out) == len(parts)
    quad = math.sqrt(sum(float(p["h"]) ** 2 for p in out))
    assert quad == pytest.approx(1.8, rel=0.02)

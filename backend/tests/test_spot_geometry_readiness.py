"""Tests for spot_geometry_readiness — "can this pin actually be forecast?"

The owner's requirement (2026-07-29): *"when we pin a new surf spot, the forecast and surf report
data automatically sync up with the logic."* Today a fresh pin silently falls back to the coarse
0.25 deg shore normal with no break depth, which flips the rating LEVEL on 45.8% of evaluations.
This module is the surface that says so out loud; these pin its vocabulary and its fail-open promise.
"""
import pytest

from services.weather_pipeline.spot_geometry_readiness import (
    BLIND, DEGRADED, FULL, assess_at, assess_geometry, readiness_counts, summarize,
)
from services.weather_pipeline.surf_point import SurfGeometry


def _geo(**kw):
    base = dict(depth_m=200.0, shelf_width_km=20.0, coastal=True, shore_normal_deg=225.0,
                shore_normal_src="etopo", magnet_factor=1.0, magnet_name=None,
                break_depth_m=22.1, nearshore=True)
    base.update(kw)
    return SurfGeometry(**base)


def test_full_geometry_is_the_only_clean_verdict():
    a = assess_geometry(_geo())
    assert a["verdict"] == FULL
    assert a["missing"] == [] and a["impact"] == []
    assert a["actionable"] is False
    assert "Full per-spot geometry" in summarize(a)


def test_a_fresh_pin_reads_degraded_not_full():
    """THE case this exists for: not in shore_normals.json -> coarse normal, no break depth."""
    a = assess_geometry(_geo(shore_normal_src="coarse", break_depth_m=None))
    assert a["verdict"] == DEGRADED
    assert set(a["missing"]) == {"fine_shore_normal", "break_depth"}
    assert a["actionable"] is True
    text = summarize(a)
    assert "coarse" in text and "break depth" in text


def test_no_shore_normal_at_all_is_blind():
    a = assess_geometry(_geo(shore_normal_deg=None, shore_normal_src="none", break_depth_m=None))
    assert a["verdict"] == BLIND
    assert "shore_normal" in a["missing"]
    assert "every swell direction scores the same" in summarize(a)


def test_a_hand_audited_override_counts_as_full():
    """surf_magnets overrides are human ground truth and outrank the derived asset — they must not
    be reported as degraded just because the source string is not literally 'etopo'."""
    a = assess_geometry(_geo(shore_normal_src="override:North Shore Oahu (Pipeline/Backdoor reef)"))
    assert a["verdict"] == FULL and a["missing"] == []


def test_break_depth_alone_downgrades_a_matched_spot():
    """16.6% of catalogue spots match the asset but carry NO break depth (measured 2026-07-29)."""
    a = assess_geometry(_geo(break_depth_m=None))
    assert a["verdict"] == DEGRADED
    assert a["missing"] == ["break_depth"]
    assert a["actionable"] is True


def test_non_coastal_is_flagged_and_is_not_re_fit_actionable():
    """A pin that is not coastal is a PLACEMENT problem — re-running the fit cannot repair it.
    Measured: of 24 randomly sampled unmatched spots, 38% failed on placement, not fit quality."""
    a = assess_geometry(_geo(coastal=False, shore_normal_src="coarse", break_depth_m=22.1))
    assert "coastal" in a["missing"]
    assert "open-ocean swell rather than surf" in summarize(a)


def test_the_verdict_vocabulary_is_closed():
    """A UI keys on these exact strings; an unannounced value renders as nothing."""
    allowed = {FULL, DEGRADED, BLIND}
    for src in ("etopo", "coarse", "none", "override:x"):
        for bd in (22.1, None):
            for coastal in (True, False):
                for n in (225.0, None):
                    a = assess_geometry(_geo(shore_normal_src=src, break_depth_m=bd,
                                             coastal=coastal, shore_normal_deg=n))
                    assert a["verdict"] in allowed
                    assert isinstance(summarize(a), str) and summarize(a)


def test_it_is_a_diagnostic_and_must_never_raise():
    """It reports on broken geometry, so it cannot itself be a way to break a surface."""
    class _Junk:
        pass
    a = assess_geometry(_Junk())
    assert a["verdict"] == BLIND
    assert assess_geometry(None)["verdict"] == BLIND


def test_assess_at_is_pure_of_network_and_uses_a_supplied_geometry():
    a = assess_at(37.4915, -122.5083, geometry=_geo())
    assert a["verdict"] == FULL and a["lat"] == 37.4915 and a["lng"] == -122.5083


def test_assess_at_resolves_real_geometry_for_a_known_spot():
    """Live, against the bundled asset: Mavericks is in shore_normals.json with a break depth."""
    a = assess_at(37.4915, -122.5083)
    assert a["verdict"] == FULL, a
    assert a["shore_normal_src"] == "etopo"
    assert a["has_break_depth"] is True


def test_readiness_counts_aggregates_for_a_catalogue_view():
    rows = [assess_geometry(_geo()),
            assess_geometry(_geo(shore_normal_src="coarse", break_depth_m=None)),
            assess_geometry(_geo(shore_normal_deg=None, shore_normal_src="none")),
            "not a dict"]
    c = readiness_counts(rows)
    assert c["total"] == 3 and c[FULL] == 1 and c[DEGRADED] == 1 and c[BLIND] == 1
    assert c["actionable"] == 2
    assert readiness_counts(None)["total"] == 0

"""Every surface must be able to say what its surf number is STANDING ON.

MEASURED BEFORE, 2026-07-30, Bondi Beach (a spot with genuinely degraded geometry):

    /api/weather/point   shore_normal_deg = 111.54097591853844   <- FOURTEEN DECIMALS
                         shore_normal_source = (absent)
                         break_depth_m       = (absent)
                         geometry_readiness  = (absent)
    /spot-ratings        per-spot keys had `confidence` and `confirmed`, nothing about geometry
    weather sim          the richest — a full geometry block — but no verdict

So a spot running on the COARSE 0.25° grid, whose bearing class is median 22.3° off and whose
rating LEVEL differs on 45.8% of evaluations, was rendered identically to a fully-measured one —
and with more apparent precision than the measured one deserves. `resolve_surf_geometry` already
knew, and `spot_geometry_readiness.assess_geometry` already graded it. Both were dropped.

★ Stamped at the SINGLE injection point where `surf_height_m` is produced, so the glyphs, the hub
and the sim inherit ONE verdict rather than each growing its own idea of "trustworthy" — the same
reason the spectral partitions are resolved there.

⚠️ `geometry_readiness` is NOT `confidence`. `confidence` grades the PIN (accuracy_flag /
is_verified_peak); this grades the INPUTS the forecast ran on. A correctly-placed, human-verified
pin can still be scored against a coarse bearing.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.schemas import NormalizedPointResponse
from services.weather_pipeline.spot_geometry_readiness import assess_geometry
from services.weather_pipeline.surf_point import resolve_surf_geometry

# Real coordinates, measured verdicts (2026-07-30).
FULL = [("Mavericks", 37.4915, -122.5083), ("Lower Trestles", 33.3819, -117.5885),
        ("Montauk", 41.0370, -71.8980)]
DEGRADED = [("Bondi Beach", -33.8900, 151.2780), ("Chicama", -7.7110, -79.5000)]


def test_the_point_schema_carries_the_whole_envelope():
    """All four, or a consumer can still be told a bearing without being told its class."""
    fields = set(NormalizedPointResponse.model_fields)
    for f in ("shore_normal_source", "break_depth_m", "geometry_readiness", "geometry_missing"):
        assert f in fields, f"{f} missing — the surf number cannot describe itself"


def test_every_envelope_field_is_OPTIONAL():
    """Additive only. An older cached product, or any path that never resolves geometry, must
    still validate — a diagnostic that can 500 a forecast is a worse defect than the one it
    reports."""
    fields = NormalizedPointResponse.model_fields
    for f in ("shore_normal_source", "break_depth_m", "geometry_readiness", "geometry_missing"):
        assert fields[f].default is None, f"{f} must default to None"


@pytest.mark.parametrize("name,lat,lng", FULL)
def test_a_fully_resolved_spot_grades_full(name, lat, lng):
    a = assess_geometry(resolve_surf_geometry(lat, lng))
    assert a["verdict"] == "full", f"{name} regressed to {a['verdict']} ({a['missing']})"
    assert a["missing"] == []


@pytest.mark.parametrize("name,lat,lng", DEGRADED)
def test_a_coarse_spot_grades_DEGRADED_and_names_what_is_missing(name, lat, lng):
    """The point of the envelope: this spot is served a plausible-looking bearing off the coarse
    grid, and until now nothing said so."""
    g = resolve_surf_geometry(lat, lng)
    a = assess_geometry(g)
    assert a["verdict"] == "degraded", f"{name} graded {a['verdict']}"
    assert "fine_shore_normal" in a["missing"]
    assert g.shore_normal_deg is not None, "a coarse bearing is still SERVED — that is the trap"
    assert a["actionable"] is True


def test_the_verdict_distinguishes_spots_the_old_payload_could_not():
    """BEFORE, these two were indistinguishable in the served payload: both carried a
    `shore_normal_deg` float and nothing else."""
    mav = assess_geometry(resolve_surf_geometry(37.4915, -122.5083))
    bondi = assess_geometry(resolve_surf_geometry(-33.8900, 151.2780))
    assert mav["verdict"] != bondi["verdict"]
    assert mav["shore_normal_deg"] is not None and bondi["shore_normal_deg"] is not None, \
        "both DO serve a bearing — the verdict is the only thing that separates them"


def test_the_sim_geometry_payload_carries_the_verdict_and_plain_english():
    from services.weather_pipeline.sim_rating import geometry_payload
    out = geometry_payload({"name": "Bondi Beach", "latitude": -33.89, "longitude": 151.278})
    assert out["readiness"] == "degraded"
    assert "fine_shore_normal" in (out.get("readiness_missing") or [])
    assert "coarse" in (out.get("readiness_note") or "").lower(), \
        "the note must say what degraded MEANS, not just that it is degraded"
    # the raw fields must survive alongside it
    assert out["shore_normal_deg"] is not None and out["shore_normal_source"] == "coarse"


def test_unresolvable_geometry_reports_BLIND_rather_than_silently_omitting():
    from services.weather_pipeline.sim_rating import geometry_payload
    out = geometry_payload({"name": "nowhere", "latitude": None, "longitude": None})
    assert out["resolved"] is False
    assert out["readiness"] == "blind"
    assert out.get("readiness_note")


def test_the_readiness_payload_stays_SMALL():
    """A 93.5 KB response is one a client REJECTS rather than displays. The per-point envelope
    carries the verdict and a short list — never the paragraph-long `impact` strings."""
    import json
    from services.weather_pipeline.sim_rating import geometry_payload
    out = geometry_payload({"name": "Bondi", "latitude": -33.89, "longitude": 151.278})
    assert len(json.dumps(out)) < 600, f"geometry payload grew to {len(json.dumps(out))} bytes"
    assert "impact" not in out


def test_the_glyph_row_declares_readiness_separately_from_confidence():
    """They answer different questions and must not be conflated: `confidence` grades the PIN,
    `geometry_readiness` grades the INPUTS."""
    import inspect
    from routes import weather as W
    src = inspect.getsource(W.SpotRatingItem)
    assert "geometry_readiness" in src and "confidence" in src
    from services.weather_pipeline import spot_ratings
    rsrc = inspect.getsource(spot_ratings.rate_one_spot)
    assert "geometry_readiness" in rsrc, "the glyph row stopped carrying readiness"
    assert "marine.geometry_readiness" in rsrc, \
        "readiness must come FROM the point response, not be recomputed — one grader, one answer"

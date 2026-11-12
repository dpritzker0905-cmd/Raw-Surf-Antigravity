"""LAND WITHOUT A BEARING — the second small-island set, and the refusal that guards it.

MASTER-AUDIT-11.0 §3.5: 16 served spots (Maldives passes, Rangiroa, Chuuk, Kwajalein, Noronha's
second peak, Cape Verde) published the OFFSHORE Hs as the surf height — CLAUDE.md's first binding
rule — because they are absent from the bearing asset: run for them 2026-08-09, the fit MEASURED a
463 m shoreline at 0.08–2.11 km on 14 but REFUSED every bearing (spreads 46–172°; atoll coasts
bend every direction, and the confidence gate is right not to guess). The fix is the weaker claim
carried separately: a `land_present` asset section that promotes `coastal` ONLY — no bearing, no
exposure, the fitted break depth when one exists. The two census coords whose fit found NO
shoreline at all (~370 m of water; mis-geocoded) are deliberately NOT in the section: promoting
them would fabricate land, and their continued refusal is pinned here as the control.

The Jacobian is the fingerprint throughout (the coastal-promotion suite's own instrument):
dFt/dHs == 3.28084 exactly and CONSTANT means the metres→feet identity — no transform ran."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import shore_normal_asset as SNA          # noqa: E402
from services.weather_pipeline.shore_normal_asset import (               # noqa: E402
    LAND_PRESENT_MAX_KM, MATCH_RADIUS_KM, land_present_at)
from services.weather_pipeline.surf_point import (                       # noqa: E402
    estimate_surf_at, resolve_surf_geometry)

FT = 3.28084
ASSET = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "services", "weather_pipeline", "data", "shore_normals.json")
REFUSED = ((3.9380, 73.2480), (3.9680, 73.2680))     # Quarters, Yin Yang — no shoreline found


def _doc():
    with open(ASSET) as fh:
        return json.load(fh)


def test_the_land_section_respects_its_own_gate():
    """Same discipline as the bearing entries' gate test: every shipped land entry must be a legal
    claim — a shoreline distance inside the bound, never a bearing."""
    doc = _doc()
    rows = doc.get("land_present")
    assert rows, "the land_present section is gone — the 14 atoll spots are offshore again"
    assert doc["land_present_max_km"] == LAND_PRESENT_MAX_KM <= 3.0
    for row in rows:
        assert len(row) == 4, f"arity {len(row)}: a land entry must never grow a bearing slot"
        lat, lng, skm, depth = row
        assert -90 <= lat <= 90 and -180 <= lng <= 180
        assert 0.0 < skm <= doc["land_present_max_km"], f"{skm} km breaches the section's own bound"
        assert depth is None or depth > 0.0
    # the two refused coords must NOT be in the section — their absence IS the refusal
    for rlat, rlng in REFUSED:
        assert not any(abs(r[0] - rlat) < 1e-4 and abs(r[1] - rlng) < 1e-4 for r in rows), (
            "a no-shoreline coordinate entered land_present — land evidence was fabricated")


def test_every_land_entry_promotes_coastal_without_claiming_a_bearing():
    rows = _doc()["land_present"]
    for lat, lng, skm, depth in rows:
        g = resolve_surf_geometry(lat, lng)
        assert g.coastal is True, f"({lat},{lng}) regressed to open_ocean"
        assert g.shore_normal_src == "none", (
            f"({lat},{lng}) claims src={g.shore_normal_src} — the land bit must never "
            f"manufacture a bearing")
        if depth is not None:
            assert g.break_depth_m == pytest.approx(depth), (
                f"({lat},{lng}) lost the fitted break depth the cap needs")


def test_a_promoted_spot_actually_transforms_the_jacobian_fingerprint():
    lat, lng, _, _ = _doc()["land_present"][0]
    h1, r1 = estimate_surf_at(lat, lng, 1.0, 14.0, 315.0, geometry=resolve_surf_geometry(lat, lng))
    h2, r2 = estimate_surf_at(lat, lng, 2.0, 14.0, 315.0, geometry=resolve_surf_geometry(lat, lng))
    jac = (h2 - h1) * FT
    assert abs(jac - FT) > 0.1, (
        f"dFt/dHs = {jac:.5f} == the metres->feet identity: the offshore number is being served "
        f"under the surf label again")
    assert r1 != "open_ocean" and r2 != "open_ocean"


def test_the_two_misgeocoded_coords_stay_refused_the_control():
    """Their fit found NO shoreline (elev ~-370 m, n_windows=0). Refusal must hold: a monitor that
    cannot leave a spot unfixed would fabricate land the instrument never measured."""
    for lat, lng in REFUSED:
        g = resolve_surf_geometry(lat, lng)
        assert g.coastal is False and g.shore_normal_src == "none"
        h1, _ = estimate_surf_at(lat, lng, 1.0, 14.0, 315.0, geometry=g)
        h2, _ = estimate_surf_at(lat, lng, 2.0, 14.0, 315.0, geometry=g)
        assert (h2 - h1) * FT == pytest.approx(FT, abs=1e-6)      # identity — honest offshore


def test_the_kill_switch_restores_open_ocean_exactly(monkeypatch):
    lat, lng, _, _ = _doc()["land_present"][0]
    assert resolve_surf_geometry(lat, lng).coastal is True
    monkeypatch.setenv("SURF_COASTAL_FROM_LAND_BIT", "0")
    g = resolve_surf_geometry(lat, lng)
    assert g.coastal is False, "SURF_COASTAL_FROM_LAND_BIT=0 must restore the pre-fix geometry"


def test_land_lookup_matches_at_the_spot_and_refuses_across_the_radius():
    lat, lng, skm, depth = _doc()["land_present"][0]
    hit = land_present_at(lat, lng)
    assert hit == (pytest.approx(skm), depth if depth is None else pytest.approx(depth))
    far = land_present_at(lat + (MATCH_RADIUS_KM + 1.5) / 111.32, lng)
    assert far is None, "the land bit answered from beyond MATCH_RADIUS_KM — radius crept"


def test_the_asset_kill_switch_covers_the_land_section_too(monkeypatch):
    monkeypatch.setenv("SHORE_NORMAL_ASSET", "0")
    lat, lng, _, _ = _doc()["land_present"][0]
    assert land_present_at(lat, lng) is None


# ── CMP-3 (audit 2026-11-10): the rating reads the SAME break depth the height's cap used ─────────

def _rating_break_depth(monkeypatch, lat, lng, flag=None):
    """The break_depth_m rate_one_spot hands compute_surf_rating, via the REAL augment."""
    import asyncio
    from datetime import datetime, timezone
    from services.weather_pipeline import spot_ratings as SRT
    from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    monkeypatch.setenv("SURF_TIDE_DEPTH", "0")
    if flag is None:
        monkeypatch.delenv("RATING_BREAK_DEPTH_FROM_GEOMETRY", raising=False)
    else:
        monkeypatch.setenv("RATING_BREAK_DEPTH_FROM_GEOMETRY", flag)
    t0 = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)

    def resp(domain, layer, speed, direction, period):
        return NormalizedPointResponse(
            model="GFS", provider="open-meteo", domain=domain, layer=layer, run_time=t0, valid_time=t0,
            is_forecast_authoritative=True, is_estimated=False,
            point=NormalizedPointDetail(requested_lat=0, requested_lng=0, sampled_lat=0, sampled_lng=0,
                                        speed=speed, direction=direction, u=0.0, v=0.0, period=period,
                                        interpolation_method="exact_match"),
            value_kind="wave_height" if domain == "marine" else "wind_speed",
            value_unit="m" if domain == "marine" else "kn", display_unit_hint="ft",
            source_variables=["x"], freshness_sec=0)

    class R:
        async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str, **_k):
            if domain == "marine":
                async def _np(*_a, **_kw):
                    return None
                return await augment_with_surf(resp("marine", layer, 2.0, 180.0, 12.0), model, domain, layer,
                                               lat, lng, valid_time_str, _np)
            return resp("wind", "wind", 5.0, 0.0, None)

    seen = {}
    real = SRT.compute_surf_rating

    def spy(*a, **kw):
        seen["bd"] = kw.get("break_depth_m")
        return real(*a, **kw)
    monkeypatch.setattr(SRT, "compute_surf_rating", spy)
    asyncio.run(SRT.rate_one_spot(R(), {"id": "x", "name": "x", "latitude": lat, "longitude": lng},
                                  "GFS", "2026-11-10T12:00:00Z"))
    return seen["bd"]


def test_rating_and_height_read_the_same_break_depth_at_every_land_present_coord(monkeypatch):
    rows = _doc()["land_present"]
    assert len(rows) == 14
    for lat, lng, _skm, _d in rows:
        assert _rating_break_depth(monkeypatch, lat, lng) == resolve_surf_geometry(lat, lng).break_depth_m, (lat, lng)


def test_the_kill_switch_restores_the_independent_break_depth_read(monkeypatch):
    from services.weather_pipeline.shore_normal_asset import break_depth_at
    lat, lng, _skm, _d = next(r for r in _doc()["land_present"] if r[3] is not None)
    assert resolve_surf_geometry(lat, lng).break_depth_m is not None and break_depth_at(lat, lng) is None
    assert _rating_break_depth(monkeypatch, lat, lng, flag="0") is None

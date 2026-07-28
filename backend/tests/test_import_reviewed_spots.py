"""The import duplicate gate — `scripts/import_reviewed_spots.duplicate_of`.

WHY THESE EXIST
---------------
The 2026-07-27 EEA import added 305 spots and introduced exactly 2 duplicates, found by a sweep the
next day:

    COXOS        vs  Coxos          2.17 km apart
    CONSOLAÇÃO   vs  Consolação     3.20 km apart

Both sit just OUTSIDE the 2.0 km proximity radius, so the distance-only gate could never have
caught them. ★ The reason is structural: an official gazetteer's coordinate for a break routinely
sits 2-3 km from a surf catalogue's (the gazetteer names a BEACH, the catalogue names a PEAK), so
distance cannot separate "a new spot near an existing one" from "the same break, pinned
differently". Only the name can.

A duplicate is worse than a gap: it permanently splits reports, ratings and search between two rows
that both look real.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from scripts.import_reviewed_spots import DEDUPE_KM, duplicate_of, haversine_km  # noqa: E402
from scripts.find_missing_spots import SAME_BREAK_KM  # noqa: E402

# The real production rows, at their real coordinates.
COXOS = ("Coxos", 38.9967, -9.4189)
CONSOLACAO = ("Consolação", 39.3167, -9.365)


def _at(lat, lng, km, bearing_east=True):
    """A point `km` away — east (longitude) or north (latitude)."""
    return (lat, lng + km / (111.0 * 0.777)) if bearing_east else (lat + km / 111.0, lng)


# ── The two that actually got through ─────────────────────────────────────────────────────────

def test_the_coxos_duplicate_is_now_refused():
    """2.17 km — outside the 2.0 km radius, identical name."""
    lat, lng = _at(COXOS[1], COXOS[2], 2.17)
    assert haversine_km(COXOS[1], COXOS[2], lat, lng) > DEDUPE_KM      # distance alone misses it
    clash, by_name = duplicate_of("COXOS", lat, lng, [COXOS])
    assert clash == "Coxos" and by_name is True


def test_the_consolacao_duplicate_is_now_refused():
    """3.20 km, and the accents differ — the matcher strips them."""
    lat, lng = _at(CONSOLACAO[1], CONSOLACAO[2], 3.20)
    assert haversine_km(CONSOLACAO[1], CONSOLACAO[2], lat, lng) > DEDUPE_KM
    clash, by_name = duplicate_of("CONSOLAÇÃO", lat, lng, [CONSOLACAO])
    assert clash == "Consolação" and by_name is True


# ── The gate must not become a blanket refusal ────────────────────────────────────────────────

def test_a_genuinely_different_break_nearby_is_still_imported():
    """`Rincon - Domes` and `Rincon - Indicators` are REAL separate peaks ~1.5 km apart. A shared
    first token must not merge them, or the catalogue loses every named peak on a point."""
    domes = ("Rincon - Domes", 18.368, -67.258)
    lat, lng = _at(domes[1], domes[2], 3.0)
    clash, _ = duplicate_of("Rincon - Indicators", lat, lng, [domes])
    assert clash is None


def test_an_unrelated_name_just_outside_the_radius_is_imported():
    lat, lng = _at(COXOS[1], COXOS[2], 5.0)
    assert duplicate_of("Praia da Empa", lat, lng, [COXOS]) == (None, False)


def test_a_far_away_spot_with_the_same_name_is_not_a_duplicate():
    """`Miramar` exists twice in the catalogue 9098 km apart — both are real. The name gate is
    bounded by SAME_BREAK_KM precisely so a common name cannot block the other side of the world."""
    lat, lng = _at(COXOS[1], COXOS[2], SAME_BREAK_KM + 5)
    assert duplicate_of("Coxos", lat, lng, [COXOS]) == (None, False)


# ── The proximity tier still stands on its own ────────────────────────────────────────────────

def test_anything_inside_the_proximity_radius_is_refused_regardless_of_name():
    lat, lng = _at(COXOS[1], COXOS[2], 1.0)
    clash, by_name = duplicate_of("Something Else Entirely", lat, lng, [COXOS])
    assert clash == "Coxos"
    assert by_name is False        # caught by DISTANCE, and reported as such


@pytest.mark.parametrize("km", [0.1, 1.0, 1.9])
def test_the_proximity_tier_is_unchanged(km):
    lat, lng = _at(COXOS[1], COXOS[2], km)
    assert duplicate_of("Whatever", lat, lng, [COXOS])[0] == "Coxos"


# ── The prefilter box must not re-narrow the gate ─────────────────────────────────────────────

def test_the_prefilter_box_covers_the_whole_name_match_radius():
    """★ The original bug lived in a 0.05 deg (~5.5 km) prefilter box. A name gate reaching to
    8 km is useless if the box excludes the 5.5-8 km band, so this walks the full radius."""
    for km in (2.5, 4.0, 5.6, 6.5, 7.9):
        for east in (True, False):
            lat, lng = _at(COXOS[1], COXOS[2], km, east)
            clash, by_name = duplicate_of("Coxos", lat, lng, [COXOS])
            assert clash == "Coxos", f"missed a name duplicate at {km} km (east={east})"
            assert by_name is True


def test_rows_without_coordinates_are_skipped_not_crashed():
    assert duplicate_of("Coxos", 38.99, -9.41, [("Ghost", None, None)]) == (None, False)

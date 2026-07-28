"""The duplicate-triage classifier — calibrated against pairs a human already adjudicated.

The 2026-07-27 sweep produced a table of name-matching pairs and the owner/analysis assigned each a
verdict. Those verdicts are the ground truth here: ★ an instrument is calibrated against a KNOWN
result before it is trusted on new data (the same discipline that validated the neighbour-band
shore-normal instrument at 6.2 deg against OSM's 6.4 deg).

The classifier's job is NOT "do these names overlap" — `names_match` already answers that. It is
"what does the DIFFERENCE between them mean": positional differences (north/south/upper/lower/
90th/jetty) mark two real peaks on one feature; an empty or decorative difference marks one break
written twice.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from scripts.triage_duplicate_spots import classify, find_pairs  # noqa: E402


# ── Adjudicated 2026-07-27 as REAL, DISTINCT PEAKS — merging these would destroy a break ──────
REAL_DISTINCT = [
    ("Ponce Inlet North Jetty", "Ponce Inlet South Jetty", 0.15),
    ("Sebastian Inlet South Jetty", "Sebastian Inlet North Jetty", 0.30),
    ("Rockaway Beach 90th Street", "Rockaway Beach 92nd Street", 0.39),
    ("Lower Trestles", "Upper Trestles", 0.38),
]

# ── Adjudicated as DUPLICATES — one break written twice ───────────────────────────────────────
REAL_DUPLICATES = [
    ("Teahupo'o", "Teahupoo", 0.14),
    ("Uluwatu", "Uluwatu - The Peak", 0.35),
    ("Margaret River", "Main Break Margaret River", 0.37),
    ("La Nord", "La Nord Hossegor", 0.40),
    ("Ala Moana Beach", "Ala Moana Bowls", 0.42),
    ("COXOS", "Coxos", 2.17),
    ("CONSOLAÇÃO", "Consolação", 3.20),
]


@pytest.mark.parametrize("a,b,km", REAL_DISTINCT)
def test_real_separate_peaks_are_never_offered_for_merge(a, b, km):
    """★ THE EXPENSIVE MISTAKE. Merging Upper into Lower Trestles deletes a world-class peak, and
    unlike a duplicate it cannot be noticed by looking at the map."""
    tier, why = classify(a, b, km)
    assert tier == "DISTINCT_PEAKS", (a, b, tier, why)


@pytest.mark.parametrize("a,b,km", REAL_DUPLICATES)
def test_real_duplicates_are_surfaced(a, b, km):
    tier, _ = classify(a, b, km)
    assert tier != "DISTINCT_PEAKS", (a, b, tier)


def test_the_apostrophe_pair_is_the_unambiguous_case():
    """`Teahupo'o` vs `Teahupoo` at 140 m — the clearest single defect in the catalogue, and
    invisible to dedup_surf_spots.py because it groups on exact string equality."""
    tier, why = classify("Teahupo'o", "Teahupoo", 0.14)
    assert tier == "IDENTICAL"
    assert "normalisation" in why


def test_case_and_accent_variants_are_identical_not_merely_similar():
    for a, b in (("COXOS", "Coxos"), ("CONSOLAÇÃO", "Consolação"), ("El Médano", "El Medano")):
        assert classify(a, b, 1.0)[0] == "IDENTICAL", (a, b)


def test_a_contained_name_is_a_variant_needing_review_not_an_auto_merge():
    """`Uluwatu` vs `Uluwatu - The Peak` is probably one break — but 'probably' is not a mandate to
    delete a row, so it lands in the tier a human reads."""
    tier, _ = classify("Uluwatu", "Uluwatu - The Peak", 0.35)
    assert tier == "VARIANT"


def test_numbered_streets_count_as_positional_without_being_listed():
    """90th/92nd are not in the POSITIONAL set — digits make a token positional by construction, so
    the rule generalises to street grids nobody enumerated."""
    assert classify("Rockaway Beach 90th Street", "Rockaway Beach 92nd Street", 0.39)[0] \
        == "DISTINCT_PEAKS"
    assert classify("Ocean City 12th St", "Ocean City 40th St", 3.0)[0] == "DISTINCT_PEAKS"


def test_pair_finding_respects_distance_and_reports_both_ids():
    spots = [
        {"id": "a", "name": "Teahupo'o", "latitude": -17.8480, "longitude": -149.2670,
         "region": "Tahiti", "is_active": True},
        {"id": "b", "name": "Teahupoo", "latitude": -17.8492, "longitude": -149.2673,
         "region": "Tahiti", "is_active": True},
        # same name, far away — the Miramar case, two real spots that share a name
        {"id": "c", "name": "Teahupoo", "latitude": 20.0, "longitude": -150.0,
         "region": "Elsewhere", "is_active": True},
    ]
    pairs = find_pairs(spots)
    assert len(pairs) == 1
    assert {pairs[0]["id_a"], pairs[0]["id_b"]} == {"a", "b"}
    assert pairs[0]["tier"] == "IDENTICAL"
    assert pairs[0]["km"] < 0.3


def test_unrelated_neighbours_produce_no_pair():
    spots = [
        {"id": "a", "name": "Pipeline", "latitude": 21.664, "longitude": -158.051,
         "region": "North Shore", "is_active": True},
        {"id": "b", "name": "Sunset Beach", "latitude": 21.678, "longitude": -158.040,
         "region": "North Shore", "is_active": True},
    ]
    assert find_pairs(spots) == []

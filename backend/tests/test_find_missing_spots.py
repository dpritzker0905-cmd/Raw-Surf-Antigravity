"""
Guards the duplicate gate in `scripts/find_missing_spots.py`.

The tool decided "absent from the catalogue" on PROXIMITY ALONE (nothing within 2 km). Measured
2026-07-27 against production, that verdict was wrong for four of its own headline results —
Jaws, Cloud 9, Mavericks and Guincho are all in the catalogue under slightly different names,
2.42-5.13 km from the Wikidata coordinate. Acting on it would have created a duplicate of four of
the most famous breaks in the world, and a duplicate is worse than a gap: it splits reports,
ratings and search between two rows that both look real.

A name match a few km away is a PLACEMENT DISCREPANCY, not a missing break.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from scripts.find_missing_spots import (  # noqa: E402
    NEAR_KM, SAME_BREAK_KM, haversine_km, names_match, normalise_name)


# (wikidata name, catalogue name) pairs that ARE the same break — every one measured in production.
SAME = [
    ("Jaws", "Jaws (Peahi)"),
    ("Cloud 9", "Cloud 9"),
    ("Guincho Beach", "Guincho"),
    ("Mavericks", "Mavericks"),
    ("El Médano", "El Medano"),          # accent folding
    ("Pipeline", "Pipeline Backdoor"),
]

# Pairs the tool actually produced as "nearest existing spot" and which are NOT the same break.
DIFFERENT = [
    ("Shipstern Bluff", "Newport"),
    ("Belharra", "Saint-Jean-de-Luz"),
    ("Lunada Ba", "Apache Pier"),        # 3636 km apart — the latitude-only prefilter's doing
    ("Scheveningen", "Inch Beach"),
    ("Malibu", "Manly Beach"),
    ("Brouwersdam", "Brouwer"),          # substring, but no shared token after normalisation
]


@pytest.mark.parametrize("a,b", SAME)
def test_same_break_is_recognised(a, b):
    assert names_match(a, b) is True, (a, b)


@pytest.mark.parametrize("a,b", DIFFERENT)
def test_different_breaks_are_not_conflated(a, b):
    assert names_match(a, b) is False, (a, b)


def test_generic_words_alone_never_match():
    """'Beach'/'Point'/'Bay' are decoration — matching on them would merge unrelated spots."""
    for a, b in (("Sunset Beach", "Manly Beach"), ("Long Point", "Steamer Point"),
                 ("Playa Grande", "Playa Hermosa")):
        assert names_match(a, b) is False, (a, b)


def test_empty_and_none_names_do_not_match():
    for a, b in ((None, "Jaws"), ("Jaws", None), ("", "Jaws"), ("   ", "Jaws"), (None, None)):
        assert names_match(a, b) is False, (a, b)


def test_normalisation_strips_decoration_and_accents():
    assert normalise_name("Jaws (Pe'ahi)") == {"jaws", "peahi"}
    # `el` is dropped as of 2026-07-28 — articles carry no identity. "El Médano"/"El Medano" still
    # match on {medano}, which is the pair that assertion was protecting.
    assert normalise_name("El Médano") == {"medano"}
    assert normalise_name("The Point") == set()          # pure decoration -> nothing to match on


def test_shared_connectives_alone_are_not_a_match():
    """MEASURED false positive: replaying the EEA import rejected `MADALENA DO MAR` as a duplicate
    of `Jardim do Mar` — two distinct Madeira villages — on the shared tokens {do, mar}. Iberian
    and French coastal names are largely built from these, and the queued FR/ES expansion is 2333
    of them."""
    for a, b in (("MADALENA DO MAR", "Jardim do Mar"),
                 ("Foz do Douro", "Vila do Conde"),
                 ("Playa de la Concha", "Playa de las Canteras"),
                 ("Plage des Dunes", "Plage du Sillon")):
        assert names_match(a, b) is False, (a, b)
    # ...while the real duplicates these names could hide still match.
    assert names_match("MADALENA DO MAR", "Madalena do Mar") is True
    assert names_match("Praia do Norte", "NORTE (NAZARE)") is True   # now caught; was missed


def test_the_four_real_false_positives_fall_in_the_discrepancy_band():
    """Each was reported "missing" while sitting inside SAME_BREAK_KM of its own catalogue row."""
    measured = [
        ("Jaws", "Jaws (Peahi)", 20.938611, -156.260833, 20.9435, -156.31),
        ("Cloud 9", "Cloud 9", 9.81367, 126.16518, 9.8318, 126.153),
        ("Guincho Beach", "Guincho", 38.733149, -9.472696, 38.7212, -9.51),
        ("Mavericks", "Mavericks", 37.485211, -122.469922, 37.4915, -122.5083),
    ]
    for wd_name, our_name, wlat, wlng, olat, olng in measured:
        km = haversine_km(wlat, wlng, olat, olng)
        assert km > NEAR_KM, f"{wd_name} would already dedupe on proximity ({km:.2f} km)"
        assert km <= SAME_BREAK_KM, f"{wd_name} is {km:.2f} km away — outside the band"
        assert names_match(wd_name, our_name), (wd_name, our_name)

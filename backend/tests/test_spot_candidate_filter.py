"""
Guards the name-based non-surf rejector in the candidate pipeline.

Bathing-water registers list every SUPERVISED SWIMMING location, not every surf beach. Measured on
the 2026-07-27 Portugal + Ireland run, 16 of 373 candidates were tidal pools, marinas, naval clubs
and river/lagoon sites — "PISCINA DO CAIS", "COMPLEXO BALNEAR DAS SALINAS", "CLUBE NAVAL DE SÃO
VICENTE", "LAGOA DE ALBUFEIRA-MAR", "FOZ DO ARELHO-LAGOA". Every one passes the geometric tests,
because they genuinely sit on the coast. Only the name reveals what they are.

Both directions matter. A rejector that also eats real surf beaches costs more than it saves.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from scripts.filter_spot_candidates import confidence, looks_non_surf  # noqa: E402

# Real surf beaches, from our catalogue and from the run's own output.
REAL = ["AREIA BRANCA", "PORTO DINHEIRO", "VALMITAO", "S. LOURENCO", "PRAIA DAS MACAS",
        "SANTA CRUZ", "Rossnowlagh", "Lahinch", "Bundoran", "Strandhill",
        "PLAGE DE CARCANS", "RIBEIRA DE ILHAS", "Thurso", "Praia do Norte", "Supertubos"]

# Observed in the EEA data, and not surf spots.
NOT_SURF = ["PISCINA DO CAIS", "COMPLEXO BALNEAR DAS SALINAS", "CLUBE NAVAL DE SAO VICENTE",
            "LAGOA DE ALBUFEIRA-MAR", "FOZ DO ARELHO-LAGOA", "CAIS MOURATO",
            "LIDO-COMPLEXO BALNEAR", "PISCINAS NATURAIS DA LAGOA", "Galway Harbour",
            "River Lee", "Lough Swilly", "Marina Beach", "Barragem do Alto Ceira"]


@pytest.mark.parametrize("name", REAL)
def test_real_surf_beaches_survive(name):
    assert looks_non_surf(name) is False, f"{name} would be wrongly rejected"


@pytest.mark.parametrize("name", NOT_SURF)
def test_pools_marinas_and_inland_water_are_rejected(name):
    assert looks_non_surf(name) is True, f"{name} would reach the reviewer"


def test_empty_and_none_names_are_not_rejected():
    """An unnamed row is a data gap, not a swimming pool — let the geometry decide."""
    for n in (None, "", "   "):
        assert looks_non_surf(n) is False


def test_confidence_prefers_open_exposed_wellresolved_coast():
    strong = confidence({"fetch_km": 584.4, "ocean_km": 0.3, "spread_deg": 1.2,
                         "break_depth_m": 8.0})
    weak = confidence({"fetch_km": 210.0, "ocean_km": 2.8, "spread_deg": 38.0,
                       "break_depth_m": ""})
    assert strong > weak
    assert 0.0 <= weak <= strong <= 100.0


def test_confidence_survives_missing_fields():
    """Rows that failed a stage carry blanks; scoring must not raise on them."""
    assert confidence({}) == 0.0
    assert confidence({"fetch_km": "", "ocean_km": "", "spread_deg": "",
                       "break_depth_m": ""}) == 0.0


def test_confidence_is_not_influenced_by_osm():
    """OSM's 536 named sport=surfing features include German river waves (Eisbachwelle, Almwelle)
    and clubs, so proximity to one is a hint for the reviewer and must never move the score."""
    base = {"fetch_km": 500.0, "ocean_km": 0.4, "spread_deg": 5.0, "break_depth_m": 6.0}
    assert confidence(base) == confidence({**base, "osm_surf_km": 0.05})

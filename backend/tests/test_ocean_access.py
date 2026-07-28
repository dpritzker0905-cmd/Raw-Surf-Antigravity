"""
Guards the ocean-access placement test (2026-07-27).

ORIGIN: the owner reported by eye that three Volusia County spots sat inland — Bethune Beach at the
city centre, New Smyrna Beach - Flagler Avenue in the town, and a duplicate New Smyrna Beach Inlet.
All three had passed the placement gate, and all three were ACCEPTED into the shore-normal asset,
shipping a bearing fitted to the Intracoastal's bank (Flagler Avenue: 84.8 deg, against 50-65 deg
for its correctly-placed neighbours).

The reason is that `nearest_shoreline_km` measures distance to any land/water boundary, and on a
barrier-island coast that boundary is the lagoon. The fix measures distance to water deep enough to
be the sea.

Synthetic rasters, no network — these run anywhere.
"""
import os
import sys

import numpy as np
import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.ocean_access import (  # noqa: E402
    DEEP_M, MAX_OCEAN_KM, ocean_access_km, placement_verdict)


def barrier_island_profile():
    """A New Smyrna cross-section, west to east, from the measured ETOPO transect at 29.028 N:

        mainland  |  lagoon (-2.7 m)  |  barrier island  |  Atlantic (-3 .. -16.6 m)
    """
    row = ([8.7, 8.6, 7.3, 6.8, 6.0, 3.6, 1.3, 0.9, 0.9, 1.1, 1.1, 1.5, 2.1, 1.8, 2.1, 2.2, 1.5]
           + [-2.7, -0.8]                              # the lagoon — never reaches 3 m
           + [0.3, 0.6, 0.6, 1.0, 2.7, 2.7]            # the barrier island
           + [-3.0, -7.4, -10.8, -12.7, -14.0, -15.2, -16.6])   # the Atlantic
    elev = np.tile(np.array(row, dtype=float), (9, 1))
    lats = np.linspace(29.028 - 0.017, 29.028 + 0.017, 9)
    lons = np.linspace(-80.9896, -80.9896 + 0.00416 * (len(row) - 1), len(row))
    return elev, lats, lons


def test_lagoon_is_not_mistaken_for_the_sea():
    """THE regression. The Flagler Avenue pin sits on the mainland beside the lagoon."""
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.9229)
    assert v["verdict"] == "INLAND", v
    assert v["ocean_km"] > MAX_OCEAN_KM, v
    # and it must point at the real water, so the editor has somewhere to move it to
    assert v["ocean_lng"] > -80.89, v


def test_a_pin_in_the_lagoon_itself_is_still_inland():
    """Being IN the wrong water is no better than being beside it — the old test called this
    0.0 km from shore."""
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.9188)   # the -2.7 m lagoon cell
    assert v["verdict"] == "INLAND", v


def test_a_pin_on_the_ocean_side_passes():
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.8896)   # barrier island, ocean-facing edge
    assert v["verdict"] == "ON_OCEAN", v
    assert v["ocean_km"] <= MAX_OCEAN_KM, v


def test_a_landlocked_window_is_reported_not_guessed():
    """No sea in the window is NO_OCEAN — explicitly unknown-and-wrong, never silently fine."""
    elev = np.full((9, 9), 120.0)
    lats = np.linspace(17.90, 17.99, 9)
    lons = np.linspace(-76.45, -76.36, 9)
    v = placement_verdict(elev, lats, lons, 17.95, -76.40)
    assert v["verdict"] == "NO_OCEAN", v
    assert v["ocean_km"] is None and v["ocean_lat"] is None


def test_shallow_water_alone_never_counts_as_ocean():
    """A wide but shallow body (an estuary, a flooded flat) must not qualify at any width."""
    elev = np.full((9, 40), -1.5)
    elev[:, :5] = 6.0
    lats = np.linspace(29.0, 29.08, 9)
    lons = np.linspace(-81.0, -80.84, 40)
    km, target = ocean_access_km(elev, lats, lons, 29.04, -80.95)
    assert km is None and target is None


def test_depth_threshold_is_the_documented_one():
    """DEEP_M is measured against the Indian River bottoming at 2.7 m — if someone lowers it below
    that, the lagoon qualifies again and the whole test silently reverts."""
    assert DEEP_M >= 3.0, "the measured lagoon floor is 2.7 m; below 3.0 m this test stops working"


def test_distance_cutoff_is_the_catalogue_calibrated_one_not_the_17_spot_one():
    """MAX_OCEAN_KM was 1.5 km, calibrated on 17 hand-picked spots. It did not survive 1515.

    At 1.5 km it flagged 250 spots (17% of the catalogue) including real breaks — Jeffreys Bay -
    Kitchen Windows (1.99), Puerto Escondido - Carrizalillo (1.77), Thurso (1.57), Torquay - Rincon
    (2.68), Maroubra, Nai Harn, Ribeira d'Ilhas, Sunzal (all ~1.51-1.53). Measured against the
    catalogue's own coordinates the populations separate at max-good 2.68 / min-bad 3.17, so the
    threshold belongs in that gap. Dropping it back under ~2.7 re-flags real breaks."""
    assert MAX_OCEAN_KM == pytest.approx(3.0)
    assert MAX_OCEAN_KM > 2.68, "below the worst correctly-placed spot, real breaks get flagged"
    assert MAX_OCEAN_KM < 3.17, "above the best misplaced spot, Flagler Avenue escapes"


@pytest.mark.parametrize("name,ocean_km,expected", [
    # every one measured from the catalogue's stored coordinates, 2026-07-27
    ("Jeffreys Bay - Kitchen Windows", 1.99, "ON_OCEAN"),
    ("Puerto Escondido - Carrizalillo", 1.77, "ON_OCEAN"),
    ("Thurso - The Shit Pipe", 1.57, "ON_OCEAN"),
    ("Torquay - Rincon", 2.68, "ON_OCEAN"),
    ("Maroubra", 1.53, "ON_OCEAN"),
    ("Ribeira d'Ilhas", 1.51, "ON_OCEAN"),
    ("New Smyrna Beach - Flagler Avenue", 3.17, "INLAND"),
    ("Shimei Bay", 3.54, "INLAND"),
    ("Cape Canaveral Air Force Station", 4.06, "INLAND"),
    ("Bethune Beach", 5.11, "INLAND"),
    ("Lakey Peak", 5.17, "INLAND"),
])
def test_the_measured_population_lands_on_the_right_side(name, ocean_km, expected):
    """Guards the threshold against the real distribution, without needing the network."""
    got = "INLAND" if ocean_km > MAX_OCEAN_KM else "ON_OCEAN"
    assert got == expected, f"{name} at {ocean_km} km"


def test_nan_cells_do_not_crash_or_count_as_water():
    elev, lats, lons = barrier_island_profile()
    elev = elev.copy()
    elev[0, :] = np.nan
    v = placement_verdict(elev, lats, lons, 29.028, -80.9229)
    assert v["verdict"] == "INLAND", v


def test_verdict_reports_the_pin_elevation():
    """The elevation is the human-legible proof — '+1.5 m in a town' is what convinced the owner."""
    elev, lats, lons = barrier_island_profile()
    v = placement_verdict(elev, lats, lons, 29.028, -80.9229)
    assert v["elev_m"] == pytest.approx(1.5, abs=0.6), v


def test_the_build_gate_rejects_an_inland_spot():
    """`accepted()` must refuse to ship a shore normal for a spot that is not on the ocean —
    a confident wrong bearing is used as-is, while a miss safely falls back to the coarse grid."""
    from scripts.build_shore_normals import accepted
    base = {"normal": 84.8, "spread": 5.0, "n_windows": 4, "shoreline_km": 0.24}
    ok, why = accepted({**base, "ocean_verdict": "ON_OCEAN"})
    assert ok and why == "accepted"
    ok, why = accepted({**base, "ocean_verdict": "INLAND"})
    assert not ok and why == "not_on_open_ocean_inland", why
    ok, why = accepted({**base, "ocean_verdict": "NO_OCEAN"})
    assert not ok and why == "not_on_open_ocean_no_ocean", why


def test_the_build_gate_is_backward_compatible_when_the_field_is_absent():
    """An older review row without the column must not start failing."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": 60.0, "spread": 5.0, "n_windows": 4, "shoreline_km": 0.2})
    assert ok and why == "accepted"


# ── The window-count gate: the SPREAD carries the confidence, not the count (2026-07-27) ──────
# `n_windows < 3` discarded 153 spots — 133 of them ON_OCEAN a median 0.21 km from open water,
# whose two fitted windows agreed to a median 5.5°. All of them fell back to the coarse 0.25° grid,
# whose bearing comes from a 194.6 km window. Graded against the local accepted consensus, the
# 2-window fits scored median 10.1° vs the coarse fallback's 17.4°, winning 68% — against the
# accepted population's own 6.2°/14.6°/70% on the same instrument.

# ── Placement is diagnosed BEFORE fit quality (2026-07-27) ───────────────────────────────────
# `spot_misplaced` fired on 0 of 1515 spots while 133 were provably beyond MAX_SHORELINE_KM —
# Manzanillo 12.01 km from shore, Nihiwatu 10.58 km at +264 m — all reported as
# `no_shoreline_in_window`. A badly misplaced pin has no coastline in its window, so it failed the
# FIT clause first and short-circuited the placement check: the worse the error, the less likely it
# was named. The review CSV is what a human works from, so the label IS the deliverable.

def test_a_misplaced_spot_is_called_misplaced_not_unfittable():
    """THE regression: a pin 12 km from shore has a placement problem, not a fitting problem —
    even though it also, inevitably, has no coastline in its window."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": None, "spread": None, "n_windows": 0,
                        "shoreline_km": 12.01, "ocean_verdict": "ON_OCEAN"})
    assert not ok and why == "spot_misplaced", why


def test_an_inland_spot_outranks_every_other_diagnosis():
    """Not on water swell can reach is the most actionable verdict there is, so it is reported
    even when the fit also failed."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": None, "spread": None, "n_windows": 0,
                        "shoreline_km": 8.0, "ocean_verdict": "INLAND"})
    assert not ok and why == "not_on_open_ocean_inland", why


def test_a_spot_stranded_at_sea_is_named_not_called_unfittable():
    """The worst case the km-from-shore bound CANNOT see.

    `shoreline_km` is None when no shoreline exists anywhere in the fetched window, so the further
    out a pin is, the more certainly it escapes a bound expressed in km-from-shore. Measured: 17
    spots sat in 110-1778 m of water — Telescopes, Macaronis, Scorpion Bay — reported as fitting
    failures.
    """
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": None, "spread": None, "n_windows": 0, "shoreline_km": None,
                        "ocean_verdict": "ON_OCEAN", "elev_m": -1778.0})
    assert not ok and why == "spot_misplaced_at_sea", why


def test_a_shallow_offshore_bank_is_not_condemned_as_stranded():
    """Cortes Bank is a real break over a seamount with no land for miles. The bound is the depth a
    wave can break in, so a shallow bank must survive a test that kills a 1.7 km-deep pin."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": 270.0, "spread": 6.0, "n_windows": 3, "shoreline_km": None,
                        "ocean_verdict": "ON_OCEAN", "elev_m": -12.0})
    assert ok and why == "accepted", why


def test_a_spot_above_sea_level_with_no_water_keeps_its_inland_verdict():
    """The 8 dry-land members of the same population are already diagnosed; do not relabel them."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": None, "spread": None, "n_windows": 0, "shoreline_km": None,
                        "ocean_verdict": "NO_OCEAN", "elev_m": 946.0})
    assert not ok and why == "not_on_open_ocean_no_ocean", why


def test_a_well_placed_spot_still_reports_its_fit_problem():
    """Reordering must not swallow the fit diagnoses for spots that ARE well placed."""
    from scripts.build_shore_normals import accepted
    base = {"shoreline_km": 0.4, "ocean_verdict": "ON_OCEAN"}
    assert accepted({**base, "normal": None, "spread": None,
                     "n_windows": 0})[1] == "no_shoreline_in_window"
    assert accepted({**base, "normal": 90.0, "spread": 90.0,
                     "n_windows": 3})[1] == "ambiguous_coastline"


def test_two_agreeing_windows_are_accepted():
    """The measured change: two windows that agree within the spread gate must ship."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": 118.0, "spread": 5.5, "n_windows": 2,
                        "shoreline_km": 0.21, "ocean_verdict": "ON_OCEAN"})
    assert ok and why == "accepted", why


def test_a_single_window_is_still_refused():
    """One window cannot disagree with itself, so it has no confidence measure at all — and
    `fit_shore_normal` does not even return a bearing below two."""
    from scripts.build_shore_normals import accepted
    ok, why = accepted({"normal": 118.0, "spread": 0.0, "n_windows": 1,
                        "shoreline_km": 0.21, "ocean_verdict": "ON_OCEAN"})
    assert not ok and why == "too_few_windows", why


def test_two_windows_still_face_every_other_clause():
    """Loosening the COUNT must not loosen anything else — a 2-window fit that is ambiguous,
    misplaced, or off the open ocean is still refused, for its own reason."""
    from scripts.build_shore_normals import accepted
    base = {"normal": 118.0, "n_windows": 2, "shoreline_km": 0.21, "ocean_verdict": "ON_OCEAN"}
    assert accepted({**base, "spread": 62.1})[1] == "ambiguous_coastline"
    assert accepted({**base, "spread": 5.5, "shoreline_km": 4.6})[1] == "spot_misplaced"
    assert accepted({**base, "spread": 5.5,
                     "ocean_verdict": "INLAND"})[1] == "not_on_open_ocean_inland"


# ── The asset build must not overwrite a good asset with a collapsed one (2026-07-28) ─────────
# A build emitted 0 of 1820 entries because every ERDDAP fetch failed, and nothing stopped it:
# the asset gate passed VACUOUSLY (an empty entry list satisfies "every entry is legal"), the
# commit step committed the empty file, and only a `git push` race kept it out of `dev`. An empty
# asset silently reverts every spot to the coarse 0.25° / 194.6 km grid.

def _write_asset(tmp_path, previous_count):
    import json as _json
    a = tmp_path / "shore_normals.json"
    a.write_text(_json.dumps({"count": previous_count,
                              "entries": [[0, 0, 1.0, 1.0, 5.0]] * previous_count}))
    return str(a)


def test_a_collapsed_asset_is_refused(tmp_path, monkeypatch):
    """0 of 1820 after a total fetch failure must NOT replace a good asset."""
    from scripts.build_shore_normals import write_is_safe
    monkeypatch.delenv("SHORE_NORMAL_ALLOW_SHRINK", raising=False)
    asset = _write_asset(tmp_path, 1386)
    ok, why = write_is_safe(0, asset)
    assert not ok and "EMPTY" in why, why
    ok, why = write_is_safe(200, asset)          # 14% retained — still a collapse
    assert not ok and "1386" in why, why


def test_a_normal_rebuild_is_allowed(tmp_path, monkeypatch):
    """Ordinary growth and small churn must still write, or the guard blocks real work."""
    from scripts.build_shore_normals import write_is_safe
    monkeypatch.delenv("SHORE_NORMAL_ALLOW_SHRINK", raising=False)
    assert write_is_safe(1386, _write_asset(tmp_path, 1073))[0]     # growth
    assert write_is_safe(1300, _write_asset(tmp_path, 1386))[0]     # 94% retained
    assert write_is_safe(5, str(tmp_path / "absent.json"))[0]       # first ever build


def test_a_deliberate_shrink_has_an_escape_hatch(tmp_path, monkeypatch):
    from scripts.build_shore_normals import write_is_safe
    monkeypatch.setenv("SHORE_NORMAL_ALLOW_SHRINK", "1")
    assert write_is_safe(200, _write_asset(tmp_path, 1386))[0]
    # ...but never for a totally empty build, which is always a failure signal
    assert not write_is_safe(0, _write_asset(tmp_path, 1386))[0]

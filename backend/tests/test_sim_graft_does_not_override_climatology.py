"""A hand-tuned constant must not outrank a live spot's own climatology.

`_GRAFTED_KEYS` copies hand-tuned CATALOG_DEFAULTS fields onto a LIVE catalogue row that happens to
share the name. `reference_size_m` was one of them, and `sim_rating.reference_size_for` returns an
explicit `spot["reference_size_m"]` BEFORE it consults `reference_for_spot` — so for the three names
that carry a default (Mavericks 4.0, Montara 1.5, Pacifica 1.2) the sim graded a constant while
every other surface graded that spot's own good day.

Measured at Mavericks on the served sea of 2026-08-01T13:00Z with RATING_LOCAL_SIZE=1:

    grafted 4.0 m -> 12.0 very_poor   |   climatology -> 27.3 poor == SERVED   |   global -> 45.3 fair

⇒ a LEVEL divergence from the glyph in the opposite direction to the one `fade0c69` closed. These
tests pin the split: a LIVE row resolves its reference from the climatology (what the glyph uses),
and the OFFLINE `catalog_default` path — which has no live row and no real id — keeps its constant.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import sim_forecast, sim_rating, sim_spots
from services.weather_pipeline import spot_size_climatology as SSC

# The real production id, so the row under test is shaped exactly like one `fetch_catalog` returns.
MAV_ID = "264de2b4-fefc-4101-bb2c-c0557b9ca190"
LIVE_ROWS = [{"id": MAV_ID, "name": "Mavericks", "region": "Half Moon Bay",
              "latitude": 37.4915, "longitude": -122.5083}]


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")      # production's value (3263031c)
    monkeypatch.setenv("SIM_SPOT_CATALOG", "1")
    sim_forecast._CATALOG_CACHE.clear()
    yield
    sim_forecast._CATALOG_CACHE.clear()


@pytest.fixture
def live_catalog(monkeypatch):
    """A live catalogue that HAS Mavericks — the case where a glyph exists to disagree with."""
    monkeypatch.setattr(sim_forecast, "fetch_catalog", lambda: list(LIVE_ROWS))
    return LIVE_ROWS


@pytest.fixture
def offline_catalog(monkeypatch):
    """No live catalogue at all — the hand-tuned defaults are the only thing left."""
    monkeypatch.setattr(sim_forecast, "fetch_catalog", lambda: None)
    monkeypatch.setattr(sim_spots, "query_spots", lambda **kw: [])


def _reset_reference_memo():
    """Clear the resolved-map memo between installs.

    ⚠️ THIS RESET WAS DEAD WHEN FIRST WRITTEN, and it has since chased the memo TWICE — which is
    the entire reason it asserts. It targeted `spot_size_climatology._ref_map_memo` behind a
    `hasattr` guard while that name existed only in a concurrent session's UNCOMMITTED tree, so
    against committed code it cleared nothing and reported no problem. It was repointed at
    `sim_rating._REF_MAP_MEMO` (`50e441bd`). That memo is now DELETED: `reference_size_for`
    delegates to `reference_for_spot`, and two caches over one composition can disagree about which
    blob snapshot they describe. So the target is `SSC._ref_map_memo` once more.
    ★ **A cleanup guarded by `hasattr` degrades into a silent no-op the moment the thing moves.**
    This ASSERTS instead, which is what turned the last move into a loud failure rather than tests
    quietly sharing state."""
    assert hasattr(SSC, "_ref_map_memo"), (
        "the reference-map memo moved; this reset is no longer clearing anything")
    SSC._ref_map_memo["cell"] = (None, {})


def _needle(spot_id, bin_index=9, n=40):
    """A climatology blob that DOES contain this spot. ★ The expected value is computed with the
    real `reference_from_hist`, never hardcoded — a hardcoded expectation would still pass if the
    percentile definition changed underneath it."""
    hist = SSC.empty_hist()
    hist[bin_index] = n
    return ({"schema_version": SSC.SCHEMA_VERSION, "spots": {spot_id: {"hist": hist}}},
            SSC.reference_from_hist(hist))


@pytest.fixture
def climatology(monkeypatch):
    """Install (or withhold) a blob. Returns a setter so each test states its own needle."""
    def _install(present=True, spot_id=MAV_ID):
        blob, expected = _needle(spot_id)
        _reset_reference_memo()               # memoised on object IDENTITY — clear between installs
        monkeypatch.setattr(SSC, "load_size_climatology_l2_cached",
                            lambda *a, **kw: (blob if present else None))
        return expected
    return _install


def test_a_live_row_does_not_inherit_the_hand_tuned_reference(live_catalog):
    """THE DEFECT. A live catalogue row must carry no hand-tuned reference, so the lookup runs."""
    res = sim_spots.resolve("Mavericks")
    assert res.identity_source == "live_catalog"
    assert res.spot["id"] == MAV_ID
    assert res.spot.get("reference_size_m") is None, (
        "a live row inherited the hand-tuned reference; `reference_size_for` returns it before "
        "consulting the climatology, so the sim would grade a constant while the glyph grades the "
        "spot's own good day")


def test_NEGATIVE_CONTROL_putting_the_key_back_reintroduces_the_defect(monkeypatch, live_catalog):
    """The test above must be able to FAIL. Re-graft the key and the live row inherits 4.0 again.

    ★ Without this, removing the assertion's teeth (or the whole graft mechanism) would leave the
    suite green — a guard that cannot fail is not evidence."""
    monkeypatch.setattr(sim_spots, "_GRAFTED_KEYS",
                        tuple(sim_spots._GRAFTED_KEYS) + ("reference_size_m",))
    res = sim_spots.resolve("Mavericks")
    assert res.spot.get("reference_size_m") == 4.0


def test_the_offline_default_path_keeps_its_hand_tuned_reference(offline_catalog):
    """The other half of the split: with no live row there is no glyph to disagree with, and no
    real id to look the climatology up by, so the hand-tuned value is all there is."""
    res = sim_spots.resolve("Mavericks")
    assert res.identity_source != "live_catalog"
    assert res.spot["reference_size_m"] == 4.0


def test_a_live_row_grades_on_the_CLIMATOLOGY(live_catalog, climatology):
    """End to end: the value `reference_size_for` hands the rating comes from the blob."""
    expected = climatology(present=True)
    spot = sim_spots.resolve("Mavericks").spot
    got = sim_rating.reference_size_for(dict(spot), allow_lookup=True)
    assert got == expected
    assert got != 4.0, "the hand-tuned constant must not be what the rating grades on"


def test_NEGATIVE_CONTROL_no_climatology_falls_to_the_global_curve(live_catalog, climatology):
    """Blob absent -> None -> the global curve, which is what the glyph also does. Parity holds in
    the failure case too, which is the whole argument for removing the graft."""
    climatology(present=False)
    spot = sim_spots.resolve("Mavericks").spot
    assert sim_rating.reference_size_for(dict(spot), allow_lookup=True) is None


def test_the_zero_network_path_still_refuses_the_lookup(live_catalog, climatology):
    """`allow_lookup=False` must stay None even with a blob in hand — the `576dcbdd` invariant."""
    climatology(present=True)
    spot = sim_spots.resolve("Mavericks").spot
    assert sim_rating.reference_size_for(dict(spot), allow_lookup=False) is None

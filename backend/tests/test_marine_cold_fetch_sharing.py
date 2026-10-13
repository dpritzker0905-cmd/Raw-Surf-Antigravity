"""
Cold-toggle sharing — one all_marine fetch may seed sibling marine layers, but NOT everywhere.

THE DEFECT THIS ADDRESSES. Measured live 2026-09-21, four independent cold/warm pairs on one box:

    waves      cold 18.27s  warm 3.73s      swell_2     cold 13.09s  warm 2.35s
    swell_1    cold 15.46s  warm 5.01s      wind_waves  cold 11.03s  warm 2.07s

Cold is 3-5.6x warm every time, and EACH MARINE LAYER IS INDEPENDENTLY COLD — so toggling through
them pays that price four times. That is the owner's "toggling between marine layers is slow".
The upstream can answer all of them in ONE request (`all_marine`), and the ingestion lane has done
exactly that for months, so this shares a proven path rather than inventing a second one.

⛔⛔ WHAT THESE TESTS ARE REALLY FOR. The dangerous version of this change is the obvious one —
"share all four, every model" — which would publish the WRONG UPSTREAM'S DATA under a model label.
The per-model sets are mirrored from the ingestion lane and pinned here:

    GFS  -> waves, swell_1, swell_2, wind_waves
    ICON -> waves, swell_1, wind_waves        (swell_2 absent: gwam has no native secondary swell)
    EURO -> NOTHING                           (`waves` is ECMWF WAM; swell_1/swell_2/wind_waves are
                                               GFS results labelled EURO — two upstreams, one label)

⭐ The EURO case is the whole reason this file exists. Sharing there would serve GFS swell as
ECMWF and no test of latency or caching would ever notice.
"""
import pytest

from services.weather_pipeline.providers.open_meteo_provider import (
    _shared_marine_layers,
    _SHARED_MARINE_LAYERS,
)


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    monkeypatch.setenv("OM_MARINE_SHARE_COLD_FETCH", "1")
    yield


class TestTheKillSwitch:
    def test_dark_by_default(self, monkeypatch):
        # It cannot be A/B'd from a dev box, so it ships OFF. A test that only ran with it enabled
        # would never notice that the default had drifted to ON.
        monkeypatch.delenv("OM_MARINE_SHARE_COLD_FETCH", raising=False)
        assert _shared_marine_layers("GFS", "marine", "waves") is None

    @pytest.mark.parametrize("value", ["0", "", "true", "yes", "on"])
    def test_only_the_literal_1_enables_it(self, monkeypatch, value):
        # Fail CLOSED on anything ambiguous: the risk of this change is wrong DATA, not slow data.
        monkeypatch.setenv("OM_MARINE_SHARE_COLD_FETCH", value)
        assert _shared_marine_layers("GFS", "marine", "waves") is None


class TestThePerModelSets:
    def test_gfs_shares_all_four(self):
        assert _shared_marine_layers("GFS", "marine", "waves") == (
            "waves", "swell_1", "swell_2", "wind_waves")

    def test_icon_excludes_swell_2(self):
        # gwam has no native secondary swell; its swell_2 falls back to swell_1, and the ingestion
        # lane normalizes only three layers from an ICON all_marine response.
        group = _shared_marine_layers("ICON", "marine", "waves")
        assert group == ("waves", "swell_1", "wind_waves")
        assert "swell_2" not in group

    def test_an_ICON_swell_2_request_takes_the_UNTOUCHED_path(self):
        """A layer outside its model's group must not be quietly answered from a response that
        cannot serve it — it returns None and the original per-layer fetch runs unchanged."""
        assert _shared_marine_layers("ICON", "marine", "swell_2") is None

    @pytest.mark.parametrize("layer", ["waves", "swell_1", "swell_2", "wind_waves"])
    def test_EURO_NEVER_SHARES(self, layer):
        """
        ⛔ THE ONE THAT MATTERS. EURO is two upstreams under one label: `waves` is ECMWF WAM while
        swell_1/swell_2/wind_waves are GFS results labelled EURO. One response cannot serve all
        four, and sharing would publish GFS swell as ECMWF — a provenance lie that no latency or
        cache test could detect.
        """
        assert _shared_marine_layers("EURO", "marine", layer) is None

    def test_an_unknown_model_shares_nothing(self):
        assert _shared_marine_layers("NOAA_SOMETHING", "marine", "waves") is None


class TestScope:
    @pytest.mark.parametrize("domain", ["weather", "wind", "WEATHER", None, ""])
    def test_only_the_marine_domain_shares(self, domain):
        assert _shared_marine_layers("GFS", domain, "waves") is None

    def test_a_non_marine_layer_name_shares_nothing(self):
        assert _shared_marine_layers("GFS", "marine", "precipitation") is None

    def test_model_case_does_not_matter(self):
        assert _shared_marine_layers("gfs", "marine", "waves") is not None

    def test_it_never_raises_on_junk(self):
        # It runs inside fetch_grid on every request; an exception here would break fetching.
        for args in [(None, None, None), ("", "", ""), (123, "marine", "waves")]:
            assert _shared_marine_layers(*args) is None


class TestTheSetsMatchTheIngestionLaneTheyWereCopiedFrom:
    """
    ⭐⭐ A HAND-COPIED CONSTANT DRIFTS. These sets exist in the ingestion modules too; if someone
    changes one lane the other must follow, and this reads the ingestion source rather than a
    second hand-written list so the two cannot disagree silently.
    """

    def test_gfs_set_matches_marine_mid_res_ingestion(self):
        import inspect
        from services.weather_pipeline import marine_mid_res_ingestion as mri
        src = inspect.getsource(mri)
        assert '["waves", "swell_1", "swell_2", "wind_waves"]' in src, (
            "the GFS ingestion layer loop changed — re-derive _SHARED_MARINE_LAYERS['GFS']"
        )
        assert _SHARED_MARINE_LAYERS["GFS"] == ("waves", "swell_1", "swell_2", "wind_waves")

    def test_icon_set_matches_marine_mid_res_ingestion(self):
        import inspect
        from services.weather_pipeline import marine_mid_res_ingestion as mri
        src = inspect.getsource(mri)
        assert '["waves", "swell_1", "wind_waves"]' in src, (
            "the ICON ingestion layer loop changed — re-derive _SHARED_MARINE_LAYERS['ICON']"
        )
        assert _SHARED_MARINE_LAYERS["ICON"] == ("waves", "swell_1", "wind_waves")

    def test_EURO_is_absent_from_the_table_entirely(self):
        # Not "present but empty" — absent, so a future reader cannot mistake an empty tuple for
        # "sharing is configured off for EURO" and helpfully fill it in.
        assert "EURO" not in _SHARED_MARINE_LAYERS

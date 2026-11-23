"""Bug hunt 2026-11-22 item D, the overnight research consensus (option B, delegated by the owner: "use subq, reflection,
longcat to help figure it out"): over a PARTITION layer (swell_1, swell_2, wind_waves) the map shows that partition's OWN
height, with no surf rating. The 0-100 rating stays on the total `waves` layer, the spot pages, the glyphs and the infobox,
where it rates the total sea through the one chain. The band used to grade one partition as if it were the whole sea.

The client asks the plain flavour for a partition layer (frontend partitionHeightOnly.js); this is the server half:
  - `/grid?surf=1` and `/grid_series?surf=1` on a partition layer return the honest height field, tagged
    surf_transform.skipped = "partition_layer" (the same shape as the coarse-extent skip the client already renders honestly);
  - the CI rated publisher stops baking rated partition sets.
Guarded flag BAND_PARTITION_HEIGHT_ONLY, ON; kill '0' = the old per-layer rating everywhere."""
import asyncio
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import frame_set_rating as fsr  # noqa: E402
from services import runtime_flags as RF  # noqa: E402
from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay  # noqa: E402
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct  # noqa: E402

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)
BOX = (-81.5, 26.5, -79.5, 29.5)                       # Florida's Atlantic coast: coastal and open-ocean cells
CELLS = [(26.5 + 0.25 * i, -81.5 + 0.25 * j) for i in range(13) for j in range(9)]
SEA = dict(speed=1.0, period=15.0, direction=95.0, u=0.3, v=-0.2)
PARTITIONS = ("swell_1", "swell_2", "wind_waves")


def _product(layer):
    w, s, e, n = BOX
    vecs = [GridVector(lat=la, lng=ln, **SEA) for la, ln in CELLS]
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer=layer, run_time=NOW, valid_time=NOW,
        is_forecast_authoritative=True, is_estimated=False, coverage=CoverageBounds(west=w, south=s, east=e, north=n),
        grid=NormalizedGrid(bounds=CoverageBounds(west=w, south=s, east=e, north=n), cols=9, rows=13, vectors=vecs,
                            diagnostics={"base": "cached"}),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", source_variables=["wave_height"],
        freshness_sec=3600)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("RATING_LOCAL_SIZE", "RATING_OBS_GATE"):   # both read Supabase L2 blobs: off for an offline test
        monkeypatch.setenv(k, "0")
    for k in ("BAND_PARTITION_HEIGHT_ONLY", "SURF_TRANSFORM", "SURF_RATING", "FRAME_RATING_REGIONAL"):
        monkeypatch.delenv(k, raising=False)


def _overlay(product, layer):
    return asyncio.run(apply_surf_overlay(product, store=None, manifest=SimpleNamespace(products=[]), model="GFS",
                                          domain="marine", layer=layer, surf=True, target_dt=NOW))


def test_flag_is_guarded_and_on():
    assert RF.GUARDED["BAND_PARTITION_HEIGHT_ONLY"] == "1"


@pytest.mark.parametrize("layer", PARTITIONS)
def test_a_partition_layer_serves_its_own_height_unrated(layer):
    src = _product(layer)
    out = _overlay(src, layer)
    tag = out.grid.diagnostics["surf_transform"]
    assert tag == {"skipped": "partition_layer"}
    assert tag.get("value_kind") != "surf_rating"            # the client's ratingMode stays false: the honest field draws
    assert [v.model_dump() for v in out.grid.vectors] == [v.model_dump() for v in src.grid.vectors]
    assert all(v.phys_speed is None and v.is_valid for v in out.grid.vectors)


def test_the_shared_cached_product_is_never_mutated():
    src = _product("swell_1")
    before = ([v.model_dump() for v in src.grid.vectors], dict(src.grid.diagnostics))
    _overlay(src, "swell_1")
    assert ([v.model_dump() for v in src.grid.vectors], src.grid.diagnostics) == before


def test_the_total_sea_layer_is_still_rated():
    out = _overlay(_product("waves"), "waves")
    tag = out.grid.diagnostics["surf_transform"]
    assert tag["value_kind"] == "surf_rating" and tag["rated"] >= 3


def test_kill_switch_rates_the_partition_again(monkeypatch):
    monkeypatch.setenv("BAND_PARTITION_HEIGHT_ONLY", "0")
    tag = _overlay(_product("swell_1"), "swell_1").grid.diagnostics["surf_transform"]
    assert tag["value_kind"] == "surf_rating" and tag["rated"] >= 3


def _layers(sets):
    return {t["layer"] for t in sets}


def test_the_rated_publisher_bakes_only_the_total_sea():
    assert _layers(fsr.rated_publish_sets()) == {"waves"}


def test_kill_switch_bakes_the_partition_sets_again(monkeypatch):
    monkeypatch.setenv("BAND_PARTITION_HEIGHT_ONLY", "0")
    assert {"waves", "swell_1", "swell_2", "wind_waves"} <= _layers(fsr.rated_publish_sets())

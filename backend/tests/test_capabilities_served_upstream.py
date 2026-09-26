"""
A15-10 (audit 15.0): `/capabilities` must name the upstream that is actually served.

Census of the live manifest, 2026-09-25 (island products excluded): every stored, non-estimated
GFS product carried upstream_provider "noaa", every ICON one "dwd", every EURO wind/pressure one
"ecmwf" — while the capability rows said "open-meteo". The tuples below are that census, copied
from the measurement (count dropped); the test holds the declarations to them.
"""
import pytest

from services.weather_pipeline.capabilities import (
    get_weather_capabilities, validate_capabilities_contract,
)

# (model, domain, layer, provider, upstream_provider, upstream_model, source_dataset) — measured live.
MEASURED_STORED_NATIVE = [
    ("GFS", "marine", "waves", "open-meteo", "noaa", "ncep_gfswave025", "ncep_gfswave025"),
    ("GFS", "marine", "swell_1", "open-meteo", "noaa", "ncep_gfswave025", "ncep_gfswave025"),
    ("GFS", "marine", "swell_2", "open-meteo", "noaa", "ncep_gfswave025", "ncep_gfswave025"),
    ("GFS", "marine", "wind_waves", "open-meteo", "noaa", "ncep_gfswave025", "ncep_gfswave025"),
    ("GFS", "wind", "wind", "open-meteo", "noaa", "gfs_seamless", "gfs_seamless"),
    ("GFS", "weather", "pressure", "open-meteo", "noaa", "gfs_seamless", "gfs_seamless"),
    ("ICON", "marine", "waves", "open-meteo", "dwd", "gwam", "dwd_gwam"),
    ("ICON", "marine", "swell_1", "open-meteo", "dwd", "gwam", "dwd_gwam"),
    ("ICON", "marine", "wind_waves", "open-meteo", "dwd", "gwam", "dwd_gwam"),
    ("ICON", "wind", "wind", "open-meteo", "dwd", "dwd_icon", "dwd_icon"),
    ("ICON", "weather", "pressure", "open-meteo", "dwd", "dwd_icon", "dwd_icon"),
    ("EURO", "wind", "wind", "open-meteo", "ecmwf", "ecmwf_ifs", "ecmwf_ifs"),
    ("EURO", "weather", "pressure", "open-meteo", "ecmwf", "ecmwf_ifs", "ecmwf_ifs"),
]


def _row(model, domain, layer):
    return next(r for r in get_weather_capabilities()
                if (r["model"], r["domain"], r["layer"]) == (model, domain, layer))


@pytest.mark.parametrize("model,domain,layer,provider,upstream,upstream_model,dataset", MEASURED_STORED_NATIVE)
def test_the_row_names_the_upstream_the_manifest_serves(model, domain, layer, provider, upstream,
                                                         upstream_model, dataset):
    row = _row(model, domain, layer)
    assert row["upstream_provider"] == upstream
    assert row["provider"] == provider                       # the dispatch key is untouched
    stored = [s for s in row["native_grid_sources"] if s["usage"] == "stored_regional_and_global_tiles"]
    assert stored and stored[0]["upstream_providers"] == [upstream]
    assert (stored[0]["upstream_model"], stored[0]["source_dataset"]) == (upstream_model, dataset)
    live = [s for s in row["native_grid_sources"] if s["usage"] == "dynamic_viewports_outside_stored_tiles"]
    assert live and live[0]["upstream_providers"] == ["open-meteo"]
    assert row["provenance_policy"]["effective_source"] == "product_response"


def test_the_contract_still_validates_and_euro_marine_is_unchanged():
    validate_capabilities_contract(get_weather_capabilities())
    for layer in ("waves", "swell_1", "swell_2", "wind_waves"):
        assert _row("EURO", "marine", layer)["upstream_provider"] == "copernicus"


def test_icon_swell_2_stays_unsupported_as_a_grid_and_describes_its_estimate():
    row = _row("ICON", "marine", "swell_2")
    assert row["supports_grid"] is False
    est = row["estimated_product"]
    assert est["computed_by"] == "frontend" and est["basis"] == "icon_swell_2_gfs_euro_blend"
    assert est["weights"] == {"GFS": 0.6, "EURO": 0.4}
    assert {(s["model"], s["upstream_provider"]) for s in est["sources"]} == {("GFS", "noaa"), ("EURO", "copernicus")}


def test_rows_that_are_not_stored_grids_are_left_alone():
    for model in ("GFS", "ICON", "EURO"):
        precip = _row(model, "weather", "precipitation")
        assert "native_grid_sources" not in precip
    assert "native_grid_sources" not in _row("GFS", "weather", "fog")


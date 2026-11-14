"""Derived marine products carry their input's unit labels (2026-11-14).

`NormalizedProduct.units` defaults to {"speed": "kn", ...} (schemas.py). The ICON swell_2 stored blend (icon_swell2_ingest.py,
"estimated_blend") and the lattice's time-interpolated slots (lattice_fill.py, "estimated_interpolation") copied value_unit /
display_unit_hint from their input but not `units`, so /grid and /point (the sampler copies product.units) labelled a wave HEIGHT
"kn". Seen live on ICON swell_2 2026-11-14 while verifying #877. A metadata label only: no served value moves, and no client code
reads units.speed for these layers (it reads value_unit / display_unit_hint). Products already stored keep "kn" until rebuilt.
"""
import math
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.weather_pipeline.icon_swell2_ingest import ingest_icon_swell2_blend_impl
from services.weather_pipeline.lattice_fill import interpolate_between
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

RUN = datetime(2026, 11, 14, 6, 0, tzinfo=timezone.utc)
BOUNDS = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
MARINE_UNITS = {"speed": "m", "direction": "degrees", "period": "seconds"}
WIND_UNITS = {"speed": "kn", "direction": "degrees", "period": "seconds"}


def _product(model, t, *, domain="marine", layer="swell_2", units=MARINE_UNITS, region="global_coarse", speed=1.5, direction=90.0):
    r = math.radians(direction)
    grid = NormalizedGrid(bounds=BOUNDS, cols=1, rows=1, vectors=[GridVector(
        lat=0.0, lng=0.0, speed=speed, direction=direction, u=-speed * math.sin(r), v=-speed * math.cos(r), period=10.0, is_valid=True)])
    marine = domain == "marine"
    return NormalizedProduct(model=model, provider="p", domain=domain, layer=layer, run_time=RUN, valid_time=t,
                             is_forecast_authoritative=True, is_estimated=False, coverage=BOUNDS, grid=grid,
                             value_kind="wave_height" if marine else "wind_speed", value_unit="m" if marine else "kn",
                             display_unit_hint="ft" if marine else "kn", units=dict(units), source_variables=[], freshness_sec=1800,
                             region_id=region, coverage_mode="global_tile", product_id=f"{model.lower()}_{region}_{t:%H}.json")


def _item(model, t, filename, region="global_coarse"):
    return SimpleNamespace(model=model, domain="marine", layer="swell_2", region_id=region, is_estimated=False, valid_time_start=t,
                           filename=filename, resolution=10.0, ingested_at=RUN + timedelta(hours=3), estimate_basis=None)


@pytest.mark.asyncio
async def test_icon_swell2_blend_keeps_the_inputs_units(monkeypatch):
    monkeypatch.setenv("ICON_SWELL2_STORED", "1")
    t = RUN + timedelta(hours=12)
    g, e = _item("GFS", t, "g.json"), _item("EURO", t, "e.json")
    loaded = {"g.json": _product("GFS", t, speed=1.0), "e.json": _product("EURO", t, speed=2.0)}
    s = MagicMock()
    s.store.get_manifest = MagicMock(return_value=SimpleNamespace(products=[g, e]))
    s.store.load_product = MagicMock(side_effect=lambda fn: loaded.get(fn))
    s.store.save_products_batch = MagicMock(side_effect=lambda batch: len(batch))
    assert await ingest_icon_swell2_blend_impl(s) is True
    saved = [p for p, _ in s.store.save_products_batch.call_args[0][0]]
    assert saved and all(p.model == "ICON" and p.layer == "swell_2" for p in saved)
    for p in saved:
        assert p.units == MARINE_UNITS                     # was {"speed": "kn", ...}: the schema default
        assert (p.value_unit, p.display_unit_hint) == ("m", "ft")


@pytest.mark.parametrize("layer", ["waves", "swell_1", "swell_2", "wind_waves"])
def test_lattice_interpolation_keeps_the_brackets_units_for_every_marine_layer(layer):
    a = _product("EURO", RUN, layer=layer)
    b = _product("EURO", RUN + timedelta(hours=6), layer=layer)
    out = interpolate_between(a, b, RUN + timedelta(hours=3))
    assert out is not None and out.source_dataset == "estimated_interpolation"
    assert out.units == MARINE_UNITS
    assert out.units["speed"] != "kn"


def test_lattice_label_follows_the_input_wind_stays_knots():
    a = _product("EURO", RUN, domain="wind", layer="wind", units=WIND_UNITS)
    b = _product("EURO", RUN + timedelta(hours=6), domain="wind", layer="wind", units=WIND_UNITS)
    out = interpolate_between(a, b, RUN + timedelta(hours=3))
    assert out is not None and out.units == WIND_UNITS     # copied, never forced to "m"

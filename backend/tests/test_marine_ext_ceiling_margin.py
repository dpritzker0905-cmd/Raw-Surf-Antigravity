"""MARINE_EXT_CEILING_MARGIN_H (dark, 2026-10-25): the ICON / EURO marine estimated tails baked past run + 336 h.

The owner's manual test: "the ICON data is showing Saturday 13th day on the Sunday 14th day with holes in Gulf data". The tails end at
the anchor's run_time + 336 h while the scrubber offers now + 336 h, so between bakes the last hours fall from the 2-deg tail to the
10-deg one and then to the far-edge hold (live 2026-10-25 21Z: ICON 2-deg tail now+320.5 h, 10-deg now+332.5 h). Pins: default 0 =
exactly today's ceiling; the margin is clamped 0..48 h; the EURO ceiling helper honours it; the ICON job (the real estimator, a fake
store) bakes targets to run + 336 + margin and no further, labelled estimated with the same basis.
"""
import asyncio
import types
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import icon_marine_extension as ime
from services.weather_pipeline.scheduler_helpers import euro_estimate_within_ceiling, marine_ext_ceiling_hours
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

RUN = datetime(2026, 10, 25, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("MARINE_EXT_CEILING_MARGIN_H", raising=False)
    monkeypatch.setenv("ICON_MARINE_EXTEND_MID", "1")


@pytest.mark.parametrize("env, want", [(None, 336.0), ("0", 336.0), ("12", 348.0), ("48", 384.0), ("100", 384.0), ("-5", 336.0),
                                       ("junk", 336.0)])
def test_the_margin_is_clamped_and_off_by_default(monkeypatch, env, want):
    if env is not None:
        monkeypatch.setenv("MARINE_EXT_CEILING_MARGIN_H", env)
    assert marine_ext_ceiling_hours() == want
    assert ime.icon_tail_ceiling(RUN) == RUN + timedelta(hours=want)


def test_the_euro_ceiling_helper_honours_the_margin(monkeypatch):
    anchor = RUN + timedelta(hours=240)
    assert euro_estimate_within_ceiling(RUN + timedelta(hours=339), RUN, anchor, 240) is False          # today: run + 336
    monkeypatch.setenv("MARINE_EXT_CEILING_MARGIN_H", "12")
    c = marine_ext_ceiling_hours()
    assert euro_estimate_within_ceiling(RUN + timedelta(hours=347), RUN, anchor, 240, ceiling_hours=c) is True
    assert euro_estimate_within_ceiling(RUN + timedelta(hours=349), RUN, anchor, 240, ceiling_hours=c) is False


def _grid(base):
    c = CoverageBounds(west=-180.0, south=-2.0, east=180.0, north=2.0)
    vecs = [GridVector(lat=lat, lng=lng, speed=base, direction=90.0, u=-base, v=0.0, period=9.0, is_valid=True)
            for lat in (-2.0, 0.0, 2.0) for lng in (-180.0, 0.0, 180.0)]
    return c, NormalizedGrid(bounds=c, cols=3, rows=3, vectors=vecs)


def _product(model, vt, base, estimated=False):
    c, g = _grid(base)
    p = NormalizedProduct(model=model, provider="test", domain="marine", layer="waves", run_time=RUN, valid_time=vt,
                          is_forecast_authoritative=not estimated, is_estimated=estimated, coverage=c, grid=g, value_kind="wave_height",
                          value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800)
    p.region_id = "global_mid"
    return p


class _Store:
    def __init__(self, gfs_last_h):
        anchor_vt = RUN + timedelta(hours=168)
        self.items, self.products, self.saved = [], {}, []

        def add(model, vt, base):
            name = f"{model.lower()}_marine_waves_global_mid_{vt:%Y%m%dT%H%M%SZ}.json"
            self.items.append(types.SimpleNamespace(model=model, domain="marine", layer="waves", region_id="global_mid", filename=name,
                                                    valid_time_start=vt, is_estimated=False, resolution=2.0, coverage_mode="global_tile"))
            self.products[name] = _product(model, vt, base)
        add("ICON", anchor_vt, 2.0)
        for h in range(168, gfs_last_h + 1, 3):
            add("GFS", RUN + timedelta(hours=h), 1.0)

    def get_manifest(self):
        return types.SimpleNamespace(products=self.items)

    def load_product(self, filename, **kw):
        p = self.products.get(filename)
        return p.model_copy(deep=True) if p is not None else None

    def save_products_batch(self, items):
        self.saved.extend(items)
        return len(items)


def _bake(store, monkeypatch, margin=None):
    if margin is not None:
        monkeypatch.setenv("MARINE_EXT_CEILING_MARGIN_H", str(margin))
    monkeypatch.setattr(ime, "_region_tiers", lambda: ["global_mid"])
    monkeypatch.setattr(ime, "_LAYERS", ["waves"])
    asyncio.run(ime.ingest_icon_marine_extended_estimates_impl(types.SimpleNamespace(store=store)))
    return sorted(p.valid_time for p, _res in store.saved)


def test_the_icon_tail_reaches_run_plus_336_plus_the_margin_and_no_further(monkeypatch):
    off = _bake(_Store(gfs_last_h=384), monkeypatch)                  # GFS reaches f384 (GFS_WORLD_FULL_HORIZON=1)
    assert off[-1] == RUN + timedelta(hours=336)                       # today: the tail stops at run + 336
    on_store = _Store(gfs_last_h=384)
    on = _bake(on_store, monkeypatch, margin=12)
    assert on[-1] == RUN + timedelta(hours=348) and len(on) == len(off) + 4      # 339, 342, 345, 348
    assert all(p.is_estimated and p.model == "ICON" and p.estimate_basis["type"] == "icon_persistence_gfs_blend"
               for p, _res in on_store.saved)                          # the same blend, the same label


def test_without_gfs_targets_past_f336_the_margin_adds_nothing(monkeypatch):
    on = _bake(_Store(gfs_last_h=336), monkeypatch, margin=12)         # GFS_WORLD_FULL_HORIZON off: GFS ends at f336
    assert on[-1] == RUN + timedelta(hours=336)


def test_the_euro_job_passes_the_margin_to_its_ceiling():
    """The EURO marine job's ceiling call site (scheduler_helpers.ingest_euro_marine_extended_estimates_impl) uses the margin: a
    source pin, as the job itself needs the whole CMEMS/GFS/ICON product set to run."""
    import inspect
    from services.weather_pipeline import scheduler_helpers as sh
    src = inspect.getsource(sh.ingest_euro_marine_extended_estimates_impl)
    assert "ceiling_hours=marine_ext_ceiling_hours()" in src

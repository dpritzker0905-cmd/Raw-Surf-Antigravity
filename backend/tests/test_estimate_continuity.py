"""EURO estimate continuity: prune after replace (item 15) and the lattice fill's ghost-slot refresh (2026-11-01).

Two dark flags, both measured on dev before they were built:

* INGEST_PRUNE_ESTIMATES_AFTER_REPLACE. The EURO coarse save writes a short GFS-ext tail, so the lane rule ("an
  estimate is superseded by any newer estimated generation") deleted the previous generation about 22 min before the
  extended-estimates stage rewrote it (112 objects at 16:05:52Z on 10-27). With the flag, an estimate goes only when a
  replacement exists at its own valid time.
* LATTICE_FILL_REFRESH_STALE. Core run 41347283478 (2026-11-01 21Z) saved 2 interpolations, not the usual ~32: the
  manifest still listed last cycle's fill entry at EURO waves +147 h (its object was already gone: NoSuchKey), so the
  slot looked filled. With the flag, the fill's own entries from an older native run count as missing.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline.lattice_fill import find_fill_slots
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest
from services.weather_pipeline.store import ProductStore

OLD = datetime(2026, 11, 1, 16, 30, tzinfo=timezone.utc)   # previous cycle's ingest run
NEW = datetime(2026, 11, 1, 20, 30, tzinfo=timezone.utc)   # this cycle's
T0 = datetime(2026, 11, 11, 15, tzinfo=timezone.utc)       # just past EURO's native horizon


def _prod(valid_time, run_time, filename, authoritative=False, layer="waves", source_dataset=None):
    return ManifestProduct(
        model="EURO", provider="copernicus", domain="marine", layer=layer,
        run_time=run_time, valid_time_start=valid_time, valid_time_end=valid_time,
        resolution=10.0, freshness_sec=1800, is_forecast_authoritative=authoritative,
        is_estimated=not authoritative, source_dataset=source_dataset,
        coverage=CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0),
        filename=filename, region_id="global_coarse", coverage_mode="global_tile", product_id=filename,
    )


@pytest.fixture
def tail_store(tmp_path, monkeypatch):
    """Mid-cycle state right after the EURO coarse save: new natives to T0-3h and a NINE-hourly new GFS-ext tail
    (stride 3 on the three-hourly NOAA cache), with last cycle's three-hourly extended estimates still on disk."""
    for name in ("INGEST_PRUNE_VERIFIED_CYCLES", "INGEST_PRUNE_PRESERVE_ESTIMATES", "INGEST_PRUNE_ESTIMATES_AFTER_REPLACE"):
        monkeypatch.delenv(name, raising=False)
    store = ProductStore(cache_dir=tmp_path)
    products = [
        _prod(T0 - timedelta(hours=3), NEW, "native_new.json", authoritative=True),
        _prod(T0 - timedelta(hours=6), OLD, "native_old.json", authoritative=True),       # superseded native
        _prod(T0 - timedelta(hours=3), OLD, "est_old_now_native.json"),                   # a native covers its hour
    ]
    for h in range(0, 27, 3):                                  # last cycle's 3-hourly tail
        products.append(_prod(T0 + timedelta(hours=h), OLD, f"est_old_{h:02d}.json"))
    for h in (0, 9, 18):                                       # this cycle's 9-hourly GFS-ext
        products.append(_prod(T0 + timedelta(hours=h), NEW, f"est_new_{h:02d}.json"))
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc)))
    for p in products:
        (tmp_path / p.filename).write_text("{}")
    return store, tmp_path


def _names(store):
    return {p.filename for p in store.get_manifest().products}


def test_flag_off_deletes_the_whole_previous_tail_before_its_rewrite(tail_store, monkeypatch):
    """The measured defect, pinned so the flag-on case below means something: with the kill switch ('0'), six old
    estimates at hours the new 9-hourly tail does not cover are deleted, though nothing will exist there until the
    extended-estimates stage."""
    monkeypatch.setenv("INGEST_PRUNE_ESTIMATES_AFTER_REPLACE", "0")
    store, disk = tail_store
    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", NEW)
    left = _names(store)
    assert not any(n.startswith("est_old_") for n in left)
    assert not (disk / "est_old_03.json").exists()


def test_flag_on_keeps_each_old_estimate_until_its_own_hour_is_replaced(tail_store, monkeypatch):
    monkeypatch.delenv("INGEST_PRUNE_ESTIMATES_AFTER_REPLACE", raising=False)  # unset = ON (default since 2026-11-01)
    store, disk = tail_store
    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", NEW)
    left = _names(store)
    # Replaced by a newer estimate at the same valid time -> gone.
    assert {"est_old_00.json", "est_old_09.json", "est_old_18.json"}.isdisjoint(left)
    # A native now covers its hour -> gone.
    assert "est_old_now_native.json" not in left
    # No replacement yet -> kept, file and entry, so the /grid path still has a product there.
    for h in (3, 6, 12, 15, 21, 24):
        assert f"est_old_{h:02d}.json" in left and (disk / f"est_old_{h:02d}.json").exists()
    # The new generation and the authoritative rule are untouched.
    assert {"est_new_00.json", "est_new_09.json", "est_new_18.json", "native_new.json"} <= left
    assert "native_old.json" not in left


def test_flag_on_is_inert_when_the_operator_purges_with_preserve_estimates_off(tail_store, monkeypatch):
    """INGEST_PRUNE_PRESERVE_ESTIMATES=0 is the documented lever to purge a poisoned estimated generation with one
    healthy native run; the new flag must not override it."""
    monkeypatch.setenv("INGEST_PRUNE_ESTIMATES_AFTER_REPLACE", "1")
    monkeypatch.setenv("INGEST_PRUNE_PRESERVE_ESTIMATES", "0")
    store, _ = tail_store
    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", NEW)
    assert not any(n.startswith("est_old_") for n in _names(store))


def test_flag_on_never_deletes_an_object_a_newer_registration_names(tmp_path, monkeypatch):
    """Estimates are time-keyed: the rewrite reuses the filename. The old registration goes, the object stays.
    Object protection is INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS (#590, on in the hosted lanes since 10-28); this flag
    relies on it rather than re-implementing it."""
    monkeypatch.setenv("INGEST_PRUNE_ESTIMATES_AFTER_REPLACE", "1")
    monkeypatch.setenv("INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS", "1")
    store = ProductStore(cache_dir=tmp_path)
    shared = "euro_marine_waves_global_coarse_20261111T150000Z_estimated.json"
    products = [_prod(T0, OLD, shared), _prod(T0, NEW, shared), _prod(T0 - timedelta(hours=3), NEW, "n.json", True)]
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc)))
    for p in products:
        (tmp_path / p.filename).write_text("{}")
    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", NEW)
    runs = [p.run_time for p in store.get_manifest().products if p.filename == shared]
    assert runs == [NEW]
    assert (tmp_path / shared).exists()


# ── LATTICE_FILL_REFRESH_STALE ───────────────────────────────────────────────────────────────────

R12 = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)   # the EURO run the live probe read


def _item(lead_h, run_time, authoritative=True, source_dataset=None):
    return SimpleNamespace(valid_time_start=R12 + timedelta(hours=lead_h), run_time=run_time,
                           is_forecast_authoritative=authoritative, source_dataset=source_dataset)


def _ecmwf_lane(run_time):
    """ECMWF open-data cadence: three-hourly to +144 h, six-hourly to +240 h."""
    return [_item(h, run_time) for h in list(range(0, 145, 3)) + list(range(150, 241, 6))]


def _leads(slots):
    return [(s[2] - R12).total_seconds() / 3600.0 for s in slots]


def test_ghost_fill_entries_hide_the_boundary_slots_when_the_flag_is_off():
    """The 21Z shape: last cycle's fill entries at 147/153/... are still listed, so every slot looks filled."""
    items = _ecmwf_lane(NEW) + [_item(h, OLD, False, "estimated_interpolation") for h in range(147, 238, 6)]
    assert find_fill_slots(items, 6.0) == []
    assert find_fill_slots(items, 6.0, refresh_stale=False) == []


def test_flag_on_regenerates_every_stale_own_fill_from_the_new_brackets():
    items = _ecmwf_lane(NEW) + [_item(h, OLD, False, "estimated_interpolation") for h in range(147, 238, 6)]
    slots = find_fill_slots(items, 6.0, refresh_stale=True)
    assert _leads(slots) == [float(h) for h in range(147, 238, 6)]
    assert _leads(slots)[:2] == [147.0, 153.0]
    for a, b, _slot in slots:   # brackets are this run's natives, never the stale entry
        assert a.run_time == NEW and b.run_time == NEW and a.is_forecast_authoritative


def test_flag_on_keeps_a_fill_from_the_current_run():
    items = _ecmwf_lane(NEW) + [_item(h, NEW, False, "estimated_interpolation") for h in range(147, 238, 6)]
    assert find_fill_slots(items, 6.0, refresh_stale=True) == []


def test_flag_on_never_displaces_an_extension_estimate():
    """Only the fill's own output qualifies: an older extension estimate (the 14-day contract) is not 'missing'."""
    natives = [_item(h, NEW) for h in range(0, 241, 6)]
    ext = [_item(h, OLD, False, "gfs_estimated_fallback") for h in range(3, 241, 6)]
    assert find_fill_slots(natives + ext, 6.0, refresh_stale=True) == []


def test_flag_on_with_no_authoritative_product_changes_nothing():
    fills = [_item(h, OLD, False, "estimated_interpolation") for h in range(0, 30, 3)]
    assert find_fill_slots(fills, 6.0, refresh_stale=True) == find_fill_slots(fills, 6.0)


def test_the_fill_job_reads_the_flag(monkeypatch):
    from services.weather_pipeline import lattice_fill
    monkeypatch.delenv("LATTICE_FILL_REFRESH_STALE", raising=False)
    assert lattice_fill.refresh_stale_enabled() is True, "ON by default since 2026-11-01 (owner)"
    monkeypatch.setenv("LATTICE_FILL_REFRESH_STALE", "0")
    assert lattice_fill.refresh_stale_enabled() is False, "'0' is the kill switch"


@pytest.mark.asyncio
@pytest.mark.parametrize("flag,saved", [("0", 0), ("1", 1)])
async def test_the_fill_job_rewrites_a_ghost_slot_only_with_the_flag(monkeypatch, flag, saved):
    """Driver level, the 21Z shape: natives of this run at +144/+150, and a listed fill entry at +147 from the last
    cycle whose object is gone (load_product -> None). Off: nothing is saved. On: the slot is regenerated."""
    from unittest.mock import MagicMock
    from services.weather_pipeline.lattice_fill import fill_inband_lattice_gaps_impl
    from services.weather_pipeline.schemas import GridVector, NormalizedGrid, NormalizedProduct

    monkeypatch.delenv("LATTICE_INBAND_FILL", raising=False)
    monkeypatch.setenv("LATTICE_FILL_REFRESH_STALE", flag)
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

    def native(lead_h, h):
        vt = R12 + timedelta(hours=lead_h)
        vecs = [GridVector(lat=0.0, lng=float(i), speed=h, direction=90.0, u=-h, v=0.0, period=9.0, is_valid=True)
                for i in range(4)]
        return NormalizedProduct(
            model="EURO", provider="open-meteo", domain="marine", layer="waves", run_time=NEW, valid_time=vt,
            is_forecast_authoritative=True, is_estimated=False, coverage=bounds,
            grid=NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vecs), value_kind="wave_height",
            value_unit="m", display_unit_hint="ft", product_id=f"n{lead_h}", source_variables=["wave_height"],
            freshness_sec=3600, region_id="global_coarse", coverage_mode="global_tile")

    def entry(p, filename, authoritative, run_time, source_dataset=None, vt=None):
        return SimpleNamespace(model="EURO", domain="marine", layer="waves", region_id="global_coarse",
                               valid_time_start=vt or p.valid_time, run_time=run_time, filename=filename,
                               resolution=10.0, is_estimated=not authoritative,
                               is_forecast_authoritative=authoritative, source_dataset=source_dataset)

    a, b = native(144, 1.0), native(150, 2.0)
    files = {"a.json": a, "b.json": b}
    entries = [entry(a, "a.json", True, NEW), entry(b, "b.json", True, NEW),
               entry(None, "ghost_147_estimated.json", False, OLD, "estimated_interpolation",
                     vt=R12 + timedelta(hours=147))]
    sched = MagicMock()
    sched.store.get_manifest.return_value = SimpleNamespace(products=entries)
    sched.store.load_product.side_effect = lambda fn: files.get(fn)
    sched.store.save_products_batch.side_effect = lambda batch: len(batch)

    ok = await fill_inband_lattice_gaps_impl(sched)
    assert ok is bool(saved)
    if saved:
        (batch,), _ = sched.store.save_products_batch.call_args
        (est, _res), = batch
        assert est.valid_time == R12 + timedelta(hours=147)
        assert est.run_time == NEW and est.is_estimated and est.source_dataset == "estimated_interpolation"
        assert est.grid.vectors[0].speed == pytest.approx(1.5, abs=1e-3)
    else:
        sched.store.save_products_batch.assert_not_called()

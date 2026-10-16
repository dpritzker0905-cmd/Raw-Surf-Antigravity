"""MANIFEST_PUBLISH_ONE_STEP at the six call sites: flag off is byte-identical, the lane being unavailable is inert, flag on
hands the snapshot to the publisher and does no I/O on the caller's thread. Plus the flag's registry entry.

The flag-off tests are CHARACTERIZATION tests: they were written and run green against the code BEFORE the call sites were touched."""
import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import manifest_publish_step as mps
from services.weather_pipeline import store_helpers
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, ManifestProduct, NormalizedGrid, NormalizedProduct, PipelineManifest,
)
from services.weather_pipeline.store import ProductStore, dump_manifest_for_l2, reconcile_manifest_products_for_upload
from tests._manifest_chain_harness import (  # noqa: F401,F811  (fixtures are used by name; the autouse ones apply here)
    BASE, FLAG, LATTICE, NEW_RUN, OLD_RUN, PILOTS_NEW, PRUNED, RUN_TIME, SAVES, UNIQUE_KEY, VALID, BOUNDS,
    Chain, FakeStore, InlineExecutor, RecordingExecutor,
    _entry, _files, _fresh_slot, _iso, _keep_moving, _no_network, _raw_entry, _raw_wind, _snapshot, _wind,
    adding, chain, changing, inline, parked, removing, sleeps, store, submit,
)


def _normalized(name_run=OLD_RUN):
    return NormalizedProduct(
        model="GFS", provider="noaa", domain="marine", layer="waves", run_time=name_run, valid_time=VALID,
        coverage=BOUNDS, region_id="gulf", is_forecast_authoritative=True, is_estimated=False, freshness_sec=0,
        value_kind="height", value_unit="m", display_unit_hint="ft", source_variables=["hs"],
        grid=NormalizedGrid(bounds=BOUNDS, cols=1, rows=1, vectors=[GridVector(lat=29, lng=-87, speed=2)]))


def _verified(filename, cycle_hours, received_hours=0):
    p = _entry(filename, provider="noaa", coverage_mode="regional_tile")
    p.model_run_time = OLD_RUN + timedelta(hours=cycle_hours)
    p.model_run_time_status = "known"
    p.run_time = OLD_RUN + timedelta(hours=received_hours)
    return p


def _disk_store(tmp_path, products=()):
    store = ProductStore(cache_dir=tmp_path)
    store._save_manifest(PipelineManifest(products=list(products), last_manifest_update=RUN_TIME))
    for p in products:
        (tmp_path / p.filename).write_bytes(b"frame")
    return store


# Each driver: (store, monkeypatch) -> runs ONE call site against a store that holds its fixtures; returns the
# `exclude_keys` the site is expected to hand reconcile (None = it passes none).
def _drive_save_product(tmp_path, monkeypatch):
    store = _disk_store(tmp_path)
    store_helpers.save_product_helper(store, _normalized())
    return store, None


def _drive_save_batch(tmp_path, monkeypatch):
    store = _disk_store(tmp_path)
    assert store_helpers.save_products_batch_helper(store, [(_normalized(), 0.25)]) == 1
    return store, None


def _drive_prune_old(tmp_path, monkeypatch):
    store = _disk_store(tmp_path, [_entry("old.json", old=True), _entry("new.json", newer=True)])
    store.prune_old_products(VALID - timedelta(days=2))
    return store, {"old.json"}


def _drive_duplicate_sweep(tmp_path, monkeypatch):
    store = _disk_store(tmp_path, [_entry("old.json"), _entry("new.json", newer=True)])
    assert store.prune_duplicate_valid_times() == 1
    return store, {"old.json"}


def _drive_superseded(tmp_path, monkeypatch):
    store = _disk_store(tmp_path, [_entry("old.json"), _entry("new.json", newer=True)])
    store.prune_superseded_products("GFS", "marine", "waves", "gulf", NEW_RUN)
    return store, {"old.json"}


def _drive_verified_cycles(tmp_path, monkeypatch):
    monkeypatch.setenv("INGEST_PRUNE_VERIFIED_CYCLES", "1")
    store = _disk_store(tmp_path, [_verified("older.json", -6, received_hours=1), _verified("newest.json", 0)])
    assert store.prune_duplicate_valid_times() == 1
    return store, {"older.json"}


SITES = {
    "store_helpers.save_product_helper": _drive_save_product,
    "store_helpers.save_products_batch_helper": _drive_save_batch,
    "copernicus_validator.prune_old_products_helper": _drive_prune_old,
    "copernicus_validator.prune_duplicate_valid_times_helper": _drive_duplicate_sweep,
    "copernicus_validator.prune_superseded_products_helper": _drive_superseded,
    "prune_verified_cycles.prune_verified_cycles": _drive_verified_cycles,
}


@pytest.fixture
def site_env(monkeypatch):
    """The store's executors and L2 are recorded; the L2 'remote' manifest is empty. Returns the shared event log."""
    log = []
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    monkeypatch.setattr(store_mod, "_manifest_executor", RecordingExecutor(log))
    monkeypatch.setattr(store_mod, "_upload_executor", InlineExecutor())
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [])
    monkeypatch.setattr(ProductStore, "_cached_manifest", None)
    real_reconcile, real_dump = store_mod.reconcile_manifest_products_for_upload, store_mod.dump_manifest_for_l2

    def reconcile(manifest, **kwargs):
        log.append(("reconcile", manifest, kwargs))
        return real_reconcile(manifest, **kwargs)

    def dump(manifest):
        data = real_dump(manifest)
        log.append(("dump", manifest, data))
        return data
    monkeypatch.setattr(store_mod, "reconcile_manifest_products_for_upload", reconcile)
    monkeypatch.setattr(store_mod, "dump_manifest_for_l2", dump)
    # The lane is otherwise AVAILABLE here (designated writer, pointer table present), so only the flag keeps it off.
    monkeypatch.setattr(mp, "pointer_enabled", lambda: True)
    monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: True)
    monkeypatch.setattr(mp, "read_pointer", lambda: pytest.fail("flag off: no pointer read on the caller's thread"))
    monkeypatch.setattr(mp, "fetch_manifest_object", lambda key: pytest.fail("flag off: no head GET by key"))
    return log


@pytest.mark.parametrize("flag", [None, "0", "true", ""], ids=["unset", "0", "true", "empty"])
@pytest.mark.parametrize("site", sorted(SITES))
def test_flag_off_each_call_site_reconciles_then_dumps_then_queues_the_manifest_json_upload(
        site, flag, site_env, monkeypatch, tmp_path):
    """The three-line pattern, unchanged: reconcile (exclude_keys only where the site passes them), dump, then
    `_manifest_executor.submit(store._upload_to_supabase, "manifest.json", <the dumped bytes>)`. The upload is QUEUED,
    not run, and nothing is read from the pointer. Any value but exactly "1" is off."""
    if flag is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, flag)
    store, expected_exclude = SITES[site](tmp_path, monkeypatch)
    log = [event for event in site_env if event[0] in ("reconcile", "dump", "submit")]
    order = [event[0] for event in log]
    assert order == ["reconcile", "dump", "submit"], order
    reconcile, dump, submit = log
    assert reconcile[1] is dump[1], "the manifest reconcile mutated is the manifest that is dumped"
    if expected_exclude is None:
        assert reconcile[2] == {}, "this site passes no exclude_keys"
    else:
        assert set(reconcile[2]["exclude_keys"]) == expected_exclude and set(reconcile[2]) == {"exclude_keys"}
    _, fn, args, kwargs = submit
    assert fn == store._upload_to_supabase
    assert args == ("manifest.json", dump[2]) and kwargs == {}
    assert len(store_mod._manifest_executor.queue) == 1, "queued, not run"


INERT = {
    "pointer_disabled": lambda monkeypatch: monkeypatch.setattr(mp, "pointer_enabled", lambda: False),
    "immutable_publication": lambda monkeypatch: monkeypatch.setenv("MANIFEST_IMMUTABLE_PUBLICATION", "1"),
    "merge_on_upload_off": lambda monkeypatch: monkeypatch.setenv("MANIFEST_MERGE_ON_UPLOAD", "0"),
    "not_the_designated_writer": lambda monkeypatch: monkeypatch.setattr(store_mod, "_l2_pipeline_writes_allowed", lambda: False),
}


@pytest.mark.parametrize("reason", sorted(INERT))
@pytest.mark.parametrize("site", sorted(SITES))
def test_with_the_flag_on_but_the_lane_unavailable_every_call_site_is_the_old_path(
        site, reason, site_env, monkeypatch, tmp_path):
    """The flag is on and something makes the one-step lane the wrong lane: it is inert, byte for byte today's calls
    (reconcile, dump, queue the manifest.json PUT), with no pointer read and no new write."""
    monkeypatch.setenv(FLAG, "1")
    INERT[reason](monkeypatch)
    store, expected_exclude = SITES[site](tmp_path, monkeypatch)
    log = [event for event in site_env if event[0] in ("reconcile", "dump", "submit")]
    assert [event[0] for event in log] == ["reconcile", "dump", "submit"]
    _, fn, args, kwargs = log[2]
    assert fn == store._upload_to_supabase and args == ("manifest.json", log[1][2]) and kwargs == {}
    assert (set(log[0][2].get("exclude_keys", ())) or None) == expected_exclude


@pytest.mark.parametrize("site", sorted(SITES))
def test_flag_on_each_call_site_hands_its_snapshot_to_the_publisher_and_does_no_io_on_the_callers_thread(
        site, chain, parked, monkeypatch, tmp_path):
    monkeypatch.setattr(ProductStore, "_upload_to_supabase", lambda self, filename, data, **kw: chain.upload(filename, data, **kw))
    monkeypatch.setattr(ProductStore, "_delete_from_supabase", lambda self, filename: chain.delete(filename))
    monkeypatch.setattr(store_mod, "_upload_executor", InlineExecutor())
    monkeypatch.setattr(ProductStore, "_cached_manifest", None)
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    chain.foreign_publish(lambda products: products + [_raw_entry("old.json"), _raw_entry("older.json")])
    store, expected_exclude = SITES[site](tmp_path, monkeypatch)
    io = [e for e in chain.events if e[0] in ("read_pointer", "fetch", "fetch_pointed", "cas")
          or (e[0] == "upload" and (e[1] == "manifest.json" or e[1].startswith("manifests/")))]
    assert io == [], "the save did pointer or manifest I/O on the caller's thread: %s" % io
    assert len(parked.queue) == 1
    parked.run()
    assert len(chain.wins()) == 1
    survivors = {p.filename for p in store.get_manifest().products}
    head = set(chain.head_files())
    assert survivors and survivors <= head and set(BASE) <= head
    assert not (expected_exclude or set()) & head, "a pruned entry came back from the head"


def test_the_flag_is_registered_dark_and_points_at_the_l2_writers_not_render():
    import ast
    from pathlib import Path
    path = Path(__file__).resolve().parent.parent / "routes" / "admin" / "surf_forecast.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    table = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                 and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in node.targets))
    registry = {key.value: ast.literal_eval(value) for key, value in zip(table.keys, table.values)}
    default, description, where = registry[FLAG]
    assert default == "0", "a change to what the manifest publishes ships dark"
    assert "workflow" in where.lower() and "render" in where.lower() and where.lower().count("not render") == 1
    assert "pilots" in where.lower() and "precompute" in where.lower() and "forecast-ingest" in where.lower()

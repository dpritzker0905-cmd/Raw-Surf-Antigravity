"""ING-1 (Fable audit 2026-11-10): a lane's stale snapshot must not resurrect an entry another lane pruned.

THE AUDIT PROBE: lane B (pilots) restored {X, Y}; lane A (core) pruned X, deleted its object and published head {Y}.
The union-only merge folded X back when B published: an entry naming a deleted object. Measured live 2026-11-11 01:11Z:
593 of 18,466 manifest entries had no object. The fix: A's publish carries a tombstone for X; B's merge drops X.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

import services.weather_pipeline.manifest_publish_step as step
import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_tombstones as tomb
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest
from services.weather_pipeline.store import dump_manifest_for_l2, reconcile_manifest_products_for_upload

NOW = datetime.now(timezone.utc).replace(microsecond=0)


@pytest.fixture(autouse=True)
def _no_runtime_manifest(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.delenv("MANIFEST_PRUNE_TOMBSTONES", raising=False)
    monkeypatch.delenv("MANIFEST_TOMBSTONE_TTL_HOURS", raising=False)


def _product(pid, ingested_hours_ago, valid_hours_ago=6):
    stamp = NOW - timedelta(hours=ingested_hours_ago)
    vt = NOW - timedelta(hours=valid_hours_ago)
    return ManifestProduct(
        model="GFS", provider="noaa", domain="marine", layer="waves",
        run_time=stamp, ingested_at=stamp, valid_time_start=vt, valid_time_end=vt, resolution=0.25,
        freshness_sec=3600, is_forecast_authoritative=True,
        coverage=CoverageBounds(west=-10.0, south=30.0, east=0.0, north=40.0),
        filename=pid, product_id=pid,
    )


def _raw(pid, ingested_hours_ago, valid_hours_ago=6):
    return json.loads(_product(pid, ingested_hours_ago, valid_hours_ago).model_dump_json())


def _manifest(*products, pruned=None):
    return PipelineManifest(last_manifest_update=NOW, products=list(products), pruned=pruned)


def _head(products, pruned):
    return tomb.ProductList.of(products, pruned)


def _iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


# ---- the audit probe, through the merge every publish path uses ------------------------------------------------------

def test_core_prune_stays_gone_when_pilots_publishes_its_stale_snapshot():
    pilots = _manifest(_product("gfs_x_past.json", 3), _product("gfs_y.json", 3))     # restored 3 h ago
    head = _head([_raw("gfs_y.json", 3)], {"gfs_x_past.json": _iso(NOW - timedelta(hours=1))})  # core pruned X 1 h ago
    reconcile_manifest_products_for_upload(pilots, remote_products=head)
    assert [p.filename for p in pilots.products] == ["gfs_y.json"]
    assert "gfs_x_past.json" in pilots.pruned, "the tombstone must ride on into pilots' publish"


def test_flag_off_is_todays_merge_and_todays_bytes(monkeypatch):
    monkeypatch.setenv("MANIFEST_PRUNE_TOMBSTONES", "0")
    pilots = _manifest(_product("gfs_x_past.json", 3), _product("gfs_y.json", 3))
    head = _head([_raw("gfs_y.json", 3)], {"gfs_x_past.json": _iso(NOW - timedelta(hours=1))})
    reconcile_manifest_products_for_upload(pilots, remote_products=head)
    assert [p.filename for p in pilots.products] == ["gfs_x_past.json", "gfs_y.json"], "flag off resurrects, as before"
    assert pilots.pruned is None
    tomb.stamp(pilots, ["gfs_y.json"])                         # a prune with the flag off writes nothing
    data = dump_manifest_for_l2(pilots)
    assert b"pruned" not in data
    assert data == pilots.model_dump_json(indent=2, exclude={"pruned"}).encode("utf-8")


def test_a_manifest_without_tombstones_serializes_as_before():
    m = _manifest(_product("a.json", 1))
    assert json.loads(m.model_dump_json()).keys() == {"last_manifest_update", "products", "written_by"}


def test_a_product_ingested_again_after_the_prune_is_not_dropped():
    pilots = _manifest(_product("gfs_x_past.json", 0.1))     # re-ingested 6 min ago, a new object under the same name
    head = _head([], {"gfs_x_past.json": _iso(NOW - timedelta(hours=1))})
    head.append(_raw("gfs_y.json", 3))
    reconcile_manifest_products_for_upload(pilots, remote_products=head)
    assert {p.filename for p in pilots.products} == {"gfs_x_past.json", "gfs_y.json"}


def test_a_newer_remote_registration_is_kept_too():
    ours = _manifest(_product("gfs_y.json", 3))
    head = _head([_raw("gfs_x_past.json", 0.1), _raw("gfs_y.json", 3)],
                 {"gfs_x_past.json": _iso(NOW - timedelta(hours=1))})
    reconcile_manifest_products_for_upload(ours, remote_products=head)
    assert {p.filename for p in ours.products} == {"gfs_x_past.json", "gfs_y.json"}


def test_tombstones_expire_after_the_ttl(monkeypatch):
    monkeypatch.setenv("MANIFEST_TOMBSTONE_TTL_HOURS", "12")
    stones = {"old.json": _iso(NOW - timedelta(hours=13)), "recent.json": _iso(NOW - timedelta(hours=11))}
    ours = _manifest(_product("gfs_y.json", 30), pruned=stones)
    reconcile_manifest_products_for_upload(ours, remote_products=_head([_raw("gfs_y.json", 30)], None))
    assert set(ours.pruned) == {"recent.json"}


def test_the_newest_stamp_per_name_wins_the_union():
    later, earlier = _iso(NOW - timedelta(hours=1)), _iso(NOW - timedelta(hours=5))
    ours = _manifest(_product("gfs_y.json", 3), pruned={"x.json": earlier})
    head = _head([_raw("gfs_y.json", 3)], {"x.json": later})
    reconcile_manifest_products_for_upload(ours, remote_products=head)
    assert ours.pruned == {"x.json": later}


# ---- the one-step lane: tombstones parsed from the head bytes and applied in _merge -----------------------------------

def test_one_step_merge_reads_the_heads_tombstones(monkeypatch):
    core_head = _manifest(_product("gfs_y.json", 3), pruned={"gfs_x_past.json": _iso(NOW - timedelta(hours=1))})
    head_bytes = core_head.model_dump_json(indent=2).encode("utf-8")
    products = step._head_products(head_bytes)
    assert products.pruned == {"gfs_x_past.json": _iso(NOW - timedelta(hours=1))}
    monkeypatch.setattr(step._slot, "unconfirmed", None)
    snapshot = _manifest(_product("gfs_x_past.json", 3), _product("gfs_y.json", 3)).model_dump_json().encode("utf-8")
    merged, _, _ = step._merge(step._Pending(None, snapshot, {}, 1), products)
    doc = json.loads(merged)
    assert [p["filename"] for p in doc["products"]] == ["gfs_y.json"]
    assert "gfs_x_past.json" in doc["pruned"]


def test_legacy_remote_fetch_carries_the_tombstones(monkeypatch):
    core_head = _manifest(_product("gfs_y.json", 3), pruned={"gfs_x_past.json": _iso(NOW - timedelta(hours=1))})
    import services.weather_pipeline.manifest_pointer as mp
    monkeypatch.setattr(mp, "fetch_pointed_manifest", lambda: core_head.model_dump_json().encode("utf-8"))
    pilots = _manifest(_product("gfs_x_past.json", 3), _product("gfs_y.json", 3))
    reconcile_manifest_products_for_upload(pilots)              # the flag-off-lane caller: fetches the head itself
    assert [p.filename for p in pilots.products] == ["gfs_y.json"]


# ---- the write side: every prune goes through submit_manifest_publish -------------------------------------------------

def test_a_prune_submit_stamps_its_deleted_ids(monkeypatch):
    seen = {}
    monkeypatch.setattr(step, "one_step_active", lambda: False)
    monkeypatch.setattr(step, "_submit_legacy", lambda store, manifest, ex: seen.setdefault("m", manifest))
    m = _manifest(_product("gfs_y.json", 3))
    step.submit_manifest_publish(None, m, exclude_keys=["gfs_x_past.json"])
    assert set(seen["m"].pruned) == {"gfs_x_past.json"}
    assert datetime.fromisoformat(seen["m"].pruned["gfs_x_past.json"].replace("Z", "+00:00")) >= NOW


def test_a_save_without_a_prune_writes_no_tombstone(monkeypatch):
    seen = {}
    monkeypatch.setattr(step, "one_step_active", lambda: False)
    monkeypatch.setattr(step, "_submit_legacy", lambda store, manifest, ex: seen.setdefault("m", manifest))
    step.submit_manifest_publish(None, _manifest(_product("gfs_y.json", 3)))
    assert seen["m"].pruned is None


def test_an_excluded_name_the_snapshot_still_holds_is_not_tombstoned(monkeypatch):
    """The prune removed what it deleted before submitting; a name still listed is a live registration of that name."""
    seen = {}
    monkeypatch.setattr(step, "one_step_active", lambda: False)
    monkeypatch.setattr(step, "_submit_legacy", lambda store, manifest, ex: seen.setdefault("m", manifest))
    step.submit_manifest_publish(None, _manifest(_product("gfs_y.json", 3)), exclude_keys=["gfs_y.json", "gone.json"])
    assert set(seen["m"].pruned) == {"gone.json"}
    assert [p.filename for p in seen["m"].products] == ["gfs_y.json"]


def test_the_store_tombstones_survive_a_round_trip_through_l2_bytes():
    m = _manifest(_product("gfs_y.json", 3))
    tomb.stamp(m, ["gfs_x_past.json"])
    again = PipelineManifest.model_validate_json(dump_manifest_for_l2(m))
    assert again.pruned == m.pruned
    assert store_mod is not None

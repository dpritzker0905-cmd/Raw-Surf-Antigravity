"""MANIFEST_PUBLISH_ONE_STEP: the caller's in-memory manifest keeps absorbing the head (round-4 finding P5), and the one other
path that wrote manifest.json unmerged goes through the publisher (P4).

With the lane on the merge happens on the executor thread, so the manifest the caller keeps working from would stay the
restore-time view for ever. The prune helpers decide from that manifest and DELETE objects by key, and `product_id` is the
filename (no run time in it), so a prune could delete another writer's fresher object stored under the SAME key. The slot
therefore keeps the last published (merged) bytes and the next caller-thread call folds them into the caller's manifest with the
existing reconcile: no I/O, once per publish cycle, with a lag of one publish (flag off folded the head fetched at each save)."""
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp, manifest_publish_step as mps, store_helpers
from services.weather_pipeline.schemas import PipelineManifest
from services.weather_pipeline.store import ProductStore
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import (  # noqa: F401,F811
    BASE, FLAG, LATTICE, PILOTS_NEW, RUN_TIME, SITES, InlineExecutor, RecordingExecutor, _disk_store,
    _normalized, _snapshot, _wind, adding, chain, inline, store,
)


def _wire_store_to_the_chain(monkeypatch, chain):
    monkeypatch.setattr(ProductStore, "_upload_to_supabase", lambda self, filename, data, **kw: chain.upload(filename, data, **kw))
    monkeypatch.setattr(ProductStore, "_delete_from_supabase", lambda self, filename: chain.delete(filename))
    monkeypatch.setattr(store_mod, "_upload_executor", InlineExecutor())
    monkeypatch.setattr(ProductStore, "_cached_manifest", None)


# ── P5: a prune decided on a restore-time view deletes another writer's fresher object under the same key ───────────────

@pytest.mark.parametrize("flag", ["0", "1"])
def test_a_prune_does_not_delete_another_writers_fresher_object_stored_under_the_same_key(chain, monkeypatch, tmp_path, flag):
    """The other writer re-registered x at r3 AFTER our restore (same key, new object). Our restore-time view still has x at r1,
    which the lane's newest estimated run (r3 or r2) supersedes: pruning on that view deletes the key, i.e. THEIR r3 frame."""
    monkeypatch.setenv(FLAG, flag)
    r1, r2, r3, r4 = (RUN_TIME + timedelta(hours=h) for h in (0, 6, 12, 18))
    x, y = ("euro_wind_wind_global_mid_20261025T0%d0000Z_estimated.json" % h for h in (3, 9))
    xv, yv = datetime(2026, 10, 25, 3, tzinfo=timezone.utc), datetime(2026, 10, 25, 9, tzinfo=timezone.utc)

    def entry(name, valid, run):
        return _wind(name, estimated=True, run_time=run, valid_time_start=valid, valid_time_end=valid)
    doc = json.loads(chain.objects[chain.head_key])
    doc["products"] += [json.loads(entry(x, xv, r3).model_dump_json()), json.loads(entry(y, yv, r2).model_dump_json())]
    chain.generation += 1
    chain.head_key = mp.run_keyed_manifest_key(chain.generation)
    chain.objects[chain.head_key] = json.dumps(doc).encode()
    chain.objects[x] = b"r3 frame written by the other writer"
    disk = _disk_store(tmp_path, [entry(x, xv, r1), entry(y, yv, r2)])                  # our restore-time view: x at r1, y at r2
    _wire_store_to_the_chain(monkeypatch, chain)
    monkeypatch.setattr(store_mod, "_manifest_executor", InlineExecutor())
    store_helpers.save_product_helper(disk, _normalized())                               # any save of this process
    disk.prune_superseded_products("EURO", "wind", "wind", "global_mid", r4)
    assert x not in chain.deleted, "deleted the other writer's fresher object under the same key"
    assert [p for p in json.loads(chain.objects[chain.head_key])["products"] if p["filename"] == x], "x left the head"


# ── the absorb itself ────────────────────────────────────────────────────────────────────────────────────────────────────

def test_after_a_publish_the_next_save_finds_the_other_writers_entries_in_its_in_memory_manifest_and_not_the_pruned_ones(
        chain, store, inline):
    chain.foreign_publish(adding(*LATTICE))                                              # another writer's 14 frames, g6
    manifest = _snapshot(BASE + PILOTS_NEW)
    mps.submit_manifest_publish(store, manifest)                                         # publish 1 merges them into the head
    assert not set(LATTICE) & {p.filename for p in manifest.products}, "nothing is folded in on the first save: no head yet"
    manifest.products = [p for p in manifest.products if p.filename != BASE[1]]          # a prune of BASE[1]
    mps.submit_manifest_publish(store, manifest, exclude_keys=[BASE[1]])                 # the next save
    names = {p.filename for p in manifest.products}
    assert set(LATTICE) <= names, "the head's entries were not absorbed into the caller's manifest"
    assert BASE[1] not in names, "an entry the caller just pruned was folded back from the head"
    assert chain.head_files() == sorted(BASE[:1] + LATTICE + PILOTS_NEW)


def test_the_head_is_absorbed_once_per_publish_cycle_not_once_per_save_and_with_no_io(chain, store, inline, monkeypatch):
    manifest = _snapshot(BASE)
    mps.submit_manifest_publish(store, manifest)                                         # publish 1 (inline): a head to absorb
    monkeypatch.setattr(store_mod, "_manifest_executor", RecordingExecutor())            # from now on jobs wait
    real, calls = store_mod.reconcile_manifest_products_for_upload, []
    monkeypatch.setattr(store_mod, "reconcile_manifest_products_for_upload",
                        lambda m, **kw: calls.append(sorted(kw)) or real(m, **kw))
    events_before = list(chain.events)
    for _ in range(4):
        mps.submit_manifest_publish(store, manifest)
    assert calls == [["exclude_keys", "remote_products"]], calls
    assert chain.events == events_before, "absorbing the head did I/O on the caller's thread"


def test_a_new_publish_makes_the_next_save_absorb_again(chain, store, inline, monkeypatch):
    manifest = _snapshot(BASE)
    mps.submit_manifest_publish(store, manifest)
    chain.foreign_publish(adding(*LATTICE[:3]))
    mps.submit_manifest_publish(store, manifest)                                         # absorbs publish 1, publishes 2 (merges LATTICE[:3])
    chain.foreign_publish(adding(*LATTICE[3:6]))
    mps.submit_manifest_publish(store, manifest)                                         # absorbs publish 2 (has LATTICE[:3])
    assert set(LATTICE[:3]) <= {p.filename for p in manifest.products}


def test_an_unreadable_published_head_does_not_stop_the_save_from_publishing(chain, store, inline, caplog):
    manifest = _snapshot(BASE)
    mps.submit_manifest_publish(store, manifest)
    mps._slot.head.data = b"<html>not a manifest</html>"
    with caplog.at_level(logging.WARNING):
        mps.submit_manifest_publish(store, _snapshot(BASE + PILOTS_NEW))
    assert len(chain.wins()) == 2 and chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert any("absorb" in r.getMessage() for r in caplog.records)


def test_with_the_flag_off_the_absorb_is_a_no_op_even_when_the_slot_holds_a_head(chain, monkeypatch):
    mps._slot.head = mps._Head(chain.objects[chain.head_key])
    monkeypatch.setenv(FLAG, "0")
    manifest = _snapshot(PILOTS_NEW)
    mps.absorb_published_head(manifest)
    assert [p.filename for p in manifest.products] == PILOTS_NEW and mps._slot.head.absorbed is False


# ── the prune helpers decide from the absorbed view ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("site", ["copernicus_validator.prune_old_products_helper",
                                  "copernicus_validator.prune_duplicate_valid_times_helper",
                                  "copernicus_validator.prune_superseded_products_helper",
                                  "prune_verified_cycles.prune_verified_cycles"])
def test_every_prune_absorbs_the_published_head_before_it_decides_what_to_delete(site, chain, monkeypatch, tmp_path):
    order = []
    real = mps.absorb_published_head
    monkeypatch.setattr(mps, "absorb_published_head", lambda *a, **k: order.append("absorb") or real(*a, **k))
    _wire_store_to_the_chain(monkeypatch, chain)
    monkeypatch.setattr(store_mod, "_manifest_executor", InlineExecutor())
    monkeypatch.setattr(ProductStore, "_delete_from_supabase", lambda self, filename: order.append("delete " + filename))
    SITES[site](tmp_path, monkeypatch)
    assert order[:2] == ["absorb", "delete " + ("older.json" if "verified" in site else "old.json")], order


# ── P4: get_manifest's clean-up resave was an unmerged publish path of its own ───────────────────────────────────────────

def test_the_cleaned_manifest_resave_goes_through_the_publisher_when_the_lane_is_on(chain, monkeypatch, tmp_path):
    """P4. get_manifest prunes impossible future-dated entries and used to PUT the result to manifest.json with no reconcile,
    where publish_run_keyed then swapped it in from a fresh pointer read: a restore-time view over the head."""
    monkeypatch.setenv("FORCE_MANIFEST_PRUNING", "true")
    _wire_store_to_the_chain(monkeypatch, chain)
    monkeypatch.setattr(store_mod, "_manifest_executor", InlineExecutor())
    chain.foreign_publish(adding(*LATTICE))                                              # another writer's 14 frames at g6
    future_name = "euro_wind_wind_global_mid_20270601T000000Z.json"
    future = _wind(future_name, valid_time_start=datetime(2027, 6, 1, tzinfo=timezone.utc),
                   valid_time_end=datetime(2027, 6, 1, tzinfo=timezone.utc))
    chain.foreign_publish(lambda products: products + [json.loads(future.model_dump_json())])     # the corrupt entry is in the head too
    local = PipelineManifest(last_manifest_update=RUN_TIME, products=[_wind(n) for n in BASE + PILOTS_NEW] + [future])
    (tmp_path / "manifest.json").write_text(local.model_dump_json(indent=2))
    ProductStore(cache_dir=tmp_path).get_manifest()
    files = chain.head_files()
    assert set(LATTICE) <= set(files), "an unmerged local snapshot replaced the head"
    assert future_name not in files and set(BASE + PILOTS_NEW) <= set(files)
    assert chain.nested_publishes == [None] and len(chain.wins()) == 1


def test_the_cleaned_manifest_resave_is_untouched_with_the_flag_off(chain, monkeypatch, tmp_path):
    """Flag off must stay byte-identical: the old two lines, no reconcile, the PUT of manifest.json."""
    monkeypatch.setenv(FLAG, "0")
    monkeypatch.setenv("FORCE_MANIFEST_PRUNING", "true")
    _wire_store_to_the_chain(monkeypatch, chain)
    monkeypatch.setattr(store_mod, "reconcile_manifest_products_for_upload",
                        lambda *a, **k: pytest.fail("flag off: the clean-up resave must not reconcile"))
    future = _wind("euro_wind_wind_global_mid_20270601T000000Z.json", valid_time_start=datetime(2027, 6, 1, tzinfo=timezone.utc),
                   valid_time_end=datetime(2027, 6, 1, tzinfo=timezone.utc))
    local = PipelineManifest(last_manifest_update=RUN_TIME, products=[_wind(n) for n in BASE] + [future])
    (tmp_path / "manifest.json").write_text(local.model_dump_json(indent=2))
    ProductStore(cache_dir=tmp_path).get_manifest()
    assert [u[0] for u in chain.uploads if not u[0].startswith("euro")][:1] == ["manifest.json"]

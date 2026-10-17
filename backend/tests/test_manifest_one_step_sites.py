"""MANIFEST_PUBLISH_ONE_STEP at the six call sites: flag off is byte-identical, the lane being unavailable is inert, flag on
hands the snapshot to the publisher and does no I/O on the caller's thread. Plus the flag's registry entry.

The flag-off tests are CHARACTERIZATION tests: they were written and run green against the code BEFORE the call sites were touched."""
from datetime import timedelta

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline import manifest_publish_step as mps
from services.weather_pipeline.schemas import PipelineManifest
from services.weather_pipeline.store import ProductStore, dump_manifest_for_l2
from tests._manifest_chain_harness import _fresh_slot, _no_network, sleeps  # noqa: F401  (autouse fixtures: they apply to this module)
from tests._manifest_chain_harness import (  # noqa: F401,F811
    BASE, FLAG, NEW_RUN, RUN_TIME, VALID, InlineExecutor, RecordingExecutor, SITES, _entry, _raw_entry, chain,
    parked, store, submit,
)


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
    other = dict(run_time=NEW_RUN + timedelta(hours=1), valid_time_start=VALID + timedelta(days=1),
                 valid_time_end=VALID + timedelta(days=1))               # another writer's entry, in no site's way
    chain.foreign_publish(lambda products: products + [
        _raw_entry("old.json"), _raw_entry("older.json"), _raw_entry("other_writer.json", **other)])
    mps._slot.head = mps._Head(dump_manifest_for_l2(                      # a publish this process already made
        PipelineManifest(last_manifest_update=RUN_TIME, products=[_entry("other_writer.json", **other)])))
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
    assert "other_writer.json" in survivors, "the caller's in-memory manifest did not absorb the published head"
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

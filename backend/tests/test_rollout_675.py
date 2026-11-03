"""#675 rollout v2 (rollout_675*.py): BLOCKED = zero mutation, every check blocks, snapshot -> write -> publish -> mark,
the scoped GC's grace, snapshot/restore, the reader proof, expected slots, the lane race, and flags-off identity.

Synthetic fixtures only: an in-memory storage adapter (FakeIO), tmp-dir ProductStores, hand-built manifests."""
import json
from datetime import timedelta
from types import SimpleNamespace as S

import pytest

from services.weather_pipeline import rollout_675 as r
from services.weather_pipeline import rollout_675_restore as restore
from services.weather_pipeline import store as module
from services.weather_pipeline.product_object_gc import is_product_object
from services.weather_pipeline.rollout_675_finish import canary_documents, finish_run
from services.weather_pipeline.rollout_675_io import scoped_gc_sweep
from services.weather_pipeline.rollout_675_reader import probe_canary
from services.weather_pipeline.schemas import PipelineManifest
from tests.test_estimate_continuity import NEW, OLD, T0, _prod
from tests.test_prune_shared_objects import ImmediateExecutor

LANE = "EURO/marine/waves/global_coarse"
EST = "euro_marine_waves_global_coarse_20261111T150000Z_estimated.json"


class FakeIO:
    def __init__(self, objects=None, head=None):
        self.objects, self.head, self.ops = dict(objects or {}), head, []
        self.fail_keys, self.copy_ok = set(), True

    def download(self, key):
        return self.objects.get(key)

    def upload(self, key, data):
        if key in self.fail_keys:
            raise RuntimeError("upload refused")
        self.ops.append(("upload", key))
        self.objects[key] = bytes(data)

    def copy(self, src, dst):
        if not self.copy_ok or dst in self.fail_keys:
            raise NotImplementedError("no copy")
        self.ops.append(("copy", dst))
        self.objects[dst] = self.objects[src]

    def delete(self, key):
        self.ops.append(("delete", key))
        self.objects.pop(key, None)

    def list(self, prefix=""):
        if not prefix:
            return [k for k in self.objects if "/" not in k]
        return sorted({k[len(prefix) + 1:].split("/")[0] for k in self.objects if k.startswith(prefix + "/")})

    def head_products(self):
        return None if self.head is None else [dict(x) for x in self.head]

    @property
    def mutations(self):
        return [op for op in self.ops if op[0] in ("upload", "copy", "delete") and op[1] != r.STATUS_KEY]   # status = ops metadata


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for name in r.PREREQUISITES:
        monkeypatch.setenv(name, "1")
    for name in r.FLAGS + (r.BYPASS, "INGEST_PILOTS", "INGEST_PRUNE_PRESERVE_ESTIMATES", "PRODUCT_RUN_KEYED_NAMES",
                           "ROLLOUT_675_READER_BASE", "GITHUB_STEP_SUMMARY", "PRODUCT_REVISION_REFRESH"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(module, "_upload_executor", ImmediateExecutor())
    monkeypatch.setattr(module, "_manifest_executor", ImmediateExecutor())
    monkeypatch.setattr(module, "_fetch_remote_manifest_products", lambda: [])
    r.reset()
    yield
    r.reset()


@pytest.fixture
def lane(tmp_path, monkeypatch):
    """EURO coarse waves mid-cycle: a NEW native covers T0, so last cycle's estimate at T0 is replaced (the new rule prunes
    it); last cycle's native at T0-3h is superseded by the old authoritative rule."""
    store = module.ProductStore(cache_dir=tmp_path)
    products = [_prod(T0, NEW, "native_new.json", authoritative=True),
                _prod(T0 - timedelta(hours=3), OLD, "native_old.json", authoritative=True),
                _prod(T0 - timedelta(hours=3), NEW, "native_new_m3.json", authoritative=True),
                _prod(T0, OLD, EST),
                _prod(T0 + timedelta(hours=3), OLD, "est_keep.json")]
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=NEW))
    for p in products:
        (tmp_path / p.filename).write_text(p.filename)
    deleted, published = [], []
    monkeypatch.setattr(store, "_delete_from_supabase", deleted.append)
    monkeypatch.setattr(store, "_upload_to_supabase", lambda *a, **k: True)
    import services.weather_pipeline.manifest_publish_step as mps
    monkeypatch.setattr(mps, "submit_manifest_publish", lambda st, m, exclude_keys=None: published.append(sorted(exclude_keys or ())))
    io = FakeIO(objects={p.filename: f"bytes:{p.filename}".encode() for p in products},
                head=[p.model_dump(mode="json") for p in products])
    return S(store=store, io=io, deleted=deleted, published=published, disk=tmp_path)


def names(store):
    return sorted(p.filename for p in store.get_manifest().products)


def prune(store):
    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", NEW)


# ── BLOCKED means zero mutation, and each check blocks ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("why", ["protect", "one_entry", "bypass", "status_unreadable", "head_unreadable"])
def test_each_preflight_failure_blocks_with_zero_mutation(lane, monkeypatch, why):
    if why == "protect":
        monkeypatch.setenv("INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS", "0")
    elif why == "one_entry":
        monkeypatch.delenv("MANIFEST_ONE_ENTRY_PER_OBJECT")
    elif why == "bypass":
        monkeypatch.setenv(r.BYPASS, "1")
    elif why == "status_unreadable":
        monkeypatch.setattr(lane.io, "download", lambda key: (_ for _ in ()).throw(RuntimeError("503")))
    else:
        lane.io.head = None
    manifest = lane.store.get_manifest()       # estimates + current natives only: the pre-#675 authoritative prune (which
    manifest.products = [p for p in manifest.products if p.filename != "native_old.json"]   # BLOCKED leaves running) has nothing to do
    lane.store._save_manifest(manifest)
    run = r.begin_run(lane.store, io=lane.io)
    assert run.state == r.BLOCKED and run.reasons
    before = names(lane.store)
    if why != "bypass":                      # with the bypass the prune is prune_verified_cycles' business, not ours
        prune(lane.store)
        assert names(lane.store) == before   # neither the new rule nor the old one ran: every estimate and native kept
        assert lane.deleted == [] and lane.published == []
    assert lane.io.mutations == []
    assert r.prune_mode() == "blocked" and not r.refresh_stale_allowed() and not r.tail_cadence_allowed()


def test_a_shared_filename_blocks_the_prune(lane):
    run = r.begin_run(lane.store, io=lane.io)
    assert run.state == r.SAFE
    lane.io.head.append(dict(lane.io.head[3], product_id="another-lane-key"))   # another lane's registration names EST
    prune(lane.store)
    assert run.state == r.BLOCKED and any("named by retained registrations" in x for x in run.reasons)
    # the new rule mutated nothing (no snapshot, no mark, the estimate and its object kept); the pre-#675 authoritative
    # prune of native_old is the pipeline's own behaviour and continues
    assert EST in names(lane.store) and EST not in lane.deleted and lane.io.mutations == [] and run.marks == set()
    assert lane.deleted == ["native_old.json"]


def test_a_missing_expected_slot_blocks():
    run = r.Run(lane="core", cycle_id="c", started_at=NEW, io=FakeIO(head=[]), flags=r.requested())
    r._RUN = run
    plan = r.Plan(op="fill", writes={"a.json": "x"}, expected={LANE: {"2026-11-11T15:00:00Z", "2026-11-11T18:00:00Z"}},
                  covered={LANE: {"2026-11-11T15:00:00Z"}})
    calls = []
    assert not r.execute(plan, write=lambda: calls.append("w"), publish=lambda: calls.append("p"))
    assert run.state == r.BLOCKED and "expected slot(s) missing" in run.reasons[0]
    assert calls == [] and run.io.mutations == [] and run.marks == set()


# ── the order, the snapshot, the grace ──────────────────────────────────────────────────────────────────────────────


def test_active_prune_snapshots_then_publishes_then_marks_and_never_deletes_in_run(lane):
    run = r.begin_run(lane.store, io=lane.io)
    prune(lane.store)
    assert run.state == r.SAFE, run.reasons
    assert EST not in names(lane.store) and "est_keep.json" in names(lane.store)
    assert EST not in lane.deleted and "native_old.json" in lane.deleted   # new rule: marked; old auth rule: unchanged
    kinds = [e[0] for e in run.events]
    assert kinds == ["snapshot", "snapshot", "publish", "mark"] and run.events[-1] == ("mark", EST)
    assert lane.io.objects[f"{run.prefix}/{EST}"] == lane.io.objects[EST]
    assert json.loads(lane.io.objects[f"{run.prefix}/_index.json"])["entries"][0]["before_sha256"] == r.sha256(lane.io.objects[EST])


def test_order_is_snapshot_write_publish_mark():
    io = FakeIO(objects={"w.json": b"old", "d.json": b"gone"}, head=[])
    run = r.Run(lane="core", cycle_id="c", started_at=NEW, io=io, flags=r.requested())
    r._RUN = run
    seen = []
    plan = r.Plan(op="fill", writes={"w.json": "2026-11-01T20:30:00Z"}, deletes=["d.json"])
    assert r.execute(plan, write=lambda: seen.append(("write", f"{run.prefix}/w.json" in io.objects)),
                     publish=lambda: seen.append(("publish", run.marks == set())))
    assert seen == [("write", True), ("publish", True)]
    order = [e[0] for e in run.events]
    assert order.index("write") > max(i for i, k in enumerate(order) if k == "snapshot")
    assert order.index("publish") > order.index("write") and order[-1] == "mark"


@pytest.mark.parametrize("copy_ok", [True, False])
def test_a_snapshot_that_fails_partway_mutates_nothing(copy_ok):
    io = FakeIO(objects={"a.json": b"A", "b.json": b"B"}, head=[])
    io.copy_ok = copy_ok
    run = r.Run(lane="core", cycle_id="c", started_at=NEW, io=io, flags=r.requested())
    r._RUN = run
    io.fail_keys.add(f"{run.prefix}/b.json")            # the second object's copy AND upload are refused
    calls = []
    assert not r.execute(r.Plan(op="tail", writes={"a.json": "t", "b.json": "t"}),
                         write=lambda: calls.append("w"), publish=lambda: calls.append("p"))
    assert calls == [] and run.state == r.BLOCKED and run.touched == {} and run.marks == set()
    assert io.objects["a.json"] == b"A" and io.objects["b.json"] == b"B"


def test_legacy_names_are_gc_products_and_the_scoped_gc_deletes_only_after_the_grace():
    assert is_product_object(EST) and not is_product_object(r.CANARY_FILENAME)
    live = [f"euro_marine_waves_global_coarse_202611{d:02d}T000000Z.json" for d in range(1, 21)]
    io = FakeIO(objects={**{n: b"x" for n in live}, EST: b"old", "unrelated_marine_waves_x_20261101T000000Z.json": b"u"})
    referenced = set(live)
    first = scoped_gc_sweep(io, {EST}, referenced, now=1000.0, grace_s=7200, min_manifest=1)
    second = scoped_gc_sweep(io, set(), referenced, now=1000.0 + 3600, grace_s=7200, min_manifest=1)
    assert first["deleted"] == second["deleted"] == 0 and EST in io.objects
    third = scoped_gc_sweep(io, set(), referenced | {EST}, now=1000.0 + 7300, grace_s=7200, min_manifest=1)
    assert third["deleted"] == 0 and EST in io.objects            # named again by the head: the mark is dropped
    scoped_gc_sweep(io, {EST}, referenced, now=20000.0, grace_s=7200, min_manifest=1)
    last = scoped_gc_sweep(io, set(), referenced, now=20000.0 + 7300, grace_s=7200, min_manifest=1)
    assert last["deleted"] == 1 and EST not in io.objects
    assert "unrelated_marine_waves_x_20261101T000000Z.json" in io.objects   # never one of our marks: never touched


# ── snapshot / restore ──────────────────────────────────────────────────────────────────────────────────────────────


def _written_run(tmp_path, lane_name="core"):
    """A finished SAFE run that rewrote W (same key) and marked D, with the status and final index in the bucket."""
    store = module.ProductStore(cache_dir=tmp_path)
    w_old, d_old = _prod(T0, OLD, "w.json"), _prod(T0 + timedelta(hours=3), OLD, "d.json")
    store._save_manifest(PipelineManifest(products=[w_old, d_old], last_manifest_update=OLD))
    io = FakeIO(objects={"w.json": b"w-old", "d.json": b"d-old"},
                head=[w_old.model_dump(mode="json"), d_old.model_dump(mode="json")])
    run = r.Run(lane=lane_name, cycle_id="20261101T203000Z-1", started_at=NEW, io=io, flags=r.requested())
    r._RUN = run
    w_new = _prod(T0, NEW, "w.json")

    def write():
        io.objects["w.json"] = b"w-new"

    def publish():
        io.head = [w_new.model_dump(mode="json")]
    assert r.execute(r.Plan(op="fill", writes={"w.json": r.iso(NEW)}, deletes=["d.json"],
                            before={"w.json": w_old.model_dump(mode="json"), "d.json": d_old.model_dump(mode="json")}),
                     write=write, publish=publish)
    run.touched["w.json"]["written_sha256"] = r.sha256(b"w-new")
    r.write_index(run)
    io.upload(r.STATUS_KEY, json.dumps({"lanes": {lane_name: {"cycle_id": run.cycle_id, "state": r.SAFE}}}).encode())
    r.reset()
    return store, io, run


def test_snapshot_restore_round_trip(tmp_path):
    store, io, run = _written_run(tmp_path)
    plan = restore.plan_restore(io, "core")
    assert plan["refusals"] == []
    published = []
    out = restore.apply_restore(io, store, plan, publish=lambda st, products, keys: published.append((products, keys)))
    assert out["state"] == r.RESTORED and io.objects["w.json"] == b"w-old" and io.objects["d.json"] == b"d-old"
    products, keys = published[0]
    assert sorted((p["filename"], p["run_time"][:13]) for p in products) == [("d.json", "2026-11-01T16"), ("w.json", "2026-11-01T16")]
    assert set(keys) >= {"w.json", "d.json"}
    assert json.loads(io.objects[r.STATUS_KEY])["lanes"]["core"]["state"] == r.RESTORED


@pytest.mark.parametrize("snap_lane,writer", [("core", "pilots"), ("pilots", "core")])
def test_restore_refuses_when_the_other_lane_wrote_newer_data(tmp_path, monkeypatch, snap_lane, writer):
    monkeypatch.setattr(r, "OWNER_LANE", snap_lane)       # the restore is lane-agnostic: either lane's snapshot, the other's write
    store, io, _ = _written_run(tmp_path, snap_lane)
    io.head.append(dict(_prod(T0, NEW + timedelta(hours=1), "w.json").model_dump(mode="json"), product_id=f"{writer}-key"))
    plan = restore.plan_restore(io, snap_lane)
    assert any("newer entry" in x for x in plan["refusals"])
    out = restore.apply_restore(io, store, plan, publish=lambda *a: pytest.fail("published"))
    assert out["restored"] == 0 and "Regenerate" in out["advice"] and io.objects["w.json"] == b"w-new"


@pytest.mark.parametrize("how", ["bytes", "marked_delete_rewritten", "newer_cycle"])
def test_restore_refuses_when_storage_or_the_lane_moved_on(tmp_path, how):
    store, io, _ = _written_run(tmp_path)
    if how == "bytes":
        io.objects["w.json"] = b"rewritten by another writer, same registration"
    elif how == "marked_delete_rewritten":
        io.objects["d.json"] = b"d-rewritten"
    else:
        io.objects[r.STATUS_KEY] = json.dumps({"lanes": {"core": {"cycle_id": "20261102T003000Z-2"}}}).encode()
    plan = restore.plan_restore(io, "core", "20261101T203000Z-1")
    assert plan["refusals"]
    assert restore.apply_restore(io, store, plan, publish=lambda *a: pytest.fail("published"))["restored"] == 0


# ── the reader proof ────────────────────────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def reader(tmp_path, monkeypatch):
    storage = {}
    monkeypatch.setattr(module, "_get_supabase_storage",
                        lambda: S(storage=S(from_=lambda _: S(download=lambda name: storage[name]))))
    monkeypatch.setattr(module.ProductStore, "_product_cache", {})
    monkeypatch.setattr(module.ProductStore, "_product_cache_vectors", {})
    monkeypatch.setattr(module.ProductStore, "_cached_manifest", None)
    monkeypatch.setattr(module.ProductStore, "_l2_negative_cache", {})
    store = module.ProductStore(cache_dir=tmp_path)

    def writer_publishes(revision):
        data, entry = canary_documents(revision)
        storage[r.CANARY_FILENAME] = data
        store._save_manifest(PipelineManifest(products=[entry], last_manifest_update=NEW))
    return store, writer_publishes


def _rows(probe, protocol=1):
    return [{"model": "EURO", "domain": "marine", "reader_protocol": protocol, "commit": "abc", "revision_probe": probe}]


@pytest.mark.parametrize("refresh", ["0", "1"])
def test_old_reader_keeps_the_gate_closed_and_a_refreshing_reader_opens_it(reader, monkeypatch, refresh):
    store, writer_publishes = reader
    monkeypatch.setenv("PRODUCT_REVISION_REFRESH", refresh)
    writer_publishes("2026-11-01T16:30:00Z")                   # run N-2
    assert probe_canary(store)["revision"] == "2026-11-01T16:30:00Z"
    writer_publishes("2026-11-01T20:30:00Z")                   # run N-1 rewrites the SAME key
    module.ProductStore._product_cache.clear()
    probe = probe_canary(store)
    prev = {"canary_revision": "2026-11-01T20:30:00Z", "audit_ok": True}
    gate = r.reader_gate(prev, http_get=lambda url, timeout: _rows(probe), base="http://reader")
    if refresh == "0":       # a8: download only if missing -> the disk copy is the old revision
        assert probe["revision"] == "2026-11-01T16:30:00Z" and not gate["open"] and "stale reader" in gate["reason"]
    else:
        assert probe["revision"] == "2026-11-01T20:30:00Z" and gate["open"], gate


@pytest.mark.parametrize("case", ["protocol", "timeout", "error", "probe_error", "no_audit", "no_row", "no_base"])
def test_the_reader_gate_fails_closed(case):
    prev = {"canary_revision": "R", "audit_ok": case != "no_audit"}
    good = _rows({"revision": "R"})

    def http_get(url, timeout):
        assert timeout <= 5
        if case == "timeout":
            raise TimeoutError()
        if case == "error":
            raise RuntimeError("502")
        if case == "protocol":
            return _rows({"revision": "R"}, protocol=0)
        if case == "probe_error":
            return _rows({"revision": None, "error": "canary not loaded"})
        if case == "no_row":
            return [{"model": "GFS", "domain": "marine"}]
        return good
    gate = r.reader_gate(prev, http_get=http_get, base="" if case == "no_base" else "http://reader")
    assert gate["open"] is False and gate["reason"]
    assert r.reader_gate(prev | {"audit_ok": True}, http_get=lambda u, t: good, base="http://reader")["open"]


def test_capabilities_report_the_reader_fields_without_moving_a_horizon():
    from services.weather_pipeline.capabilities import WEATHER_CAPABILITIES, get_weather_capabilities
    rows = get_weather_capabilities()
    euro = next(x for x in rows if x["model"] == "EURO" and x["domain"] == "marine")
    assert euro["reader_protocol"] == 1 and "revision_probe" in euro and "commit" in euro
    for served, static in zip(rows, WEATHER_CAPABILITIES):
        for key in ("max_forecast_hours", "native_horizon_hours", "estimated_horizon_hours"):
            assert served.get(key) == static.get(key)
    assert all("reader_protocol" not in x for x in rows if not (x["model"] == "EURO" and x["domain"] == "marine"))


# ── expected slots ──────────────────────────────────────────────────────────────────────────────────────────────────


def _source(hours):
    return [{"hourly": {"time": [(T0 + timedelta(hours=h)).isoformat() for h in hours]}}]


def test_expected_tail_slots_three_and_nine_hourly():
    times = _source(range(0, 25, 3))[0]["hourly"]["time"]
    three = r.expected_tail_slots(times, 1)
    nine = r.expected_tail_slots(times, 3)
    assert three == {r.iso(T0 + timedelta(hours=h)) for h in range(0, 25, 3)}
    assert nine == {r.iso(T0 + timedelta(hours=h)) for h in (0, 9, 18)}
    longer = r.expected_tail_slots(_source(range(0, 52, 3))[0]["hourly"]["time"], 1)
    assert len(longer) == 18                                    # from the source, not a fixed count


@pytest.mark.parametrize("gap", [False, True])
def test_promoted_tail_snapshots_its_rewrites_and_a_missing_slot_falls_back(tmp_path, gap):
    store = module.ProductStore(cache_dir=tmp_path)
    existing = _prod(T0, OLD, r.tail_filename("waves", T0))
    store._save_manifest(PipelineManifest(products=[existing], last_manifest_update=OLD))
    io = FakeIO(objects={existing.filename: b"tail-old"}, head=[existing.model_dump(mode="json")])
    run = r.Run(lane="core", cycle_id="c", started_at=NEW, io=io, flags=r.requested(), state=r.PROMOTED)
    r._RUN = run
    assert r.tail_cadence_allowed()
    hours = [h for h in range(0, 25, 3) if not (gap and h == 6)]
    step = r.tail_gate(store, "waves", _source(hours), 1, NEW)
    if gap:
        assert step == 3 and run.state == r.BLOCKED and io.mutations == []
    else:
        assert step == 1 and run.state == r.PROMOTED
        assert io.objects[f"{run.prefix}/{existing.filename}"] == b"tail-old" and len(run.touched) == 9


# ── the lane race and the read-back ─────────────────────────────────────────────────────────────────────────────────


def _canary_publisher(lane):
    def publish(store, manifest):
        lane.io.head.append(next(p for p in manifest.products if p.filename == r.CANARY_FILENAME).model_dump(mode="json"))
    return publish


def test_entries_lost_after_publish_block_the_next_run(lane, tmp_path):
    r.begin_run(lane.store, io=lane.io)

    def publish():                     # the OTHER lane's concurrent publish wins: its head lacks our entry
        lane.io.head = [x for x in lane.io.head if x["filename"] != "fill.json"]
    assert r.execute(r.Plan(op="fill", writes={"fill.json": r.iso(NEW)}, before={"fill.json": None}),
                     write=lambda: lane.io.objects.__setitem__("fill.json", b"f"), publish=publish)
    canary_publish = _canary_publisher(lane)
    status = finish_run(lane.store, now=NEW + timedelta(minutes=40), summary_path=str(tmp_path / "summary.md"),
                        publish=canary_publish, flush=lambda: True)
    assert status["entries_lost"] == ["fill.json"] and status["audit_ok"] is False
    assert "fill.json" in (tmp_path / "summary.md").read_text()
    r.reset()
    nxt = r.begin_run(lane.store, io=lane.io)
    assert nxt.state == r.BLOCKED and any("entries lost after publish" in x for x in nxt.reasons)


def test_a_clean_run_records_the_canary_and_the_next_run_promotes(lane, tmp_path):
    r.begin_run(lane.store, io=lane.io)
    prune(lane.store)
    canary_publish = _canary_publisher(lane)
    status = finish_run(lane.store, now=NEW + timedelta(minutes=50), summary_path=str(tmp_path / "s.md"),
                        publish=canary_publish, flush=lambda: True)
    assert status["state"] == r.SAFE and status["audit_ok"] and status["entries_lost"] == []
    assert status["bounds"]["mode"].startswith("observe-only (1/6") and status["bounds_breach"] == []
    rev = status["canary_revision"]
    r.reset()
    rows = _rows({"revision": rev})
    monkeypatch_env = pytest.MonkeyPatch()
    monkeypatch_env.setenv("ROLLOUT_675_READER_BASE", "http://reader")
    try:
        nxt = r.begin_run(lane.store, io=lane.io, http_get=lambda url, timeout: rows)
    finally:
        monkeypatch_env.undo()
    assert nxt.state == r.PROMOTED and r.refresh_stale_allowed() and r.tail_cadence_allowed()


def test_the_non_owning_lane_treats_owned_entries_as_read_only(lane, monkeypatch):
    monkeypatch.setenv("INGEST_PILOTS", "only")
    run = r.begin_run(lane.store, io=lane.io)
    assert run.state == r.READ_ONLY and r.prune_mode() == "legacy" and not r.refresh_stale_allowed()
    manifest = lane.store.get_manifest()
    ghost = _prod(T0 + timedelta(hours=9), OLD, "ghost_estimated.json")
    manifest.products.append(ghost)                             # the other lane pruned it; this lane still holds it
    remote = [p.model_dump(mode="json") for p in manifest.products if p.filename != "ghost_estimated.json"]
    r.defer_owned_entries(manifest, remote)
    assert "ghost_estimated.json" not in {p.filename for p in manifest.products}
    lane.store._save_manifest(manifest)
    lane.store.prune_duplicate_valid_times()
    assert EST in names(lane.store) and lane.io.mutations == []


# ── all three flags '0' ─────────────────────────────────────────────────────────────────────────────────────────────


def test_all_flags_off_is_byte_identical_and_inert(tmp_path, monkeypatch):
    for name in r.FLAGS:
        monkeypatch.setenv(name, "0")
    outputs = []
    for with_context in (False, True):
        store = module.ProductStore(cache_dir=tmp_path / str(with_context))
        products = [_prod(T0, NEW, "n.json", authoritative=True), _prod(T0, OLD, EST),
                    _prod(T0 + timedelta(hours=3), OLD, "e3.json"), _prod(T0 + timedelta(hours=3), NEW, "e3n.json")]
        store._save_manifest(PipelineManifest(products=products, last_manifest_update=NEW))
        deleted = []
        monkeypatch.setattr(store, "_delete_from_supabase", deleted.append)
        io = FakeIO()
        io.head_products = lambda: pytest.fail("I/O with every flag off")
        if with_context:
            run = r.begin_run(store, io=io)
            assert run.state == r.OFF
        prune(store)
        store.prune_duplicate_valid_times()
        dump = json.dumps([p.model_dump(mode="json") for p in store.get_manifest().products], sort_keys=True)
        outputs.append((dump, sorted(deleted), r.refresh_stale_allowed(), r.tail_cadence_allowed(), r.prune_mode()))
        if with_context:
            assert finish_run(store) is None and io.ops == []
    assert outputs[0] == outputs[1]


# ── (2) the fill refresh, end to end through fill_inband_lattice_gaps_impl ─────────────────────────────────────────


def _fill_scheduler():
    from tests.test_lattice_inband_fill import RUN as LRUN, T0 as LT0, _four, _product, _scheduler_with
    from services.weather_pipeline.store_helpers import _build_product_filename
    pa = _product(LT0, _four(1.0, 90.0, 9.0))
    pb = _product(LT0 + timedelta(hours=6), _four(2.0, 90.0, 9.0))
    stale = _product(LT0 + timedelta(hours=3), _four(9.0, 90.0, 9.0), run_time=LRUN - timedelta(hours=6), is_estimated=True)
    stale_name = _build_product_filename(stale)

    def entry(product, filename, source_dataset=None):
        fields = dict(model=product.model, domain=product.domain, layer=product.layer, region_id=product.region_id,
                      valid_time_start=product.valid_time, run_time=product.run_time, filename=filename, resolution=10.0,
                      is_estimated=product.is_estimated, is_forecast_authoritative=product.is_forecast_authoritative,
                      source_dataset=source_dataset)
        item = S(**fields)
        item.model_dump = lambda mode=None: {k: (r.iso(v) if hasattr(v, "tzinfo") else v) for k, v in fields.items()}
        return item, product
    sched = _scheduler_with({"a.json": entry(pa, "a.json"), "b.json": entry(pb, "b.json"),
                             stale_name: entry(stale, stale_name, "estimated_interpolation")})
    return sched, stale_name


@pytest.mark.asyncio
@pytest.mark.parametrize("state,snapshot_fails", [(r.PROMOTED, False), (r.PROMOTED, True), (r.SAFE, False)])
async def test_fill_refresh_runs_only_promoted_and_after_its_snapshot(monkeypatch, state, snapshot_fails):
    from services.weather_pipeline.lattice_fill import fill_inband_lattice_gaps_impl
    monkeypatch.delenv("LATTICE_INBAND_FILL", raising=False)
    sched, stale_name = _fill_scheduler()
    io = FakeIO(objects={stale_name: b"stale-fill"}, head=[])
    run = r.Run(lane="core", cycle_id="c", started_at=NEW, io=io, flags=r.requested(), state=state)
    r._RUN = run
    if snapshot_fails:
        io.fail_keys.add(f"{run.prefix}/{stale_name}")
    saved_when = []
    sched.store.save_products_batch.side_effect = lambda batch: saved_when.append(
        (len(batch), f"{run.prefix}/{stale_name}" in io.objects)) or len(batch)
    await fill_inband_lattice_gaps_impl(sched)
    if state == r.PROMOTED and not snapshot_fails:
        assert saved_when == [(1, True)] and run.state == r.PROMOTED       # the stale slot rewritten AFTER its snapshot
        assert run.touched[stale_name]["before_sha256"] == r.sha256(b"stale-fill")
    else:                                                                  # SAFE, or BLOCKED by the failed snapshot:
        assert saved_when == [] and io.objects[stale_name] == b"stale-fill"   # the legacy fill sees the slot as filled
        assert run.state == (r.BLOCKED if snapshot_fails else r.SAFE)


# ── Reflection's review (2026-11-02): an unfinished run, a torn delete, a late registration during a restore ────────────


def test_a_run_that_never_finished_blocks_the_next(lane):
    r.begin_run(lane.store, io=lane.io)                         # writes the RUNNING marker, then "crashes"
    assert json.loads(lane.io.objects[r.STATUS_KEY])["lanes"]["core"]["state"] == r.RUNNING
    r.reset()
    nxt = r.begin_run(lane.store, io=lane.io)
    assert nxt.state == r.BLOCKED and any("never finished its read-back" in x for x in nxt.reasons)


def test_a_delete_whose_bytes_are_another_run_aborts_the_prune(lane):
    lane.io.objects[EST] = json.dumps({"run_time": r.iso(NEW)}).encode()     # the key was rewritten by a newer run
    run = r.begin_run(lane.store, io=lane.io)
    prune(lane.store)
    assert run.state == r.BLOCKED and any("stored bytes are run" in x for x in run.reasons)
    assert EST in names(lane.store) and run.marks == set() and lane.published == []


def test_restore_rechecks_the_shared_head_before_republishing(tmp_path, monkeypatch):
    store, io, _ = _written_run(tmp_path)
    plan = restore.plan_restore(io, "core")
    real_copy = io.copy

    def copy_then_pilots_publishes(src, dst):
        real_copy(src, dst)
        io.head.append(dict(_prod(T0, NEW + timedelta(hours=2), "w.json").model_dump(mode="json"), product_id="pilots-key"))
    monkeypatch.setattr(io, "copy", copy_then_pilots_publishes)
    out = restore.apply_restore(io, store, plan, publish=lambda *a: pytest.fail("published over a newer registration"))
    assert out["republished"] is False and out["refused"]

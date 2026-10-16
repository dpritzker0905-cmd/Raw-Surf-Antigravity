"""The manifest's compare-and-swap is taken at PUBLISH time, so it cannot protect a MERGE taken earlier.

★ WHY THIS EXISTS (2026-10-16). Two ingest runs (core and pilots, split into separate concurrency groups on
2026-07-14 by b856b3939 because "manifest merge-on-upload made core overlap safe") advanced the SAME manifest
generation chain seconds apart (core 38903053463 and pilots 38899520579, 13:53:36-13:54:30Z). Fourteen
`euro_wind_wind_global_mid_*_estimated.json` frames the core run registered at 13:53:41Z are in Storage but not in
the manifest the backend serves, so the lane's oldest known model cycle stayed at two stale frames (27 h) and
`/api/health/data` answered 503. Every writer uploads its WHOLE snapshot, so a snapshot that missed another writer's
registration erases it.

THE SEQUENCE THE CODE ACTUALLY RUNS, per upload:
  1. reconcile_manifest_products_for_upload()  folds in the head's entries (head generation N is read here)
  2. dump_manifest_for_l2()                    serializes the snapshot
  3. the serial _manifest_executor uploads manifest.json (16 MB, 1-3 s, queued behind earlier uploads)
  4. publish_run_keyed(): `current = read_pointer()` (generation read NOW, not at step 1), uploads the run-keyed copy,
     then cas_advance(current.generation, ...)
So the CAS compares against the generation seen at step 4. If another writer published between 1 and 4, this writer's
CAS still wins and replaces the head with a snapshot that never contained the other writer's entries. The CAS only
protects the generation-copy upload inside step 4, which is why `CAS lost` was seen only occasionally.
manifest_pointer.publish_run_keyed's own comment assumes "GH's serial concurrency group makes this rare".

THE FIX (dark, MANIFEST_MERGE_AT_COMMIT=1, services/weather_pipeline/manifest_merge_commit.py): step 1 records the head
generation + a digest per entry it merged against (the BASIS), step 2 files the basis under the serialized bytes, and
step 4 re-reads the pointer; if it moved it does a 3-way merge by product id (B = basis, O = our bytes, T = the head)
and CASes from the generation it merged against, retrying (3 attempts, same basis) before falling back to the old path.
FLAG OFF the old behaviour is untouched and the defect test below is a strict xfail that documents it.

Real reconcile, serializer and publish functions; only the pointer row and the object store are in memory.
"""
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

import services.weather_pipeline.store as store_mod  # noqa: F401  (reconcile imports it lazily)
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest
from services.weather_pipeline.store import dump_manifest_for_l2, reconcile_manifest_products_for_upload

RUN_TIME = datetime(2026, 10, 16, 13, 53, tzinfo=timezone.utc)
VALID = datetime(2026, 10, 25, 3, tzinfo=timezone.utc)      # in the future: nothing here is past retention
FLAG = "MANIFEST_MERGE_AT_COMMIT"


def _files(data):
    return sorted(p["filename"] for p in json.loads(data)["products"])


class Chain:
    """The pointer row and the immutable run-keyed objects, in memory. `cas_advance` is Postgres'
    `UPDATE ... WHERE generation = expected`: it succeeds only if the row still says `expected`."""

    def __init__(self, base_files):
        self.generation = 5
        self.objects = {}
        self.head_key = mp.run_keyed_manifest_key(5)
        self.objects[self.head_key] = dump_manifest_for_l2(_manifest(base_files))
        self.cas_failures = 0
        self.before_cas = None            # a hook that runs between a writer's pointer read and its CAS
        self.during_upload = None         # single-shot: another writer lands while OUR run-keyed copy is uploading
        self.cas_calls = []               # per CAS: expected generation, won, and the candidate's files AT CAS TIME
        self.puts = []                    # every key written through `upload` (the run-keyed copy, re-PUTs)
        self.nested_publishes = []        # what publish_run_keyed returned when a manifest.json PUT re-entered it
        self.pointer_reads = 0
        self.object_reads = []            # keys fetched by key (the merge lane's per-generation GET)
        self.fail_manifest_json_put = False
        self._foreign = 0

    def read_pointer(self):
        self.pointer_reads += 1
        return {"generation": self.generation, "manifest_key": self.head_key}

    def cas_advance(self, expected_generation, manifest_key, run_id, written_by):
        if self.before_cas:
            hook, self.before_cas = self.before_cas, None
            hook()
        won = expected_generation == self.generation
        self.cas_calls.append({"expected": expected_generation, "won": won, "key": manifest_key,
                               "files": _files(self.objects[manifest_key])})
        if not won:
            self.cas_failures += 1
            return False
        self.generation += 1
        self.head_key = manifest_key
        return True

    def fetch_pointed_manifest(self):
        return self.objects[self.head_key]

    def fetch_manifest_object(self, key):
        self.object_reads.append(key)
        return self.objects.get(key)

    def upload(self, key, data):
        """`store._upload_to_supabase`: the production `upload_fn`. A successful manifest.json PUT runs
        publish_run_keyed again, exactly as the real method does."""
        if key.startswith("manifests/") and self.during_upload:
            hook, self.during_upload = self.during_upload, None
            hook()
        self.puts.append(key)
        if key == "manifest.json" and self.fail_manifest_json_put:
            raise RuntimeError("HTTP 503: SlowDown")
        self.objects[key] = data
        if key == "manifest.json":
            self.nested_publishes.append(mp.publish_run_keyed(None, data, self.upload, self.delete))

    def delete(self, key):
        self.objects.pop(key, None)

    def head_files(self):
        return _files(self.objects[self.head_key])

    def head_entry(self, filename):
        return next(p for p in json.loads(self.objects[self.head_key])["products"] if p["filename"] == filename)

    def foreign_publish(self, *edits):
        """ANOTHER writer's commit, bypassing our code: the head's products edited, one generation on, under a
        key of its own (so it cannot collide with the run-keyed key we are about to upload)."""
        doc = json.loads(self.objects[self.head_key])
        for edit in edits:
            doc["products"] = edit(doc["products"])
        doc["written_by"] = "designated:gh-run-other"
        self._foreign += 1
        self.generation += 1
        self.head_key = "manifests/manifest-g%012d-other%d.json" % (self.generation, self._foreign)
        self.objects[self.head_key] = json.dumps(doc, indent=2).encode("utf-8")


def _product(filename, estimated=False, **over):
    fields = dict(
        model="EURO", provider="estimated" if estimated else "ecmwf", domain="wind", layer="wind",
        run_time=RUN_TIME, valid_time_start=VALID, valid_time_end=VALID, resolution=0.25, freshness_sec=3600,
        is_forecast_authoritative=not estimated, coverage=CoverageBounds(west=-180, south=-80, east=180, north=84),
        filename=filename, product_id=filename, region_id="global_mid", is_estimated=estimated,
    )
    fields.update(over)
    return ManifestProduct(**fields)


def _manifest(files):
    """`files` items are a filename, or (filename, field overrides) for an entry this writer changed."""
    products = []
    for item in files:
        name, over = (item, {}) if isinstance(item, str) else item
        products.append(_product(name, estimated=name.endswith("_estimated.json"), **over))
    return PipelineManifest(last_manifest_update=RUN_TIME, products=products)


def _raw(filename, **over):
    return json.loads(_product(filename, estimated=filename.endswith("_estimated.json"), **over).model_dump_json())


def adding(*names):
    return lambda products: products + [_raw(n) for n in names]


def removing(*names):
    return lambda products: [p for p in products if p["filename"] not in names]


def changing(name, **over):
    return lambda products: [dict(p, **over) if p["filename"] == name else p for p in products]


BASE = ["euro_wind_wind_global_mid_20261024T000000Z.json", "euro_wind_wind_global_mid_20261024T060000Z.json"]
PILOTS_NEW = ["euro_wind_wind_global_mid_20261025T060000Z.json"]
LATTICE = [f"euro_wind_wind_global_mid_202610{d}T{h}0000Z_estimated.json"
           for d in (22, 23, 24) for h in ("03", "09", "15", "21")] + [
    "euro_wind_wind_global_mid_20261025T150000Z_estimated.json",
    "euro_wind_wind_global_mid_20261025T210000Z_estimated.json"]          # the 14 the core run's fill registered


@pytest.fixture
def chain(monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    monkeypatch.delenv("MANIFEST_IMMUTABLE_PUBLICATION", raising=False)
    c = Chain(BASE)
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    monkeypatch.setattr(mp, "pointer_enabled", lambda: True)
    monkeypatch.setattr(mp, "read_pointer", c.read_pointer)
    monkeypatch.setattr(mp, "cas_advance", c.cas_advance)
    monkeypatch.setattr(mp, "fetch_pointed_manifest", c.fetch_pointed_manifest)
    monkeypatch.setattr(mp, "fetch_manifest_object", c.fetch_manifest_object)
    return c


@pytest.fixture
def merge_on(chain, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    return chain


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Everything here is in memory. A code path that reached for Supabase would fail loudly, not call it."""
    import requests

    def refuse(*args, **kwargs):
        raise AssertionError("this test must not make an HTTP request")
    monkeypatch.setattr(requests.sessions.Session, "request", refuse)


@pytest.fixture(autouse=True)
def _no_merge_state_leaks_between_tests():
    """The basis registry is process state (like the manifest cache); a test must not inherit another's."""
    from services.weather_pipeline import manifest_merge_commit as mmc
    mmc._bases.clear()
    mmc._local.__dict__.clear()
    yield
    mmc._bases.clear()
    mmc._local.__dict__.clear()


def prepare(own_files, exclude_keys=None):
    """Steps 1-2 of an upload: this writer's snapshot, merged against the head AS IT IS NOW, serialized."""
    manifest = _manifest(own_files)
    reconcile_manifest_products_for_upload(manifest, exclude_keys=exclude_keys)
    return dump_manifest_for_l2(manifest)


def publish(chain, data):
    """Step 4 of an upload (what _upload_to_supabase calls after the manifest.json PUT)."""
    chain.objects["manifest.json"] = data                # the legacy PUT, already done by the time we get here
    return mp.publish_run_keyed(None, data, chain.upload, chain.delete)


def test_writers_that_do_not_overlap_keep_each_others_registrations(chain):
    """NULL CONTROL: if the second writer merges after the first has published, the union survives."""
    assert publish(chain, prepare(BASE + LATTICE))
    assert publish(chain, prepare(BASE + PILOTS_NEW))
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_a_head_that_moves_during_the_publish_is_detected(chain):
    """HARNESS CONTROL: the CAS does catch a publish that lands between the pointer read and the swap (the
    generation-copy upload window). The loser's snapshot is left unreferenced and the head keeps the winner's."""
    pilots = prepare(BASE + PILOTS_NEW)
    chain.before_cas = lambda: publish(chain, prepare(BASE + LATTICE))      # core publishes mid-way
    assert publish(chain, pilots) is None
    assert chain.cas_failures == 1
    assert chain.head_files() == sorted(BASE + LATTICE)


@pytest.mark.xfail(strict=True, reason="THE UNFIXED DEFAULT (MANIFEST_MERGE_AT_COMMIT off): the CAS is taken from a "
                                       "pointer read made at publish time, after the merge it is meant to protect")
def test_a_snapshot_merged_before_another_writers_publish_does_not_erase_it(chain):
    """THE DEFECT. Pilots merges against generation 5 and serializes. Before its (queued, 1-3 s) upload reaches
    publish_run_keyed, core registers 14 estimated frames and publishes generation 6. Pilots' publish then reads the
    pointer (now 6), swaps 6 -> 7 successfully, and the head no longer contains core's 14 frames. Nothing re-adds
    them: pilots' next merge reads a head that lacks them.
    """
    pilots = prepare(BASE + PILOTS_NEW)                          # steps 1-2 against generation 5
    assert publish(chain, prepare(BASE + LATTICE))               # core publishes generation 6
    assert chain.generation == 6
    publish(chain, pilots)                                       # step 4: pointer read NOW = 6, CAS 6 -> 7 wins
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW), (
        "the published head lost %d of core's 14 registered frames: %s"
        % (len(set(LATTICE) - set(chain.head_files())), sorted(set(LATTICE) - set(chain.head_files()))[:3]))


# ── FLAG OFF: the unfixed default is byte-identical to the code before the lane existed ─────────────────────────

def test_flag_off_adds_no_reads_and_no_writes(chain):
    """With the flag off the upload makes exactly the calls it always made: reconcile reads the head through
    fetch_pointed_manifest, publish reads the pointer ONCE, uploads ONE run-keyed copy and CASes from that read.
    No per-generation GET, no second pointer read, no manifest.json re-PUT."""
    data = prepare(BASE + PILOTS_NEW)
    key = publish(chain, data)
    assert key == mp.run_keyed_manifest_key(6)
    assert chain.objects[key] == data
    assert chain.object_reads == []
    assert chain.pointer_reads == 1
    assert chain.puts == [key]
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, True)]


def test_flag_off_and_flag_on_serialize_identical_bytes(chain, monkeypatch):
    """dump_manifest_for_l2 files a basis under the bytes it returns; it must never change the bytes."""
    off = dump_manifest_for_l2(_manifest(BASE + PILOTS_NEW))
    monkeypatch.setenv(FLAG, "1")
    on = dump_manifest_for_l2(_manifest(BASE + PILOTS_NEW))
    assert on == off


def test_the_flag_is_registered_dark_in_the_admin_flag_table():
    source = (Path(__file__).resolve().parent.parent / "routes" / "admin" / "surf_forecast.py").read_text(encoding="utf-8")
    assert re.search(r'"MANIFEST_MERGE_AT_COMMIT":\s*\("0",', source), "register it in _RATING_FLAGS, default \"0\""


# ── FLAG ON: the commit merges against the head it is about to replace ───────────────────────────────────────────

def test_merge_at_commit_keeps_both_writers_registrations(merge_on):
    """(a) THE DEFECT SCENARIO, unchanged, with the flag on."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    assert publish(chain, prepare(BASE + LATTICE))
    assert chain.generation == 6
    assert publish(chain, pilots)
    assert chain.generation == 7
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW), (
        "the published head lost %d of core's 14 registered frames" % len(set(LATTICE) - set(chain.head_files())))


def test_merge_at_commit_with_no_concurrent_writer_publishes_exactly_our_bytes(merge_on):
    """(b) NULL CONTROL, and the first half of (f): nothing moved, so our bytes go out unchanged, ONE generation
    advance, CAS from the generation the snapshot was merged against, no legacy re-PUT, no merge."""
    chain = merge_on
    data = prepare(BASE + PILOTS_NEW)
    key = publish(chain, data)
    assert key == mp.run_keyed_manifest_key(6)
    assert chain.objects[key] == data
    assert chain.generation == 6
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, True)]
    assert chain.puts == [key]


def test_merge_at_commit_costs_one_get_at_reconcile_and_none_at_commit_when_nothing_moved(merge_on):
    """The lane's price when it has nothing to do: the basis is read from the generation reconcile resolved (one
    GET of that run-keyed object, which also feeds the fold) and the commit reads only the pointer row."""
    chain = merge_on
    data = prepare(BASE + PILOTS_NEW)
    assert chain.object_reads == [mp.run_keyed_manifest_key(5)]
    assert publish(chain, data)
    assert chain.object_reads == [mp.run_keyed_manifest_key(5)]
    assert chain.pointer_reads == 2                                  # reconcile's, then the commit's


def test_merge_at_commit_does_not_resurrect_an_entry_the_other_writer_pruned(merge_on):
    """(c) Pilots merged while BASE[0] was registered and did not touch it. Core prunes it and publishes. A union
    would put it back; the 3-way merge sees pilots left it as it was and core removed it, so it stays removed."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(removing(BASE[0]))
    assert publish(chain, pilots)
    assert BASE[0] not in chain.head_files(), "a pruned entry came back"
    assert chain.head_files() == sorted(BASE[1:] + PILOTS_NEW)


def test_merge_at_commit_does_not_resurrect_an_entry_we_pruned(merge_on):
    """(d) Pilots pruned BASE[0] (exclude_keys) while core, concurrently, registered the lattice. The head core
    published still carries BASE[0]; copying 'whatever the head has' would resurrect an entry whose object we
    just deleted (the dangling-entry 404 class)."""
    chain = merge_on
    pilots = prepare(BASE[1:] + PILOTS_NEW, exclude_keys=[BASE[0]])
    chain.foreign_publish(adding(*LATTICE))
    assert publish(chain, pilots)
    files = chain.head_files()
    assert set(LATTICE) <= set(files), "core's registrations were lost"
    assert BASE[0] not in files, "an entry we pruned came back from the head"
    assert files == sorted(BASE[1:] + LATTICE + PILOTS_NEW)


def test_merge_at_commit_an_entry_both_sides_changed_takes_ours(merge_on):
    """(e) Both writers changed BASE[1] since the basis: ours wins (the documented rule), and core's other
    registrations still arrive."""
    chain = merge_on
    pilots = prepare([BASE[0], (BASE[1], {"freshness_sec": 111})] + PILOTS_NEW)
    chain.foreign_publish(changing(BASE[1], freshness_sec=222), adding(*LATTICE))
    assert publish(chain, pilots)
    assert chain.head_entry(BASE[1])["freshness_sec"] == 111
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_merge_at_commit_an_entry_only_the_other_writer_changed_takes_theirs(merge_on):
    """(e2) Pilots carried BASE[0] unchanged; core updated it. Overwriting core's update with pilots' stale copy
    is the 'our copy wins even if theirs is newer' risk reconcile documents; the 3-way merge removes it."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(changing(BASE[0], freshness_sec=333))
    assert publish(chain, pilots)
    assert chain.head_entry(BASE[0])["freshness_sec"] == 333
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)


def test_merge_at_commit_a_head_that_moves_during_our_upload_is_merged_not_overwritten(merge_on):
    """(f) Core lands while our run-keyed copy is uploading (the 1-3 s window). The CAS is taken from the
    generation the bytes were merged against (5), so it LOSES; the retry reads the new head (6), merges against
    it with the same basis and CASes from 6. A CAS taken from a fresh read just before the swap would win with
    bytes that never saw core's registrations."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.during_upload = lambda: chain.foreign_publish(adding(*LATTICE))
    assert publish(chain, pilots)
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(5, False), (6, True)]
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_merge_at_commit_the_cas_candidate_already_carries_the_heads_registrations(merge_on):
    """(f) At the moment of the swap the candidate must hold everything the head held: that is the whole contract
    of a CAS that was preceded by a merge."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    assert publish(chain, pilots)
    first = chain.cas_calls[0]
    assert first["expected"] == 6
    assert set(LATTICE) <= set(first["files"]), "the swap was taken with a candidate that lacks the head's frames"


def test_merge_at_commit_a_head_that_moves_again_is_merged_again_against_the_same_basis(merge_on):
    """(g) The head moves once before we publish and AGAIN inside our first CAS: attempt two merges against the
    newer head. Our diff against the basis does not change, so core's earlier AND later frames both arrive."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE[:7]))
    chain.before_cas = lambda: chain.foreign_publish(adding(*LATTICE[7:]))
    assert publish(chain, pilots)
    assert [(c["expected"], c["won"]) for c in chain.cas_calls] == [(6, False), (7, True)]
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_merge_at_commit_gives_up_after_three_attempts_then_takes_the_old_path(merge_on, caplog):
    """(g) A head that never stops moving: three merge attempts, then today's path (a fresh pointer read, one
    CAS). Never an unbounded loop, never an exception."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    moves = []

    def keep_moving():
        if len(moves) < 6:
            moves.append(1)
            chain.before_cas = keep_moving
            chain.foreign_publish(adding("euro_wind_wind_global_mid_20261026T%02d0000Z.json" % len(moves)))

    chain.before_cas = keep_moving
    with caplog.at_level(logging.WARNING):
        publish(chain, pilots)                                   # must not raise, whatever it returns
    assert [c["expected"] for c in chain.cas_calls] == [6, 7, 8, 9], "3 merge attempts, then the old path's one CAS"
    assert "falling back" in caplog.text


def test_merge_at_commit_without_a_basis_publishes_exactly_as_before(merge_on, caplog):
    """(h) Bytes nobody reconciled (the cleaned-manifest resave, the fixture purge) carry no basis: the old path
    runs unchanged and says so."""
    chain = merge_on
    bare = dump_manifest_for_l2(_manifest(BASE + PILOTS_NEW))          # no reconcile, so no basis
    chain.foreign_publish(adding(*LATTICE))
    with caplog.at_level(logging.WARNING):
        assert publish(chain, bare) == mp.run_keyed_manifest_key(7)
    assert "no merge basis" in caplog.text and "falling back" in caplog.text
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)             # today's behaviour, exactly
    assert [c["expected"] for c in chain.cas_calls] == [6]
    assert chain.object_reads == []


@pytest.mark.parametrize("failure", ["no_pointer", "no_object", "object_raises", "unparseable"])
def test_merge_at_commit_a_basis_that_cannot_be_captured_leaves_the_old_path(merge_on, monkeypatch, caplog, failure):
    """(h) The pointer or the head object is unavailable at reconcile: no basis, today's behaviour, no raise."""
    chain = merge_on
    with monkeypatch.context() as broken:
        if failure == "no_pointer":
            broken.setattr(mp, "read_pointer", lambda: None)
        elif failure == "no_object":
            broken.setattr(mp, "fetch_manifest_object", lambda key: None)
        elif failure == "object_raises":
            broken.setattr(mp, "fetch_manifest_object", lambda key: (_ for _ in ()).throw(RuntimeError("HTTP 500")))
        else:
            broken.setattr(mp, "fetch_manifest_object", lambda key: b"{not json")
        pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    with caplog.at_level(logging.WARNING):
        assert publish(chain, pilots) == mp.run_keyed_manifest_key(7)
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert "falling back" in caplog.text


@pytest.mark.parametrize("failure", ["raises", "garbage", "no_products", "no_ids"])
def test_merge_at_commit_a_failure_while_merging_falls_back_and_never_raises(merge_on, monkeypatch, caplog, failure):
    """(h) The head moved and the merge cannot be done (GET raises, bytes are not a manifest, an entry has no id
    to merge by): the old path publishes our snapshot, a warning says why, and nothing propagates."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    if failure == "raises":
        monkeypatch.setattr(mp, "fetch_manifest_object", lambda key: (_ for _ in ()).throw(RuntimeError("HTTP 500")))
    elif failure == "garbage":
        monkeypatch.setattr(mp, "fetch_manifest_object", lambda key: b"<html>502</html>")
    elif failure == "no_products":
        monkeypatch.setattr(mp, "fetch_manifest_object", lambda key: b'{"last_manifest_update": "x"}')
    else:
        monkeypatch.setattr(mp, "fetch_manifest_object", lambda key: json.dumps(
            {"products": [{"model": "EURO"}]}).encode("utf-8"))
    with caplog.at_level(logging.WARNING):
        assert publish(chain, pilots) == mp.run_keyed_manifest_key(7)
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)
    assert "falling back" in caplog.text


def test_merge_at_commit_a_second_dump_without_its_own_reconcile_inherits_no_basis(merge_on, caplog):
    """(h) A basis describes the products reconcile merged. If the snapshot is changed and dumped again without
    a new reconcile (store.get_manifest's cleaned resave), the old basis must not be filed under the new bytes:
    entries added since would read as 'removed by us' and be dropped from the merge."""
    chain = merge_on
    manifest = _manifest(BASE + PILOTS_NEW)
    reconcile_manifest_products_for_upload(manifest)
    dump_manifest_for_l2(manifest)                                       # consumes the basis
    manifest.products = manifest.products[:-1]
    stale = dump_manifest_for_l2(manifest)                               # different bytes, no reconcile
    chain.foreign_publish(adding(*LATTICE))
    with caplog.at_level(logging.WARNING):
        assert publish(chain, stale)
    assert "no merge basis" in caplog.text
    assert chain.object_reads == [mp.run_keyed_manifest_key(5)]          # reconcile's GET only; none at commit


def test_merge_at_commit_re_puts_the_legacy_manifest_json_once_when_the_merge_changed_it(merge_on):
    """(i) manifest.json was PUT with our stale bytes before publish ran. Once the merged head differs from them
    the legacy file gets the merged bytes (best-effort, once), and that PUT's own publish_run_keyed does not
    advance the pointer a second time."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    key = publish(chain, pilots)
    assert key == mp.run_keyed_manifest_key(7)
    merged = chain.objects[key]
    assert merged != pilots
    assert chain.puts == [key, "manifest.json"]
    assert chain.objects["manifest.json"] == merged
    assert len(chain.cas_calls) == 1 and chain.generation == 7, "the re-PUT published a generation of its own"
    assert chain.nested_publishes == [None]


def test_merge_at_commit_does_not_re_put_when_the_merge_changed_nothing(merge_on):
    """(i) The head moved but carries nothing we lack: our bytes are published as they are and the legacy file,
    which already holds them, is not written again."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish()                                              # a generation bump, same products
    key = publish(chain, pilots)
    assert key == mp.run_keyed_manifest_key(7)
    assert chain.objects[key] == pilots
    assert chain.puts == [key]
    assert chain.nested_publishes == []


def test_merge_at_commit_a_failing_legacy_re_put_never_raises(merge_on):
    """(i) The legacy file is best-effort: a failed re-PUT leaves the pointer lane's merged head in place."""
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    chain.foreign_publish(adding(*LATTICE))
    chain.fail_manifest_json_put = True
    assert publish(chain, pilots) == mp.run_keyed_manifest_key(7)
    assert chain.head_files() == sorted(BASE + LATTICE + PILOTS_NEW)


def test_merge_at_commit_stands_aside_for_the_immutable_publication_lane(chain, monkeypatch):
    """manifest_immutable.publish_immutable does not merge and owns the commit when it is on: the merge lane
    must not even spend a GET capturing a basis it can never use."""
    monkeypatch.setenv(FLAG, "1")
    monkeypatch.setenv("MANIFEST_IMMUTABLE_PUBLICATION", "1")
    prepare(BASE + PILOTS_NEW)
    assert chain.object_reads == []


def test_merge_basis_registry_remembers_eight_snapshots_and_forgets_the_oldest(merge_on, caplog):
    """The registry is process memory (one basis is a digest per product, ~16k of them): it is bounded. The
    serial manifest executor never has more than a handful of snapshots queued, so the OLDEST falls out first and
    an evicted snapshot is published by the old path, with a warning, not guessed at."""
    chain = merge_on
    snapshots = [prepare(BASE + ["euro_wind_wind_global_mid_20261026T%02d0000Z.json" % i]) for i in range(9)]
    chain.foreign_publish(adding(*LATTICE))
    with caplog.at_level(logging.WARNING):
        assert publish(chain, snapshots[-1])                              # the newest: merged
    assert set(LATTICE) <= set(chain.head_files())
    assert "no merge basis" not in caplog.text
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        assert publish(chain, snapshots[0])                               # the oldest: evicted, old path
    assert "no merge basis" in caplog.text


def test_merge_at_commit_a_repeated_product_id_cannot_be_merged_and_falls_back(merge_on, caplog):
    """A manifest that lists one id twice has no single entry to merge by: collapsing it silently would drop one
    of the two. The old path publishes it as it always did, and says why."""
    chain = merge_on
    manifest = _manifest(BASE + PILOTS_NEW + [BASE[0]])
    reconcile_manifest_products_for_upload(manifest)
    twice = dump_manifest_for_l2(manifest)
    chain.foreign_publish(adding(*LATTICE))
    with caplog.at_level(logging.WARNING):
        assert publish(chain, twice) == mp.run_keyed_manifest_key(7)
    assert "twice" in caplog.text and "falling back" in caplog.text
    assert chain.objects[mp.run_keyed_manifest_key(7)] == twice


def test_merge_at_commit_a_head_that_repeats_an_id_gives_no_basis(merge_on, caplog):
    chain = merge_on
    chain.foreign_publish(adding(BASE[0]))                              # the head now lists BASE[0] twice
    with caplog.at_level(logging.WARNING):
        pilots = prepare(BASE + PILOTS_NEW)
        assert publish(chain, pilots)
    assert "twice" in caplog.text and "no merge basis" in caplog.text


@pytest.mark.parametrize("moved,retired", [(False, 1), (True, 2)])
def test_merge_at_commit_retires_the_run_keyed_copy_that_fell_out_of_the_ring(merge_on, moved, retired):
    """After a WON CAS to generation N the copy KEEP_RUN_KEYED generations back is deleted, as the old path does."""
    chain = merge_on
    stale = mp.run_keyed_manifest_key(retired)
    chain.objects[stale] = b"an old generation"
    pilots = prepare(BASE + PILOTS_NEW)
    if moved:
        chain.foreign_publish(adding(*LATTICE))
    assert publish(chain, pilots)
    assert stale not in chain.objects
    assert chain.head_key in chain.objects


def test_merge_at_commit_a_pointer_row_that_vanished_at_commit_falls_back_and_never_raises(merge_on, monkeypatch, caplog):
    chain = merge_on
    pilots = prepare(BASE + PILOTS_NEW)
    monkeypatch.setattr(mp, "read_pointer", lambda: None)
    monkeypatch.setattr(mp, "_insert_initial", lambda *a, **k: False)    # the old path's initial insert: not for real
    with caplog.at_level(logging.WARNING):
        assert publish(chain, pilots) is None
    assert "pointer row is unavailable" in caplog.text and "falling back" in caplog.text
    assert chain.cas_calls == []

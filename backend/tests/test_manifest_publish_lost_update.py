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

Real reconcile, serializer and publish functions; only the pointer row and the object store are in memory.
"""
import json
from datetime import datetime, timezone

import pytest

import services.weather_pipeline.store as store_mod  # noqa: F401  (reconcile imports it lazily)
from services.weather_pipeline import manifest_pointer as mp
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest
from services.weather_pipeline.store import dump_manifest_for_l2, reconcile_manifest_products_for_upload

RUN_TIME = datetime(2026, 10, 16, 13, 53, tzinfo=timezone.utc)
VALID = datetime(2026, 10, 25, 3, tzinfo=timezone.utc)      # in the future: nothing here is past retention


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

    def read_pointer(self):
        return {"generation": self.generation, "manifest_key": self.head_key}

    def cas_advance(self, expected_generation, manifest_key, run_id, written_by):
        if self.before_cas:
            hook, self.before_cas = self.before_cas, None
            hook()
        if expected_generation != self.generation:
            self.cas_failures += 1
            return False
        self.generation += 1
        self.head_key = manifest_key
        return True

    def fetch_pointed_manifest(self):
        return self.objects[self.head_key]

    def upload(self, key, data):
        self.objects[key] = data

    def delete(self, key):
        self.objects.pop(key, None)

    def head_files(self):
        return sorted(p["filename"] for p in json.loads(self.objects[self.head_key])["products"])


def _product(filename, estimated=False):
    return ManifestProduct(
        model="EURO", provider="estimated" if estimated else "ecmwf", domain="wind", layer="wind",
        run_time=RUN_TIME, valid_time_start=VALID, valid_time_end=VALID, resolution=0.25, freshness_sec=3600,
        is_forecast_authoritative=not estimated, coverage=CoverageBounds(west=-180, south=-80, east=180, north=84),
        filename=filename, product_id=filename, region_id="global_mid", is_estimated=estimated,
    )


def _manifest(files):
    return PipelineManifest(last_manifest_update=RUN_TIME,
                            products=[_product(f, estimated=f.endswith("_estimated.json")) for f in files])


BASE = ["euro_wind_wind_global_mid_20261024T000000Z.json", "euro_wind_wind_global_mid_20261024T060000Z.json"]
PILOTS_NEW = ["euro_wind_wind_global_mid_20261025T060000Z.json"]
LATTICE = [f"euro_wind_wind_global_mid_202610{d}T{h}0000Z_estimated.json"
           for d in (22, 23, 24) for h in ("03", "09", "15", "21")] + [
    "euro_wind_wind_global_mid_20261025T150000Z_estimated.json",
    "euro_wind_wind_global_mid_20261025T210000Z_estimated.json"]          # the 14 the core run's fill registered


@pytest.fixture
def chain(monkeypatch):
    c = Chain(BASE)
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "36500")
    monkeypatch.delenv("MANIFEST_IMMUTABLE_PUBLICATION", raising=False)
    monkeypatch.setattr(mp, "pointer_enabled", lambda: True)
    monkeypatch.setattr(mp, "read_pointer", c.read_pointer)
    monkeypatch.setattr(mp, "cas_advance", c.cas_advance)
    monkeypatch.setattr(mp, "fetch_pointed_manifest", c.fetch_pointed_manifest)
    return c


def prepare(own_files):
    """Steps 1-2 of an upload: this writer's snapshot, merged against the head AS IT IS NOW, serialized."""
    manifest = _manifest(own_files)
    reconcile_manifest_products_for_upload(manifest)
    return dump_manifest_for_l2(manifest)


def publish(chain, data):
    """Step 4 of an upload (what _upload_to_supabase calls after the manifest.json PUT)."""
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

"""MANIFEST_PUBLISH_ONE_STEP: the coalescing slot, the executor's exit, the backoff, and the cost of one publish."""
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


def test_five_submits_while_a_job_runs_publish_at_most_twice_and_apply_every_exclusion(chain, store, inline):
    """The running job publishes snapshot 1; submits 2-5 arrive during its upload; ONE more publish carries the newest
    snapshot and the UNION of all five exclusions. The head is read once per job, not once per submit."""
    chain.foreign_publish(adding(*PRUNED))                                      # the head holds what each save prunes

    def the_rest():
        for i in range(1, 5):
            submit(store, BASE + SAVES[:i + 1], exclude_keys=[PRUNED[i]])
    chain.during_upload = the_rest
    submit(store, BASE + SAVES[:1], exclude_keys=[PRUNED[0]])
    assert len(inline.log) == 1, "one job on the executor, however many submits arrive while it runs"
    assert len(chain.wins()) == 2
    assert chain.head_files() == sorted(BASE + SAVES), "the LAST snapshot must be what the head ends up holding"
    assert len(chain.kinds("fetch")) == 2 and len(chain.kinds("read_pointer")) == 2


def test_submits_before_the_job_runs_are_one_job_one_publish(chain, store, parked):
    for i in range(5):
        submit(store, BASE + SAVES[:i + 1])
    assert len(parked.queue) == 1
    parked.run()
    assert len(chain.wins()) == 1 and chain.head_files() == sorted(BASE + SAVES)
    assert len(chain.kinds("fetch")) == 1


def test_a_save_that_arrives_during_the_legacy_put_is_published_by_the_same_job(chain, store, inline):
    """After the pointer win the job PUTs the legacy manifest.json; a save that lands right then is neither lost nor
    treated as published."""
    chain.during_legacy_put = lambda: submit(store, BASE + PILOTS_NEW + SAVES[:1])
    submit(store, BASE + PILOTS_NEW)
    assert len(inline.log) == 1
    assert len(chain.wins()) == 2
    assert chain.head_files() == sorted(BASE + PILOTS_NEW + SAVES[:1])


def test_coalescing_with_a_real_executor_thread(chain, store, monkeypatch):
    chain.foreign_publish(adding(*PRUNED))
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="test_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    entered, release = threading.Event(), threading.Event()

    def block():
        entered.set()
        assert release.wait(20)
    chain.during_upload = block
    submit(store, BASE + SAVES[:1], exclude_keys=[PRUNED[0]])
    assert entered.wait(20), "the first job never reached its upload"
    for i in range(1, 5):
        submit(store, BASE + SAVES[:i + 1], exclude_keys=[PRUNED[i]])
    release.set()
    executor.shutdown(wait=True)
    assert len(chain.wins()) == 2
    assert chain.head_files() == sorted(BASE + SAVES)
    assert len(chain.kinds("fetch")) == 2


def test_a_stream_of_submits_racing_the_running_job_never_loses_the_last_one_and_never_overlaps_jobs(
        chain, store, monkeypatch):
    """The caller keeps saving while the job reads, merges and publishes (the pointer read is slowed so the interleavings
    are real). Whatever the interleaving: never two jobs at once, never more publishes than submits, and the head ends up
    holding the LAST snapshot."""
    import time
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="test_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    active, overlaps = [], []
    real_read = chain.read_pointer

    def slow_read():
        active.append(1)
        if len(active) > 1:
            overlaps.append(1)
        time.sleep(0.002)
        try:
            return real_read()
        finally:
            active.pop()
    monkeypatch.setattr(mp, "read_pointer", slow_read)
    names = ["euro_wind_wind_global_mid_2027%04dT000000Z.json" % i for i in range(200)]
    for i in range(200):
        submit(store, BASE + names[:i + 1])
        if i % 7 == 0:
            time.sleep(0.003)
    executor.shutdown(wait=True)
    assert overlaps == []
    assert 1 <= len(chain.wins()) <= 200
    assert chain.head_files() == sorted(BASE + names), "the last submit was not published"


def test_executor_shutdown_at_exit_runs_the_job_that_has_not_started(chain, store, monkeypatch):
    """The interpreter's exit joins the executor. A snapshot whose job is still queued behind earlier uploads must be
    published by that join, not dropped."""
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="test_manifest")
    monkeypatch.setattr(store_mod, "_manifest_executor", executor)
    busy = threading.Event()
    executor.submit(busy.wait, 20)                                              # an earlier upload holds the one worker
    submit(store, BASE + PILOTS_NEW)
    assert chain.events == [], "the caller's thread must do no I/O"
    busy.set()
    executor.shutdown(wait=True)
    assert chain.head_files() == sorted(BASE + PILOTS_NEW)


def test_a_failed_executor_submit_does_not_wedge_the_slot(chain, store, monkeypatch):
    dead = ThreadPoolExecutor(max_workers=1)
    dead.shutdown()
    monkeypatch.setattr(store_mod, "_manifest_executor", dead)
    with pytest.raises(RuntimeError):
        submit(store, BASE + PILOTS_NEW)
    live = InlineExecutor()
    monkeypatch.setattr(store_mod, "_manifest_executor", live)
    submit(store, BASE[1:] + PILOTS_NEW + SAVES[:1], exclude_keys=[BASE[0]])
    assert chain.head_files() == sorted(BASE[1:] + PILOTS_NEW + SAVES[:1])


def test_the_backoff_is_jittered_exponential_and_bounded():
    waits = {n: [mps.backoff_seconds(n) for _ in range(300)] for n in (1, 2, 3, 4)}
    assert len(set(waits[1])) > 1, "no jitter"
    assert all(0 < w <= 3 for ws in waits.values() for w in ws)
    assert max(waits[4]) > max(waits[1]) * 2, "no growth"


def test_cost_of_publishing_a_16k_entry_manifest_in_one_step(chain, store, inline, capsys):
    """A production-sized head (about 16 MB of JSON). Counted exactly: one pointer read, one head GET, one unique upload,
    one CAS, one legacy PUT. CPU and peak memory are printed (machine dependent), with a ceiling that only a pathology
    (quadratic merge, a copy per entry) would cross."""
    import time
    import tracemalloc
    names = ["euro_wind_wind_global_mid_2026%04dT%06dZ.json" % (i // 100, i % 100) for i in range(16000)]
    chain.objects[chain.head_key] = dump_manifest_for_l2(_snapshot(names))
    snapshot = _snapshot(names[:15990] + ["pilots_new_%d.json" % k for k in range(10)])
    chain.foreign_publish(adding(*["core_new_%d.json" % k for k in range(14)]))           # a real merge, not a no-op
    head_bytes = len(chain.objects[chain.head_key])
    tracemalloc.start()
    started = time.process_time()
    mps.submit_manifest_publish(store, snapshot)
    cpu = time.process_time() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    with capsys.disabled():
        print("\nCOST one-step publish: head %.1f MB, CPU %.2f s, peak traced memory %.0f MiB"
              % (head_bytes / 1e6, cpu, peak / 2 ** 20))
    assert len(chain.kinds("read_pointer")) == 1 and len(chain.kinds("fetch")) == 1 and len(chain.wins()) == 1
    assert len([u for u in chain.uploads if u[0].startswith("manifests/")]) == 1
    assert len([u for u in chain.uploads if u[0] == "manifest.json"]) == 1
    files = set(chain.head_files())
    assert {"core_new_13.json", "pilots_new_9.json", names[15999]} <= files and len(files) == 16000 + 14 + 10
    assert cpu < 120 and peak < 3 * 2 ** 30

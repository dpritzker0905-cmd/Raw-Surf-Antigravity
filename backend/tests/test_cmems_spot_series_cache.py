"""CMEMS spot series fetched once per bulletin (roadmap stage 1, 2026-09-26).

THE WASTE THIS REMOVES. CMEMS publishes twice a day; the spot pre-warm ran ~12 times a day and hit its
1200 s budget on every run (179 boxes x ~10 s on a healthy upstream), leaving 8-17% of rating points on
non-native fallback. With the per-bulletin L2 blob, a run whose bulletin is already cached fetches only
the spots the blob lacks, and a budget-aborted run completes the blob on the next run.
No test here touches the network: the listing, the blob I/O and the CMEMS fetch are all stubbed.
"""
import asyncio
import gzip
import json
from datetime import datetime, timezone

import pytest

from services import cmems_run_identity as cri
from services import cmems_spot_series_cache as spot_cache
from services import copernicus_marine_service as cms
from services.copernicus_global_fetcher import DATASET_ID
from services.copernicus_point_batching import (
    EURO_POINT_FORECAST_DAYS, batched_point_cache_key, prewarm_euro_marine_point_cache,
)

B_OLD = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
B_NEW = datetime(2026, 9, 26, 0, tzinfo=timezone.utc)
FD = EURO_POINT_FORECAST_DAYS
# Two 5-degree clusters, three spots each.
SPOTS = [(33.62, -117.93), (33.65, -118.00), (34.01, -118.50),
         (21.28, -157.84), (21.30, -157.80), (21.60, -158.10)]


def _series(lat, lng, bulletin):
    s = {"latitude": lat, "longitude": lng, "__provider": "copernicus",
         "hourly": {"time": ["2026-09-26T00:00:00Z"], "wave_height": [1.5]}}
    if bulletin is not None:
        s["__model_run_time"] = bulletin.isoformat()
    return s


def _blob(bulletin, points, fd=FD, dataset=DATASET_ID, version=spot_cache.SCHEMA_VERSION):
    return {"version": version, "dataset": dataset, "bulletin": bulletin.isoformat(), "forecast_days": fd,
            "points": {spot_cache.point_key(la, lo): _series(la, lo, bulletin) for la, lo in points}}


@pytest.fixture
def lane(monkeypatch):
    """The pre-warm with every seam stubbed. Returns a dict of what happened."""
    seen = {"fetched_points": [], "saved": [], "listing_calls": 0, "loads": 0}
    state = {"latest": B_NEW, "blob": None, "stamp": B_NEW}

    def latest(_ds, **kw):
        seen["listing_calls"] += 1
        return state["latest"]

    def load():
        seen["loads"] += 1
        return state["blob"]

    async def fetch(latitudes, longitudes, forecast_days, variables=None, valid_time=None):
        seen["fetched_points"] += list(zip(latitudes, longitudes))
        return [_series(la, lo, state["stamp"]) for la, lo in zip(latitudes, longitudes)]

    monkeypatch.setenv("POINT_BATCH_NATIVE_COPERNICUS", "1")
    monkeypatch.delenv("POINT_SKIP_NATIVE_COPERNICUS", raising=False)
    monkeypatch.setenv("CMEMS_POINT_CACHE_L2", "1")
    monkeypatch.setattr(cri, "latest_native_bulletin", latest)
    monkeypatch.setattr(spot_cache, "load_blob", load)
    monkeypatch.setattr(spot_cache, "save_blob", lambda blob: seen["saved"].append(blob) or True)
    monkeypatch.setattr(cms, "fetch_euro_marine", fetch)
    cms._point_cache.clear()
    run = lambda: asyncio.run(prewarm_euro_marine_point_cache(SPOTS, forecast_days=FD))  # noqa: E731
    yield state, seen, run
    cms._point_cache.clear()


def test_a_cached_bulletin_costs_no_fetch(lane):
    state, seen, run = lane
    state["blob"] = _blob(B_NEW, SPOTS)
    stats = run()
    assert seen["fetched_points"] == [] and stats["boxes"] == 0
    assert stats["cache_hits"] == 6 and stats["cached_points"] == 6
    for la, lo in SPOTS:
        assert batched_point_cache_key(la, lo, FD) in cms._point_cache
    assert seen["saved"] == []                                   # nothing new to write


def test_a_partial_blob_fetches_only_what_it_lacks_and_writes_the_union(lane):
    """The budget-abort recovery: the next run completes the blob."""
    state, seen, run = lane
    state["blob"] = _blob(B_NEW, SPOTS[:3])                       # SoCal cached, Hawaii missing
    stats = run()
    assert sorted(seen["fetched_points"]) == sorted(SPOTS[3:])
    assert stats["cache_hits"] == 3 and stats["cached_points"] == 6
    assert len(seen["saved"]) == 1 and len(seen["saved"][0]["points"]) == 6
    assert seen["saved"][0]["bulletin"] == B_NEW.isoformat()


def test_a_new_bulletin_ignores_the_old_blob(lane):
    state, seen, run = lane
    state["blob"] = _blob(B_OLD, SPOTS)
    stats = run()
    assert sorted(seen["fetched_points"]) == sorted(SPOTS) and stats["cache_hits"] == 0
    assert seen["saved"][0]["bulletin"] == B_NEW.isoformat() and len(seen["saved"][0]["points"]) == 6


def test_unproven_series_are_never_cached(lane):
    """ARCO still serving the previous bulletin: the fetch comes back unstamped, and the cache stays out of it."""
    state, seen, run = lane
    state["stamp"] = None
    stats = run()
    assert stats["cached_points"] == 6                            # the run itself still pre-warms
    assert seen["saved"] == []


def test_a_series_stamped_with_another_bulletin_is_not_cached(lane):
    state, seen, run = lane
    state["stamp"] = B_OLD
    run()
    assert seen["saved"] == []


def test_no_listing_means_todays_path(lane):
    state, seen, run = lane
    state["latest"] = None
    stats = run()
    assert sorted(seen["fetched_points"]) == sorted(SPOTS) and seen["loads"] == 0 and seen["saved"] == []
    assert stats["bulletin"] is None


def test_the_kill_switch_skips_the_listing(lane, monkeypatch):
    state, seen, run = lane
    monkeypatch.setenv("CMEMS_POINT_CACHE_L2", "0")
    state["blob"] = _blob(B_NEW, SPOTS)
    run()
    assert seen["listing_calls"] == 0 and sorted(seen["fetched_points"]) == sorted(SPOTS)


def test_off_by_default_under_the_test_suite(monkeypatch):
    monkeypatch.delenv("CMEMS_POINT_CACHE_L2", raising=False)
    monkeypatch.setenv("TESTING", "1")
    assert spot_cache.enabled() is False
    monkeypatch.setenv("TESTING", "0")
    assert spot_cache.enabled() is True


@pytest.mark.parametrize("change", [{"version": 99}, {"fd": FD - 1}, {"dataset": "other"}])
def test_a_blob_for_another_shape_is_not_used(change):
    blob = _blob(B_NEW, SPOTS, fd=change.get("fd", FD), dataset=change.get("dataset", DATASET_ID),
                 version=change.get("version", spot_cache.SCHEMA_VERSION))
    assert spot_cache.usable_entries(blob, B_NEW.isoformat(), FD, DATASET_ID) == {}


def test_an_unstamped_entry_inside_a_matching_blob_is_dropped():
    blob = _blob(B_NEW, SPOTS[:2])
    blob["points"][spot_cache.point_key(*SPOTS[1])].pop("__model_run_time")
    assert list(spot_cache.usable_entries(blob, B_NEW.isoformat(), FD, DATASET_ID)) == [spot_cache.point_key(*SPOTS[0])]


def test_merged_blob_is_none_when_nothing_new_and_proven():
    have = {spot_cache.point_key(*SPOTS[0]): _series(*SPOTS[0], B_NEW)}
    again = {spot_cache.point_key(*SPOTS[0]): _series(*SPOTS[0], B_NEW)}
    assert spot_cache.merged_blob(have, again, B_NEW.isoformat(), FD, DATASET_ID) is None
    unproven = {spot_cache.point_key(*SPOTS[1]): _series(*SPOTS[1], None)}
    assert spot_cache.merged_blob(have, unproven, B_NEW.isoformat(), FD, DATASET_ID) is None


def test_save_writes_gzipped_json_under_the_reserved_key(monkeypatch):
    written = {}
    from services.weather_pipeline import store as store_mod
    monkeypatch.setattr(store_mod.ProductStore, "_upload_to_supabase",
                        lambda self, name, data, **kw: written.update(name=name, data=data, kw=kw))
    blob = _blob(B_NEW, SPOTS[:1])
    assert spot_cache.save_blob(blob) is True
    assert written["name"] == spot_cache.CACHE_KEY and written["kw"].get("strict") is True
    assert json.loads(gzip.decompress(written["data"])) == blob


def test_the_orphan_sweep_spares_the_cache_key():
    from datetime import timedelta
    from scripts.sweep_orphaned_l2 import is_orphan
    now = datetime.now(timezone.utc)
    assert is_orphan(spot_cache.CACHE_KEY, set(), now - timedelta(days=30), now, 24) is False


def test_latest_native_bulletin_reads_the_newest_tag_and_never_raises():
    cri._memo.clear()
    uri = "https://s3.example/mdl-native-14/native/GLOBAL/" + DATASET_ID + "_202411"
    describe = lambda **kw: {"products": [{"datasets": [{"dataset_id": DATASET_ID, "versions": [  # noqa: E731
        {"label": "202411", "parts": [{"retired_date": None,
                                       "services": [{"service_name": "original-files", "uri": uri}]}]}]}]}]}

    class _Resp:
        def __init__(self, body):
            self.content = body.encode()

        def raise_for_status(self):
            pass

    class _Session:
        def get(self, url, params=None, timeout=None):
            keys = [f"native/x/mfwamglocep_2026092{d}12_R2026092{d - 1}_12H.nc" for d in (3, 4)] + \
                   ["native/x/mfwamglocep_2026092600_R20260926_00H.nc"]
            return _Resp('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                         + "".join(f"<Contents><Key>{k}</Key></Contents>" for k in keys)
                         + "<IsTruncated>false</IsTruncated></ListBucketResult>")

    now = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)
    assert cri.latest_native_bulletin(DATASET_ID, now=now, describe=describe, session=_Session()) == B_NEW
    cri._memo.clear()

    def boom(**kw):
        raise ConnectionError("catalogue down")
    assert cri.latest_native_bulletin(DATASET_ID, now=now, describe=boom) is None
    cri._memo.clear()

"""Item 14 (2026-11-01, DARK): EURO swell at the 2-deg world tier, and the frame sets that publish it.

EURO swell_1/swell_2/wind_waves existed only at 10 deg (global_coarse), so no world frame existed at any zoom. Pinned here:
the ingest flag stores the three partitions at global_mid (waves stays ECMWF), the CMEMS wrapper splits the ~83 thin bands
across fetcher processes and joins them in order (all or nothing), the fetcher downloads only the asked variables (driven
offline against a fake CMEMS subset that writes real netCDF), and the publisher adds the sets only with its own flag.
"""
import json
import os
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

from services.copernicus_marine_service import CMEMS_PARTITION_VARS, split_band_lats


# ── the band split ──────────────────────────────────────────────────────────────────────────────

def test_split_is_contiguous_ordered_and_complete():
    lats = [-80.0 + 2.0 * i for i in range(83)]
    chunks = split_band_lats(lats, 4)
    assert len(chunks) == 4
    assert [x for c in chunks for x in c] == lats
    assert max(map(len, chunks)) - min(map(len, chunks)) <= 1


@pytest.mark.parametrize("workers,expected", [(1, 1), (0, 1), (None, 1), (99, 3)])
def test_split_never_makes_empty_or_extra_chunks(workers, expected):
    assert len(split_band_lats([1.0, 2.0, 3.0], workers)) == expected


# ── the wrapper: N fetcher processes, one result ────────────────────────────────────────────────

@pytest.fixture
def wrapper_env(monkeypatch):
    import services.copernicus_marine_service as cms
    monkeypatch.setattr(cms, "is_test_environment", lambda: False)
    monkeypatch.setattr(cms, "_check_credentials", lambda: ("user", "pass"))
    monkeypatch.delenv("COPERNICUS_GLOBAL_TIMEOUT_S", raising=False)
    return cms


def _fake_run_factory(calls, fail_lat=None):
    import subprocess

    def fake_run(argv, capture_output=True, text=True, timeout=None):
        payload = json.loads(argv[-1])
        calls.append({"lats": payload.get("lats"), "variables": payload.get("variables"), "timeout": timeout})
        lats = payload.get("lats") or [-80.0]
        if fail_lat is not None and fail_lat in lats:
            return subprocess.CompletedProcess(argv, 1, stdout="", stderr="boom")
        with open(payload["output_path"], "w") as fh:
            json.dump([{"latitude": la, "longitude": 0.0, "__model_run_time": "2026-11-01T12:00:00Z", "hourly": {}}
                       for la in lats], fh)
        return subprocess.CompletedProcess(argv, 0, stdout="SUMMARY: ok", stderr="")
    return fake_run


@pytest.mark.asyncio
async def test_workers_split_the_bands_and_join_them_in_order(wrapper_env, monkeypatch):
    import subprocess
    calls = []
    monkeypatch.setattr(subprocess, "run", _fake_run_factory(calls))
    monkeypatch.setenv("COPERNICUS_GLOBAL_TIMEOUT_S", "3600")
    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    pts = await wrapper_env.fetch_euro_marine_global_coarse(region, 2.0, 10, variables=list(CMEMS_PARTITION_VARS), workers=4)
    assert len(calls) == 4
    assert all(c["variables"] == list(CMEMS_PARTITION_VARS) and c["timeout"] == 3600 for c in calls)
    got = [p["latitude"] for p in pts]
    assert got == sorted(got) and len(got) == 83 and got[0] == -80.0


@pytest.mark.asyncio
async def test_defaults_keep_one_process_with_every_variable(wrapper_env, monkeypatch):
    import subprocess
    calls = []
    monkeypatch.setattr(subprocess, "run", _fake_run_factory(calls))
    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    assert await wrapper_env.fetch_euro_marine_global_coarse(region, 10.0, 10)
    assert calls == [{"lats": None, "variables": None, "timeout": 2400}]


@pytest.mark.asyncio
async def test_one_failed_chunk_returns_nothing_not_a_globe_with_a_hole(wrapper_env, monkeypatch):
    import subprocess
    calls = []
    monkeypatch.setattr(subprocess, "run", _fake_run_factory(calls, fail_lat=0.0))
    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    assert await wrapper_env.fetch_euro_marine_global_coarse(region, 2.0, 10, workers=4) is None
    assert len(calls) == 4


# ── the fetcher, offline: a fake CMEMS subset that writes real netCDF ──────────────────────────

def test_fetcher_downloads_only_the_asked_variables_for_the_asked_lats(monkeypatch, tmp_path):
    netCDF4 = pytest.importorskip("netCDF4")
    import numpy as np
    asked = []

    def subset(dataset_id, variables, minimum_longitude, maximum_longitude, minimum_latitude, maximum_latitude,
               start_datetime, end_datetime, output_directory, output_filename, username, password):
        asked.append((tuple(variables), round((minimum_latitude + maximum_latitude) / 2, 3)))
        nc = netCDF4.Dataset(os.path.join(output_directory, output_filename), "w")
        lats = np.linspace(minimum_latitude, maximum_latitude, 3)
        lons = np.arange(-180.0, 180.0, 0.5)
        nc.createDimension("time", 4)
        nc.createDimension("latitude", len(lats))
        nc.createDimension("longitude", len(lons))
        nc.createVariable("latitude", "f8", ("latitude",))[:] = lats
        nc.createVariable("longitude", "f8", ("longitude",))[:] = lons
        t = nc.createVariable("time", "f8", ("time",))
        t.units = "hours since 2026-11-01 12:00:00"
        t[:] = [0, 3, 6, 9]
        for v in variables:
            value = 180.0 if v.startswith("VMDR") else (9.0 if v.startswith("VTM") else 1.25)
            nc.createVariable(v, "f4", ("time", "latitude", "longitude"))[:] = np.full((4, len(lats), len(lons)), value)
        nc.close()

    monkeypatch.setitem(sys.modules, "copernicusmarine", types.SimpleNamespace(subset=subset))
    monkeypatch.setattr("tempfile.gettempdir", lambda: str(tmp_path))
    from services.copernicus_global_fetcher import fetch_global_coarse
    payload = {"username": "u", "password": "p", "resolution": 2.0,
               "bbox": {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0},
               "start_datetime": "2026-11-01T12:00:00", "end_datetime": "2026-11-02T00:00:00",
               "lats": [10.0, 12.0], "variables": list(CMEMS_PARTITION_VARS)}
    points, ok, failed, times = fetch_global_coarse(payload)
    assert (ok, failed) == (2, 0)
    assert [a[1] for a in asked] == [10.0, 12.0]
    assert all(set(a[0]) == set(CMEMS_PARTITION_VARS) for a in asked), "no total-sea variable downloaded"
    assert len(points) == 2 * 180 and points[0]["latitude"] == 10.0 and points[-1]["latitude"] == 12.0
    hourly = points[0]["hourly"]
    assert "wave_height" not in hourly
    assert hourly["swell_wave_height"][0] == pytest.approx(1.25)
    assert hourly["secondary_swell_wave_period"][0] == pytest.approx(9.0)
    assert hourly["wind_wave_direction"][0] == pytest.approx(180.0, abs=0.01)
    assert len(times) == 4


# ── the ingest ──────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def mid_job(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wave_service as wave_svc
    import services.copernicus_marine_service as cms
    from tests.test_ecmwf_euro import _mock_cmems_marine_points, _mock_ecmwf_wave_points

    store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_MARINE_MID_ECMWF", "1")
    monkeypatch.setenv("EURO_MID_RES", "10.0")
    monkeypatch.delenv("EURO_MID_CMEMS_WORKERS", raising=False)
    calls = []

    async def fake_ecmwf(bbox, resolution=2.0, forecast_days=10):
        return _mock_ecmwf_wave_points()

    async def fake_cmems(region, resolution, days, variables=None, workers=1):
        calls.append({"variables": variables, "workers": workers})
        return None if os.environ.get("_FAKE_CMEMS_DOWN") == "1" else _mock_cmems_marine_points()

    monkeypatch.setattr(wave_svc, "fetch_euro_marine_waves_global", fake_ecmwf)
    monkeypatch.setattr(cms, "fetch_euro_marine_global_coarse", fake_cmems)
    return scheduler, store, calls


def _layers(store, provider=None):
    return {p.layer for p in store.get_manifest().products
            if p.model == "EURO" and p.region_id == "global_mid" and (provider is None or p.provider == provider)}


@pytest.mark.asyncio
async def test_flag_off_stores_waves_only_and_never_asks_cmems(mid_job, monkeypatch):
    monkeypatch.setenv("EURO_MARINE_MID_CMEMS_SWELL", "0")  # the kill switch (ON by default since 2026-11-01)
    scheduler, store, calls = mid_job
    assert await scheduler.ingest_euro_marine_global_mid() is True
    assert _layers(store) == {"waves"} and calls == []


@pytest.mark.asyncio
async def test_flag_on_adds_the_three_cmems_partitions_at_global_mid(mid_job, monkeypatch):
    monkeypatch.delenv("EURO_MARINE_MID_CMEMS_SWELL", raising=False)  # unset = ON
    scheduler, store, calls = mid_job
    assert await scheduler.ingest_euro_marine_global_mid() is True
    assert calls == [{"variables": list(CMEMS_PARTITION_VARS), "workers": 4}]
    assert _layers(store, "copernicus") == {"swell_1", "swell_2", "wind_waves"}
    assert _layers(store, "open-meteo") == {"waves"}, "waves stays on the ECMWF stream"
    for p in store.get_manifest().products:
        if p.provider == "copernicus":
            assert p.is_forecast_authoritative and not p.is_estimated


@pytest.mark.asyncio
async def test_a_cmems_failure_costs_the_swell_layers_only(mid_job, monkeypatch):
    monkeypatch.setenv("EURO_MARINE_MID_CMEMS_SWELL", "1")
    monkeypatch.setenv("_FAKE_CMEMS_DOWN", "1")
    scheduler, store, _ = mid_job
    assert await scheduler.ingest_euro_marine_global_mid() is True
    assert _layers(store) == {"waves"}


# ── the publisher ──────────────────────────────────────────────────────────────────────────────

def test_publisher_adds_the_euro_swell_sets_only_with_its_flag(monkeypatch):
    from services import frame_set as fs
    from scripts.publish_frame_images import selected_sets
    monkeypatch.delenv("FRAME_SETS", raising=False)
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES", "0")
    monkeypatch.setenv("FRAME_EURO_SWELL_SETS", "0")  # the kill switch (ON by default since 2026-11-01)
    off = [fs.set_key(t) for t in selected_sets()]
    assert not any(k.startswith("EURO/marine/swell") or k.startswith("EURO/marine/wind_waves") for k in off)
    monkeypatch.delenv("FRAME_EURO_SWELL_SETS", raising=False)  # unset = ON
    on = [fs.set_key(t) for t in selected_sets()]
    added = [k for k in on if k not in off]
    assert len(added) == 6
    assert {k.split("/")[2] for k in added} == {"swell_1", "swell_2", "wind_waves"}
    assert on[:len(off)] == off, "every existing set (world and regional) keeps its order and comes first"
    assert on[len(off):] == added, "the EURO swell sets come LAST, so the publish budget drops them before any bundle"

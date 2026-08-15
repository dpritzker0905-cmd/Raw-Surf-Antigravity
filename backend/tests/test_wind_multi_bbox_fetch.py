"""MULTI-BBOX wind fetch: N regions for ONE region's download cost.

WHY THIS EXISTS. The pilot lane rationed regions with a clock-keyed rotation
(WORLDWIDE_REGIONS_PER_CYCLE), and that rationing is what starved Hawaii's wind to a 75.0 h-old run
behind a CURRENT valid_time, and GFS marine's uk_ireland to 447.6 h. But the cost being rationed was
pure redundancy: NOAA's byte-range selects a GRIB *message*, not a region, and a message is the whole
global 0.25 deg field. Measured live against the 20260731 12Z cycle -- UGRD 591,525 B + VGRD
572,474 B per forecast step, BYTE-IDENTICAL for a 609-point Hawaii box and a 2,009-point uk_ireland
box. Sampling every region out of each decoded field removes the cost rather than scheduling it.

The load-bearing assertions here are:
  1. EQUIVALENCE  -- multi-mode output for a region is EXACTLY the single-mode output for that bbox.
     Without this the optimisation is a silent data change, which is the worse defect.
  2. COST         -- the number of HTTP fetches is INDEPENDENT of the region count. This is the whole
     claim; a comment asserting it would rot, so it is pinned as a test.
  3. ALIGNMENT    -- a failed step pads EVERY region, so no region's hourly arrays desync from
     `times`. The single-bbox code padded one series; multi must pad all of them.

pygrib has no Windows wheel, so numpy/requests/pygrib are injected as fakes. That is not a
compromise: the change under test is the sampling/indexing restructure, not GRIB decoding, and a
synthetic global field makes the equivalence assertion EXACT instead of approximate.
"""
import sys
import types
from datetime import datetime, timezone

import numpy as np
import pytest

from services import noaa_gfs_wind_fetcher as F

# A tiny stand-in for the global 0.25 deg grid: 0.5 deg so the arrays stay small but the
# lat/lon lookup, the 0-360 wrap and the nearest-neighbour indexing all exercise real paths.
GLAT = np.arange(90.0, -90.01, -0.5)      # north -> south, like GFS
GLON = np.arange(0.0, 360.0, 0.5)         # 0..360, like GFS (forces the is_360 branch)


def _field(seed):
    """Deterministic, spatially varying field so a mis-indexed sample cannot coincidentally match."""
    la = GLAT[:, None]
    lo = GLON[None, :]
    return (np.sin(np.radians(la)) * 10.0 + np.cos(np.radians(lo)) * 3.0 + seed).astype(float)


U_FIELD = _field(0.0)
V_FIELD = _field(7.0)


class _Msg:
    def __init__(self, values):
        self.values = values

    def latlons(self):
        return np.meshgrid(GLAT, GLON, indexing="ij")[0], np.meshgrid(GLAT, GLON, indexing="ij")[1]


class _Grbs:
    def __init__(self, fail):
        self._fail = fail

    def read(self):
        if self._fail:
            raise RuntimeError("decode failed")
        return [_Msg(U_FIELD), _Msg(V_FIELD)]

    def close(self):
        pass


class _Resp:
    def __init__(self, text=b"", status=200):
        self._t = text
        self.status_code = status

    @property
    def text(self):
        return self._t.decode() if isinstance(self._t, bytes) else self._t

    @property
    def content(self):
        return self._t if isinstance(self._t, bytes) else self._t.encode()


# Two messages at known offsets; _parse_idx derives ends from the next row's start.
IDX_TEXT = (
    "1:0:d=2026073112:UGRD:10 m above ground:anl:\n"
    "2:1000:d=2026073112:VGRD:10 m above ground:anl:\n"
    "3:2000:d=2026073112:TMP:surface:anl:\n"
)


def _range_len(headers, default=8):
    """Bytes implied by a `bytes=a-b` Range header (inclusive), else `default`."""
    rng = (headers or {}).get("Range", "") if headers else ""
    if rng.startswith("bytes=") and "-" in rng:
        a, _, b = rng[6:].partition("-")
        if a.isdigit() and b.isdigit():
            return int(b) - int(a) + 1
    return default


class _FakeRequests:
    """Counts range GETs so the COST assertion can be made directly."""

    def __init__(self, fail_steps=()):
        self.range_gets = 0
        self.idx_gets = 0
        self.fail_steps = set(fail_steps)
        self.decoded_steps = 0

    def head(self, url, timeout=None):
        return _Resp(status=200)

    def get(self, url, headers=None, timeout=None):
        if url.endswith(".idx"):
            self.idx_gets += 1
            return _Resp(IDX_TEXT)
        self.range_gets += 1
        # WS-CAN-0017: honour the Range handed to us. This used to answer a `bytes=a-b` request
        # with a fixed 16 bytes — a response no real server gives, and exactly the shape the new
        # length check rejects. A fixture that cannot occur disarms the guard downstream, so the
        # FIXTURE is fixed, never the guard.
        return _Resp(b"\x00" * _range_len(headers, 16))


def _install(monkeypatch, req, fail_steps=()):
    state = {"n": 0}

    def _open(path):
        step = state["n"] // 1  # one pygrib.open per forecast step
        state["n"] += 1
        return _Grbs(fail=(step in set(fail_steps)))

    fake_pygrib = types.ModuleType("pygrib")
    fake_pygrib.open = _open
    monkeypatch.setitem(sys.modules, "pygrib", fake_pygrib)
    monkeypatch.setitem(sys.modules, "requests", req)
    # The fetcher writes the range bytes to a temp file then opens it with pygrib; both are faked,
    # so the write is harmless. Freeze the clock so _pick_cycle is deterministic.
    monkeypatch.setattr(F, "datetime", _FrozenDatetime)


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)


HAWAII = {"west": -161.0, "south": 18.0, "east": -154.0, "north": 23.0}
UK = {"west": -11.0, "south": 49.0, "east": 1.0, "north": 59.0}
BRAZIL = {"west": -49.0, "south": -27.0, "east": -34.0, "north": -3.0}


def _run(monkeypatch, payload, fail_steps=()):
    req = _FakeRequests()
    _install(monkeypatch, req, fail_steps)
    out = F.fetch_global_coarse(payload)
    return out, req


def test_multi_region_output_is_identical_to_single_region(monkeypatch):
    """THE EQUIVALENCE. An optimisation that changes the numbers is a data defect wearing a
    performance costume — every sampled value must match the per-region path exactly."""
    days = 1
    single = {}
    for rid, bb in (("hawaii", HAWAII), ("uk_ireland", UK), ("brazil_east", BRAZIL)):
        (pts, ok, failed, times), _ = _run(
            monkeypatch, {"bbox": bb, "resolution": 0.25, "forecast_days": days})
        assert ok > 0 and pts, rid
        single[rid] = pts

    (multi, m_ok, m_failed, m_times), _ = _run(monkeypatch, {
        "bbox": HAWAII, "resolution": 0.25, "forecast_days": days,
        "bboxes": {"hawaii": HAWAII, "uk_ireland": UK, "brazil_east": BRAZIL},
    })
    assert isinstance(multi, dict) and set(multi) == set(single)
    for rid in single:
        assert multi[rid] == single[rid], f"{rid} differs between multi and single mode"


def test_download_cost_is_independent_of_region_count(monkeypatch):
    """THE CLAIM, PINNED. This is why the rotation can be retired: fetch volume does not grow with
    regions. If a future change reintroduces per-region fetching, this fails instead of quietly
    restoring the 4x duplication that made rationing look necessary."""
    days = 1
    _, one = _run(monkeypatch, {"bbox": HAWAII, "resolution": 0.25, "forecast_days": days,
                                "bboxes": {"hawaii": HAWAII}})
    _, eight = _run(monkeypatch, {
        "bbox": HAWAII, "resolution": 0.25, "forecast_days": days,
        "bboxes": {f"r{i}": bb for i, bb in enumerate([HAWAII, UK, BRAZIL] * 3)},
    })
    assert one.range_gets == eight.range_gets, (
        f"1 region = {one.range_gets} range GETs, 9 regions = {eight.range_gets} -- cost scaled with regions")
    assert one.idx_gets == eight.idx_gets


def test_a_failed_step_pads_every_region_so_none_desyncs(monkeypatch):
    """THE ALIGNMENT. The single-bbox code padded ONE series on a failed step. With N regions, a
    partial pad leaves some region's hourly arrays shorter than `times`, so every later value is
    attributed to the wrong timestamp — a silent time shift, the worst kind of wrong."""
    (multi, ok, failed, times), _ = _run(monkeypatch, {
        "bbox": HAWAII, "resolution": 0.25, "forecast_days": 1,
        "bboxes": {"hawaii": HAWAII, "uk_ireland": UK},
    }, fail_steps=(2,))
    assert failed == 1 and ok > 0
    for rid, pts in multi.items():
        for p in pts:
            assert len(p["hourly"]["wind_speed_10m"]) == len(times), rid
            assert len(p["hourly"]["wind_direction_10m"]) == len(times), rid


def test_single_bbox_path_still_returns_a_plain_list(monkeypatch):
    """The legacy contract is load-bearing: ingest_gfs_wind_global_impl and the recovery lane both
    call the single-bbox path and index it as a list."""
    (pts, ok, failed, times), _ = _run(
        monkeypatch, {"bbox": HAWAII, "resolution": 0.25, "forecast_days": 1})
    assert isinstance(pts, list) and pts
    assert set(pts[0]) >= {"latitude", "longitude", "hourly", "hourly_units", "__provider"}
    assert pts[0]["__provider"] == "noaa"


def test_no_cycle_returns_empty_of_the_right_shape(monkeypatch):
    """Multi mode must return {} not [] when the cycle probe fails, or the caller's
    `if multi:` / `.items()` handling breaks on the failure path."""
    class _NoCycle(_FakeRequests):
        def head(self, url, timeout=None):
            return _Resp(status=404)

    req = _NoCycle()
    _install(monkeypatch, req)
    pts, ok, failed, times = F.fetch_global_coarse(
        {"bbox": HAWAII, "resolution": 0.25, "forecast_days": 1, "bboxes": {"hawaii": HAWAII}})
    assert pts == {} and times is None

    req2 = _NoCycle()
    _install(monkeypatch, req2)
    pts2, _, _, _ = F.fetch_global_coarse({"bbox": HAWAII, "resolution": 0.25, "forecast_days": 1})
    assert pts2 == []


def test_region_grid_sizes_differ_but_wire_cost_does_not(monkeypatch):
    """The measured asymmetry that makes the whole thing work: a 609-point box and a 2,009-point box
    cost the same on the wire, because the bbox is applied AFTER decode."""
    (multi, _, _, _), req = _run(monkeypatch, {
        "bbox": HAWAII, "resolution": 0.25, "forecast_days": 1,
        "bboxes": {"hawaii": HAWAII, "uk_ireland": UK},
    })
    assert len(multi["uk_ireland"]) > len(multi["hawaii"]) * 2   # genuinely different point counts
    steps = len(multi["hawaii"][0]["hourly"]["time"])
    assert req.range_gets == steps * len(F.WIND_VARS)            # and one fetch set per STEP, not per region

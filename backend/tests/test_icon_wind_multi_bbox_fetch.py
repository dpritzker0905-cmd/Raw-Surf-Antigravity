"""MULTI-BBOX DWD ICON wind fetch: N regions for ONE region's download cost.

Third of the family (NOAA wind, NOAA wave, DWD ICON wind). DWD is the case the 2026-07-13 GWAM fix
already proved for MARINE — "DWD publishes whole-globe files per (var, hour) with no spatial
byte-range, so per-region passes re-download identical whole-globe files" — and the wind lane was
simply never ported, so it kept rotating and left uk_ireland / east_australia at 29.8 h.

ICON is the awkward one: an ICOSAHEDRAL grid, so the index map is a flat cell index from a 3D
nearest-neighbour search (dot.argmax()), not an (r, c) pair. EQUIVALENCE therefore matters most —
a restructure that mis-associates a region with another region's cell indices would produce
plausible wind at the wrong place, which no smoke test would notice.

pygrib/bz2/requests are injected as fakes; the axis, NN-search and sampling code under test is real.
"""
import bz2
import sys
import types
from datetime import datetime, timezone

import numpy as np
import pytest

from services import dwd_icon_wind_fetcher as F

# A small icosahedral-ish cell cloud: irregular points on the sphere, like ICON's native grid.
_rng = np.random.RandomState(20260731)
NCELL = 4000
CLAT = np.degrees(np.arcsin(_rng.uniform(-1.0, 1.0, NCELL)))
CLON = _rng.uniform(-180.0, 180.0, NCELL)
U_FIELD = (np.sin(np.radians(CLAT * 2.1)) * 8.0 + np.cos(np.radians(CLON * 1.3)) * 3.0)
V_FIELD = (np.cos(np.radians(CLAT * 1.7)) * 6.0 - np.sin(np.radians(CLON * 2.2)) * 2.0)


class _Msg:
    def __init__(self, vals):
        self.values = vals


class _Grbs:
    def __init__(self, vals, fail):
        self._v, self._fail = vals, fail

    def read(self):
        if self._fail:
            raise RuntimeError("decode failed")
        return [_Msg(self._v)]

    def close(self):
        pass


class _Resp:
    def __init__(self, content=b"", status=200):
        self.content = content
        self.status_code = status


class _FakeRequests:
    """Serves CLAT/CLON/U/V by URL and counts DOWNLOADS so the cost claim can be asserted."""

    def __init__(self, fail_steps=()):
        self.downloads = 0
        self.fail_steps = set(fail_steps)
        self._step_seen = {}

    def head(self, url, timeout=None):
        return _Resp(status=200)

    def get(self, url, timeout=None):
        self.downloads += 1
        # payload is a marker; the fake pygrib decides what array to return from the marker
        if "CLAT" in url:
            tag = b"CLAT"
        elif "CLON" in url:
            tag = b"CLON"
        elif "U_10M" in url:
            tag = b"U"
        elif "V_10M" in url:
            tag = b"V"
        else:
            tag = b"?"
        # encode the forecast hour so a failing step can be targeted
        fh = b"000"
        for part in url.split("_"):
            if part.isdigit() and len(part) == 3:
                fh = part.encode()
        return _Resp(bz2.compress(tag + b":" + fh))


def _install(monkeypatch, req):
    def _open(path):
        with open(path, "rb") as fh:
            raw = fh.read()
        tag, fh_s = raw.split(b":")
        step = int(fh_s) // 3
        arr = {b"CLAT": CLAT, b"CLON": CLON, b"U": U_FIELD, b"V": V_FIELD}[tag]
        fail = (tag in (b"U", b"V")) and (step in req.fail_steps)
        return _Grbs(arr, fail)

    fake = types.ModuleType("pygrib")
    fake.open = _open
    monkeypatch.setitem(sys.modules, "pygrib", fake)
    monkeypatch.setitem(sys.modules, "requests", req)
    monkeypatch.setattr(F, "datetime", _Frozen)


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)


UK = {"west": -11.0, "south": 49.0, "east": 1.0, "north": 59.0}
EAST_AUS = {"west": 150.0, "south": -38.0, "east": 156.0, "north": -25.0}
HAWAII = {"west": -161.0, "south": 18.0, "east": -154.0, "north": 23.0}


def _run(monkeypatch, payload, fail_steps=()):
    req = _FakeRequests(fail_steps)
    _install(monkeypatch, req)
    return F.fetch_global_coarse(payload), req


def test_multi_region_output_is_identical_to_single_region(monkeypatch):
    """THE EQUIVALENCE — on an icosahedral grid, where a mis-keyed index map would silently return
    another region's wind rather than fail."""
    single = {}
    for rid, bb in (("uk_ireland", UK), ("east_australia", EAST_AUS), ("hawaii", HAWAII)):
        (pts, ok, _f, _t), _ = _run(monkeypatch, {"bbox": bb, "resolution": 1.0, "forecast_days": 1})
        assert ok > 0 and pts, rid
        single[rid] = pts

    (multi, _ok, _f, _t), _ = _run(monkeypatch, {
        "bbox": UK, "resolution": 1.0, "forecast_days": 1,
        "bboxes": {"uk_ireland": UK, "east_australia": EAST_AUS, "hawaii": HAWAII},
    })
    assert isinstance(multi, dict) and set(multi) == set(single)
    for rid in single:
        assert multi[rid] == single[rid], f"{rid} differs between multi and single mode"


def test_download_cost_is_independent_of_region_count(monkeypatch):
    """THE CLAIM, PINNED — the reason the rotation can be retired for ICON too."""
    _, one = _run(monkeypatch, {"bbox": UK, "resolution": 1.0, "forecast_days": 1,
                                "bboxes": {"uk_ireland": UK}})
    _, many = _run(monkeypatch, {
        "bbox": UK, "resolution": 1.0, "forecast_days": 1,
        "bboxes": {f"r{i}": bb for i, bb in enumerate([UK, EAST_AUS, HAWAII] * 3)},
    })
    assert one.downloads == many.downloads, (
        f"1 region = {one.downloads} downloads, 9 regions = {many.downloads} — cost scaled with regions")


def test_a_failed_step_pads_every_region_so_none_desyncs(monkeypatch):
    (multi, ok, failed, times), _ = _run(monkeypatch, {
        "bbox": UK, "resolution": 1.0, "forecast_days": 1,
        "bboxes": {"uk_ireland": UK, "east_australia": EAST_AUS},
    }, fail_steps=(2,))
    assert failed >= 1 and ok > 0
    for rid, pts in multi.items():
        for p in pts:
            assert len(p["hourly"]["wind_speed_10m"]) == len(times), rid
            assert len(p["hourly"]["wind_direction_10m"]) == len(times), rid


def test_single_bbox_path_still_returns_a_plain_list(monkeypatch):
    """ingest_icon_wind_global and the mid-res tier call this path and index it as a list."""
    (pts, ok, _f, _t), _ = _run(monkeypatch, {"bbox": UK, "resolution": 1.0, "forecast_days": 1})
    assert isinstance(pts, list) and pts and pts[0]["__provider"] == "dwd"


def test_no_cycle_returns_empty_of_the_right_shape(monkeypatch):
    class _NoCycle(_FakeRequests):
        def head(self, url, timeout=None):
            return _Resp(status=404)

    req = _NoCycle()
    _install(monkeypatch, req)
    pts, _o, _f, times = F.fetch_global_coarse(
        {"bbox": UK, "resolution": 1.0, "forecast_days": 1, "bboxes": {"uk_ireland": UK}})
    assert pts == {} and times is None

    req2 = _NoCycle()
    _install(monkeypatch, req2)
    pts2, _o, _f, _t = F.fetch_global_coarse({"bbox": UK, "resolution": 1.0, "forecast_days": 1})
    assert pts2 == []


def test_regions_get_genuinely_different_wind(monkeypatch):
    """Guards the failure this grid makes easy: every region silently sharing one index map."""
    (multi, _ok, _f, _t), _ = _run(monkeypatch, {
        "bbox": UK, "resolution": 1.0, "forecast_days": 1,
        "bboxes": {"uk_ireland": UK, "east_australia": EAST_AUS},
    })
    uk = [p["hourly"]["wind_speed_10m"][0] for p in multi["uk_ireland"]]
    au = [p["hourly"]["wind_speed_10m"][0] for p in multi["east_australia"]]
    assert set(uk) != set(au), "both regions returned the same values — shared index map?"

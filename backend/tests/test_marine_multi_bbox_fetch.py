"""MULTI-BBOX GFS-Wave fetch: N regions for ONE region's download cost.

Twin of test_wind_multi_bbox_fetch, on the lane with the worst measured instance: GFS marine for
uk_ireland and east_australia sat 448.2 h (18.7 days) behind, and the serve path degraded silently
(2 deg global_mid fall-through, and a live per-request upstream fetch respectively).

Marine is the harder port -- 12 variables, energy-weighted BLOCK means, per-partition confidence --
so EQUIVALENCE is the assertion that matters most: the block-mean helpers run for real against a
synthetic global field, and every sampled value in multi mode must equal the single-bbox result
exactly. A restructure that quietly changes a direction blend would be a physics defect wearing a
performance costume.

pygrib has no Windows wheel, so numpy/requests/pygrib are injected as fakes; the sampling and
block-mean code under test is real.
"""
import sys
import types
from datetime import datetime, timezone

import numpy as np
import pytest

from services import noaa_gfs_wave_fetcher as F

GLAT = np.arange(90.0, -90.01, -0.5)
GLON = np.arange(0.0, 360.0, 0.5)


def _field(seed):
    la = GLAT[:, None]
    lo = GLON[None, :]
    return (np.sin(np.radians(la * 1.7)) * 6.0 + np.cos(np.radians(lo * 2.3)) * 4.0 + seed).astype(float)


# One distinct field per message, in OM_ORDER; directions forced into a plausible 0..360 range.
FIELDS = []
for _i, _om in enumerate(F.OM_ORDER):
    _f = _field(float(_i))
    if "direction" in _om:
        _f = (_f * 17.0) % 360.0
    elif "height" in _om:
        _f = np.abs(_f) * 0.4
    else:
        _f = np.abs(_f) + 4.0
    FIELDS.append(_f)


class _Msg:
    def __init__(self, values):
        self.values = values

    def latlons(self):
        a, b = np.meshgrid(GLAT, GLON, indexing="ij")
        return a, b


class _Grbs:
    def __init__(self, fail):
        self._fail = fail

    def read(self):
        if self._fail:
            raise RuntimeError("decode failed")
        return [_Msg(f) for f in FIELDS]

    def close(self):
        pass


# WS-CAN-0017: the double must honour the Range it is handed. It used to answer a
# `bytes=0-999` request with 8 bytes — a response no real server gives, and exactly the
# shape the new length check exists to reject. A fixture that cannot occur disarms the
# guard downstream, so the fixture is fixed, never the guard.
def _range_len(headers, default=8):
    """Bytes implied by a `bytes=a-b` Range header (inclusive), else `default`."""
    rng = (headers or {}).get("Range", "") if headers else ""
    if rng.startswith("bytes=") and "-" in rng:
        a, _, b = rng[6:].partition("-")
        if a.isdigit() and b.isdigit():
            return int(b) - int(a) + 1
    return default


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


IDX_TEXT = "".join(
    f"{i+1}:{i*1000}:d=2026073112:{tok}:{lvl}:anl:\n"
    for i, ((tok, lvl), _om, _u) in enumerate(F.IDX_TO_OM)
) + f"{len(F.IDX_TO_OM)+1}:{len(F.IDX_TO_OM)*1000}:d=2026073112:TMP:surface:anl:\n"


class _FakeRequests:
    def __init__(self):
        self.range_gets = 0
        self.idx_gets = 0

    def head(self, url, timeout=None):
        return _Resp(status=200)

    def get(self, url, headers=None, timeout=None):
        if url.endswith(".idx"):
            self.idx_gets += 1
            return _Resp(IDX_TEXT)
        self.range_gets += 1
        return _Resp(b"\x00" * _range_len(headers, 8))


class _FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)


def _install(monkeypatch, req, fail_steps=()):
    state = {"n": 0}

    def _open(path):
        step = state["n"]
        state["n"] += 1
        return _Grbs(fail=(step in set(fail_steps)))

    fake = types.ModuleType("pygrib")
    fake.open = _open
    monkeypatch.setitem(sys.modules, "pygrib", fake)
    monkeypatch.setitem(sys.modules, "requests", req)
    monkeypatch.setattr(F, "datetime", _FrozenDatetime)


UK = {"west": -11.0, "south": 49.0, "east": 1.0, "north": 59.0}
EAST_AUS = {"west": 150.0, "south": -38.0, "east": 156.0, "north": -25.0}
HAWAII = {"west": -161.0, "south": 18.0, "east": -154.0, "north": 23.0}


def _run(monkeypatch, payload, fail_steps=()):
    req = _FakeRequests()
    _install(monkeypatch, req, fail_steps)
    return F.fetch_global_coarse(payload), req


def test_multi_region_output_is_identical_to_single_region(monkeypatch):
    """THE EQUIVALENCE, on the two regions that were actually starved. Every one of the 12 variables,
    including the energy-weighted block-mean directions and the partition confidences, must match the
    per-region path exactly."""
    days = 1
    single = {}
    for rid, bb in (("uk_ireland", UK), ("east_australia", EAST_AUS), ("hawaii", HAWAII)):
        (pts, ok, failed, times), _ = _run(
            monkeypatch, {"bbox": bb, "resolution": 0.5, "forecast_days": days})
        assert ok > 0 and pts, rid
        single[rid] = pts

    (multi, m_ok, _, _), _ = _run(monkeypatch, {
        "bbox": UK, "resolution": 0.5, "forecast_days": days,
        "bboxes": {"uk_ireland": UK, "east_australia": EAST_AUS, "hawaii": HAWAII},
    })
    assert isinstance(multi, dict) and set(multi) == set(single)
    for rid in single:
        assert multi[rid] == single[rid], f"{rid} differs between multi and single mode"


def test_download_cost_is_independent_of_region_count(monkeypatch):
    """THE CLAIM, PINNED — why the rotation can be retired at all. 12 messages per step regardless
    of how many regions ride along."""
    days = 1
    _, one = _run(monkeypatch, {"bbox": UK, "resolution": 0.5, "forecast_days": days,
                                "bboxes": {"uk_ireland": UK}})
    _, many = _run(monkeypatch, {
        "bbox": UK, "resolution": 0.5, "forecast_days": days,
        "bboxes": {f"r{i}": bb for i, bb in enumerate([UK, EAST_AUS, HAWAII] * 3)},
    })
    assert one.range_gets == many.range_gets, (
        f"1 region = {one.range_gets} range GETs, 9 regions = {many.range_gets} — cost scaled with regions")
    assert one.idx_gets == many.idx_gets


def test_a_failed_step_pads_every_region_so_none_desyncs(monkeypatch):
    """A partial pad leaves one region's 12 series shorter than `times`, shifting every later value
    onto the wrong timestamp."""
    (multi, ok, failed, times), _ = _run(monkeypatch, {
        "bbox": UK, "resolution": 0.5, "forecast_days": 1,
        "bboxes": {"uk_ireland": UK, "east_australia": EAST_AUS},
    }, fail_steps=(2,))
    assert failed == 1 and ok > 0
    for rid, pts in multi.items():
        for p in pts:
            for om, series in p["hourly"].items():
                if om == "time":
                    continue
                assert len(series) == len(times), f"{rid}/{om} desynced"


def _rc_of(lat, lon):
    """The (row, col) the fetcher's nearest-neighbour map would pick for a coordinate."""
    r = int(np.abs(GLAT - lat).argmin())
    c = int(np.abs(GLON - (lon % 360.0)).argmin())
    return r, c


def test_block_means_are_actually_CONSUMED_not_merely_available(monkeypatch):
    """ATTACHMENT != CONSUMPTION — a gap this repo has been bitten by before, and one these tests
    could not see on their own.

    test_noaa_wave_blockmean.py imports the energy-weighted helpers from _fetch_common and proves
    them correct in isolation; no test drove fetch_global_coarse with a decodable field, so nothing
    asserted the fetcher CALLS them. Verified by mutation: replacing
    `energy_mean_direction_block(...)` with the raw `arr[r, c]` centre sample kept all 57 tests in
    the four block-mean suites GREEN. The equivalence test above cannot see it either — a change
    inside the shared sampling code moves multi and single modes identically.

    These call sites are exactly what the multi-bbox restructure moved, so they get a guard here:
    the emitted value must equal the helper's result, and must NOT equal the centre point.
    """
    from services._fetch_common import energy_mean_height_block

    res = 0.5
    (pts, ok, _, _), _ = _run(monkeypatch, {"bbox": UK, "resolution": res, "forecast_days": 1})
    assert ok > 0 and pts
    half = max(1, int(round(res / 0.25 / 2.0)))

    hi = F.OM_ORDER.index("wave_height")
    h_field = FIELDS[hi]

    # 1. HEIGHT: exact equality with the helper the fetcher is supposed to call.
    checked = 0
    for p in pts[:25]:
        r, c = _rc_of(p["latitude"], p["longitude"])
        expected = energy_mean_height_block(h_field, r, c, half, True)
        got = p["hourly"]["wave_height"][0]
        if expected != expected:            # NaN -> fetcher emits None
            assert got is None
        else:
            assert got == round(float(expected), 4), (
                f"wave_height at ({p['latitude']},{p['longitude']}) = {got}, "
                f"block-mean helper says {round(float(expected), 4)}")
            checked += 1
    assert checked > 0, "no non-NaN points exercised — the assertion proved nothing"

    # 2. DIRECTIONS: must differ from the raw centre sample. If any call site regressed to
    #    `arr[r, c]`, every value would match the centre exactly and this fails.
    for om in [o for o in F.OM_ORDER if o.endswith("_direction")]:
        arr = FIELDS[F.OM_ORDER.index(om)]
        differs = 0
        total = 0
        for p in pts[:25]:
            r, c = _rc_of(p["latitude"], p["longitude"])
            got = p["hourly"][om][0]
            raw = round(float(arr[r, c]), 4)
            if got is None:
                continue
            total += 1
            if abs(got - raw) > 1e-6:
                differs += 1
        assert total > 0, f"{om}: no values emitted"
        assert differs > total // 2, (
            f"{om}: {differs}/{total} values differ from the raw centre sample — "
            "the fetcher looks like it is point-sampling instead of block-averaging")


def test_single_bbox_path_still_returns_a_plain_list(monkeypatch):
    """ingest_gfs_marine_global and the mid-res tier both call the single-bbox path as a list."""
    (pts, ok, _, _), _ = _run(monkeypatch, {"bbox": UK, "resolution": 0.5, "forecast_days": 1})
    assert isinstance(pts, list) and pts
    assert pts[0]["__provider"] == "noaa"
    assert "wave_height" in pts[0]["hourly"]


def test_no_cycle_returns_empty_of_the_right_shape(monkeypatch):
    class _NoCycle(_FakeRequests):
        def head(self, url, timeout=None):
            return _Resp(status=404)

    req = _NoCycle()
    _install(monkeypatch, req)
    pts, _, _, times = F.fetch_global_coarse(
        {"bbox": UK, "resolution": 0.5, "forecast_days": 1, "bboxes": {"uk_ireland": UK}})
    assert pts == {} and times is None

    req2 = _NoCycle()
    _install(monkeypatch, req2)
    pts2, _, _, _ = F.fetch_global_coarse({"bbox": UK, "resolution": 0.5, "forecast_days": 1})
    assert pts2 == []

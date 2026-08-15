"""
PER-REGION RESOLUTION in the GFS-Wave multi-bbox pass — the "downloaded the same 790 MB twice" fix.

WHY. A NOAA byte-range selects a GRIB *message*, and a message is the whole global 0.25 deg field,
so the bbox never touches the wire (2b0e1466). The pass could already sample many bboxes from one
download — but it forced ONE output resolution on all of them. That single scalar is the only reason
the 2 deg `global_mid` tile could not ride the 0.25 deg flagship pass, and instead re-downloaded the
identical f000-f336 set: ~790 MB and ~26 min, twice in one pilots run (measured, run 30748383857).

WHAT IS ACTUALLY AT RISK. Two things, and only one of them is visible in a point count:
  1. the AXES (how many points a region gets) — obvious, caught by shape;
  2. the BLOCK HALF-WIDTH used by every block-mean (`half = resolution / 0.25 / 2`) — invisible in
     shape, and wrong silently. A 2 deg tile aggregated with a 0.25 deg block width would report
     near-point samples under a 2 deg label: the exact "a cap safe for display lies as a sort key"
     shape, where the number looks fine and means something else.
So the load-bearing test here is `test_block_width_is_per_region_not_shared` — it compares the SAME
coordinate sampled by two regions of different resolution in ONE pass and requires the values to
differ. Share `half` again and that test, alone, goes red.

The decode stack (pygrib) lives only in the ingest lane, so it is stubbed. The source grid is a real
0.25 deg lattice, because block widths are meaningless on a toy grid.
"""
import sys
import types

import numpy as np
import pytest


# ── a real 0.25 deg source lattice (a window, not the globe — block widths just need room) ────────
_LATS = np.arange(30.0, 9.75, -0.25)          # 81 rows, north -> south (GRIB order)
_LONS = np.arange(-40.0, -19.75, 0.25)        # 81 cols
_GLAT = np.repeat(_LATS[:, None], len(_LONS), axis=1)
_GLON = np.repeat(_LONS[None, :], len(_LATS), axis=0)

# A field with CURVATURE. A linear ramp would defeat the whole test: a symmetric block mean over a
# linear field equals its centre value, so every block width would agree and a shared-`half`
# regression would sail through. The quadratic makes width observable.
_FIELD = ((np.arange(len(_LATS))[:, None] - 40.0) ** 2
          + (np.arange(len(_LONS))[None, :] - 40.0) ** 2).astype(float)

_IDX_KEYS = [
    ("HTSGW", "surface"), ("PERPW", "surface"), ("DIRPW", "surface"), ("WVHGT", "surface"),
    ("SWELL", "1 in sequence"), ("SWELL", "2 in sequence"), ("WVPER", "surface"),
    ("SWPER", "1 in sequence"), ("SWPER", "2 in sequence"), ("WVDIR", "surface"),
    ("SWDIR", "1 in sequence"), ("SWDIR", "2 in sequence"),
]


class _Msg:
    def __init__(self):
        self.values = _FIELD.copy()

    def latlons(self):
        return _GLAT, _GLON


class _Grbs:
    def read(self):
        return [_Msg() for _ in range(12)]

    def close(self):
        pass


@pytest.fixture
def fetcher(monkeypatch):
    import services.noaa_gfs_wave_fetcher as f

    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: _Grbs()))
    monkeypatch.setattr(f, "_pick_cycle",
                        lambda _rq, now, _mf: (now.replace(minute=0, second=0, microsecond=0),
                                               "https://stub/gfswave."))
    idx = "\n".join(f"{i + 1}:{i * 1000}:d=2026080200:{v}:{l}:anl:"
                    for i, (v, l) in enumerate(_IDX_KEYS))

    def _get(url, **kw):
        if url.endswith(".idx"):
            return types.SimpleNamespace(text=idx, status_code=200)
        # WS-CAN-0017: honour the Range handed to us. A fixed 8 bytes for a `bytes=0-999` request
        # is a response no real server gives, and it is exactly what `_fetch_message_bytes` now
        # rejects. Fix the fixture, never the guard.
        rng = (kw.get("headers") or {}).get("Range", "")
        n = 8
        if rng.startswith("bytes=") and "-" in rng:
            a, _, b = rng[6:].partition("-")
            if a.isdigit() and b.isdigit():
                n = int(b) - int(a) + 1
        return types.SimpleNamespace(status_code=206, content=b"\x00" * n)

    monkeypatch.setattr(__import__("requests"), "get", _get)
    return f


# Two bboxes over the SAME water, so a coordinate they share is sampled by both in one pass.
_BOX = {"west": -35.0, "south": 15.0, "east": -25.0, "north": 25.0}


def _payload(resolutions=None, resolution=2.0):
    p = {"bbox": dict(_BOX), "resolution": resolution, "forecast_days": 1,
         "bboxes": {"coarse": dict(_BOX), "fine": dict(_BOX)}, "output_path": ""}
    if resolutions:
        p["resolutions"] = resolutions
    return p


def _at(points, lat, lon):
    for p in points:
        if abs(p["latitude"] - lat) < 1e-6 and abs(p["longitude"] - lon) < 1e-6:
            return p
    raise AssertionError(f"({lat}, {lon}) not sampled")


# ── legacy: a payload without the map must behave exactly as before ───────────────────────────────

def test_payload_without_resolutions_is_unchanged(fetcher):
    """THE BYTE-IDENTICAL CONTRACT. Every caller that does not mix resolutions — including the whole
    single-bbox path — must keep getting one scalar resolution for every bbox."""
    regions, ok, _failed, _times = fetcher.fetch_global_coarse(_payload(resolution=2.0))

    assert ok > 0
    assert set(regions) == {"coarse", "fine"}
    # 10 deg span at 2 deg, endpoints inclusive -> 6 x 6.
    assert len(regions["coarse"]) == 36
    assert len(regions["fine"]) == 36, "without `resolutions` both bboxes must share the scalar"


def test_resolutions_map_gives_each_region_its_own_axes(fetcher):
    regions, _ok, _failed, _times = fetcher.fetch_global_coarse(
        _payload(resolutions={"fine": 0.5}))

    assert len(regions["coarse"]) == 36            # 2 deg  -> 6 x 6
    assert len(regions["fine"]) == 441             # 0.5 deg -> 21 x 21


def test_kill_switch_collapses_back_to_one_resolution(fetcher, monkeypatch):
    """NOAA_MULTI_RES=0 is the operator's way back to the pre-fold behaviour without a deploy."""
    monkeypatch.setenv("NOAA_MULTI_RES", "0")
    regions, _ok, _failed, _times = fetcher.fetch_global_coarse(
        _payload(resolutions={"fine": 0.5}))

    assert len(regions["coarse"]) == 36
    assert len(regions["fine"]) == 36, "the kill switch must ignore the resolutions map entirely"


# ── the load-bearing one: block width is per region, not shared ───────────────────────────────────

def test_block_width_is_per_region_not_shared(fetcher):
    """THE REGRESSION THAT SHAPE CANNOT SEE.

    `half` (= resolution / 0.25 / 2) sets how many source cells each output point averages: 4 for a
    2 deg tile, 1 for a 0.5 deg tile. Both regions sample the SAME coordinate here, so if `half`
    were still read from the shared scalar, the two would return the IDENTICAL value. Over a field
    with curvature they must not."""
    regions, _ok, _failed, _times = fetcher.fetch_global_coarse(
        _payload(resolutions={"fine": 0.5}))

    lat, lon = 21.0, -31.0                        # on both lattices, away from the bbox edges
    coarse = _at(regions["coarse"], lat, lon)["hourly"]["wave_height"][0]
    fine = _at(regions["fine"], lat, lon)["hourly"]["wave_height"][0]

    assert coarse is not None and fine is not None
    assert coarse != pytest.approx(fine, rel=1e-9), (
        f"same coordinate, 2 deg vs 0.5 deg block, identical value ({coarse}) — `half` is being "
        f"shared across regions, so one of these tiles is aggregated at the wrong width")


def test_unlisted_regions_keep_the_scalar(fetcher):
    """A partial map must not silently re-scale the regions it omits — that is how the flagship
    0.25 deg tiles would change grid the day global_mid joined their pass."""
    regions, _ok, _failed, _times = fetcher.fetch_global_coarse(
        _payload(resolutions={"fine": 0.5}, resolution=2.0))

    assert len(regions["coarse"]) == 36, "an omitted region must fall back to the scalar resolution"

"""The NOAA HRRR wind fetcher (services/noaa_hrrr_wind_fetcher.py): grid check, rotation flag, area mean, encoding,
cycle choice and the whole lane object, offline (a fake AWS and a fake decoder; no GRIB library needed).

Why each part matters (log 2026-10-09-hrrr-wind-lane.md):
  * the grid is read from the message's OWN section 3: a changed NOAA grid must be refused, not silently misplaced;
  * HRRR's winds are grid-relative (component flag 0x08): unrotated, they are 11-17 deg off at the coasts, the error
    Open-Meteo's gfs_hrrr carries (+0.47-0.69 kn vector RMSE against 101 NDBC buoys over 5 days);
  * each lattice cell is an AREA mean (scalar speed, vector direction), not a point sample (5.2 kn p95 of aliasing).
"""
import math
import struct
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from services import _hrrr_grid as hg
from services import noaa_hrrr_wind_fetcher as f


def _sm(v):
    """GRIB2 sign-magnitude int32."""
    return (0x80000000 | (-v)) if v < 0 else v


def grib_msg(nx=hg.NX, ny=hg.NY, la1=hg.LA1_DEG, lo1=hg.LO1_DEG + 360.0, flags=0x08, lov=262.5, dx=3000000,
             latin=38.5, template=30):
    s3 = bytearray(81)
    struct.pack_into(">IBBIBBH", s3, 0, 81, 3, 0, nx * ny, 0, 0, template)
    s3[14] = 6
    struct.pack_into(">II", s3, 30, nx, ny)
    struct.pack_into(">II", s3, 38, _sm(int(round(la1 * 1e6))), int(round(lo1 * 1e6)))
    s3[46] = flags
    struct.pack_into(">II", s3, 47, _sm(int(round(latin * 1e6))), int(round(lov * 1e6)))
    struct.pack_into(">II", s3, 55, dx, dx)
    s3[64] = 0x40
    struct.pack_into(">II", s3, 65, _sm(int(round(latin * 1e6))), _sm(int(round(latin * 1e6))))
    struct.pack_into(">II", s3, 73, _sm(-90000000), 0)
    s1 = bytearray(21)
    struct.pack_into(">IB", s1, 0, 21, 1)
    body = bytes(s1) + bytes(s3) + b"7777"
    return b"GRIB" + b"\x00\x00" + bytes([0, 2]) + struct.pack(">Q", 16 + len(body)) + body


def test_section3_reads_the_hrrr_grid():
    tmpl, nx, ny, la1, lo1, flags, lov, dx, dy, l1, l2 = f.grid_section(grib_msg())
    assert (tmpl, nx, ny) == (30, 1799, 1059)
    assert la1 == pytest.approx(21.138123) and lo1 == pytest.approx(237.280472) and lov == pytest.approx(262.5)
    assert (dx, dy) == (3000000, 3000000) and l1 == pytest.approx(38.5) and l2 == pytest.approx(38.5)


def test_grid_relative_flag_decides_the_rotation():
    assert f.check_grid(grib_msg(flags=0x08)) is True
    assert f.check_grid(grib_msg(flags=0x00)) is False


@pytest.mark.parametrize("kw", [{"nx": 1800}, {"lo1": 237.5}, {"lov": 265.0}, {"dx": 2500000}, {"latin": 40.0},
                                {"template": 0}])
def test_a_changed_grid_is_refused(kw):
    with pytest.raises(ValueError):
        f.check_grid(grib_msg(**kw))


def test_not_grib_is_refused():
    with pytest.raises(ValueError):
        f.grid_section(b"<html>404</html>" + b"\x00" * 64)


def test_area_mean_is_scalar_speed_along_the_vector_direction():
    # cell 0: two 10-kn winds 90 deg apart -> 10 kn toward 45 deg (a vector mean would read 7.07 kn);
    # cell 1: only NaN -> missing; cell 2: two opposed winds -> no direction, so a 0 vector.
    idx = np.array([0, 0, 1, 2, 2, -1])
    u = np.array([10.0, 0.0, np.nan, -5.0, 5.0, 99.0])
    v = np.array([0.0, 10.0, np.nan, 0.0, 0.0, 99.0])
    mu, mv = f.area_mean(u, v, idx, 3)
    assert math.hypot(mu[0], mv[0]) == pytest.approx(10.0) and mu[0] == pytest.approx(mv[0])
    assert np.isnan(mu[1]) and np.isnan(mv[1])
    assert (mu[2], mv[2]) == (0.0, 0.0)


def test_encoding_round_trips_to_a_fortieth_of_a_metre_per_second():
    # native m/s, step 0.05 (~0.1 kn); the serve lane converts with surf_rating.MS_TO_KT, the one knots constant
    a = np.array([[0.0, 12.34, -7.77], [np.nan, 1638.3, -0.04]])
    b = f.decode(f.encode(a), a.shape)
    assert np.isnan(b[1, 0])
    assert np.nanmax(np.abs(b - a)) <= 0.025 + 1e-4


IDX = """1:0:d=2026100912:REFC:entire atmosphere:3 hour fcst:
77:1000:d=2026100912:UGRD:10 m above ground:3 hour fcst:
78:3000:d=2026100912:VGRD:10 m above ground:3 hour fcst:
79:5000:d=2026100912:WIND:10 m above ground:2-3 hour max fcst:
"""


def test_wind_ranges_take_the_10m_pair_in_order():
    assert f.wind_ranges(IDX) == [("UGRD", 1000, 2999), ("VGRD", 3000, 4999)]
    with pytest.raises(RuntimeError):
        f.wind_ranges(IDX.replace("VGRD", "TMP"))


class FakeAWS:
    """HEAD/GET against an in-memory bucket: cycles listed in `cycles` publish f00..f48."""

    def __init__(self, cycles, max_f=48, fail_f=()):
        self.cycles, self.max_f, self.fail_f, self.gets = cycles, max_f, set(fail_f), []

    class R:
        def __init__(self, status, text="", content=b""):
            self.status_code, self.text, self.content = status, text, content

    def _parse(self, url):
        for cyc in self.cycles:
            pre = f._prefix(cyc)
            if url.startswith(pre):
                return cyc, int(url[len(pre):len(pre) + 2])
        return None, None

    def head(self, url, timeout=None):
        cyc, fh = self._parse(url)
        return self.R(200 if cyc is not None and fh <= self.max_f else 404)

    def get(self, url, headers=None, timeout=None):
        self.gets.append(url)
        cyc, fh = self._parse(url)
        if cyc is None or fh in self.fail_f:
            return self.R(404)
        if url.endswith(".idx"):
            return self.R(200, text=IDX)
        msg = grib_msg()
        start, end = map(int, headers["Range"].split("=")[1].split("-"))
        return self.R(206, content=(msg + b"\x00" * (end - start + 1))[: end - start + 1])


def test_pick_cycle_takes_the_newest_complete_extended_run():
    now = datetime(2026, 10, 9, 18, 40, tzinfo=timezone.utc)
    c12 = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)
    c06 = datetime(2026, 10, 9, 6, tzinfo=timezone.utc)
    assert f.pick_cycle(FakeAWS([c12, c06]), now) == c12            # 18Z not published yet
    assert f.pick_cycle(FakeAWS([c06]), now) == c06
    assert f.pick_cycle(FakeAWS([c12], max_f=30), now) is None      # f48 missing -> not a complete run


def test_build_lane_end_to_end(monkeypatch):
    """A uniform grid-relative wind (toward grid +y, 10 m/s) everywhere: every lattice node inside HRRR must read the
    EARTH-relative vector at its longitude, in native m/s; nodes off HRRR must be missing; a failed step is skipped."""
    cyc = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)
    n = hg.NX * hg.NY

    def fake_decode(msg):
        # check_grid ran on these bytes already; return U=0, V=10 m/s by call order (U first, then V)
        fake_decode.k += 1
        return np.zeros(n) if fake_decode.k % 2 == 1 else np.full(n, 10.0)
    fake_decode.k = 0
    monkeypatch.setattr(f, "decode_values", fake_decode)
    lane = f.build_lane({"max_f": 3}, requests=FakeAWS([cyc], fail_f={2}), now=cyc + timedelta(hours=7))
    assert lane["format"] == f.FORMAT and lane["cycle"] == "2026-10-09T12:00:00Z"
    assert lane["hours"] == ["2026-10-09T12:00:00Z", "2026-10-09T13:00:00Z", "2026-10-09T15:00:00Z"]
    assert lane["steps_failed"] == 1 and lane["horizon"] == "2026-10-09T15:00:00Z"
    la = lane["lattice"]
    shape = (3, la["nlat"], la["nlon"])
    U, V = f.decode(lane["u"], shape), f.decode(lane["v"], shape)

    def node(lat, lon):
        return int(round((lat - la["lat0"]) / la["res"])), int(round((lon - la["lon0"]) / la["res"]))
    r, c = node(27.75, -87.5)                                       # the Gulf eye's neighbourhood
    alpha = hg.rotation_rad(-87.5)
    assert lane["units"] == "m/s"
    assert U[0, r, c] == pytest.approx(10.0 * math.sin(alpha), abs=0.06)
    assert V[0, r, c] == pytest.approx(10.0 * math.cos(alpha), abs=0.06)
    r, c = node(45.0, -70.0)                                        # New England: alpha ~ +17 deg, u ~ +2.9 m/s
    assert U[0, r, c] > 2.5
    r, c = node(21.0, -100.0)                                       # south of HRRR's edge
    assert np.isnan(U[0, r, c])
    assert np.isfinite(U[0]).mean() == pytest.approx(0.75, abs=0.05)   # measured share on the real grid: 0.749

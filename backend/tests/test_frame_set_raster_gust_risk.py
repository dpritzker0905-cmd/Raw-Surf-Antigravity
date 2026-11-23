"""The ENS gust-risk raster set (gate gust-ens-risk-v1): dark by default, exact frames, the ENS grid moved to 180W, the window
checked on every member message, a partial ensemble refused. Offline: a fake fetch_step."""
import os
import sys
import threading
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import frame_binary as fb  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402
from services import frame_set_raster_gust_risk as gk  # noqa: E402
from services.weather_pipeline import ens_wind_fetch as ef  # noqa: E402

META = {"ni": 1440, "nj": 721, "lat_south": -90.0, "lat_north": 90.0, "lon_west": 180.0, "dlat": 0.25, "dlon": 0.25}


def test_registered_dark_with_its_own_switch(monkeypatch):
    sp = fsr.SPECS[gk.SET]
    assert sp["default_on"] is False and sp["env"] == "FRAME_RASTER_GUST_RISK"
    monkeypatch.delenv("FRAME_RASTER_GUST_RISK", raising=False)
    assert fsr.enabled(gk.SET) is False
    monkeypatch.setenv("FRAME_RASTER_GUST_RISK", "1")
    assert fsr.enabled(gk.SET) is True
    assert sp["fields"] == fb.GUST_RISK_FIELDS and sp["field"] == fb.GUST_P25_PCT
    assert sp["hours"][0] == 3 and sp["hours"][-1] == 360 and 147 not in sp["hours"]
    assert isinstance(fsr.make_source(sp, session=object()), gk.EnsGustRiskSource)


def test_one_model_on_its_own_range():
    sp = fsr.SPECS[gk.SET]
    assert sp["target"]["model"] == "ECMWF_ENS" and sp["upstream_provider"] == "ecmwf"
    assert "CC BY 4.0" in sp["license"] and "ECMWF" in sp["credit"]


def test_to_lattice_moves_the_origin_only():
    a = np.zeros((721, 1440))
    a[:, 0] = 7.0                                          # the first column of a grid starting at 0E
    out = gk.to_lattice(a, dict(META, lon_west=0.0))
    assert out[0, 720] == 7.0 and out[0, 0] == 0.0         # 0E sits at column 720 of a 180W lattice
    assert gk.to_lattice(a, META) is a                     # ECMWF open data already starts at 180W (-180)
    with pytest.raises(ValueError):
        gk.to_lattice(np.zeros((361, 720)), dict(META, dlat=0.5, dlon=0.5))


def _fake_fetch(values_by_member, step_range):
    def fetch_step(session, run, step, reduce_fn, params, base, decode_lock=None, **kw):
        assert decode_lock is not None                    # ecCodes is not thread-safe: the set's lock rides along
        stack = []
        for v in values_by_member:
            with decode_lock:
                stack.append(reduce_fn(np.full((721, 1440), v, dtype=np.float64), dict(META, step_range=step_range)))
        return {params[0]: np.stack(stack)}, {"has_cf": False}
    return fetch_step


def test_fetch_percent_planes_and_exact_frame(monkeypatch):
    vals = [10.0] * 20 + [13.0] * 20 + [18.0] * 5 + [30.0] * 5          # m/s; 25 kn = 12.861, 34 kn = 17.491, 48 kn = 24.693
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch(vals, "23-24"))
    src = gk.EnsGustRiskSource(fsr.SPECS[gk.SET], session=object())
    planes = src.fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)
    assert planes[fb.GUST_P25_PCT][0, 0] == 60.0 and planes[fb.GUST_P34_PCT][0, 0] == 20.0
    assert planes[fb.GUST_P48_PCT][0, 0] == 10.0
    sp = fsr.effective_spec(fsr.SPECS[gk.SET])
    run = datetime(2026, 11, 22, tzinfo=timezone.utc)
    raw, gz, chk = fsr.build_frame_multi(planes, run + timedelta(hours=24), run, sp)
    assert chk["bad"] == 0 and chk["max_abs_err"] == 0.0 and chk["missing"] == 0
    _h, fields = fb.decode_plane(gz)
    assert fields[fb.GUST_P34_PCT][5, 5] == 20.0


def test_wrong_window_refuses_the_step(monkeypatch):
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch([1.0] * 50, "21-24"))     # a 3 h window where 1 h is published
    src = gk.EnsGustRiskSource(fsr.SPECS[gk.SET], session=object())
    with pytest.raises(ValueError, match="window"):
        src.fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)


def test_partial_ensemble_refused(monkeypatch):
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch([1.0] * 49, "23-24"))
    src = gk.EnsGustRiskSource(fsr.SPECS[gk.SET], session=object())
    with pytest.raises(ValueError, match="members"):
        src.fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)


def test_ens_fetch_runs_every_decode_under_the_given_lock(monkeypatch):
    from services.weather_pipeline import eval_grib2 as g2
    held = []
    lock = threading.Lock()

    class R:
        status_code = 206
        content = b"x"
    monkeypatch.setattr(ef, "_get", lambda *a, **k: R())
    monkeypatch.setattr(g2, "decode_span", lambda buf, sk, w, prefer="auto": held.append(lock.locked()) or
                        {k: (np.zeros((2, 2)), {}) for k in w})
    out = {"10fg": [None, None]}
    ef._read_file(None, "u", [("10fg", 1), ("10fg", 2)], [(0, 1), (10, 1)], out, lambda a, m: a, "eccodes", 0,
                  {1: 0, 2: 1}, decode_lock=lock)
    assert held == [True, True]
    held.clear()
    ef._read_file(None, "u", [("10fg", 1)], [(0, 1)], {"10fg": [None]}, lambda a, m: a, "eccodes", 0, {1: 0})
    assert held == [False]                                 # no lock given: unchanged behaviour

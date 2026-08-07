"""
test_ecmwf_period_bands_decode.py — make the period-band ON path actually EXECUTE.

WHY THIS EXISTS
---------------
`9553991d` shipped the band fetch behind `ECMWF_PERIOD_BANDS`, default off. Its tests covered
`layer_params()` and `period_bands_enabled()` — the request-shaping half — and nothing else. The
DECODE loop and the `_assemble` band emission run ONLY with the flag on, and no run has ever had it
on. `test_ecmwf_euro.py`'s own header says the quote: the real fetch/decode "is verified on Render",
which means it is not verified here at all.

Shipping inert was right. Leaving the ON path unexercised is this repo's single most recorded
failure — `period_bands.py` itself sat imported-by-nothing, and the local-size rollout was "written
down, never run". A flag whose ON branch has never executed is not a feature behind a switch; it is
untested code with a switch in front of it.

⛔ THE HIGH-RISK CASE, and the reason this file leads with it. `times_dt` for waves is the
intersection of the HEIGHT and DIRECTION messages only — bands are deliberately NOT required, so a
cycle missing one band still ingests. That makes series ALIGNMENT the thing to prove: if a band is
absent at one valid time, its series must carry `None` AT THAT INDEX and keep every other hour in
place. Get it wrong and one hour's band height is silently attributed to another hour — no error, no
log, a wrong sea state.

Stubs `pygrib` and the ECMWF client, so it runs offline in every CI lane rather than only on a box
that happens to have a GRIB decoder.
"""
import os
import sys
import types
from datetime import datetime, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import ecmwf_opendata_fetcher as f  # noqa: E402

pytest.importorskip("numpy")
import numpy as np  # noqa: E402

# A small descending-latitude grid: ECMWF stores north-down, and `build_regular_nn` keys off that.
_LATS = np.array([40.0, 35.0, 30.0])
_LONS = np.array([0.0, 5.0, 10.0])
_T0 = datetime(2026, 8, 2, 0, 0, 0)
_T1 = _T0 + timedelta(hours=3)


class _FakeMsg:
    def __init__(self, short_name, valid_date, fill):
        self.shortName = short_name
        self.validDate = valid_date
        self._fill = fill

    @property
    def values(self):
        return np.full((_LATS.size, _LONS.size), self._fill, dtype=float)

    def latlons(self):
        return np.meshgrid(_LONS, _LATS)[1], np.meshgrid(_LONS, _LATS)[0]


class _FakeGrbs:
    def __init__(self, msgs):
        self._msgs = msgs

    def __iter__(self):
        return iter(self._msgs)

    def close(self):
        pass


def _install(monkeypatch, msgs):
    """Stub pygrib + the ECMWF client so the real decode loop runs on messages we control."""
    fake_pygrib = types.ModuleType("pygrib")
    fake_pygrib.open = lambda path: _FakeGrbs(msgs)
    monkeypatch.setitem(sys.modules, "pygrib", fake_pygrib)

    class _FakeClient:
        # ⚠️ EVERY call, not just the last. The fetcher now issues TWO retrieves when the ensemble
        # is on (deterministic + members), so a single `last_params` slot silently describes only
        # the second one.
        all_params = []

        def __init__(self, *a, **k):
            pass

        def retrieve(self, **kw):
            # ASSERT THE SETUP LANDED: the decode is only meaningful if the REQUEST carried the
            # bands. Without this the test could pass on a request that never asked for them.
            _FakeClient.last_params = list(kw.get("param") or [])
            _FakeClient.all_params = _FakeClient.all_params + [list(kw.get("param") or [])]
            open(kw["target"], "wb").write(b"GRIB-stub")
            return None

    fake_od = types.ModuleType("ecmwf.opendata")
    fake_od.Client = _FakeClient
    monkeypatch.setitem(sys.modules, "ecmwf.opendata", fake_od)
    monkeypatch.setitem(sys.modules, "ecmwf", types.ModuleType("ecmwf"))
    sys.modules["ecmwf"].opendata = fake_od
    return _FakeClient


def _payload():
    return {"bbox": {"south": 30.0, "north": 40.0, "west": 0.0, "east": 10.0},
            "resolution": 5.0, "forecast_days": 1, "layer": "waves"}


def _base_msgs():
    """swh + mwd at two valid times — the pair `times_dt` is built from."""
    return [_FakeMsg("swh", _T0, 2.0), _FakeMsg("mwd", _T0, 270.0),
            _FakeMsg("swh", _T1, 3.0), _FakeMsg("mwd", _T1, 280.0)]


def test_flag_off_emits_no_band_series_at_all(monkeypatch):
    """Inert means inert: with the flag off the payload shape is what it was before the bands."""
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    _install(monkeypatch, _base_msgs())
    points, ok, failed, times = f.fetch_global_coarse(_payload())
    assert points and times, "the stub did not produce a decodable fetch"
    hourly = points[0]["hourly"]
    assert not [k for k in hourly if k.startswith("wave_band_")], \
        f"band series emitted with the flag OFF: {[k for k in hourly if k.startswith('wave_band_')]}"
    assert "wave_height" in hourly and "wave_period" in hourly


def test_flag_on_decodes_and_emits_every_band(monkeypatch):
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    msgs = _base_msgs()
    for i, bp in enumerate(f.WAVE_PERIOD_BAND_PARAMS):
        msgs += [_FakeMsg(bp, _T0, 0.5 + i * 0.1), _FakeMsg(bp, _T1, 1.5 + i * 0.1)]
    client = _install(monkeypatch, msgs)

    points, ok, failed, times = f.fetch_global_coarse(_payload())
    # THE SETUP CONTROL: some request must actually have asked for the bands.
    # ⚠️ ACROSS ALL RETRIEVES, not the last one. With ECMWF_WAVE_ENSEMBLE defaulting ON the fetcher
    # issues TWO requests — the deterministic one (which carries the bands) and a member request for
    # `swh` alone — so `last_params` records the ensemble and this control reported "the request
    # never carried the bands" for a run in which it plainly did. "The last request" stopped being a
    # well-defined thing the moment a second one existed.
    requested = {p for call in client.all_params for p in call}
    assert set(f.WAVE_PERIOD_BAND_PARAMS).issubset(requested), \
        f"no request carried the bands: {client.all_params}"

    hourly = points[0]["hourly"]
    units = points[0].get("hourly_units") or points[0].get("units") or {}
    for i, bp in enumerate(f.WAVE_PERIOD_BAND_PARAMS):
        key = f"wave_band_{bp}"
        assert key in hourly, f"{key} missing from the emitted payload"
        assert len(hourly[key]) == len(times), \
            f"{key} has {len(hourly[key])} values for {len(times)} times — SERIES MISALIGNED"
        assert hourly[key] == [pytest.approx(0.5 + i * 0.1), pytest.approx(1.5 + i * 0.1)]
        # ★ A series with no declared unit is a number that cannot say what it is — the same class
        # of gap as a borrowed bearing labelled as measured. Caught by mutation: dropping the units
        # while keeping the values left this file green until this assertion existed.
        assert units.get(key) == "m", \
            f"{key} is emitted with no unit ({units.get(key)!r}) — it is a significant height in m"


def test_a_band_MISSING_at_one_valid_time_does_not_shift_the_series(monkeypatch):
    """★★ THE ALIGNMENT GUARD. `times_dt` is built from swh ∩ mwd, so a band absent at one hour
    must produce None AT THAT INDEX — not a shorter list whose remaining values slide onto the
    wrong hours. A silent one-hour shift in band energy is a wrong sea state with no error."""
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    msgs = _base_msgs()
    for bp in f.WAVE_PERIOD_BAND_PARAMS:
        msgs.append(_FakeMsg(bp, _T1, 1.25))          # present at T1 ONLY — absent at T0
    _install(monkeypatch, msgs)

    points, ok, failed, times = f.fetch_global_coarse(_payload())
    assert len(times) == 2, f"expected both valid times to survive, got {times}"
    hourly = points[0]["hourly"]
    for bp in f.WAVE_PERIOD_BAND_PARAMS:
        series = hourly[f"wave_band_{bp}"]
        assert len(series) == 2, f"wave_band_{bp} length {len(series)} != 2 — the series SHIFTED"
        assert series[0] is None, f"wave_band_{bp}[0] should be None (band absent at T0)"
        assert series[1] == pytest.approx(1.25), f"wave_band_{bp}[1] lost its value to the shift"


def test_a_missing_band_does_not_drop_the_valid_time_for_everyone_else(monkeypatch):
    """Bands are deliberately NOT part of the `times_dt` intersection. A cycle that publishes swh
    and mwd but is short one band must still ingest the full time axis — otherwise adding the band
    fetch could SHRINK the forecast horizon, which would be a far worse regression than the feature
    is worth."""
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    msgs = _base_msgs() + [_FakeMsg("h1012", _T0, 0.9)]   # one band, one time, nothing else
    _install(monkeypatch, msgs)
    points, ok, failed, times = f.fetch_global_coarse(_payload())
    assert len(times) == 2, "a partial band set shortened the time axis"
    assert points[0]["hourly"]["wave_height"] == [pytest.approx(2.0), pytest.approx(3.0)]


def test_bands_never_leak_into_the_wind_layer(monkeypatch):
    """The band kinds are keyed by shortName. A `wind` fetch must not grow band series even with
    the flag on — the request does not ask for them and the decode must not invent them.

    ⚠️ THE FIRST VERSION OF THIS TEST WAS VACUOUS and a mutation caught it: it supplied only 10u/10v
    messages, so no band message existed to leak and the assertion could never fire. Disabling the
    waves-layer filter outright left it GREEN. A test whose PRECONDITION never occurs is the exact
    failure this repo has recorded five times over — so the band messages are now PRESENT in the
    stream, and the guard is that the wind decode ignores them."""
    monkeypatch.setenv("ECMWF_PERIOD_BANDS", "1")
    msgs = [_FakeMsg("10u", _T0, 5.0), _FakeMsg("10v", _T0, 5.0)]
    # THE PRECONDITION, made real: band messages are in the stream this fetch decodes.
    msgs += [_FakeMsg(bp, _T0, 0.7) for bp in f.WAVE_PERIOD_BAND_PARAMS]
    _install(monkeypatch, msgs)
    payload = _payload()
    payload["layer"] = "wind"
    points, ok, failed, times = f.fetch_global_coarse(payload)
    assert points, "wind fetch produced nothing"
    hourly = points[0]["hourly"]
    assert not [k for k in hourly if k.startswith("wave_band_")], \
        f"band series leaked into a WIND payload: {[k for k in hourly if k.startswith('wave_band_')]}"
    assert set(hourly) == {"time", "wind_speed_10m", "wind_direction_10m"}, \
        f"the wind payload grew unexpected keys: {sorted(hourly)}"

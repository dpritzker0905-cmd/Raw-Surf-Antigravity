"""F-05 part 2: CMEMS global-wave products carry the bulletin they came from, or no claim at all.

The fixture is the REAL native listing read on 2026-09-26 (data starts 09-20 00Z .. 10-04 12Z, the
bulletin tags exactly as listed), and the live check the same day resolved 2026-09-25T12Z against a
window ending at ARCO's published end_datetime (2026-10-05T00Z). No test here touches the network.
"""
import json
import sys
from datetime import datetime, timedelta, timezone

import pytest

from services import cmems_run_identity as cri
from services.weather_pipeline.cycle_provenance import cycle_from_points

DS = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
URI = ("https://s3.waw3-1.cloudferro.com/mdl-native-14/native/GLOBAL_ANALYSISFORECAST_WAV_001_027/"
       "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411")
UTC = timezone.utc


def _t(*a):
    return datetime(*a, tzinfo=UTC)


def _key(start, bulletin):
    return (f"native/GLOBAL_ANALYSISFORECAST_WAV_001_027/{DS}_202411/{start:%Y/%m}/"
            f"mfwamglocep_{start:%Y%m%d%H}_R{bulletin:%Y%m%d}_{bulletin:%H}H.nc")


def _listing_2026_09_26():
    """As listed: each older data date carries the next day's bulletin; 09-24 12Z onward is R25_12H."""
    keys, s = [], _t(2026, 9, 20, 0)
    while s <= _t(2026, 10, 4, 12):
        if s < _t(2026, 9, 24, 12):
            b = (s + timedelta(days=1)).replace(hour=s.hour)
        else:
            b = _t(2026, 9, 25, 12)
        keys.append(_key(s, b))
        s += timedelta(hours=12)
    return keys


def _axis(a, b, step=3):
    out, t = [], a
    while t <= b:
        out.append(t.strftime("%Y-%m-%dT%H:%M:%SZ"))
        t += timedelta(hours=step)
    return out


SERVED_FIRST = _t(2026, 9, 25, 18)        # production window: now - 6 h
ARCO_END = _t(2026, 10, 5, 0)             # the STAC end_datetime read 2026-09-26


@pytest.fixture(autouse=True)
def _fresh_memo():
    cri._memo.clear()
    yield
    cri._memo.clear()


def test_parse_native_key_reads_the_producer_name():
    assert cri.parse_native_key(_key(_t(2026, 10, 4, 12), _t(2026, 9, 25, 12))) == (
        _t(2026, 10, 4, 12), _t(2026, 9, 25, 12))
    assert cri.parse_native_key("native/x/2026/09/README.txt") is None
    assert cri.parse_native_key(None) is None


def test_real_listing_resolves_the_served_bulletin():
    run, reason = cri.run_from_native_keys(_listing_2026_09_26(), SERVED_FIRST, ARCO_END)
    assert (run, reason) == (_t(2026, 9, 25, 12), "ok")


def test_arco_one_bulletin_behind_is_not_claimed():
    """The served horizon is 12 h short of the listed bulletin: ARCO still holds the previous run."""
    run, reason = cri.run_from_native_keys(_listing_2026_09_26(), SERVED_FIRST, ARCO_END - timedelta(hours=12))
    assert run is None and reason.startswith("horizon_mismatch")


def test_new_bulletin_on_disk_before_arco_rebuild_is_not_claimed():
    """R26_00H has landed natively (horizon +12 h) but the fetched data still ends at the old horizon."""
    keys = [k for k in _listing_2026_09_26() if cri.parse_native_key(k)[0] < _t(2026, 9, 25, 0)]
    s = _t(2026, 9, 25, 0)
    while s <= _t(2026, 10, 5, 0):
        keys.append(_key(s, _t(2026, 9, 26, 0)))
        s += timedelta(hours=12)
    run, reason = cri.run_from_native_keys(keys, SERVED_FIRST, ARCO_END)
    assert run is None and reason.startswith("horizon_mismatch")
    # ...and once ARCO serves the new horizon, the new bulletin is the one claimed.
    assert cri.run_from_native_keys(keys, SERVED_FIRST, ARCO_END + timedelta(hours=12)) == (
        _t(2026, 9, 26, 0), "ok")


def test_window_spanning_older_bulletins_is_not_claimed():
    run, reason = cri.run_from_native_keys(_listing_2026_09_26(), _t(2026, 9, 22, 3), ARCO_END)
    assert run is None and reason.startswith("mixed_bulletins")


def test_file_step_is_read_from_the_listing_not_assumed():
    keys, s = [], _t(2026, 9, 25, 0)
    while s <= _t(2026, 9, 30, 18):
        keys.append(_key(s, _t(2026, 9, 25, 0)))
        s += timedelta(hours=6)
    assert cri.run_from_native_keys(keys, _t(2026, 9, 25, 3), _t(2026, 10, 1, 0)) == (_t(2026, 9, 25, 0), "ok")


def test_too_little_listing_is_not_claimed():
    assert cri.run_from_native_keys([], SERVED_FIRST, ARCO_END) == (None, "too_few_native_files")


def _describe_dict(retired_newer=False):
    svc = {"service_name": "original-files", "uri": URI + "/"}
    part = lambda retired: {"retired_date": retired, "services": [{"service_name": "wmts", "uri": "x"}, svc]}
    versions = [{"label": "202411", "parts": [part(None)]}]
    if retired_newer:
        versions.append({"label": "209901", "parts": [
            {"retired_date": "2026-01-01", "services": [{"service_name": "original-files", "uri": "https://wrong"}]}]})
    return {"products": [{"datasets": [{"dataset_id": DS, "versions": versions}]}]}


def test_native_uri_comes_from_the_catalogue_and_skips_retired_versions():
    assert cri.native_files_uri(DS, describe=lambda **kw: _describe_dict(retired_newer=True)) == URI


class _Resp:
    def __init__(self, body):
        self.content = body.encode()

    def raise_for_status(self):
        pass


class _Session:
    """Serves the fixture listing as S3 ListObjectsV2 pages of 5, with continuation tokens."""
    def __init__(self, keys):
        self.keys, self.calls = keys, []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params)))
        match = [k for k in self.keys if k.startswith(params["prefix"])]
        i = int(params.get("continuation-token", "0"))
        page, nxt = match[i:i + 5], i + 5
        more = nxt < len(match)
        body = ('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                + "".join(f"<Contents><Key>{k}</Key></Contents>" for k in page)
                + f"<IsTruncated>{'true' if more else 'false'}</IsTruncated>"
                + (f"<NextContinuationToken>{nxt}</NextContinuationToken>" if more else "")
                + "</ListBucketResult>")
        return _Resp(body)


def test_listing_walks_month_folders_and_pages():
    sess = _Session(_listing_2026_09_26())
    keys = cri.list_native_keys(URI, SERVED_FIRST, ARCO_END, sess)
    assert sorted(keys) == sorted(k for k in _listing_2026_09_26()
                                  if "/2026/09/" in k or "/2026/10/" in k)
    assert {c[0] for c in sess.calls} == {"https://s3.waw3-1.cloudferro.com/mdl-native-14"}
    prefixes = {c[1]["prefix"] for c in sess.calls}
    assert prefixes == {f"native/GLOBAL_ANALYSISFORECAST_WAV_001_027/{DS}_202411/2026/09/",
                        f"native/GLOBAL_ANALYSISFORECAST_WAV_001_027/{DS}_202411/2026/10/"}
    assert any("continuation-token" in c[1] for c in sess.calls)   # paging exercised


def test_resolve_run_end_to_end_offline():
    iso, reason = cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END),
                                  describe=lambda **kw: _describe_dict(), session=_Session(_listing_2026_09_26()))
    assert (iso, reason) == ("2026-09-25T12:00:00+00:00", "ok")


def test_resolve_run_never_raises(monkeypatch):
    def boom(**kw):
        raise ConnectionError("catalogue down")
    assert cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END), describe=boom) == (None, "error:ConnectionError")
    monkeypatch.setenv("CMEMS_RUN_IDENTITY", "0")
    assert cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END), describe=boom) == (None, "disabled")


def test_stamp_is_all_or_nothing_and_cycle_provenance_reads_it():
    kw = dict(describe=lambda **k: _describe_dict(), session=_Session(_listing_2026_09_26()))
    pts = [{"latitude": 0.0}, {"latitude": 10.0}]
    cri.stamp_run(pts, _axis(SERVED_FIRST, ARCO_END), DS, **kw)
    assert cycle_from_points(pts) == {"model_run_time": _t(2026, 9, 25, 12), "model_run_time_status": "known"}

    kw["session"] = _Session(_listing_2026_09_26())
    pts = [{"latitude": 0.0}, {"latitude": 10.0}]
    cri.stamp_run(pts, _axis(SERVED_FIRST, ARCO_END - timedelta(hours=12)), DS, **kw)
    assert all("__model_run_time" not in p for p in pts)
    assert cycle_from_points(pts)["model_run_time_status"] == "missing"


def test_global_fetcher_subprocess_stamps_its_output(monkeypatch, tmp_path, capsys):
    """The production path is `copernicus_global_fetcher.py <payload>` as a subprocess; its main()
    must stamp the points it writes and report the outcome on the SUMMARY line the caller logs."""
    from services import copernicus_global_fetcher as cgf
    times = _axis(SERVED_FIRST, ARCO_END)
    monkeypatch.setattr(cgf, "fetch_global_coarse",
                        lambda payload: ([{"latitude": 0.0, "longitude": 0.0, "hourly": {"time": times}}], 1, 0, times))
    monkeypatch.setattr(cri, "resolve_run", lambda ds, t, **kw: ("2026-09-25T12:00:00+00:00", "ok")
                        if ds == DS and t == times else (None, "wrong_args"))
    out = tmp_path / "pts.json"
    monkeypatch.setattr(sys, "argv", ["x", json.dumps({"username": "u", "password": "p", "output_path": str(out)})])
    cgf.main()
    assert json.loads(out.read_text())[0]["__model_run_time"] == "2026-09-25T12:00:00+00:00"
    assert "run=2026-09-25T12:00:00+00:00 (ok)" in capsys.readouterr().out


def test_memo_serves_repeat_lanes_without_refetching():
    calls = {"describe": 0}

    def describe(**kw):
        calls["describe"] += 1
        return _describe_dict()
    sess = _Session(_listing_2026_09_26())
    for _ in range(3):
        assert cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END), describe=describe, session=sess)[1] == "ok"
    first_pass = len(sess.calls)
    assert calls["describe"] == 1 and first_pass > 0
    cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END), describe=describe, session=sess)
    assert len(sess.calls) == first_pass            # listing reused inside its TTL


def test_stale_memo_cannot_mis_stamp_a_newer_served_horizon():
    """ARCO rebuilt onto a newer bulletin while the memo still holds the old listing: the served
    horizon moved +12 h, so the old bulletin is refused rather than claimed."""
    kw = dict(describe=lambda **k: _describe_dict(), session=_Session(_listing_2026_09_26()))
    assert cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END), **kw)[1] == "ok"
    iso, reason = cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END + timedelta(hours=12)), **kw)
    assert iso is None and reason.startswith("horizon_mismatch")


def test_memo_expires(monkeypatch):
    monkeypatch.setattr(cri, "LISTING_TTL_S", 0.0)
    sess = _Session(_listing_2026_09_26())
    kw = dict(describe=lambda **k: _describe_dict(), session=sess)
    cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END), **kw)
    n = len(sess.calls)
    cri.resolve_run(DS, _axis(SERVED_FIRST, ARCO_END), **kw)
    assert len(sess.calls) == 2 * n


def _fake_cmems_subprocess(times):
    """Stands in for `copernicus_fetcher.py`: writes a real netCDF subset where the payload says."""
    import netCDF4

    def run(args, **kw):
        payload = json.loads(args[-1])
        path = f"{payload['output_directory']}/{payload['output_filename']}"
        with netCDF4.Dataset(path, "w") as nc:
            nc.createDimension("time", len(times))
            nc.createDimension("latitude", 2)
            nc.createDimension("longitude", 2)
            t = nc.createVariable("time", "f8", ("time",))
            t.units = "hours since 1970-01-01 00:00:00"
            t[:] = [(datetime.fromisoformat(x.replace("Z", "+00:00")) - _t(1970, 1, 1)).total_seconds() / 3600
                    for x in times]
            nc.createVariable("latitude", "f4", ("latitude",))[:] = [10.0, 10.1]
            nc.createVariable("longitude", "f4", ("longitude",))[:] = [-30.0, -29.9]
            nc.createVariable("VHM0", "f4", ("time", "latitude", "longitude"))[:, :, :] = 1.0

        class R:
            returncode, stdout, stderr = 0, "", ""
        return R()
    return run


@pytest.mark.parametrize("valid_time, expect_stamp", [(None, True), ("2026-09-27T12:00:00Z", False)])
def test_in_process_lane_stamps_ingestion_windows_only(monkeypatch, valid_time, expect_stamp):
    """`_fetch_sync` feeds island ingestion and the spot-box pre-warm (valid_time=None, 10-day windows
    that reach the horizon). A +-3 h client window can never prove a bulletin, so it must not even ask."""
    pytest.importorskip("netCDF4")
    import subprocess
    from services import copernicus_marine_service as cms
    times = _axis(SERVED_FIRST, ARCO_END)
    seen = []
    monkeypatch.setattr(cms, "_check_credentials", lambda: ("u", "p"))
    monkeypatch.setattr(subprocess, "run", _fake_cmems_subprocess(times))
    monkeypatch.setattr(cri, "resolve_run", lambda ds, t, **kw: (seen.append((ds, t)) or
                                                                  ("2026-09-25T12:00:00+00:00", "ok")))
    pts = cms._fetch_sync([10.0, 10.1], [-30.0, -29.9], 10, None, valid_time=valid_time)
    assert len(pts) == 2 and pts[0]["hourly"]["wave_height"][0] == 1.0
    if expect_stamp:
        assert seen == [(DS, times)]
        assert cycle_from_points(pts)["model_run_time_status"] == "known"
    else:
        assert seen == []
        assert all("__model_run_time" not in p for p in pts)

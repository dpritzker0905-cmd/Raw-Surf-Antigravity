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

META = {"ni": 1440, "nj": 721, "lat_south": -90.0, "lat_north": 90.0, "lon_west": 180.0, "dlat": 0.25, "dlon": 0.25,
        "decoder": "eccodes", "grib_id": dict(gk.PIN, tablesVersion=32, numberOfForecastsInEnsemble=51)}


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
    def fetch_step(session, run, step, reduce_fn, params, base, decode_lock=None, prefer="auto", **kw):
        assert prefer == "eccodes"                        # the pinned decoder: pygrib carries no window or identity
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
    src = _src()
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
    src = _src()
    with pytest.raises(ValueError, match="window"):
        src.fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)


def test_partial_ensemble_refused(monkeypatch):
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch([1.0] * 49, "23-24"))
    src = _src()
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


def _src(**kw):
    sp = dict(fsr.SPECS[gk.SET], target=dict(fsr.SPECS[gk.SET]["target"]))
    return gk.EnsGustRiskSource(sp, session=kw.get("session", object()))


# ---- guardrails for the hidden publish (the director, 2026-11-23) --------------------------------------------------
def test_g4_identity_pinned_and_logged_in_the_index_target(monkeypatch):
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch([10.0] * 50, "23-24"))
    src = _src()
    src.fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)
    prov = src.spec["target"]["provenance"]
    assert prov["centre"] == "ecmf" and prov["generatingProcessIdentifier"] == 161 and prov["decoder"] == "eccodes"
    assert "provenance" not in fsr.SPECS[gk.SET]["target"]           # the registered spec is never mutated


def test_g4_a_changed_identity_refuses_the_step(monkeypatch):
    monkeypatch.setitem(META, "grib_id", dict(META["grib_id"], generatingProcessIdentifier=162))
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch([10.0] * 50, "23-24"))
    with pytest.raises(ValueError, match="pinned"):
        _src().fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)


def test_g4_a_decode_without_identity_refuses_the_step(monkeypatch):
    monkeypatch.setitem(META, "grib_id", None)
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch([10.0] * 50, "23-24"))
    with pytest.raises(ValueError, match="identity"):
        _src().fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)


def test_g2_read_cap_counts_bytes_and_refuses_after_it():
    class R:
        def __init__(self, n):
            self.content = b"x" * n
            self.status_code = 200

    class Inner:
        def get(self, url, **kw):
            return R(600)
    src = _src(session=Inner())
    src.read_cap = 1000
    src.http.get("a")
    assert src.bytes_pulled == 600 and not src.exceeded
    src.http.get("b")                                                  # crosses the cap: recorded
    assert src.exceeded and "read cap" in src.exceeded
    with pytest.raises(gk.BudgetExceeded):
        src.http.get("c")                                              # and nothing more is read
    assert src.bytes_pulled == 1200


def test_g2_store_cap_refuses_the_frame_that_crosses_it(monkeypatch):
    monkeypatch.setattr(ef, "fetch_step", _fake_fetch([10.0] * 25 + [20.0] * 25, "23-24"))
    src = _src()
    src.store_cap = 10                                                 # bytes: any frame crosses it
    with pytest.raises(gk.BudgetExceeded, match="store cap"):
        src.fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 24)
    with pytest.raises(gk.BudgetExceeded):
        src.fetch(datetime(2026, 11, 22, tzinfo=timezone.utc), 27)   # every later step is refused at once


@pytest.mark.parametrize("text,state", [("Gate verdict: PASS (25 kn B1, B2)\n", "PASS"), ("x\nGate verdict: **FAIL**\n", "FAIL"),
                                        ("Gate verdict: VOID\n", "VOID"), ("no verdict line\n", "PENDING"),
                                        ("Gate verdict: maybe\n", "PENDING")])
def test_gate_state_reads_the_result_line(tmp_path, text, state):
    p = tmp_path / "r.md"
    p.write_text(text)
    assert gk.gate_state(str(p)) == state
    assert gk.gate_state(str(tmp_path / "missing.md")) == "PENDING"


def test_g1_display_only_on_the_flag_and_a_recorded_pass(tmp_path, monkeypatch):
    p = tmp_path / "r.md"
    p.write_text("Gate verdict: PASS\n")
    monkeypatch.delenv("GUST_RISK_DISPLAY", raising=False)
    assert gk.display_allowed(str(p)) is False                         # default off
    monkeypatch.setenv("GUST_RISK_DISPLAY", "1")
    assert gk.display_allowed(str(p)) is True
    p.write_text("Gate verdict: FAIL\n")
    assert gk.display_allowed(str(p)) is False
    assert gk.display_allowed(str(tmp_path / "none.md")) is False      # never scored -> hidden


def test_g1_no_client_code_reads_the_set():
    from pathlib import Path
    src = Path(__file__).resolve().parents[2] / "frontend" / "src"
    needles = ("gust_risk", "GUST_RISK", "gust_p25kn", "ECMWF_ENS/weather")
    hits = [str(p) for p in src.rglob("*.js") if any(s in p.read_text(encoding="utf-8", errors="ignore") for s in needles)]
    assert hits == [], f"a client path reads the hidden gust-risk set before the gate passes: {hits}"


def test_g5_and_slot_publish_blocked(tmp_path, monkeypatch):
    p = tmp_path / "r.md"
    monkeypatch.delenv("GUST_RISK_PUBLISH_HOURS_UTC", raising=False)
    at11 = datetime(2026, 11, 23, 11, 50, tzinfo=timezone.utc)
    assert gk.publish_blocked(at11, str(p)) is None                    # pending: publish (hidden)
    assert "daily slot" in gk.publish_blocked(datetime(2026, 11, 23, 4, 0, tzinfo=timezone.utc), str(p))
    assert gk.publish_blocked(datetime(2026, 11, 23, 15, 59, tzinfo=timezone.utc), str(p)) is None
    p.write_text("Gate verdict: FAIL\n")
    assert gk.publish_blocked(at11, str(p)).startswith("auto-disabled")
    p.write_text("Gate verdict: VOID\n")
    assert gk.publish_blocked(at11, str(p)).startswith("auto-disabled")


def _local_sink(tmp_path):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
    import publish_frame_images as pub
    return pub.LocalSink(str(tmp_path / "bucket"))


def test_g3_prune_removes_runs_and_indices_older_than_14_days(tmp_path):
    from services import frame_set as fs
    sink = _local_sink(tmp_path)
    pre = fs.set_prefix(gk.SPEC["target"])
    for path in (f"{pre}/20261101T000000Z/20261101T030000Z-aaa.bin", f"{pre}/index/20261101T000000Z-aaa.json",
                 f"{pre}/20261120T000000Z/20261120T030000Z-bbb.bin", f"{pre}/index/20261120T000000Z-bbb.json",
                 "budget/gust_risk_ens/20261001.json", "budget/gust_risk_ens/20261122.json"):
        sink.write(path, b"{}", "application/json", "no-cache")
    gone = gk.prune_old(sink, datetime(2026, 11, 23, 12, tzinfo=timezone.utc))
    assert sorted(gone) == sorted([f"{pre}/20261101T000000Z/20261101T030000Z-aaa.bin", f"{pre}/index/20261101T000000Z-aaa.json",
                                   "budget/gust_risk_ens/20261001.json"])
    assert sink.read(f"{pre}/index/20261120T000000Z-bbb.json") is not None


class _FakeSource:
    def __init__(self, exceed=False, pulled=5000):
        self.read_cap, self.exceeded, self.bytes_pulled, self.bytes_stored = 1e12, ("read cap: x" if exceed else None), pulled, 10


def _run_guarded(tmp_path, monkeypatch, source, result_text=None, hour=12):
    sink = _local_sink(tmp_path)
    res = tmp_path / "result.md"
    if result_text:
        res.write_text(result_text)
    monkeypatch.setenv("GUST_RISK_RESULT_FILE", str(res))
    monkeypatch.delenv("GUST_RISK_DISPLAY", raising=False)
    monkeypatch.delenv("GUST_RISK_PUBLISH_HOURS_UTC", raising=False)
    uploads, made = [], []

    class FakeFsr:
        @staticmethod
        def make_source(sp):
            made.append(sp)
            return source

        @staticmethod
        def publish(src, snk, uploader, log=print, spec=None):
            uploader([("p", b"x", "t", "c")])
            return {"status": "published", "bytes": 1}

    class FakePub:
        @staticmethod
        def _uploader(snk):
            return lambda jobs: uploads.extend(jobs)
    rc = gk.guarded_publish(None, fsr.SPECS[gk.SET], lambda a: sink, FakePub, FakeFsr, lambda n, r, strict=False: 0,
                            now=datetime(2026, 11, 23, hour, tzinfo=timezone.utc))
    return rc, uploads, made, sink


def test_guarded_publish_hidden_and_counts_the_day(tmp_path, monkeypatch):
    rc, uploads, made, sink = _run_guarded(tmp_path, monkeypatch, _FakeSource())
    assert rc == 0 and len(uploads) == 1 and made[0]["target"]["display"] is False and made[0]["target"]["gate"] == "PENDING"
    assert gk.day_used(sink, datetime(2026, 11, 23, tzinfo=timezone.utc)) == 5000


def test_guarded_publish_uploads_nothing_when_a_cap_is_reached(tmp_path, monkeypatch):
    rc, uploads, _m, _s = _run_guarded(tmp_path, monkeypatch, _FakeSource(exceed=True))
    assert rc == 1 and uploads == []


def test_guarded_publish_stops_when_the_day_is_spent(tmp_path, monkeypatch):
    sink = _local_sink(tmp_path)
    gk.add_day_used(sink, datetime(2026, 11, 23, tzinfo=timezone.utc), gk.READ_CAP_DAY)
    rc, uploads, made, _s = _run_guarded(tmp_path, monkeypatch, _FakeSource())
    assert rc == 1 and uploads == [] and made == []                     # nothing is even read


def test_guarded_publish_auto_disabled_by_a_recorded_fail(tmp_path, monkeypatch):
    rc, uploads, made, _s = _run_guarded(tmp_path, monkeypatch, _FakeSource(), result_text="Gate verdict: FAIL\n")
    assert rc == 0 and uploads == [] and made == []


# ---- regression 2026-11-23: the raster sets must import WITHOUT numpy (data-health-monitor's raster_set_freshness.py runs a
# system python3 that has none; #1202's top-level core import blinded the monitor to every raster set)
def test_raster_sets_and_the_freshness_monitor_import_without_numpy():
    import subprocess
    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    code = ("import sys; sys.modules['numpy'] = None; sys.path.insert(0, '.'); sys.path.insert(0, 'scripts'); "
            "from services import frame_set_raster as f; import raster_set_freshness; "
            "print('gust_risk_ens' in f.SPECS, len(f.SPECS['gust_risk_ens']['hours']))")
    out = subprocess.run([sys.executable, "-c", code], cwd=backend, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.strip() == "True 84"


def test_load_time_constants_equal_the_core():
    from services.weather_pipeline import ens_gust_risk_core as core
    assert gk.HOURS == tuple(core.native_steps(360)) and gk.THRESHOLDS_KN == core.THRESHOLDS_KN and gk.MEMBERS == core.MEMBERS
    assert fsr.SPECS[gk.SET]["hours"] == gk.HOURS

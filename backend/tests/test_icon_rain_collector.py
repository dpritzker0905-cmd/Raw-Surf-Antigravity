"""The ICON rain collector (research; nothing served): the pre-registered window, idempotence, the size cap, the domain cut, the
packed file, and the workflow's off switch. No network: DWD and the bucket are fakes."""
import datetime as dt
import io
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import icon_rain_collector as col  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]
UTC = dt.timezone.utc


def run(day):
    return dt.datetime(2026, 11, day, tzinfo=UTC)


def test_the_registered_leads_and_the_step_before_each():
    assert col.LEADS == (5, 6, 23, 24, 47, 48, 77, 78, 117, 120)   # f006/024/048/078 hourly; f120's step is 3 h (ICON past 78 h)
    assert col.object_key(run(19)) == "research/icon_tot_prec_us/2026111900.npz"
    assert col.tot_url(run(19), 6).endswith("/00/tot_prec/icon_global_icosahedral_single-level_2026111900_006_TOT_PREC.grib2.bz2")
    assert col.invar_url(run(19), "CLAT").endswith("/00/clat/icon_global_icosahedral_time-invariant_2026111900_CLAT.grib2.bz2")


def test_today_and_yesterday_are_tried_so_a_missed_day_is_recovered():
    now = dt.datetime(2026, 11, 19, 7, 40, tzinfo=UTC)
    assert col.candidate_cycles(now) == [run(18), run(19)]


def test_the_window_is_30_runs_from_the_first_stored_and_never_past_it():
    first = col.first_stored(["research/icon_tot_prec_us/2026111900.npz", "research/icon_tot_prec_us/2026112000.npz", "junk"])
    assert first == run(19)
    assert col.in_window(run(19) + dt.timedelta(days=29), first)
    assert not col.in_window(run(19) + dt.timedelta(days=30), first)
    assert col.in_window(run(1), None)                          # before the first run, anything starts it


def test_the_prefix_is_never_a_product_name_so_the_product_gc_never_lists_it():
    from services.weather_pipeline import product_object_gc as gc
    assert not gc.is_product_object(col.PREFIX.split("/")[0])
    assert not gc.is_product_object(col.object_key(run(19)))


def test_the_domain_cut_keeps_the_us_plus_margin_in_either_longitude_convention():
    clat = np.array([40.0, 40.0, 10.0, 60.0, 30.0])
    clon = np.array([-100.0, 260.0, -100.0, -100.0, 10.0])      # 260 E is 100 W
    assert col.domain_cells(clat, clon).tolist() == [0, 1]


def test_the_packed_file_holds_cells_centres_and_every_lead_as_float32():
    clat, clon = np.array([40.0, 41.0, 0.0]), np.array([-100.0, -99.0, 0.0])
    cells = col.domain_cells(clat, clon)
    body = col.pack(cells, clat, clon, {lead: np.full(3, float(lead)) for lead in col.LEADS})
    z = np.load(io.BytesIO(body))
    assert z["cell"].tolist() == [0, 1] and z["clat"].dtype == np.float32
    assert sorted(k for k in z.files if k.startswith("tp_")) == [f"tp_{lead:03d}" for lead in sorted(col.LEADS)]
    assert z["tp_120"].tolist() == [120.0, 120.0]


class _Store:
    def __init__(self, keys=()):
        self.keys, self.uploads = list(keys), {}

    def list_keys(self):
        return list(self.keys)

    def upload(self, key, body):
        self.uploads[key] = body
        self.keys.append(key)


def _fake_fetch(monkeypatch, fail=()):
    clat, clon = np.array([40.0, 41.0, 0.0]), np.array([-100.0, -99.0, 0.0])

    def fetch(_http, url):
        if any(f in url for f in fail):
            raise RuntimeError("HTTP 404")
        return url.encode()

    def decode(raw):
        u = raw.decode()
        if u.endswith("_CLAT.grib2.bz2"):
            return clat
        if u.endswith("_CLON.grib2.bz2"):
            return clon
        return np.full(3, 1.0)

    monkeypatch.setattr(col, "fetch", fetch)
    monkeypatch.setattr(col, "decode_grib", decode)


def test_collect_stores_new_runs_skips_stored_ones_and_is_idempotent(monkeypatch):
    _fake_fetch(monkeypatch)
    store = _Store(["research/icon_tot_prec_us/2026111800.npz"])
    now = dt.datetime(2026, 11, 19, 7, 40, tzinfo=UTC)
    recs = col.collect(None, store, now, log=lambda *_: None)
    assert [r["status"] for r in recs] == ["already stored", "stored"]
    assert list(store.uploads) == ["research/icon_tot_prec_us/2026111900.npz"] and recs[1]["cells"] == 2 and recs[1]["bytes"] > 0
    again = col.collect(None, store, now, log=lambda *_: None)          # a second invocation the same day uploads nothing
    assert [r["status"] for r in again] == ["already stored", "already stored"] and len(store.uploads) == 1


def test_collect_refuses_past_the_window_and_over_the_size_cap(monkeypatch):
    _fake_fetch(monkeypatch)
    store = _Store(["research/icon_tot_prec_us/2026100100.npz"])        # first run 49 days earlier
    recs = col.collect(None, store, dt.datetime(2026, 11, 19, 7, 40, tzinfo=UTC), log=lambda *_: None)
    assert all(r["status"].startswith("past the 30-day window") for r in recs) and not store.uploads
    monkeypatch.setattr(col, "MAX_BYTES", 10)
    store = _Store()
    recs = col.collect(None, store, dt.datetime(2026, 11, 19, 7, 40, tzinfo=UTC), log=lambda *_: None)
    assert all(r["status"].startswith("REFUSED") for r in recs) and not store.uploads


def test_one_runs_failure_does_not_stop_the_other_and_the_summary_logs_bytes(monkeypatch):
    _fake_fetch(monkeypatch, fail=("2026111800_",))
    store = _Store()
    recs = col.collect(None, store, dt.datetime(2026, 11, 19, 7, 40, tzinfo=UTC), log=lambda *_: None)
    assert recs[0]["status"].startswith("failed") and recs[1]["status"] == "stored"
    text = col.summary(recs)
    assert "| 2026111900 | stored | 2 |" in text and "nothing served" in text


def test_the_workflow_is_off_until_its_variable_and_passes_the_key_by_name_only():
    text = (REPO / ".github" / "workflows" / "icon-rain-collector.yml").read_text(encoding="utf-8")
    assert "if: ${{ vars.ICON_RAIN_COLLECT == '1' }}" in text
    assert "SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}" in text
    assert "environment: supabase-service" in text and "toJSON(vars)" not in text
    assert "render" not in text.lower().replace("render call", "")

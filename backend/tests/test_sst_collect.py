"""G4 SST collector (2026-11-17): backend/scripts/sst_collect.py + the sst-g4-collect workflow.

Offline only (a fake HTTP store in [t, 1, 16, 16] blosc chunks, as the real geoChunked store; no network). Pins: the station
rule (numeric WTMP, 60S..65N, the file's own column names); the cell pick (own cell, else the nearest ocean cell within 2,
else excluded); an all-land chunk the store never wrote (403) reads as land, a refused time axis fails loudly; a daily run is
keyed by the store's last step, holds the last 264 h at every station and is skipped when stored; the workflow is ON by
default with a '0' kill and holds the bucket key only in its two standard-library storage steps.
"""
import gzip
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sst_collect as sc  # noqa: E402

FILL = 9.969209968386869e36
LATEST = """#STN       LAT      LON  YYYY MM DD hh mm WDIR WSPD   GST WVHT  DPD APD MWD   PRES  PTDY  ATMP  WTMP  DEWP  VIS   TIDE
#text      deg      deg   yr mo day hr mn degT  m/s   m/s   m   sec sec degT   hPa   hPa  degC  degC  degC  nmi     ft
46221    33.86  -118.63  2026 11 18 03 00  MM    MM    MM  1.2  13   9 270     MM    MM    MM  18.4    MM   MM     MM
46025    33.75  -119.05  2026 11 18 03 00 290   5.0   6.0  1.1  12   8 280 1015.0    MM  16.0    MM    MM   MM     MM
51201    21.67  -158.12  2026 11 18 03 00  MM    MM    MM  1.9  14   9 310     MM    MM    MM  25.9    MM   MM     MM
SOUTH    -62.00   -60.00  2026 11 18 03 00  MM    MM    MM  1.9  14   9 310     MM    MM    MM   1.0    MM   MM     MM
"""


def test_the_station_rule():
    got = sc.parse_latest_obs(LATEST)
    assert [g[0] for g in got] == ["46221", "51201"]      # 46025: WTMP missing; SOUTH: south of 60S
    assert got[0][1:] == (33.86, -118.63, 18.4)


def test_the_cell_pick():
    j0, k0 = sc.cell_of(30.0, -120.0)
    assert sc.pick_cell(30.0, -120.0, lambda j, k: True)[:2] == (j0, k0)              # its own cell when it is ocean
    land_own = sc.pick_cell(30.0, -120.0, lambda j, k: (j, k) != (j0, k0))
    assert land_own is not None and land_own[:2] != (j0, k0) and land_own[2] < 15     # the nearest ocean neighbour
    assert sc.pick_cell(30.0, -120.0, lambda j, k: (j, k) == (j0 + 2, k0 + 2))[:2] == (j0 + 2, k0 + 2)
    assert sc.pick_cell(30.0, -120.0, lambda j, k: (j, k) == (j0 + 3, k0)) is None    # beyond 2 cells: excluded


class _Resp:
    def __init__(self, status, body=b"", js=None, text=""):
        self.status_code, self.content, self._js, self.text = status, body, js, text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._js


T0 = datetime(2026, 11, 10, tzinfo=timezone.utc)
TLEN, NT = 200, 400                                   # two time chunks; the window spans both


class _Http:
    """latest_obs + a geoChunked store: thetao[t, 0, j, k] = 10 + j/1000 + t/100 (degC), land where (j//16, k//16) == LAND."""

    def __init__(self, land_box=None, refuse_time=False):
        from numcodecs import Blosc
        self.codec = Blosc(cname="lz4", clevel=5, shuffle=1)
        self.comp = {"blocksize": 0, "clevel": 5, "cname": "lz4", "id": "blosc", "shuffle": 1}
        self.land_box, self.refuse_time, self.gets = land_box, refuse_time, []
        self.hours = np.array([(T0 - sc.EPOCH).total_seconds() / 3600 + i for i in range(NT)], dtype="<f4")

    def get(self, url, timeout=None):
        self.gets.append(url)
        if url == sc.LATEST_OBS:
            return _Resp(200, text=LATEST)
        name, key = url[len(sc.GEO) + 1:].split("/")
        if key == ".zarray":
            if name == "thetao":
                return _Resp(200, js={"chunks": [TLEN, 1, 16, 16], "dtype": "<f4", "compressor": self.comp,
                                      "shape": [NT, 1, sc.ROWS, sc.COLS]})
            return _Resp(200, js={"chunks": [NT], "dtype": "<f4", "compressor": self.comp, "shape": [NT]})
        if name == "time":
            return _Resp(403) if self.refuse_time else _Resp(200, self.codec.encode(self.hours.tobytes()))
        tc, _z, cy, cx = (int(x) for x in key.split("."))
        if (cy, cx) == self.land_box:
            return _Resp(403)                          # the store never wrote an all-land chunk
        t = np.arange(tc * TLEN, (tc + 1) * TLEN)[:, None, None, None]
        j = np.arange(cy * 16, cy * 16 + 16)[None, None, :, None]
        blk = (10 + j / 1000 + t / 100 + 0 * np.arange(16)[None, None, None, :]).astype("<f4")
        return _Resp(200, self.codec.encode(np.ascontiguousarray(blk).tobytes()))


def _run(tmp_path, mode="daily", http=None, existing=None):
    http = http or _Http()
    if existing is not None:
        (tmp_path / "existing_runs.json").write_text(json.dumps(existing))
    sc.main([mode, "--cache", str(tmp_path)], http=http, store=sc.GeoStore(http), now=T0)
    return http, json.loads((tmp_path / f"collect_report_sst_{mode}.json").read_text())


def test_a_daily_run_freezes_the_stations_and_keeps_264_hours(tmp_path):
    http, rep = _run(tmp_path)
    end = T0 + timedelta(hours=NT - 1)
    name = end.strftime("%Y%m%dT%H") + ".json.gz"
    assert rep["frozen"] and rep["stations"] == 2 and rep["run"] == name and rep["hours"] == 264
    st = json.loads((tmp_path / "sst_stations.json.new").read_text())
    assert [s["id"] for s in st["stations"]] == ["46221", "51201"] and st["excluded"] == []
    with gzip.open(tmp_path / "runs" / (name + ".new"), "rt") as fh:
        run = json.load(fh)
    assert run["store_end"] == end.strftime("%Y-%m-%dT%H:%M:%SZ") and run["n"] == 264 and run["step_h"] == 1
    s0 = st["stations"][0]
    v = run["values"]["46221"]
    assert len(v) == 264 and v[-1] == pytest.approx(10 + s0["j"] / 1000 + (NT - 1) / 100, abs=1e-3)
    assert v[0] == pytest.approx(10 + s0["j"] / 1000 + (NT - 264) / 100, abs=1e-3)   # spans the two time chunks


def test_an_all_land_box_excludes_its_station_and_a_refused_time_axis_fails(tmp_path):
    j, k = sc.cell_of(21.67, -158.12)
    http, rep = _run(tmp_path, http=_Http(land_box=(j // 16, k // 16)))
    st = json.loads((tmp_path / "sst_stations.json").read_text())
    assert [e["id"] for e in st["excluded"]] == ["51201"] and rep["stations"] == 1
    with pytest.raises(RuntimeError, match="time axis"):
        _run(tmp_path / "x", http=_Http(refuse_time=True))


def test_an_unchanged_store_is_skipped(tmp_path):
    end = (T0 + timedelta(hours=NT - 1)).strftime("%Y%m%dT%H")
    _http, rep = _run(tmp_path, existing=[f"{end}.json.gz"])
    assert "skipped" in rep and not list((tmp_path / "runs").glob("*.new"))


def test_the_workflow_is_on_by_default_with_a_kill_and_the_key_only_in_the_storage_steps():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "sst-g4-collect.yml").read_text(encoding="utf-8")
    assert "if: ${{ (vars.SST_G4_COLLECT || '1') != '0' }}" in yml
    steps = yml.split("\n      - ")[1:]
    with_key = [s for s in steps if "SUPABASE_SERVICE_ROLE_KEY" in s]
    assert len(with_key) == 2 and all("python3 -I -S backend/scripts/sst_bucket_io.py" in s for s in with_key)
    assert any("sst_collect.py daily" in s and "SUPABASE" not in s for s in steps)

"""Native 1/12-degree Copernicus currents on the surf boxes (2026-11-22, DARK): services/frame_set_raster_currents_native.py.

Offline only (an in-memory ARCO store, LocalSink). Pins: one dark set per pilot box with the world set's frame layout and the
direction byte at EVERY cell (index grid.flow_dir_stride = 1); the box snapped inward to the source lattice; the client's box
table equals the publisher's; ONE read per hour feeds every box and reads only the chunks the boxes touch; a published box
frame holds the source cells themselves; the script routes the bundle; the pilots step and the monitor carry the switch.
"""
import json
import math
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
import publish_raster_frames as script  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402
from services import frame_set_raster_currents as cur  # noqa: E402
from services import frame_set_raster_currents_native as nat  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CYCLE = datetime(2026, 11, 15, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in (nat.ENV, "FRAME_RASTER_BUDGET_S", "FRAME_MIN_COVERAGE", "FRAME_RASTER_ONE_BYTE", "FRAME_RASTER_DIR_BYTE"):
        monkeypatch.delenv(k, raising=False)


def test_one_dark_set_per_pilot_box_with_the_world_layout_and_a_direction_byte_per_cell():
    names = nat.names()
    assert len(names) == 14 and all(n in fsr.SPECS for n in names)
    for n in names:
        sp = fsr.spec_for(n)
        box = nat.box_of(n)
        assert fs.set_key(sp["target"]) == f"CMEMS/marine/currents/{box}_0p083"
        assert sp["env"] == nat.ENV and sp["default_on"] is False and not fsr.enabled(n)
        assert sp["bundle"] == "currents_native" and sp["dir_stride"] == 1 and tuple(sp["hours"]) == tuple(range(0, 241, 6))
        eff = fsr.effective_spec(sp)
        assert eff["fields"] == (fb.CURRENT_KN_BAND, fb.FLOW_DIR_BYTE) and eff["uv_convention"] == 1
        assert "uo/vo" in sp["source_dataset"] and "no regrid" in sp["source_dataset"]          # plain uo/vo, never SMOC utotal
        assert sp["credit"] == fsr.spec_for("currents")["credit"] and sp["license"] == fsr.spec_for("currents")["license"]
        assert isinstance(fsr.make_source(sp, session=object()), nat.NativeCurrentsSource)


def test_a_box_snaps_inward_to_the_source_lattice():
    (j0, j1, k0, k1), g = nat.box_window({"west": -76.1, "south": 37.5, "east": -69.0, "north": 44.6})
    assert (j0, k0) == (math.ceil((37.5 + 80) * 12), math.ceil((-76.1 + 180) * 12))
    w, s, e, n = g["bounds"]
    assert -76.1 <= w < -76.1 + 1 / 12 and s == 37.5 and e == -69.0 and 44.6 - 1 / 12 < n <= 44.6
    assert (g["cols"], g["rows"]) == (k1 - k0 + 1, j1 - j0 + 1)
    with pytest.raises(ValueError):
        nat.box_window({"west": -10.0, "south": -85.0, "east": 0.0, "north": -70.0})           # south of the source rows


def test_the_client_box_table_is_the_publishers():
    js = (ROOT / "frontend" / "src" / "components" / "map" / "currentNative.js").read_text(encoding="utf-8")
    table = js[js.index("NATIVE_BOXES = Object.freeze({"):]
    table = table[:table.index("});")]
    got = {m.group(1): tuple(float(x) for x in m.group(2).split(",")) for m in re.finditer(r"(\w+): \[([^\]]+)\]", table)}
    want = {box: tuple(round(x, 4) for x in nat.box_window(b)[1]["bounds"]) for box, b in nat._boxes().items()}
    assert got == want


class _Resp:
    def __init__(self, status, body=b"", js=None):
        self.status_code, self.content, self._js = status, body, js

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def json(self):
        return self._js


class _Http:
    """An in-memory ARCO store (chunk [1, 1, 512, 2048] blosc float32, as the real one); counts the uo chunk GETs."""

    def __init__(self, uo, vo, times_h):
        from numcodecs import Blosc
        self.codec = Blosc(cname="lz4", clevel=5, shuffle=1)
        self.comp = {"blocksize": 0, "clevel": 5, "cname": "lz4", "id": "blosc", "shuffle": 1}
        self.fields = {"uo": uo, "vo": vo}
        self.times = np.asarray(times_h, dtype="<f4")
        self.uo_chunks = []

    def get(self, url, timeout=None):
        name, key = url[len(cur.ARCO) + 1:].split("/")
        if key == ".zarray":
            if name in ("uo", "vo"):
                return _Resp(200, js={"chunks": [1, 1, 512, 2048], "dtype": "<f4", "compressor": self.comp,
                                      "shape": [len(self.times), 50, cur.SRC_ROWS, cur.SRC_COLS]})
            n = len(self.times) if name == "time" else 50
            return _Resp(200, js={"chunks": [n], "dtype": "<f4", "compressor": self.comp, "shape": [n]})
        if name == "time":
            return _Resp(200, self.codec.encode(self.times.tobytes()))
        if name == "elevation":
            return _Resp(200, self.codec.encode(np.linspace(-5000.0, -0.494, 50).astype("<f4").tobytes()))
        t, z, y, x = (int(k) for k in key.split("."))
        if name == "uo":
            self.uo_chunks.append((t, y, x))
        blk = np.full((512, 2048), 9.969209968386869e36, dtype="<f4")
        src = self.fields[name][y * 512:(y + 1) * 512, x * 2048:(x + 1) * 2048]
        blk[:src.shape[0], :src.shape[1]] = src
        return _Resp(200, self.codec.encode(blk.tobytes()))


def _store():
    land = np.full((cur.SRC_ROWS, cur.SRC_COLS), 9.969209968386869e36, dtype="<f4")
    uo, vo = land.copy(), land.copy()
    uo[1200:1300, :] = 0.5                                            # an eastward jet (about 0.97 kn), 20N-28.3N
    vo[1200:1300, :] = 0.0
    h0 = (CYCLE - cur.EPOCH).total_seconds() / 3600 - 24
    return _Http(uo, vo, [h0 + 6 * k for k in range(4 * 11 + 5)])


def _two_boxes(monkeypatch):
    from services.weather_pipeline import pilot_regions as pr
    boxes = {"hawaii": pr.WORLDWIDE_COASTAL_REGIONS["hawaii"], "florida_east_coast": pr.REGIONAL_CONFIGS["florida_east_coast"]}
    monkeypatch.setattr(nat, "_boxes", lambda: boxes)
    return [nat.set_name(b) for b in boxes]


def test_one_read_per_hour_feeds_every_box_and_touches_only_their_chunks(tmp_path, monkeypatch):
    names = _two_boxes(monkeypatch)
    http = _store()
    sink = pub.LocalSink(tmp_path)
    specs = {n: dict(fsr.spec_for(n), hours=(0, 6)) for n in names}
    monkeypatch.setattr(fsr, "spec_for", lambda n: specs[n])
    shared = nat._SharedRead(specs[names[0]], session=http)
    reports, pulled = nat.publish_all(sink, pub._uploader(sink), names, log=print, shared=shared, now=CYCLE + timedelta(hours=7))
    assert {r["status"] for r in reports.values()} == {"published"} and all(r["built"] == 2 for r in reports.values())
    per_hour = {}
    for t, y, x in http.uo_chunks:
        per_hour.setdefault(t, []).append((y, x))
    assert len(per_hour) == 2                                         # two hours, each read once for both boxes
    for keys in per_hour.values():   # Hawaii (row chunk 2, col chunk 0) + Florida (row chunk 2, col chunk 0): one chunk, once
        assert sorted(keys) == [(2, 0)]
    assert pulled > 0 and not shared._hours                           # the slices are freed after the publish


def test_a_published_box_frame_is_the_source_cells_with_a_direction_per_cell(tmp_path, monkeypatch):
    names = _two_boxes(monkeypatch)
    http = _store()
    sink = pub.LocalSink(tmp_path)
    sp = dict(fsr.spec_for(names[0]), hours=(0, 6))
    shared = nat._SharedRead(sp, session=http)
    report = fsr.publish(nat.NativeCurrentsSource(sp, shared=shared), sink, pub._uploader(sink), log=print, spec=sp,
                         now=CYCLE + timedelta(hours=7))
    assert report["status"] == "published" and report["refused"] == 0
    rec = json.loads((tmp_path / fs.LATEST).read_text())["sets"]["CMEMS/marine/currents/hawaii_0p083"]
    index = json.loads((tmp_path / rec["index"]).read_text())
    assert index["grid"]["flow_dir_stride"] == 1 and index["grid"]["cols"] == 85 and index["grid"]["rows"] == 61
    assert index["grid"]["bounds"] == {"west": -161.0, "south": 18.0, "east": -154.0, "north": 23.0}
    head, f = fb.decode_plane((tmp_path / index["frames"][1]["path"]).read_bytes())
    band, d = f[fb.CURRENT_KN_BAND], f[fb.FLOW_DIR_BYTE]
    (j0, _j1, _k0, _k1), _g = nat.box_window({"west": -161.0, "south": 18.0, "east": -154.0, "north": 23.0})
    jet = np.isfinite(band)
    assert jet[1200 - j0:].all() and not jet[:1200 - j0].any()       # the jet's own rows, cell for cell (no 3 x 3 mean)
    assert np.nanmax(band) == pytest.approx(0.5 * cur.KN_PER_MS, abs=0.01)
    assert np.allclose(d[jet], 90.0) and not d[~jet].any()           # toward 90 at EVERY wet cell, odd rows and columns too
    assert jet[1:, 1::2].any()


def test_the_script_routes_the_bundle_and_is_dark(monkeypatch, capsys):
    assert script.main(["--bundle", "currents_native", "--out-dir", "unused"]) == 0
    assert "currents_native: off (FRAME_RASTER_CURRENTS_NATIVE); skipped" in capsys.readouterr().out
    seen = {}
    monkeypatch.setenv(nat.ENV, "1")
    monkeypatch.setattr(script, "_sink", lambda args: object())
    monkeypatch.setattr(nat, "publish_all", lambda sink, up, names, log=print: (
        seen.__setitem__("names", names), ({n: {"status": "published", "bytes": 1000} for n in names}, 2e6))[1])
    assert script.main(["--bundle", "currents_native", "--out-dir", "unused"]) == 0
    assert seen["names"] == nat.names()
    assert "::notice title=Raster set currents_native size::pulled 2.0 MB, kept 0.0 MB (14 boxes; published)" in capsys.readouterr().out
    assert script.main(["--set", "currents_native_hawaii", "--out-dir", "unused"]) == 0
    assert seen["names"] == ["currents_native_hawaii"]


def test_the_pilots_step_is_dark_and_the_monitor_reads_its_switch():
    wf = (ROOT / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in wf.split("\n      - name: ")[1:] if "--bundle currents_native" in s]
    assert len(steps) == 1
    step = steps[0]
    assert "vars.FRAME_IMAGES_PUBLISH == '1' && vars.FRAME_RASTER_CURRENTS_NATIVE == '1'" in step
    assert "FRAME_RASTER_CURRENTS_NATIVE: ${{ vars.FRAME_RASTER_CURRENTS_NATIVE }}" in step
    # A failed publish turns the run red (the advisor's gate on #1145): no continue-on-error, and the next step still runs.
    assert "continue-on-error" not in step.split("\n      # ")[0]
    i = wf.index("--bundle currents_native")
    assert "if: ${{ !cancelled()" in wf[i:i + 3000].split("\n      - name: ")[1]
    mon = (ROOT / ".github" / "workflows" / "data-health-monitor.yml").read_text(encoding="utf-8")
    assert "FRAME_RASTER_CURRENTS_NATIVE: ${{ vars.FRAME_RASTER_CURRENTS_NATIVE }}" in mon

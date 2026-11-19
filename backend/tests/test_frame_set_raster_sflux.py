"""GFS 0.117-degree sets from NOAA's surface flux files (services/frame_set_raster_sflux.py), offline.

A fake source on a small Gaussian-shaped grid (the module's NLAT / NLON / GRID patched), so no network, no pygrib and no 4.7 M
node frames. Pins: one fetch per forecast hour feeds all three sets; PRATE bucket averages de-average to the step's rate; the
amount over a step is rounded to 0.1 mm; the lattice turn (south row first, column 0 = 180W) with no interpolation; a failed
hour is unbuilt for every set and the next rain hour re-reads the previous average; publish through frame_set_raster.publish
(index, latest.json); each set ships ON and '0' kills it; the pilots step and the monitor see every switch.
"""
import json
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
from services import frame_set_raster_sflux as sx  # noqa: E402

CYCLE = datetime(2026, 11, 18, 18, tzinfo=timezone.utc)
NAMES = ("temperature_0p117", "water_temp_0p117", "precipitation_0p117")
ENVS = ("FRAME_RASTER_TEMPERATURE_0P117", "FRAME_RASTER_WATER_TEMP_0P117", "FRAME_RASTER_PRECIP_0P117")
WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
NY, NX = 6, 8                                                     # the small grid: 6 rows, 8 columns


def _rate(f, r, c):
    """The true rain rate (mm/h) in the hour ending at f, per node: unique per hour and node."""
    return 0.3 * f + 0.1 * r + 0.04 * c + 0.013                      # never on a 0.05 rounding tie (0.1 mm steps)


class _Source:
    """Fake sflux: GRIB order (row 0 = north, column 0 = 0E); PRATE as the average since the bucket began (kg/m2/s)."""

    def __init__(self, fail=()):
        self.fail, self.calls = set(fail), []

    def complete_cycle(self, now):
        return CYCLE

    def url(self, cycle, f):
        return f"https://example.test/sflux.f{f:03d}"

    def fetch(self, cycle, f, names):
        self.calls.append((f, tuple(names)))
        if f in self.fail:
            self.fail.discard(f)                                      # fails once
            raise RuntimeError("boom")
        r, c = np.mgrid[0:NY, 0:NX]
        out = {}
        for n in names:
            if n == "precipitation_0p117":
                b, _prev = sx.rain_step(f)
                hours = [h for h in range(b + 1, f + 1)]
                # an average since the bucket: sum of each hour's amount (3-hour steps hold 3 h at one rate) / elapsed seconds
                amount = sum(_rate(h, r, c) for h in hours) if f <= 120 else sum(3 * _rate(h, r, c) for h in range(b + 3, f + 1, 3))
                out[n] = amount / ((f - b) * 3600.0)
            elif n == "temperature_0p117":
                out[n] = 273.15 + 10.0 + r + 0.5 * c + 0.01 * f
            else:
                out[n] = 273.15 + 20.0 - r - 0.25 * c
        return out


@pytest.fixture
def small(monkeypatch):
    monkeypatch.setattr(sx, "NLAT", NY)
    monkeypatch.setattr(sx, "NLON", NX)
    grid = {"cols": NX, "rows": NY, "bounds": (-180.0, -75.0, 135.0, 75.0), "stride": 1}
    monkeypatch.setattr(sx, "GRID", grid)
    monkeypatch.setitem(fsr.GRIDS, "0p117", grid)                    # the index's grid is the frames' grid
    for n in NAMES:
        monkeypatch.setitem(sx.SPECS[n], "hours", tuple(h for h in sx.SPECS[n]["hours"] if h <= 13 or h in (120, 123, 126)))
    for e in ENVS:
        monkeypatch.delenv(e, raising=False)


def _decode(gz, fid):
    return fb.decode_plane(gz)[1][fid]


def test_the_three_sets_are_registered_on_the_native_gaussian_lattice():
    for n, env in zip(NAMES, ENVS):
        sp = fsr.SPECS[n]
        assert sp is sx.SPECS[n] and sp["env"] == env and sp["default_on"] is True and sp["grid"] == "0p117"
        assert sp["target"]["region_id"] == "global_0p117" and sp["target"]["model"] == "GFS"
    assert fsr.GRIDS["0p117"]["cols"] == 3072 and fsr.GRIDS["0p117"]["rows"] == 1536
    x, _w = np.polynomial.legendre.leggauss(1536)                    # the N768 Gaussian latitudes
    lat = np.degrees(np.arcsin(x))
    assert abs(sx.GAUSS_N - lat[-1]) < 1e-6
    west, south, east, north = fsr.GRIDS["0p117"]["bounds"]
    assert (west, east) == (-180.0, 180.0 - 360.0 / 3072) and south == -north == -sx.GAUSS_N
    uniform = np.linspace(south, north, 1536)
    assert np.abs(lat - uniform).max() < 0.002                      # every Gaussian row within 0.002 deg of its lattice row
    assert len(sx.HOURS) == 209 and sx.HOURS[120] == 120 and sx.HOURS[121] == 123 and sx.HOURS[-1] == 384
    assert sx.SPECS["precipitation_0p117"]["hours"] == sx.HOURS[1:]


def test_groups_cover_every_hour_once_one_bucket_each():
    gs = sx.groups()
    assert sorted(f for g in gs for f in g) == list(sx.HOURS)
    assert [0] in gs and [1, 2, 3, 4, 5, 6] in gs and [115, 116, 117, 118, 119, 120] in gs and [123, 126] in gs
    for g in gs:
        if g != [0]:
            assert len({sx.rain_step(f)[0] for f in g}) == 1 and g == sorted(g)


def test_prate_averages_de_average_to_each_steps_rate():
    rates = [0.0, 1.0, 4.0, 0.5, 2.0, 0.0, 3.0]                     # mm/h in hours 1..6 (index = hour)
    avg = {f: sum(rates[1:f + 1]) / f / 3600.0 for f in range(1, 7)}
    for f in range(1, 7):
        b, prev = sx.rain_step(f)
        got = sx.rate_from_averages(np.array([avg[f]]), f, np.array([avg[prev]]) if prev > b else None, prev, b)
        assert got[0] == pytest.approx(rates[f], abs=1e-9)
    # past f120: 3-hour steps inside a 6-hour bucket (120-123, then 120-126)
    a123, a126 = 2.0 / 3600.0, (2.0 * 3 + 5.0 * 3) / 6 / 3600.0
    assert sx.rate_from_averages(np.array([a123]), 123, None, 120, 120)[0] == pytest.approx(2.0)
    assert sx.rate_from_averages(np.array([a126]), 126, np.array([a123]), 123, 120)[0] == pytest.approx(5.0)
    assert sx.rate_from_averages(np.array([1e-9]), 2, np.array([2e-9]), 1, 0)[0] == 0.0     # packing noise below 0 -> 0


def test_rain_amount_over_the_step_is_rounded_to_a_tenth_of_a_mm():
    assert sx.round_rain(np.array([0.04, 0.06, 1.234]), 1).tolist() == pytest.approx([0.0, 0.1, 1.2])
    # 3-hour step: 0.04 mm/h = 0.12 mm -> 0.1 mm -> 0.0333 mm/h
    assert sx.round_rain(np.array([0.04, 0.01]), 3).tolist() == pytest.approx([0.1 / 3, 0.0])


def test_the_lattice_turn_is_south_first_from_180w_with_no_interpolation(monkeypatch):
    monkeypatch.setattr(sx, "NLAT", NY)
    monkeypatch.setattr(sx, "NLON", NX)
    g = np.arange(NY * NX, dtype=float).reshape(NY, NX)             # GRIB: row 0 = north, column 0 = 0E
    out = sx.to_lattice(g)
    assert out[0, 0] == g[-1, NX // 2]                               # south row, 180W (GRIB column NX/2 = 180E = 180W)
    assert out[-1, NX // 2] == g[0, 0]                               # north row, 0E
    assert sorted(out.ravel()) == sorted(g.ravel())                  # the same values, only moved
    with pytest.raises(ValueError):
        sx.to_lattice(np.zeros((NY + 1, NX)))


def test_one_fetch_per_hour_feeds_all_three_sets(small):
    src = _Source()
    got = sx.build_bundle(src, CYCLE, list(NAMES), log=lambda *a: None)
    per_hour = {}
    for f, names in src.calls:
        per_hour.setdefault(f, []).append(names)
    assert all(len(v) == 1 for v in per_hour.values())               # every hour read ONCE
    assert set(per_hour[0][0]) == {"temperature_0p117", "water_temp_0p117"} and set(per_hour[5][0]) == set(NAMES)
    r, c = np.mgrid[0:NY, 0:NX]
    for n in NAMES:
        frames, uploads, stats = got[n]
        assert stats["built"] == len(sx.SPECS[n]["hours"]) and stats["failed"] == 0 and len(uploads) == stats["built"]
        for fr, (path, gz, _t, _c) in zip([x for x in frames if x.get("path")], uploads):
            f = fr["source"]["forecast_hour"]
            assert path.startswith(fs.set_prefix(sx.SPECS[n]["target"]) + "/20261118T180000Z/")
            plane = _decode(gz, sx.SPECS[n]["field"])
            if n == "precipitation_0p117":
                step = 1 if f <= 120 else 3
                want = sx.to_lattice(np.round(_rate(f, r, c) * step / 0.1) * 0.1 / step)
                assert np.abs(plane - want).max() <= 0.005 + 1e-9, f
            elif n == "temperature_0p117":
                assert np.abs(plane - sx.to_lattice(10.0 + r + 0.5 * c + 0.01 * f)).max() <= 0.025 + 1e-9
            assert fr["valid_time"] == fsr.iso(CYCLE + timedelta(hours=f))


def test_a_failed_hour_is_unbuilt_for_every_set_and_the_next_rain_hour_re_reads_its_average(small):
    src = _Source(fail={3})
    got = sx.build_bundle(src, CYCLE, list(NAMES), log=lambda *a: None)
    for n in NAMES:
        f3 = [x for x in got[n][0] if x["source"]["forecast_hour"] == 3][0]
        assert f3["path"] is None and f3["unbuilt"] == "failed"
        assert got[n][2]["failed"] == 1
    assert (3, ("precipitation_0p117",)) in src.calls                # f004's rate re-read f003's average alone
    f4 = [x for x in got["precipitation_0p117"][0] if x["source"]["forecast_hour"] == 4][0]
    assert f4["path"]


def test_publish_bundle_writes_each_set_and_skips_a_published_cycle(small, tmp_path):
    sink = pub.LocalSink(tmp_path)
    rep = sx.publish_bundle(_Source(), sink, pub._uploader(sink), log=lambda *a: None, budget_s=600)
    assert {n: r["status"] for n, r in rep.items()} == {n: "published" for n in NAMES}
    latest = json.loads((tmp_path / "v1" / "latest.json").read_text())
    for n in NAMES:
        key = fs.set_key(sx.SPECS[n]["target"])
        assert latest["sets"][key]["run"] == "2026-11-18T18:00:00Z"
        index = json.loads((tmp_path / latest["sets"][key]["index"]).read_text())
        assert index["grid"]["cols"] == NX and index["common_meta"]["upstream_provider"] == "noaa"
        assert "sflux" in index["common_meta"]["source_dataset"]
    src = _Source()
    again = sx.publish_bundle(src, sink, pub._uploader(sink), log=lambda *a: None, budget_s=600)
    assert {r["status"] for r in again.values()} == {"unchanged"} and src.calls == []


@pytest.mark.parametrize("name,env", list(zip(NAMES, ENVS)))
def test_each_set_ships_on_and_0_kills_it(name, env, small, tmp_path, monkeypatch, capsys):
    assert fsr.enabled(name)
    monkeypatch.setenv(env, "")                                       # how a workflow passes an unset variable
    assert fsr.enabled(name)
    monkeypatch.setenv(env, "0")
    assert not fsr.enabled(name)
    sink = pub.LocalSink(tmp_path)
    rep = sx.publish_bundle(_Source(), sink, pub._uploader(sink), log=lambda *a: None, budget_s=600)
    assert name not in rep and len(rep) == 2
    assert script.main(["--set", name, "--out-dir", str(tmp_path)]) == 0 and "skipped" in capsys.readouterr().out


def test_all_killed_the_bundle_does_nothing(monkeypatch, capsys):
    for e in ENVS:
        monkeypatch.setenv(e, "0")
    assert script.main(["--bundle", "sflux", "--out-dir", "unused"]) == 0
    assert capsys.readouterr().out.count("skipped") == 3


def test_the_pilots_step_runs_unless_all_three_are_0_and_passes_each_switch():
    yml = (WORKFLOWS / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if "publish_raster_frames.py --bundle sflux" in s]
    assert len(steps) == 1
    step = steps[0]
    for e in ENVS:
        assert f"(vars.{e} || '1') != '0'" in step and f"{e}: ${{{{ vars.{e} || '1' }}}}" in step
    assert "vars.FRAME_IMAGES_PUBLISH == '1'" in step and "FRAME_RASTER_BUDGET_S" in step and "timeout-minutes" in step
    mon = (WORKFLOWS / "data-health-monitor.yml").read_text(encoding="utf-8")
    for e in ENVS:
        assert f"{e}: ${{{{ vars.{e} }}}}" in mon

"""REGRID_NATIVE_CELL (2026-09-29): a 0.25-deg regional node must be its EXACT native cell, not a 2x2 NW block mean.

Found by the same-model parity probe: our regional GFS node matched Open-Meteo's north-west 2x2 mean of the same
12Z field to MAE 0.010 m on 72% of rows, its own cell on 14%. `half = max(1, round(0.25 / 0.25 / 2))` = 1, and the
block is rows [r-1, r+1) x cols [c-1, c+1). These pin, on the REAL `fetch_global_coarse` loop over a stub GRIB that is
an actual 0.25-deg grid:

  * flag OFF: byte-identical to before, and the defect pinned as it is (a node = the NW 2x2 RMS);
  * flag ON at 0.25 deg: every height, period and direction is the native cell's, and every confidence is the
    production reduction's single-cell answer (partition 0.0/1.0, total-sea from the multi-tier function);
  * flag ON off native (1.0 deg): byte-identical (the coarse tiers are not touched);
  * the vectorized and the per-point paths agree with the flag on;
  * the doubled view equals the 1x1-slice oracle for every reduction (the module's core claim).
"""
import sys
import types
from datetime import datetime, timezone

import numpy as np
import pytest

from services import _fetch_blockmean_vec as V
from services import _fetch_common as F
from services._fetch_native_cell import Doubled, doubled_indices, is_native, one_cell

LAT0, LON0, NLAT, NLON = 40.0, -80.0, 41, 41                  # a real 0.25-deg patch: 40..30 N, 80..70 W
_GLAT = np.tile((LAT0 - 0.25 * np.arange(NLAT))[:, None], (1, NLON))
_GLON = np.tile((LON0 + 0.25 * np.arange(NLON))[None, :], (NLAT, 1))
BBOX = {"west": -77.0, "south": 33.0, "east": -73.0, "north": 37.0}  # well inside the patch (no edge wrap)
_KEYS = [("HTSGW", "surface"), ("PERPW", "surface"), ("DIRPW", "surface"), ("WVHGT", "surface"),
         ("SWELL", "1 in sequence"), ("SWELL", "2 in sequence"), ("WVPER", "surface"),
         ("SWPER", "1 in sequence"), ("SWPER", "2 in sequence"), ("WVDIR", "surface"),
         ("SWDIR", "1 in sequence"), ("SWDIR", "2 in sequence")]


def _field(k):
    """A STRUCTURED field with land and zero-energy cells, so a wrong index or block cannot pass by accident."""
    rng = np.random.default_rng(500 + k)
    var = _KEYS[k][0]
    hi = 360.0 if var in ("DIRPW", "WVDIR", "SWDIR") else (18.0 if "PER" in var else 5.0)
    a = rng.uniform(0.0 if hi != 18.0 else 4.0, hi, size=(NLAT, NLON))
    a[rng.uniform(size=a.shape) < 0.15] = np.nan
    if var in ("WVHGT", "SWELL"):
        a[rng.uniform(size=a.shape) < 0.25] = 0.0                # a partition absent here
    a[:, :3] = np.nan                                            # a coast along the west edge
    return a


FIELDS = [_field(k) for k in range(len(_KEYS))]


class _Msg:
    def __init__(self, k):
        self.values = FIELDS[k]

    def latlons(self):
        return _GLAT, _GLON


class _Grbs:
    def read(self):
        return [_Msg(i) for i in range(len(_KEYS))]

    def close(self):
        pass


def _run(monkeypatch, native: str, vector: str = "1", resolution: float = 0.25):
    import services.noaa_gfs_wave_fetcher as fetcher
    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=lambda _p: _Grbs()))
    for k, v in {"NOAA_COARSE_DIR_BLOCKMEAN": "1", "NOAA_COARSE_SCALAR_BLOCKMEAN": "1",
                 "NOAA_COARSE_DIR_CONFIDENCE": "1", "NOAA_PARTITION_DIR_CONFIDENCE": "1",
                 "FETCH_VECTOR_BLOCKMEAN": vector, "REGRID_NATIVE_CELL": native}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(fetcher, "_pick_cycle", lambda _rq, _now, _mf: (datetime(2026, 9, 29, 12, tzinfo=timezone.utc),
                                                                        "https://stub/gfswave."))
    idx = "\n".join(f"{i + 1}:{i * 1000}:d=2026092912:{v}:{lvl}:anl:" for i, (v, lvl) in enumerate(_KEYS))

    def _get(url, **kw):
        if url.endswith(".idx"):
            return types.SimpleNamespace(text=idx, status_code=200)
        rng = (kw.get("headers") or {}).get("Range", "")
        n = 8
        if rng.startswith("bytes=") and "-" in rng:
            a, _, b = rng[6:].partition("-")
            if a.isdigit() and b.isdigit():
                n = int(b) - int(a) + 1
        return types.SimpleNamespace(status_code=206, content=b"\x00" * n)

    monkeypatch.setattr(__import__("requests"), "get", _get)
    points, ok, failed, times = fetcher.fetch_global_coarse(
        {"bbox": BBOX, "resolution": resolution, "forecast_days": 1, "output_path": ""})
    assert ok > 0 and points
    return points


def _rc(p):
    return int(round((LAT0 - p["latitude"]) / 0.25)), int(round((p["longitude"] - LON0) / 0.25))


def _f(var):
    return FIELDS[[om for om in __import__("services.noaa_gfs_wave_fetcher", fromlist=["x"]).OM_ORDER].index(var)]


def test_flag_off_pins_the_defect__a_node_is_the_north_west_2x2_rms(monkeypatch):
    h = _f("wave_height")
    checked = 0
    for p in _run(monkeypatch, "0"):
        r, c = _rc(p)
        block = h[r - 1:r + 1, c - 1:c + 1]
        got = p["hourly"]["wave_height"][0]
        if got is None or not np.isfinite(block).any():
            continue
        assert got == pytest.approx(float(np.sqrt(np.nanmean(block ** 2))), abs=1e-4)
        checked += 1
    assert checked > 100


def test_flag_on_every_value_is_the_exact_native_cell(monkeypatch):
    checked = 0
    for p in _run(monkeypatch, "1"):
        r, c = _rc(p)
        for var in ("wave_height", "wave_period", "swell_wave_height", "swell_wave_period", "wind_wave_height",
                    "secondary_swell_wave_height", "swell_wave_direction", "wind_wave_direction"):
            want = _f(var)[r, c]
            got = p["hourly"][var][0]
            if np.isfinite(want):
                assert got == pytest.approx(float(want), abs=1e-4), (var, r, c)
                checked += 1
            else:
                assert got is None, (var, r, c)
    assert checked > 1000


def test_flag_on_confidences_are_the_reductions_single_cell_answers(monkeypatch):
    import services.noaa_gfs_wave_fetcher as fetcher
    pconf_keys = set(fetcher.PARTITION_DIR_CONFIDENCE_OM.values())
    pairs = [(_f(d), _f(h)) for d, h in fetcher.TOTAL_SEA_PARTITIONS]
    for p in _run(monkeypatch, "1"):
        r, c = _rc(p)
        for key in pconf_keys:
            v = p["hourly"][key][0]
            assert v in (0.0, 1.0), (key, v)                   # one cell: the train is there, or it is not
        x, conf = F.energy_mean_direction_block_multi_conf(
            [(one_cell(d, r, c), one_cell(h, r, c)) for d, h in pairs], one_cell(_f("wave_direction"), r, c),
            0, 0, 1, True, one_cell(_f("wave_height"), r, c))
        got_d, got_c = p["hourly"]["wave_direction"][0], p["hourly"][fetcher.DIR_CONFIDENCE_OM][0]
        assert (got_d is None) == (x != x) and (got_d is None or got_d == pytest.approx(round(x, 4), abs=1e-4))
        assert (got_c is None) == (conf is None) and (got_c is None or got_c == pytest.approx(round(conf, 4), abs=1e-4))


def test_flag_on_does_not_touch_a_coarse_tier(monkeypatch):
    with monkeypatch.context() as m:
        off = _run(m, "0", resolution=1.0)
    with monkeypatch.context() as m:
        on = _run(m, "1", resolution=1.0)
    assert off == on


def test_the_vectorized_and_per_point_paths_agree_with_the_flag_on(monkeypatch):
    with monkeypatch.context() as m:
        vec = _run(m, "1", vector="1")
    with monkeypatch.context() as m:
        scal = _run(m, "1", vector="0")
    assert vec == scal


def test_the_doubled_view_equals_the_one_cell_oracle_for_every_reduction():
    rng = np.random.default_rng(3)
    h = rng.uniform(0, 5, (20, 30))
    h[rng.uniform(size=h.shape) < 0.2] = np.nan
    h[rng.uniform(size=h.shape) < 0.2] = 0.0
    d = rng.uniform(0, 360, (20, 30))
    per = rng.uniform(4, 16, (20, 30))
    rs = np.repeat(np.arange(1, 19), 30)
    cs = np.tile(np.arange(30), 18)
    R2, C2 = doubled_indices(rs, cs)
    np.testing.assert_array_equal(V.height_block_batch(Doubled(h), R2, C2, 1, True, None), h[rs, cs])
    np.testing.assert_allclose(V.scalar_block_batch(Doubled(per), Doubled(h), R2, C2, 1, True, None),
                               [F.energy_mean_scalar_block(one_cell(per, r, c), one_cell(h, r, c), 0, 0, 1, True)
                                for r, c in zip(rs, cs)])
    bd, bc = V.partition_dir_conf_batch(Doubled(d), Doubled(h), R2, C2, 1, True, None)
    oracle = [F.energy_mean_direction_block_partition_conf(one_cell(d, r, c), one_cell(h, r, c), 0, 0, 1, True)
              for r, c in zip(rs, cs)]
    np.testing.assert_allclose(bd, [x for x, _ in oracle])
    np.testing.assert_allclose(bc, [y for _, y in oracle])


def test_the_doubled_view_is_interior_everywhere__even_on_the_grid_edge():
    """Why the batch functions' scalar fallback is never taken under the flag: a half=1 block centred on (2r+1, 2c+1)
    spans rows 2r..2r+1 of a 2*nrows view, full-size for every native r including 0 and nrows-1. Pinned so that a
    fallback lambda surviving a mutation is known to be unreachable, not untested. The EDGE cells (where the legacy
    NW block is clamped) still equal the 1x1-slice oracle."""
    rng = np.random.default_rng(9)
    h = rng.uniform(0.1, 5, (7, 11))
    per = rng.uniform(4, 16, (7, 11))
    rs = np.array([0, 0, 6, 6, 3, 0, 6])
    cs = np.array([0, 10, 0, 10, 5, 5, 5])
    R2, C2 = doubled_indices(rs, cs)
    assert V._interior_mask(R2, C2, 14, 22, 1, True).all()
    assert V._interior_mask(R2, C2, 14, 22, 1, False).all()
    np.testing.assert_array_equal(V.height_block_batch(Doubled(h), R2, C2, 1, True, None), h[rs, cs])
    np.testing.assert_allclose(V.scalar_block_batch(Doubled(per), Doubled(h), R2, C2, 1, True, None),
                               [F.energy_mean_scalar_block(one_cell(per, r, c), one_cell(h, r, c), 0, 0, 1, True)
                                for r, c in zip(rs, cs)])


def test_the_switch_is_off_unless_set_to_one(monkeypatch):
    from services import _fetch_native_cell as N
    monkeypatch.delenv("REGRID_NATIVE_CELL", raising=False)
    assert N.enabled() is False
    for v, want in (("0", False), ("", False), ("true", False), ("1", True)):
        monkeypatch.setenv("REGRID_NATIVE_CELL", v)
        assert N.enabled() is want, v


@pytest.mark.parametrize("res,native", [(0.25, True), (0.2500001, True), (0.5, False), (2.0, False), (10.0, False)])
def test_only_the_native_resolution_is_native(res, native):
    assert is_native(res) is native


def test_both_fetch_lanes_declare_the_switch_dark_and_equal():
    """The two workflows that run the wave fetch move together, never one (the same coast regridded two ways by
    cycle). DARK until the owner's word: the value is '0' in both."""
    from pathlib import Path

    import yaml
    root = Path(__file__).resolve().parents[2]
    values = {}
    for wf in ("forecast-ingest.yml", "forecast-ingest-pilots.yml"):
        d = yaml.safe_load((root / ".github" / "workflows" / wf).read_text(encoding="utf-8"))
        found = [st["env"]["REGRID_NATIVE_CELL"] for j in d["jobs"].values() for st in j.get("steps", [])
                 if isinstance(st, dict) and "REGRID_NATIVE_CELL" in (st.get("env") or {})]
        assert len(found) == 1, wf
        values[wf] = found[0]
    assert set(values.values()) == {"0"}, values

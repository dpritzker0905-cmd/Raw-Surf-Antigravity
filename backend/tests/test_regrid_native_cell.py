"""REGRID_NATIVE_CELL (2026-09-29): a 0.25-deg regional node must be its EXACT native cell, not a 2x2 NW block mean.

Found by the same-model parity probe: our regional GFS node matched Open-Meteo's north-west 2x2 mean of the same
12Z field to MAE 0.010 m on 72% of rows, its own cell on 14%. `half = max(1, round(0.25 / 0.25 / 2))` = 1, and the
block is rows [r-1, r+1) x cols [c-1, c+1). These pin, on the REAL `fetch_global_coarse` loop over a stub GRIB that is
an actual 0.25-deg grid:

  * flag OFF: byte-identical to before, and the defect pinned as it is (a node = the NW 2x2 RMS);
  * flag ON at 0.25 deg: every height, period and direction is the native cell's, and every confidence is the
    production reduction's single-cell answer (partition 0.0/1.0, total-sea from the multi-tier function);
  * ...except a LAND node (its own total height missing), which answers from its CENTRED 3x3 (an RMS checked by
    hand here), so no node the legacy NW 2x2 covered is left empty. The real-GRIB job measured the exact cell alone
    blanking 20 of 425 coastal nodes (4.7%) on Florida's east coast; a sea cell with no partition stays empty;
  * flag ON off native (1.0 deg): byte-identical (the coarse tiers are not touched);
  * the vectorized and the per-point paths agree with the flag on;
  * the doubled view equals the 1x1-slice oracle for every reduction (the module's core claim);
  * the SAME for ICON (dwd_gwam_fetcher: every variable and the total-sea confidence) and EURO
    (ecmwf_opendata_fetcher: the height, deterministic and member spread, now shares its cell with the direction).
"""
import sys
import types
from datetime import datetime, timezone

import numpy as np
import pytest

from services import _fetch_blockmean_vec as V
from services import _fetch_common as F
from services._fetch_native_cell import LAND_HALF, Doubled, doubled_indices, is_native, one_cell, views

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


def _centred_rms(a, r, c):
    """The land fallback's height, BY HAND: RMS over the finite cells of the centred 3x3 (cols wrap)."""
    blk = a[max(0, r - 1):r + 2][:, [(c - 1) % a.shape[1], c, (c + 1) % a.shape[1]]]
    f = blk[np.isfinite(blk)]
    return float(np.sqrt(np.mean(f ** 2))) if f.size else float("nan")


def _hb(total_h, r, c):
    return LAND_HALF if not np.isfinite(total_h[r, c]) else 1


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


def test_flag_on_every_value_is_the_exact_native_cell_and_a_land_node_its_centred_3x3(monkeypatch):
    checked = land = 0
    hs = _f("wave_height")
    for p in _run(monkeypatch, "1"):
        r, c = _rc(p)
        if not np.isfinite(hs[r, c]):                        # LAND: every height is the centred 3x3 RMS
            land += 1
            for var in ("wave_height", "swell_wave_height", "wind_wave_height", "secondary_swell_wave_height"):
                want, got = _centred_rms(_f(var), r, c), p["hourly"][var][0]
                assert (got is None) == (want != want), (var, r, c)
                assert got is None or got == pytest.approx(want, abs=1e-4), (var, r, c)
            continue
        for var in ("wave_height", "wave_period", "swell_wave_height", "swell_wave_period", "wind_wave_height",
                    "secondary_swell_wave_height", "swell_wave_direction", "wind_wave_direction"):
            want = _f(var)[r, c]
            got = p["hourly"][var][0]
            if np.isfinite(want):
                assert got == pytest.approx(float(want), abs=1e-4), (var, r, c)
                checked += 1
            else:
                assert got is None, (var, r, c)          # a SEA cell with no train stays empty
    assert checked > 1000 and land > 20


def test_flag_on_no_node_the_legacy_block_covered_is_left_empty(monkeypatch):
    """The gate the real-GRIB job failed on (20 of 425 coastal nodes blank): total height coverage is a SUPERSET."""
    with monkeypatch.context() as m:
        off = {(p["latitude"], p["longitude"]): p["hourly"]["wave_height"][0] for p in _run(m, "0")}
    with monkeypatch.context() as m:
        on = {(p["latitude"], p["longitude"]): p["hourly"]["wave_height"][0] for p in _run(m, "1")}
    lost = [k for k, v in off.items() if v is not None and on[k] is None]
    assert lost == [] and sum(v is not None for v in off.values()) > 200


def test_flag_on_confidences_are_the_reductions_single_cell_answers(monkeypatch):
    import services.noaa_gfs_wave_fetcher as fetcher
    pconf_keys = set(fetcher.PARTITION_DIR_CONFIDENCE_OM.values())
    pairs = [(_f(d), _f(h)) for d, h in fetcher.TOTAL_SEA_PARTITIONS]
    hs = _f("wave_height")
    for p in _run(monkeypatch, "1"):
        r, c = _rc(p)
        hb = _hb(hs, r, c)
        if hb == 1:
            for key in pconf_keys:
                v = p["hourly"][key][0]
                assert v in (0.0, 1.0), (key, v)               # one cell: the train is there, or it is not
        flat = [x for d, h in pairs for x in (d, h)]
        v_ = views(r, c, hb, *flat, _f("wave_direction"), hs)
        n = len(flat)
        x, conf = F.energy_mean_direction_block_multi_conf(
            [(v_[i], v_[i + 1]) for i in range(0, n, 2)], v_[n], v_[n + 2], v_[n + 3], v_[n + 4], True, v_[n + 1])
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


def test_the_land_view_is_the_centred_3x3_at_every_cell_edges_included():
    """`views(..., LAND_HALF, ...)` is what a land node's scalar reduction sees: its centred 3x3, rows clamped at the
    grid edge, columns wrapped. Checked against an RMS computed by hand at every cell of a small grid."""
    rng = np.random.default_rng(21)
    nr, nc = 9, 13
    h = rng.uniform(0, 5, (nr, nc))
    h[rng.uniform(size=h.shape) < 0.3] = np.nan
    got = [F.energy_mean_height_block(*views(r, c, LAND_HALF, h), True) for r in range(nr) for c in range(nc)]
    np.testing.assert_allclose(got, [_centred_rms(h, r, c) for r in range(nr) for c in range(nc)], equal_nan=True)


@pytest.mark.parametrize("fetcher_name", ["noaa_gfs_wave_fetcher", "dwd_gwam_fetcher"])
def test_under_the_flag_every_batch_reduction_runs_at_half_1(monkeypatch, fetcher_name):
    """⛔ A land node must be answered by the SAME scalar reduction in the vectorized and the per-point paths, never
    by a second batch pass at half=3: that summed the 36 duplicated subcells in a different order and, on QUANTIZED
    real GRIB, differed in 1 of 115,600 values (run 36624144116: wind_wave_period 3.6257 vs 3.6258). Random stubs
    cannot show the tie at this size (synthetic: 0 of 33,600 at 2 decimals, 9 of 33,600 at 1 decimal, and a
    quantized copy of this harness did NOT catch the old code), so the guard is structural: spy on every batch
    reduction the fetcher calls and require half == 1 whenever the flag is on at native resolution."""
    import importlib
    mod = importlib.import_module(f"services.{fetcher_name}")
    halves = []
    for name in ("multi_dir_conf_batch", "partition_dir_conf_batch", "direction_block_batch", "height_block_batch",
                 "scalar_block_batch"):
        if not hasattr(mod, name):
            continue
        orig = getattr(mod, name)

        def spy(*a, _orig=orig, _name=name, **k):
            halves.append((_name, a[3] if _name == "height_block_batch" else a[4]))
            return _orig(*a, **k)
        monkeypatch.setattr(mod, name, spy)
    (_run if fetcher_name == "noaa_gfs_wave_fetcher" else _gw_run)(monkeypatch, "1", vector="1")
    assert halves, "SETUP BROKEN: no batch reduction was called"
    assert {h for _n, h in halves} == {1}, sorted(set(halves))


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


# ── ICON (DWD GWAM) ─────────────────────────────────────────────────────────────────────────────────────────────
# The same rule at dwd_gwam_fetcher.py: one `half` per call. GWAM publishes 0..360 longitudes, so the patch is
# 280..290 E (= 80..70 W) and the bbox is the same water.
_GW_LON0 = 280.0
_GW_VARS = ["swh", "mwd", "tm10", "shts", "mdts", "mpts", "shww", "mdww", "mpww"]
_GW_OM = {"swh": "wave_height", "mwd": "wave_direction", "tm10": "wave_period", "shts": "swell_wave_height",
          "mdts": "swell_wave_direction", "mpts": "swell_wave_period", "shww": "wind_wave_height",
          "mdww": "wind_wave_direction", "mpww": "wind_wave_period"}


def _gw_field(var):
    rng = np.random.default_rng(700 + _GW_VARS.index(var))
    lo, hi = {"mwd": (0.0, 360.0), "mdts": (0.0, 360.0), "mdww": (0.0, 360.0),
              "tm10": (4.0, 18.0), "mpts": (4.0, 18.0), "mpww": (4.0, 18.0)}.get(var, (0.0, 5.0))
    a = rng.uniform(lo, hi, size=(NLAT, NLON))
    a[rng.uniform(size=a.shape) < 0.15] = np.nan
    if var in ("shts", "shww"):
        a[rng.uniform(size=a.shape) < 0.25] = 0.0
    a[:, :3] = np.nan
    return a


GW_FIELDS = {v: _gw_field(v) for v in _GW_VARS}
_GW_GLON = np.tile((_GW_LON0 + 0.25 * np.arange(NLON))[None, :], (NLAT, 1))


class _GwPath:
    """What the stubbed download hands pygrib: the URL names the variable, and there is no file to clean up."""

    def __init__(self, url):
        self.url = url

    def __str__(self):
        return self.url

    def exists(self):
        return False


class _GwMsg:
    def __init__(self, var):
        self.values = GW_FIELDS[var]

    def latlons(self):
        return _GLAT, _GW_GLON


def _gw_run(monkeypatch, native: str, vector: str = "1", resolution: float = 0.25):
    import services.dwd_gwam_fetcher as fetcher

    def _open(path):
        var = str(path).split("/")[-2]                           # .../{run}/{var}/GWAM_...grib2.bz2
        return types.SimpleNamespace(read=lambda: [_GwMsg(var)], close=lambda: None)

    monkeypatch.setitem(sys.modules, "pygrib", types.SimpleNamespace(open=_open))
    for k, v in {"FETCH_VECTOR_BLOCKMEAN": vector, "DWD_GWAM_DIR_BLOCKMEAN": "1", "DWD_GWAM_DIR_CONFIDENCE": "1",
                 "DWD_GWAM_SCALAR_BLOCKMEAN": "1", "REGRID_NATIVE_CELL": native}.items():
        monkeypatch.setenv(k, v)
    t0 = datetime(2026, 9, 29, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(fetcher, "_pick_cycle", lambda _rq, _now, _mf: (t0, "20260929", "12"), raising=False)
    monkeypatch.setattr(fetcher, "_download_grib", lambda _rq, url, _tmp: _GwPath(url), raising=False)
    points, ok, failed, times = fetcher.fetch_global_coarse(
        {"bbox": BBOX, "resolution": resolution, "forecast_days": 1, "output_path": ""})
    assert ok > 0 and points
    return points


def _gw_rc(p):
    return int(round((LAT0 - p["latitude"]) / 0.25)), int(round(((p["longitude"] % 360.0) - _GW_LON0) / 0.25))


def test_icon_flag_off_pins_the_same_defect(monkeypatch):
    h = GW_FIELDS["swh"]
    checked = 0
    for p in _gw_run(monkeypatch, "0"):
        r, c = _gw_rc(p)
        block = h[r - 1:r + 1, c - 1:c + 1]
        got = p["hourly"]["wave_height"][0]
        if got is None or not np.isfinite(block).any():
            continue
        assert got == pytest.approx(float(np.sqrt(np.nanmean(block ** 2))), abs=1e-4)
        checked += 1
    assert checked > 100


def test_icon_flag_on_every_value_is_the_native_cell_and_the_confidence_its_single_cell_answer(monkeypatch):
    import services.dwd_gwam_fetcher as fetcher
    checked = land = 0
    hs = GW_FIELDS["swh"]
    for p in _gw_run(monkeypatch, "1"):
        r, c = _gw_rc(p)
        hb = _hb(hs, r, c)
        if hb == 1:
            for var, om in _GW_OM.items():
                want = GW_FIELDS[var][r, c]
                got = p["hourly"][om][0]
                if np.isfinite(want):
                    assert got == pytest.approx(float(want), abs=1e-4), (om, r, c)
                    checked += 1
                else:
                    assert got is None, (om, r, c)
        else:                                                # LAND: the heights are the centred 3x3 RMS
            land += 1
            for var in ("swh", "shts", "shww"):
                want, got = _centred_rms(GW_FIELDS[var], r, c), p["hourly"][_GW_OM[var]][0]
                assert (got is None) == (want != want) and (got is None or got == pytest.approx(want, abs=1e-4))
        v_ = views(r, c, hb, GW_FIELDS["mwd"], hs)
        _x, conf = F.energy_mean_direction_block_multi_conf([(v_[0], v_[1])], v_[0], *v_[2:], True)
        got_c = p["hourly"][fetcher.DIR_CONFIDENCE_OM][0]
        assert (got_c is None) == (conf is None)
        assert got_c is None or got_c == pytest.approx(round(conf, 4), abs=1e-4)
    assert checked > 1000 and land > 20


def test_icon_paths_agree_and_the_coarse_tier_is_untouched(monkeypatch):
    with monkeypatch.context() as m:
        vec = _gw_run(m, "1", vector="1")
    with monkeypatch.context() as m:
        scal = _gw_run(m, "1", vector="0")
    assert vec == scal
    with monkeypatch.context() as m:
        off = _gw_run(m, "0", resolution=1.0)
    with monkeypatch.context() as m:
        on = _gw_run(m, "1", resolution=1.0)
    assert off == on


# ── EURO (ECMWF open data) ──────────────────────────────────────────────────────────────────────────────────────
# Only the HEIGHT is block-meaned there; direction and periods are point-sampled at the node's own cell. So under
# the defect one EURO point carried a height from the NW 2x2 beside a direction from its own cell.
_EU_T0 = datetime(2026, 9, 29, 12, 0, 0)
_EU_T1 = datetime(2026, 9, 29, 15, 0, 0)
_EU_GLON = np.tile((LON0 + 0.25 * np.arange(NLON))[None, :], (NLAT, 1))


def _eu_field(seed, lo, hi):
    rng = np.random.default_rng(seed)
    a = rng.uniform(lo, hi, size=(NLAT, NLON))
    a[rng.uniform(size=a.shape) < 0.15] = np.nan
    a[:, :3] = np.nan
    return a


EU = {"swh": _eu_field(901, 0.0, 5.0), "mwd": _eu_field(902, 0.0, 360.0), "pp1d": _eu_field(903, 4.0, 18.0),
      "mwp": _eu_field(904, 3.0, 12.0)}
EU_MEMBERS = {1: _eu_field(911, 0.0, 5.0), 2: _eu_field(912, 0.0, 5.0), 3: _eu_field(913, 0.0, 5.0)}


class _EuMsg:
    analDate = None

    def __init__(self, short, vt, field, member=None):
        self.shortName, self.validDate, self.values = short, vt, field
        if member is not None:
            self.perturbationNumber = member

    def latlons(self):
        return _GLAT, _EU_GLON


class _EuGrbs:
    def __init__(self, msgs):
        self._m = msgs

    def __iter__(self):
        return iter(self._m)

    def close(self):
        pass


def _eu_run(monkeypatch, native: str, resolution: float = 0.25, ensemble: str = "0"):
    import services.ecmwf_opendata_fetcher as fetcher
    det = [_EuMsg(s, vt, EU[s]) for vt in (_EU_T0, _EU_T1) for s in ("swh", "mwd", "pp1d", "mwp")]
    mem = [_EuMsg("swh", vt, EU_MEMBERS[m], member=m) for vt in (_EU_T0, _EU_T1) for m in EU_MEMBERS]
    monkeypatch.setitem(sys.modules, "pygrib",
                        types.SimpleNamespace(open=lambda path: _EuGrbs(mem if "waef" in str(path) else det)))

    class _Client:
        def __init__(self, *a, **k):
            pass

        def retrieve(self, **kw):
            with open(kw["target"], "wb") as fh:
                fh.write(b"GRIB-stub")

    od = types.ModuleType("ecmwf.opendata")
    od.Client = _Client
    monkeypatch.setitem(sys.modules, "ecmwf.opendata", od)
    monkeypatch.setitem(sys.modules, "ecmwf", types.ModuleType("ecmwf"))
    sys.modules["ecmwf"].opendata = od
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    monkeypatch.setenv("ECMWF_WAVE_SCALAR_BLOCKMEAN", "1")
    monkeypatch.setenv("ECMWF_WAVE_ENSEMBLE", ensemble)
    monkeypatch.setenv("REGRID_NATIVE_CELL", native)
    points, ok, _failed, _times = fetcher.fetch_global_coarse(
        {"bbox": BBOX, "resolution": resolution, "forecast_days": 1, "layer": "waves"})
    assert ok and points
    return points


def test_euro_flag_off_pins_a_height_from_the_nw_2x2_beside_a_direction_from_the_own_cell(monkeypatch):
    checked = 0
    for p in _eu_run(monkeypatch, "0"):
        r, c = _rc(p)
        block = EU["swh"][r - 1:r + 1, c - 1:c + 1]
        got_h, got_d = p["hourly"]["wave_height"][0], p["hourly"]["wave_direction"][0]
        if got_h is None or got_d is None or not np.isfinite(block).any():
            continue
        assert got_h == pytest.approx(float(np.sqrt(np.nanmean(block ** 2))), abs=1e-3)
        assert got_d == pytest.approx(float(EU["mwd"][r, c]), abs=1e-3)
        checked += 1
    assert checked > 100


def test_euro_flag_on_the_height_is_the_same_cell_as_everything_else(monkeypatch):
    checked = land = 0
    for p in _eu_run(monkeypatch, "1"):
        r, c = _rc(p)
        own = EU["swh"][r, c]
        want = float(own) if np.isfinite(own) else _centred_rms(EU["swh"], r, c)   # LAND -> the centred 3x3
        land += not np.isfinite(own)
        got = p["hourly"]["wave_height"][0]
        assert (got is None) == (want != want), (r, c)
        if got is not None:
            assert got == pytest.approx(want, abs=1e-3), (r, c)
            checked += 1
    assert checked > 100 and land > 20


def test_icon_and_euro_leave_no_legacy_covered_node_empty(monkeypatch):
    for run, key in ((_gw_run, "wave_height"), (_eu_run, "wave_height")):
        with monkeypatch.context() as m:
            off = {(p["latitude"], p["longitude"]): p["hourly"][key][0] for p in run(m, "0")}
        with monkeypatch.context() as m:
            on = {(p["latitude"], p["longitude"]): p["hourly"][key][0] for p in run(m, "1")}
        assert [k for k, v in off.items() if v is not None and on[k] is None] == [], run.__name__


def test_euro_flag_on_the_member_spread_is_taken_at_the_same_cell(monkeypatch):
    from services.ecmwf_opendata_fetcher import reduce_member_values
    pts = _eu_run(monkeypatch, "1", ensemble="1")
    assert any(p["hourly"].get("wave_height_spread") for p in pts), "SETUP BROKEN: no spread was served"
    rcs = [_rc(p) for p in pts]
    _m, sds, _n = reduce_member_values({m: [F.energy_mean_height_block(*views(r, c, _hb(a, r, c), a), True)
                                            for r, c in rcs] for m, a in EU_MEMBERS.items()})
    checked = 0
    for p, sd in zip(pts, sds):
        got = p["hourly"]["wave_height_spread"][0]
        if got is None or sd is None or sd != sd:
            continue
        assert got == pytest.approx(float(sd), abs=1e-3)
        checked += 1
    assert checked > 100


def test_euro_coarse_tier_is_untouched(monkeypatch):
    with monkeypatch.context() as m:
        off = _eu_run(m, "0", resolution=1.0, ensemble="1")
    with monkeypatch.context() as m:
        on = _eu_run(m, "1", resolution=1.0, ensemble="1")
    assert off == on

"""ICON on the 0.125-degree lattice by a supersampled area mean (G2, 2026-11-16): services/frame_set_raster_icon125.py.

Offline, on small synthetic grids (the module takes the lattice as arguments): a box filled by one cell keeps that cell's value
(the peak); a box over k x k cells is their mean (conservation); a cell grid with holes never leaves a box empty; the last column
DWD's map lacks is filled from its neighbours; DWD's weights file is refused unless it is the nearest-neighbour map of the
expected grid; and the weights' cells must be the GRIB's cells in the same order.
"""
import numpy as np
import pytest

from services import frame_set_raster as fsr
from services import frame_set_raster_icon125 as i125

ROWS, COLS, STEP = 9, 16, 22.5                       # a coarse whole-globe lattice: lat -90..90, lon -180..157.5


def _nodes(rows=ROWS, cols=COLS, step=STEP):
    lat = (-90.0 + step * np.arange(rows))[:, None] * np.ones((1, cols))
    lon = (-180.0 + step * np.arange(cols))[None, :] * np.ones((rows, 1))
    return lat, lon


def _cells_at(lat, lon):
    return i125._unit(lat.ravel(), lon.ravel()).astype(np.float32)


def test_a_box_filled_by_one_cell_keeps_that_cells_value():
    lat, lon = _nodes()
    xyz = _cells_at(lat, lon)                                       # one cell per node, at its centre
    nn = np.arange(ROWS * COLS, dtype=np.int32).reshape(ROWS, COLS)
    pick = i125.subpoint_pick(nn, xyz, lat.ravel(), lon.ravel(), k=3, rows=ROWS, cols=COLS, step=STEP)
    vals = np.random.default_rng(1).uniform(0, 50, ROWS * COLS)
    plane = i125.area_mean(vals, pick)
    inner = slice(1, ROWS - 1)                                      # the pole rows are one point each
    assert np.allclose(plane[inner], vals.reshape(ROWS, COLS)[inner])


def test_a_box_over_k_by_k_cells_is_their_mean_so_mass_is_kept():
    k = 3
    sub = STEP / k
    rows_f, cols_f = ROWS * k, COLS * k
    flat = (-90.0 + STEP * np.arange(ROWS))[:, None] + ((np.arange(k) - 1) * sub)[None, :]
    flon = (-180.0 + STEP * np.arange(COLS))[:, None] + ((np.arange(k) - 1) * sub)[None, :]
    clat = np.repeat(flat.ravel(), cols_f).reshape(rows_f, cols_f)
    clon = np.tile(flon.ravel(), rows_f).reshape(rows_f, cols_f)
    keep = np.abs(clat) < 80                                        # away from the poles, where sub-points collapse
    xyz = _cells_at(clat, clon)
    node_of = (np.arange(rows_f) // k)[:, None] * COLS + (np.arange(cols_f) // k)[None, :]
    nn = np.full((ROWS, COLS), -1, dtype=np.int32)
    for idx in range(rows_f * cols_f):                              # a node's nearest cell: the centre one of its k x k
        r, c = divmod(idx, cols_f)
        if r % k == 1 and c % k == 1:
            nn[r // k, c // k] = idx
    vals = np.random.default_rng(2).gamma(0.5, 4.0, rows_f * cols_f)
    plane = i125.area_mean(vals, i125.subpoint_pick(nn, xyz, clat.ravel(), clon.ravel(), k=k, rows=ROWS, cols=COLS, step=STEP))
    expect = np.array([vals[(node_of == n).ravel()].mean() for n in range(ROWS * COLS)]).reshape(ROWS, COLS)
    rows_ok = np.array([keep[r * k:(r + 1) * k].all() for r in range(ROWS)])
    assert np.allclose(plane[rows_ok], expect[rows_ok])


def test_no_box_is_left_empty_when_cells_are_sparser_than_boxes():
    """The design risk of centre assignment at 0.125 deg: here half the nodes hold no cell, yet every box gets a value."""
    lat, lon = _nodes()
    keep = (np.add.outer(np.arange(ROWS), np.arange(COLS)) % 2 == 0)
    cl, co = lat[keep], lon[keep]
    xyz = _cells_at(cl, co)
    pos = {(a, b): i for i, (a, b) in enumerate(zip(cl, co))}
    nn = np.empty((ROWS, COLS), dtype=np.int32)
    for r in range(ROWS):
        for c in range(COLS):
            nn[r, c] = pos.get((lat[r, c], lon[r, c]), pos.get((lat[r, c], lon[r, (c + 1) % COLS])))
    plane = i125.area_mean(np.ones(cl.size), i125.subpoint_pick(nn, xyz, cl, co, k=3, rows=ROWS, cols=COLS, step=STEP))
    assert np.isfinite(plane).all() and np.allclose(plane, 1.0)


def test_the_last_column_dwd_lacks_takes_the_nearer_neighbour():
    lat, lon = _nodes()
    xyz = _cells_at(lat, lon)
    nn = np.arange(ROWS * COLS, dtype=np.int32).reshape(ROWS, COLS)
    full = i125.extend_nn(nn[:, :-1], xyz, rows=ROWS, cols=COLS, step=STEP)
    assert full.shape == (ROWS, COLS) and np.array_equal(full[:, :-1], nn[:, :-1])
    for shift_col, lon_to, want_col in ((0, 175.0, 0), (COLS - 2, 140.0, COLS - 2)):   # move one neighbour column closer
        lon2 = lon.copy()
        lon2[:, shift_col] = lon_to
        full = i125.extend_nn(nn[:, :-1], _cells_at(lat, lon2), rows=ROWS, cols=COLS, step=STEP)
        assert [int(full[r, -1]) for r in range(1, ROWS - 1)] == [int(nn[r, want_col]) for r in range(1, ROWS - 1)]


def test_a_nan_cell_is_left_out_and_an_all_nan_box_stays_no_data():
    pick = np.array([[[0, 1, 2], [3, 3, 3]]], dtype=np.int32)
    plane = i125.area_mean(np.array([1.0, np.nan, 3.0, np.nan]), pick)
    assert plane[0, 0] == pytest.approx(2.0) and np.isnan(plane[0, 1])


def test_the_weights_cells_must_be_the_gribs_cells_in_order():
    lat = np.array([10.0, -20.0, 30.0])
    lon = np.array([179.99999, 0.0, -45.0])
    assert i125.same_grid(lat, lon, lat.copy(), np.array([-180.00001, 0.0, -45.0]))      # the date line is one place
    assert not i125.same_grid(lat, lon, lat[::-1].copy(), lon[::-1].copy())
    assert not i125.same_grid(lat, lon, lat[:2], lon[:2])
    packed = lat + np.array([0.00195, -0.00195, 0.0]), lon + np.array([0.0039, -0.0039, 0.0])    # GRIB packing, as measured
    assert i125.same_grid(lat, lon, *packed)
    assert not i125.same_grid(lat, lon, lat + np.array([0.12, 0.0, 0.0]), lon)                   # a neighbouring cell


def _scrip(method="Nearest neighbor", dims=(i125.DWD_COLS, i125.ROWS), n=None):
    netCDF4 = pytest.importorskip("netCDF4")
    links = n if n is not None else dims[0] * dims[1]
    ds = netCDF4.Dataset("t", "w", diskless=True, memory=1024)
    ds.map_method = method
    ds.createDimension("dst_grid_rank", 2)
    ds.createDimension("num_links", links)
    ds.createDimension("src_grid_size", 4)
    ds.createVariable("dst_grid_dims", "i4", ("dst_grid_rank",))[:] = list(dims)
    ds.createVariable("dst_address", "i4", ("num_links",))[:] = np.arange(1, links + 1)
    ds.createVariable("src_address", "i4", ("num_links",))[:] = (np.arange(links) % 4) + 1
    ds.createVariable("src_grid_center_lat", "f8", ("src_grid_size",))[:] = np.radians([0.0, 10.0, 20.0, 30.0])
    ds.createVariable("src_grid_center_lon", "f8", ("src_grid_size",))[:] = np.radians([0.0, 5.0, 5.0, 5.0])
    return bytes(ds.close())


def test_dwds_nearest_neighbour_map_is_read_zero_based_on_the_expected_grid():
    nn, slat, slon = i125.read_dwd_nn(_scrip())
    assert nn.shape == (i125.ROWS, i125.DWD_COLS) and nn.dtype == np.int32
    assert nn.ravel()[:5].tolist() == [0, 1, 2, 3, 0] and np.allclose(slat, [0, 10, 20, 30]) and np.allclose(slon[1:], 5.0)


@pytest.mark.parametrize("kw,why", [({"method": "Conservative"}, "not nearest"), ({"dims": (1440, 721)}, "target grid"),
                                    ({"n": 7}, "target node")])
def test_anything_but_dwds_nearest_map_of_this_grid_is_refused(kw, why):
    with pytest.raises(RuntimeError, match=why):
        i125.read_dwd_nn(_scrip(**kw))


def test_the_lattice_is_the_0p125_grid_the_frame_encoder_is_given():
    g = fsr.GRIDS["0p125"]
    assert (g["rows"], g["cols"]) == (i125.ROWS, i125.COLS) and g["bounds"] == (-180.0, -90.0, 180.0 - i125.STEP, 90.0)
    assert i125.DWD_COLS == i125.COLS - 1


# ── the set: precipitation_icon_0p125 (dark) ───────────────────────────────────────────────────────────────────────────

from pathlib import Path  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

from services import frame_set as fs  # noqa: E402
from services import frame_set_raster_sources as srcs  # noqa: E402

SPEC = fsr.SPECS["precipitation_icon_0p125"]


def test_the_set_is_icon_rain_on_the_0p125_lattice_with_the_0p25_sets_hours():
    assert fs.set_key(SPEC["target"]) == "ICON/weather/precipitation/global_0p125"
    assert SPEC["grid"] == "0p125" and SPEC["frame_plane"] is True and SPEC["source"] == "icon_precip_0p125"
    assert tuple(SPEC["hours"]) == tuple(fsr.SPECS["precipitation_icon"]["hours"])
    assert srcs.SOURCES["icon_precip_0p125"] is srcs.IconPrecip0p125Source
    assert issubclass(srcs.IconPrecip0p125Source, srcs.IconPrecipSource)


def test_the_set_is_dark_until_its_own_variable_and_has_one_gated_pilots_step(monkeypatch):
    monkeypatch.delenv("FRAME_RASTER_PRECIP_ICON_0P125", raising=False)
    assert SPEC["default_on"] is False and not fsr.enabled("precipitation_icon_0p125")
    monkeypatch.setenv("FRAME_RASTER_PRECIP_ICON_0P125", "1")
    assert fsr.enabled("precipitation_icon_0p125")
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    steps = [s for s in yml.split("\n      - name: ")[1:] if "--set precipitation_icon_0p125\n" in s + "\n"]
    assert len(steps) == 1 and "vars.FRAME_IMAGES_PUBLISH == '1' && vars.FRAME_RASTER_PRECIP_ICON_0P125 == '1'" in steps[0]


class _Src(srcs.IconPrecip0p125Source):
    def __init__(self, dwd):
        super().__init__(SPEC, session=object())
        self.dwd, self.fetched = dwd, 0

    def _decode_bz2(self, url):
        return np.array([10.0, 20.0, 30.0, 40.0]) if url.endswith("CLAT.grib2.bz2") else np.array([0.0, 1.0, 2.0, 3.0])


def test_dwds_map_is_refused_when_its_cells_are_not_this_runs_cells(monkeypatch):
    src = _Src(None)
    monkeypatch.setattr(i125, "fetch_dwd_nn", lambda http: (np.zeros((2, 2), np.int32), np.array([10.0, 20.0, 40.0, 30.0]),
                                                            np.array([0.0, 1.0, 3.0, 2.0])))
    with pytest.raises(RuntimeError, match="not this run's ICON grid"):
        src.grid(datetime(2026, 11, 16, 0, tzinfo=timezone.utc))


def test_a_frame_is_the_area_mean_of_the_steps_rate_and_the_map_is_built_once(monkeypatch):
    src = _Src(None)
    built = []
    monkeypatch.setattr(src, "rate", lambda cycle, f, n: np.array([4.0, 0.0, 2.0, np.nan]))
    monkeypatch.setattr(srcs.IconPrecip0p125Source, "grid", lambda self, cycle: built.append(cycle) or (
        np.array([[[0, 0, 1, 1], [2, 2, 2, 3]]], dtype=np.int32), 4))
    plane = src.fetch("run", 6)
    assert plane.tolist() == [[2.0, 2.0]] and built == ["run"]


def test_a_box_over_the_cap_is_refused_never_silently_truncated():
    lat = np.zeros(13)
    lon = np.zeros(13)                                              # 13 cells round to one node
    with pytest.raises(RuntimeError, match="more than the cap"):
        i125.box_cells(lat, lon, rows=ROWS, cols=COLS, step=STEP, cap=12)
    assert i125.box_cells(lat[:12], lon[:12], rows=ROWS, cols=COLS, step=STEP, cap=12).shape[2] == 12


def test_a_single_cell_spike_is_found_in_its_own_box_and_its_mass_is_kept():
    """The registered null control, as the advisor asked: a field that is zero but for ONE cell. A misplaced pick map moves the
    spike; a mis-weighted one loses or gains its mass. Here cells are the nodes' own centres plus one off-centre spike cell."""
    lat, lon = _nodes()
    base = _cells_at(lat, lon)
    spike_lat, spike_lon = 22.5 + 3.0, -45.0 + 4.0                  # inside node (r=5, c=6)'s box, off its centre
    xyz = np.concatenate([base, _cells_at(np.array([spike_lat]), np.array([spike_lon]))])
    cl = np.concatenate([lat.ravel(), [spike_lat]])
    co = np.concatenate([lon.ravel(), [spike_lon]])
    nn = np.arange(ROWS * COLS, dtype=np.int32).reshape(ROWS, COLS)
    pick = i125.subpoint_pick(nn, xyz, cl, co, k=9, rows=ROWS, cols=COLS, step=STEP, reach_deg=STEP)
    vals = np.zeros(cl.size)
    vals[-1] = 90.0
    plane = i125.area_mean(vals, pick)
    r, c = np.unravel_index(np.argmax(plane), plane.shape)
    assert (int(r), int(c)) == (5, 6)                               # the spike stays in its own box
    assert np.count_nonzero(plane) >= 1 and plane.max() < 90.0      # shared with the centre cell: an area mean


def test_every_pick_is_the_true_nearest_cell_on_a_random_mesh():
    """The advisor's guard for the offline 800/800-per-band measurement: on an irregular random mesh about as dense as the boxes,
    the pick map equals a brute force over ALL cells for every sub-point, at every latitude including the pole rows."""
    rows, cols, step = 37, 72, 5.0
    rng = np.random.default_rng(11)
    n = 3000
    z = rng.uniform(-1, 1, n)
    lon = rng.uniform(-180, 180, n)
    lat = np.degrees(np.arcsin(z))                                  # uniform on the sphere
    xyz = i125._unit(lat, lon)
    nlat, nlon = _nodes(rows, cols, step)
    nodes = i125._unit(nlat, nlon).reshape(-1, 3)
    nn = np.argmax(nodes @ xyz.T, 1).astype(np.int32).reshape(rows, cols)       # each node's true nearest
    pick = i125.subpoint_pick(nn, xyz, lat, lon, k=3, rows=rows, cols=cols, step=step, reach_deg=step)
    off = (np.arange(3) - 1) * (step / 3)
    slat = np.clip((-90.0 + step * np.arange(rows))[:, None] + off, -90, 90)
    slon = (-180.0 + step * np.arange(cols))[:, None] + off
    sub = i125._unit(slat[:, None, :, None], slon[None, :, None, :]).reshape(rows, cols, 9, 3)
    brute = np.argmax(sub @ xyz.T, 3)
    d = lambda idx: np.take_along_axis(sub @ xyz.T, idx[..., None], 3)[..., 0]   # noqa: E731
    assert np.array_equal(pick, brute) or np.allclose(d(pick), d(brute), atol=0, rtol=0)


def test_a_real_near_tie_is_decided_in_float64():
    """ICON grid 0026, 2026-11-16: cells 10166 (80.29393, 81.99219) and 10167 (80.22362, 82.46094) from the sub-point (80.20833,
    81.95833). 10166 is 0.00098 deg nearer; float32 positions pick 10167."""
    cells = i125._unit(np.array([80.29393005371094, 80.22361755371094]), np.array([81.9921875, 82.4609375]))
    sub = i125._unit(np.array([80.25 - 0.125 / 3]), np.array([82.0 - 0.125 / 3]))                  # (1 sub-point, 3)
    cands = np.array([1, 0])
    assert int(i125.nearest_among(sub, cells, cands)[0]) == 0
    rounded = cells.astype(np.float32).astype(np.float64)          # the defect: cell positions held in float32
    assert int(i125.nearest_among(sub, rounded, cands)[0]) == 1     # ... flips the pick to the farther cell

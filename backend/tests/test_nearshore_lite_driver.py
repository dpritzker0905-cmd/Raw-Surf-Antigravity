"""MOP-lite NetCDF driver on small SYNTHETIC NetCDF subsets (no network, no GeoTIFF dependency)."""
import numpy as np
import pytest
import xarray as xr

from services.weather_pipeline.nearshore_lite import coefficients as coef
from services.weather_pipeline.nearshore_lite import driver, freeze

LAT0, LON0 = 33.0, -118.0


def _write(path, lat, lon, z, var="elevation", lat_name="lat", lon_name="lon"):
    ds = xr.Dataset({var: ((lat_name, lon_name), z)}, coords={lat_name: lat, lon_name: lon})
    ds.to_netcdf(path)
    return str(path)


def _plane(tmp_path, name, dlat, dlon, offset=0.0, half=0.5, lat_rng=None, lon_rng=None, shore_m=3000.0, slope=0.02):
    """A north-south coast: sea to the WEST, land to the east. Elevation-style (negative = below datum).
    `lat_rng` / `lon_rng` = (lo, hi) offsets from the target, for tiles that cover only part of the domain."""
    la, lo = lat_rng or (-half, half), lon_rng or (-half, half)
    lat = np.arange(LAT0 + la[0], LAT0 + la[1] + 1e-9, dlat)
    lon = np.arange(LON0 + lo[0], LON0 + lo[1] + 1e-9, dlon)
    x_m = (lon - LON0) * 111320.0 * np.cos(np.radians(LAT0))
    depth = slope * (shore_m - x_m) + offset                 # shore 3 km east of the target; depth grows seaward
    z = -np.tile(depth[None, :], (lat.size, 1))
    z[:, depth <= 0] = 5.0                                 # land: positive elevation
    return _write(tmp_path / f"{name}.nc", lat, lon, z)


def test_reader_normalises_sign_and_orientation(tmp_path):
    lat = np.array([34.0, 33.0, 32.0])                     # descending, as many products store it
    lon = np.array([-119.0, -118.0, -117.0])
    z = np.array([[-10.0, -20.0, 5.0], [-30.0, -40.0, 5.0], [-50.0, -60.0, 5.0]])
    p = _write(tmp_path / "a.nc", lat, lon, z)
    la, lo, d = driver.read_netcdf_depth(p, "elevation", sign=-1.0)
    assert la.tolist() == [32.0, 33.0, 34.0] and d[0, 0] == 50.0 and d[2, 0] == 10.0 and np.isnan(d[0, 2])
    p2 = _write(tmp_path / "b.nc", lat, lon, np.abs(z), var="depth", lat_name="latitude", lon_name="longitude")
    la2, lo2, d2 = driver.read_netcdf_depth(p2, "depth", sign=+1.0)
    assert d2[0, 0] == 50.0


def test_an_unreadable_or_mismatched_source_raises(tmp_path):
    with pytest.raises(driver.SourceReadError):
        driver.read_netcdf_depth(str(tmp_path / "missing.nc"), "elevation")
    p = _write(tmp_path / "c.nc", np.array([0.0, 1.0]), np.array([0.0, 1.0]), np.zeros((2, 2)))
    with pytest.raises(driver.SourceReadError, match="variable"):
        driver.read_netcdf_depth(p, "nope")


def test_bilinear_resample_reproduces_a_linear_field_and_marks_outside_nan():
    lat = np.arange(0.0, 3.0, 1.0)
    lon = np.arange(0.0, 3.0, 1.0)
    d = (2.0 * lat[:, None] + 3.0 * lon[None, :]) + 10.0
    out = driver.resample_bilinear(lat, lon, d, np.array([0.5, 1.25]), np.array([0.5, 2.0, 5.0]))
    assert out[0, 0] == pytest.approx(10.0 + 1.0 + 1.5) and out[1, 1] == pytest.approx(10.0 + 2.5 + 6.0)
    assert np.isnan(out[:, 2]).all()


def test_build_target_converts_datum_checks_the_seam_and_freezes_in_order(tmp_path):
    fine = _plane(tmp_path, "cudem", 0.002, 0.002, offset=0.0, half=0.04)      # small tile: GEBCO fills beyond it
    gebco = _plane(tmp_path, "gebco", 0.01, 0.01, offset=0.0)
    srcs = [
        {"name": "CUDEM", "path": fine, "var": "elevation", "native_datum": "NAVD88", "offset_m": 0.1,
         "method": "vdatum", "version": "VDatum 4.7", "volume": "tile1", "tile_sha256": "a" * 64},
        {"name": "GEBCO", "path": gebco, "var": "elevation", "native_datum": "MSL", "volume": "GEBCO_2024"},
    ]
    target, rows = driver.build_target("T1", LAT0, LON0, srcs, half_extent_m=6000.0, dx_m=50.0)
    assert target["sources"] == ["CUDEM", "GEBCO"] and target["stratum"] == "COARSE"       # GEBCO fills cells within 5 km
    assert target["datum_records"][0]["version"] == "VDatum 4.7" and target["tile_sha256"] == {"CUDEM:tile1": "a" * 64}
    assert len(rows) == 1 and rows[0].join == "CUDEM:tile1|GEBCO:GEBCO_2024" and rows[0].n_cells > 0
    assert rows[0].median_m == pytest.approx(0.1, abs=0.05)           # the NAVD88 -> MSL offset is the whole difference
    sp, sha = freeze.commit_seam_table(str(tmp_path / "s"), rows)
    freeze.freeze_targets(str(tmp_path / "c"), [target], sp, sha)
    tab = coef.load_verified(str(tmp_path / "c"), "T1")
    assert tab.meta["stratum"] == "COARSE" and tab.depth_t_m > 1.0
    assert tab.meta["convergence_half_step"] is not None


def test_a_datum_error_between_sources_is_a_seam(tmp_path):
    a = _plane(tmp_path, "crm", 0.002, 0.002, offset=0.0, lon_rng=(-0.05, 0.02))
    b = _plane(tmp_path, "emod", 0.002, 0.002, offset=2.0, lon_rng=(0.0, 0.05))   # 2 m vertical disagreement
    srcs = [{"name": "CRM", "path": a, "var": "elevation", "native_datum": "EGM2008"},
            {"name": "EMODNET", "path": b, "var": "elevation", "native_datum": "MSL"}]
    target, rows = driver.build_target("T2", LAT0, LON0, srcs, half_extent_m=6000.0, dx_m=50.0)
    assert rows[0].tag == "SEAM" and "SEAM" in target["tags"]


def test_a_source_wholly_hidden_under_a_finer_one_makes_no_join(tmp_path):
    a = _plane(tmp_path, "crm", 0.002, 0.002)
    b = _plane(tmp_path, "emod", 0.002, 0.002, offset=2.0)
    srcs = [{"name": "CRM", "path": a, "var": "elevation", "native_datum": "EGM2008"},
            {"name": "EMODNET", "path": b, "var": "elevation", "native_datum": "MSL"}]
    _, rows = driver.build_target("T2b", LAT0, LON0, srcs, half_extent_m=6000.0, dx_m=50.0)
    assert rows == []                                                # never composed next to each other: no join in the domain


def test_an_unresolved_datum_tags_the_target(tmp_path):
    a = _plane(tmp_path, "crm", 0.002, 0.002)
    srcs = [{"name": "CRM", "path": a, "var": "elevation", "native_datum": "MLLW"}]   # no offset supplied
    target, rows = driver.build_target("T3", LAT0, LON0, srcs, half_extent_m=6000.0, dx_m=50.0)
    assert "DATUM_1M" in target["tags"] and target["stratum"] == "FINE"


def test_no_data_in_the_domain_is_refused(tmp_path):
    lat, lon = np.array([10.0, 11.0]), np.array([10.0, 11.0])
    p = _write(tmp_path / "far.nc", lat, lon, -np.ones((2, 2)) * 20)
    with pytest.raises(driver.SourceReadError, match="no source has data"):
        driver.build_target("T4", LAT0, LON0, [{"name": "GEBCO", "path": p, "var": "elevation", "native_datum": "MSL"}],
                            half_extent_m=3000.0, dx_m=100.0)


def test_a_direct_cudem_gebco_join_is_checked_even_with_crm_between_them_in_priority(tmp_path):
    """CUDEM (west) and GEBCO (everywhere, 3 m deeper) meet directly in the south; CRM covers only a northern strip.
    A priority-consecutive scheme would pair CUDEM|CRM and CRM|GEBCO and never CUDEM|GEBCO."""
    cudem = _plane(tmp_path, "cudem", 0.002, 0.002, half=0.04, lon_rng=(-0.04, 0.0), shore_m=1000.0)
    crm = _plane(tmp_path, "crm", 0.002, 0.002, lat_rng=(0.01, 0.04), lon_rng=(-0.04, 0.04), shore_m=1000.0)
    gebco = _plane(tmp_path, "gebco", 0.01, 0.01, offset=3.0, shore_m=1000.0)
    srcs = [{"name": "CUDEM", "volume": "t1", "path": cudem, "var": "elevation", "native_datum": "MSL"},
            {"name": "CRM", "volume": "v1", "path": crm, "var": "elevation", "native_datum": "EGM2008"},
            {"name": "GEBCO", "volume": "G24", "path": gebco, "var": "elevation", "native_datum": "MSL"}]
    target, rows = driver.build_target("J1", LAT0, LON0, srcs, half_extent_m=6000.0, dx_m=50.0)
    joins = {r.join: r for r in rows}
    assert "CUDEM:t1|GEBCO:G24" in joins, sorted(joins)
    assert joins["CUDEM:t1|GEBCO:G24"].tag == "SEAM" and joins["CUDEM:t1|GEBCO:G24"].p95_m == pytest.approx(3.0, abs=0.2)
    assert "SEAM" in target["tags"]


def test_two_crm_volumes_keep_their_own_datum_records_and_their_join_is_checked(tmp_path):
    """Volume A is stored at MLLW (0.9 m below MSL), volume B at EGM2008 (= MSL). Same physical seabed. With the right
    offset the join is clean; with the offset missing it is DATUM_1M and the 1.5 m step is a SEAM."""
    a_native_shift = -1.5                                           # volume A stored 1.5 m shallower than MSL depth
    west = {"lon_rng": (-0.05, 0.0), "lat_rng": (-0.05, 0.05)}
    east = {"lon_rng": (0.0, 0.05), "lat_rng": (-0.05, 0.05)}
    va = _plane(tmp_path, "crmA", 0.002, 0.002, offset=a_native_shift, shore_m=1000.0, slope=0.002, **west)
    vb = _plane(tmp_path, "crmB", 0.002, 0.002, shore_m=1000.0, slope=0.002, **east)
    good = [{"name": "CRM", "volume": "A", "path": va, "var": "elevation", "native_datum": "MLLW", "offset_m": 1.5,
             "method": "co-ops-datums", "version": "9410230"},
            {"name": "CRM", "volume": "B", "path": vb, "var": "elevation", "native_datum": "EGM2008"}]
    target, rows = driver.build_target("C1", LAT0, LON0, good, half_extent_m=3000.0, dx_m=50.0)
    assert [r["volume_or_tile"] for r in target["datum_records"]] == ["A", "B"]          # neither record is lost
    assert {r["native_datum"] for r in target["datum_records"]} == {"MLLW", "EGM2008"}
    assert [r.join for r in rows] == ["CRM:A|CRM:B"] and rows[0].tag == "" and rows[0].p95_m < 0.5
    bad = [dict(good[0], offset_m=None), good[1]]
    target2, rows2 = driver.build_target("C2", LAT0, LON0, bad, half_extent_m=3000.0, dx_m=50.0)
    assert "DATUM_1M" in target2["tags"] and rows2[0].tag == "SEAM" and rows2[0].p95_m == pytest.approx(1.5, abs=0.3)


def test_duplicate_source_volume_inputs_are_refused(tmp_path):
    p = _plane(tmp_path, "d", 0.002, 0.002)
    s = {"name": "CRM", "volume": "A", "path": p, "var": "elevation", "native_datum": "MSL"}
    with pytest.raises(ValueError, match="duplicate"):
        driver.build_target("D", LAT0, LON0, [s, dict(s)], half_extent_m=3000.0, dx_m=50.0)


def _two_volumes(tmp_path, tag, step_m=0.0, dx_m=100.0):
    """Two non-overlapping CRM volumes of one PERFECT 1:50 plane beach; volume A is stored `step_m` deeper (a datum error)."""
    west = {"lon_rng": (-0.05, 0.0), "lat_rng": (-0.05, 0.05)}
    east = {"lon_rng": (0.0, 0.05), "lat_rng": (-0.05, 0.05)}
    va = _plane(tmp_path, f"{tag}A", 0.001, 0.001, offset=step_m, shore_m=1000.0, **west)
    vb = _plane(tmp_path, f"{tag}B", 0.001, 0.001, shore_m=1000.0, **east)
    srcs = [{"name": "CRM", "volume": "A", "path": va, "var": "elevation", "native_datum": "EGM2008"},
            {"name": "CRM", "volume": "B", "path": vb, "var": "elevation", "native_datum": "EGM2008"}]
    return driver.build_target(tag, LAT0, LON0, srcs, half_extent_m=3000.0, dx_m=dx_m)


def test_a_perfect_1_in_50_slope_at_100_m_cells_is_not_a_seam(tmp_path):
    """Amendment A9 (de-sloped pairing): neighbouring-cell pairing would give slope x cell = 2 m here."""
    target, rows = _two_volumes(tmp_path, "perfect")
    assert len(rows) == 1 and rows[0].n_cells >= 1 and rows[0].unpaired == 0
    assert rows[0].tag == "" and rows[0].p95_m < 0.15 and "SEAM" not in target["tags"]


def test_a_2_m_datum_step_on_that_slope_is_caught(tmp_path):
    target, rows = _two_volumes(tmp_path, "stepped", step_m=2.0)
    assert rows[0].tag == "SEAM" and rows[0].p95_m == pytest.approx(2.0, abs=0.3) and "SEAM" in target["tags"]


def _layers(h, w, left_cols, depth_fn):
    """Two layers split at column `left_cols`; layer 0 = west, layer 1 = east. Returns (layers, which)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    d = depth_fn(yy, xx)
    g0, g1 = np.where(xx < left_cols, d, np.nan), np.where(xx >= left_cols, d, np.nan)
    which = np.where(xx < left_cols, 0, 1).astype(np.int16)
    return [(("CRM", "A"), g0), (("CRM", "B"), g1)], which


def test_a_side_with_fewer_than_six_valid_cells_gives_no_pair_and_is_counted():
    layers, which = _layers(20, 20, 10, lambda yy, xx: 5.0 + 0.1 * xx)
    vi, vj, n_unpaired = driver.deslope_pairs(layers, which, 0, 1)
    assert len(vi) == 1 and n_unpaired == 0                          # enough cells: one pair, the planes agree
    assert vi[0] == pytest.approx(vj[0], abs=1e-6)
    thin = layers[1][1].copy()
    thin[:, 11:] = np.nan                                            # the east side keeps ONE column of cells inside the band
    thin[4:, :] = np.nan                                             # ...and only 4 rows: 4 valid cells < 6
    vi, vj, n_unpaired = driver.deslope_pairs([layers[0], (layers[1][0], thin)], which, 0, 1)
    assert vi == [] and vj == [] and n_unpaired == 1


def test_deep_water_joins_are_not_paired():
    layers, which = _layers(20, 20, 10, lambda yy, xx: 80.0 + 0.1 * xx)
    vi, vj, n_unpaired = driver.deslope_pairs(layers, which, 0, 1)
    assert vi == [] and n_unpaired == 1                              # nothing shallower than 30 m: counted, not silently dropped


def test_the_seam_table_reports_unpaired_segments():
    from services.weather_pipeline.nearshore_lite import seam
    row = seam.check_join("t", "A|B", "A,B", np.array([]), np.array([]))
    row.unpaired = 3
    text, _ = seam.to_csv([row])
    assert text.splitlines()[0].endswith("unpaired_segments") and text.splitlines()[1].endswith(",3")

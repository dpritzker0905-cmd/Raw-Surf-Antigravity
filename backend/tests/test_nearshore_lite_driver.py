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


def _plane(tmp_path, name, dlat, dlon, offset=0.0, half=0.5):
    """A north-south coast: sea to the WEST, land to the east. Elevation-style (negative = below datum)."""
    lat = np.arange(LAT0 - half, LAT0 + half + 1e-9, dlat)
    lon = np.arange(LON0 - half, LON0 + half + 1e-9, dlon)
    x_m = (lon - LON0) * 111320.0 * np.cos(np.radians(LAT0))
    depth = 0.02 * (3000.0 - x_m) + offset                 # shore 3 km east of the target; depth grows seaward
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
    assert target["datum_records"][0]["version"] == "VDatum 4.7" and target["tile_sha256"] == {"CUDEM": "a" * 64}
    assert len(rows) == 1 and rows[0].join == "CUDEM|GEBCO" and rows[0].n_cells > 0
    assert rows[0].median_m == pytest.approx(0.1, abs=0.05)           # the NAVD88 -> MSL offset is the whole difference
    sp, sha = freeze.commit_seam_table(str(tmp_path / "s"), rows)
    freeze.freeze_targets(str(tmp_path / "c"), [target], sp, sha)
    tab = coef.load_verified(str(tmp_path / "c"), "T1")
    assert tab.meta["stratum"] == "COARSE" and tab.depth_t_m > 1.0
    assert tab.meta["convergence_half_step"] is not None


def test_a_datum_error_between_sources_is_a_seam(tmp_path):
    a = _plane(tmp_path, "crm", 0.002, 0.002, offset=0.0)
    b = _plane(tmp_path, "emod", 0.002, 0.002, offset=2.0)            # 2 m vertical disagreement
    srcs = [{"name": "CRM", "path": a, "var": "elevation", "native_datum": "EGM2008"},
            {"name": "EMODNET", "path": b, "var": "elevation", "native_datum": "MSL"}]
    target, rows = driver.build_target("T2", LAT0, LON0, srcs, half_extent_m=6000.0, dx_m=50.0)
    assert rows[0].tag == "SEAM" and "SEAM" in target["tags"]


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

"""The raster frame-set tables load WITHOUT numpy (2026-11-23).

The data-health monitor runs scripts/raster_set_freshness.py on the runner's bare python3, which has no numpy. That script imports
services.frame_set_raster, which loads every own-module set through frame_set_raster_plugins. #1202 added a set whose module
imported the numpy gust core at load time; the import crashed, and the monitor checked no raster set at all (run 45187283647).
Each own-module set imports numpy where it builds frames, never at load. This test blocks numpy in a fresh interpreter and loads
the tables the way the monitor does.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

# sys.modules[name] = None makes `import name` raise ImportError, as on an interpreter without the package.
_PROBE = """
import sys
for name in ("numpy", "netCDF4", "h5py", "xarray", "scipy", "eccodes", "cfgrib"):
    sys.modules[name] = None
sys.path.insert(0, {backend!r})
{body}
"""


def _run(body):
    code = _PROBE.format(backend=str(BACKEND), body=body)
    return subprocess.run([sys.executable, "-c", code], cwd=str(BACKEND), capture_output=True, text=True, timeout=120)


def test_frame_set_raster_and_every_plugin_set_load_without_numpy():
    r = _run("from services import frame_set_raster as fsr\n"
             "assert 'gust_risk_ens' in fsr.SPECS and 'currents_giops' in fsr.SPECS, sorted(fsr.SPECS)\n"
             "assert 'numpy' not in {k for k, v in sys.modules.items() if v is not None}\n"
             "print(len(fsr.SPECS))")
    assert r.returncode == 0, r.stderr[-3000:]
    assert int(r.stdout.strip()) > 0


def test_the_freshness_script_loads_its_set_table_without_numpy():
    r = _run("import runpy\n"
             "sys.argv = ['raster_set_freshness.py', '--help']\n"
             "try:\n"
             "    runpy.run_path({script!r}, run_name='__main__')\n"
             "except SystemExit as e:\n"
             "    assert e.code in (0, None), e.code\n".replace("{script!r}", repr(str(BACKEND / "scripts" / "raster_set_freshness.py"))))
    assert r.returncode == 0, r.stderr[-3000:]


def test_the_gust_core_still_re_exports_the_schedule():
    from services.weather_pipeline import ens_gust_risk_core as gr
    from services.weather_pipeline import ens_gust_schedule as gs
    for name in ("KN_TO_MS", "MEMBERS", "THRESHOLDS_KN", "THRESHOLDS_MS", "gust_param", "gust_window_h", "native_steps"):
        assert getattr(gr, name) is getattr(gs, name), name
    assert gs.native_steps(360)[:2] == [3, 6] and gs.native_steps(360)[-1] == 360

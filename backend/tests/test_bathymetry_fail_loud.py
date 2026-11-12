"""CMP-4: a depth grid that cannot load must fail startup, not serve offshore height as surf height."""
import builtins
import inspect
import os
import sys

import pytest

from services.weather_pipeline import bathymetry as bathy


@pytest.fixture
def fresh_grid(monkeypatch):
    """Drop the cached grid so _load() really runs, and restore it afterwards."""
    monkeypatch.setattr(bathy, "_grid", None)
    monkeypatch.setattr(bathy, "_meta", None)
    monkeypatch.delenv("BATHYMETRY_FAIL_LOUD", raising=False)


def _block_numpy(monkeypatch):
    for name in [m for m in sys.modules if m == "numpy" or m.startswith("numpy.")]:
        monkeypatch.delitem(sys.modules, name)
    real_import = builtins.__import__

    def fake(name, *a, **k):
        if name == "numpy" or name.startswith("numpy."):
            raise ImportError("No module named 'numpy' (blocked by test)")
        return real_import(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fake)


def test_healthy_grid_passes_the_startup_check(fresh_grid):
    bathy.verify_loadable()  # must not raise


def test_numpy_blocked_fails_startup_instead_of_returning_offshore_height(fresh_grid, monkeypatch):
    _block_numpy(monkeypatch)
    with pytest.raises(bathy.BathymetryUnavailableError, match="cannot be loaded"):
        bathy.verify_loadable()


def test_kill_switch_restores_the_old_silent_degrade(fresh_grid, monkeypatch):
    monkeypatch.setenv("BATHYMETRY_FAIL_LOUD", "0")
    _block_numpy(monkeypatch)
    bathy.verify_loadable()  # no raise; readers keep returning None as before


def test_missing_asset_fails_startup(fresh_grid, monkeypatch):
    monkeypatch.setattr(bathy, "_NPY", os.path.join(os.path.dirname(bathy._NPY), "does_not_exist.npy"))
    with pytest.raises(bathy.BathymetryUnavailableError, match="missing"):
        bathy.verify_loadable()


def test_lifespan_runs_the_check_before_anything_else():
    import server
    src = inspect.getsource(server.lifespan)
    assert "verify_loadable()" in src
    assert src.index("verify_loadable()") < src.index("ensure_database_tables()")

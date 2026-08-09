"""The point resolver's selection key — resolution breaks time ties, one definition, kill-switched.

MASTER-AUDIT-11.0 resolution F7: the old key was (time_diff, bbox_area), so two GLOBAL products at
the same hour tied on BOTH terms and MANIFEST ORDER decided which answered a point — a 10° product
could shadow a 2° product covering the same coordinate, and 55.22% of served spots depend on a
global tier. This tie-break is the gate the audit put in front of any 0.25° coverage expansion.
The audit also required the change be revertible: POINT_RES_TIEBREAK=0 restores (diff, area)
byte-exactly, and both selection sites must share ONE key so they cannot drift apart again."""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.point_resolution import _selection_key          # noqa: E402
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct  # noqa: E402

NOW = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)


def _prod(res, west=-180.0, south=-80.0, east=180.0, north=85.0):
    return ManifestProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=NOW, valid_time_start=NOW, valid_time_end=NOW + timedelta(hours=1),
        resolution=res, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=CoverageBounds(west=west, south=south, east=east, north=north),
        filename=f"r{res}.json")


def test_a_time_tie_between_globals_now_goes_to_the_finer_product(monkeypatch):
    """The audit's exact case: 2° and 10° global products, same hour, same bbox — the old key
    tied on both terms and manifest order decided. Finer must win, in either order."""
    monkeypatch.delenv("POINT_RES_TIEBREAK", raising=False)
    fine, coarse = (_prod(2.0), 0.0), (_prod(10.0), 0.0)
    assert min([coarse, fine], key=_selection_key)[0].resolution == 2.0
    assert min([fine, coarse], key=_selection_key)[0].resolution == 2.0


def test_time_stays_primary_a_closer_coarse_product_still_beats_a_farther_fine_one(monkeypatch):
    monkeypatch.delenv("POINT_RES_TIEBREAK", raising=False)
    closer_coarse, farther_fine = (_prod(10.0), 600.0), (_prod(0.25), 3600.0)
    assert min([farther_fine, closer_coarse], key=_selection_key)[0].resolution == 10.0


def test_the_kill_switch_restores_the_old_key_exactly(monkeypatch):
    """With POINT_RES_TIEBREAK=0 the key must be (diff, area) — resolution invisible again, so a
    rollback reproduces the pre-change selection byte-for-byte."""
    monkeypatch.setenv("POINT_RES_TIEBREAK", "0")
    fine, coarse = (_prod(2.0), 0.0), (_prod(10.0), 0.0)
    assert _selection_key(fine) == _selection_key(coarse), (
        "under the kill switch two same-time same-bbox products must TIE (resolution must not "
        "enter the key), leaving manifest order to decide as before")
    smaller_area = (_prod(10.0, west=-10, south=-10, east=10, north=10), 0.0)
    assert min([fine, smaller_area], key=_selection_key)[0] is smaller_area[0], (
        "under the kill switch area must still break the time tie")


def test_both_selection_sites_share_the_one_key_so_they_cannot_drift():
    import inspect
    from services.weather_pipeline import point_resolution as PR
    for fn_name in ("_resolve_point_internal", "find_cached_grid_product"):
        src = inspect.getsource(getattr(PR.PointResolutionService, fn_name))
        assert "key=_selection_key" in src, (
            f"{fn_name} no longer uses the shared _selection_key — the two sites can drift into "
            f"different selection semantics, which is how the four duplicate lambdas happened")
        assert "get_bbox_area" not in src, (
            f"{fn_name} regrew a local ranking — rank in _selection_key only")

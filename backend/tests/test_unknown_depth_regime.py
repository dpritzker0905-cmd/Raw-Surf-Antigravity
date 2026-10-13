"""W-31 (audit 4.1): a coastal point with no usable depth is the NAMED regime `unknown_depth`, never `shelf`.

`estimate_surf` passes the offshore height through untouched when a coastal point has no usable depth, and labelled
it 'shelf', the regime of a friction-reduced height: no reader could tell "the shelf took nothing off" from "there
was no depth to ask". The height is unchanged (the null control below), every consumer that hides or excludes a
regime treats the new label exactly as it treated 'shelf', and the height convention still never reaches this path.
"""
import pytest

from services.weather_pipeline import surf_height_convention as shc
from services.weather_pipeline import surf_transform as st


@pytest.mark.parametrize("depth", [None, 0.0, -3.0])
def test_a_coastal_point_without_depth_is_named_and_passes_the_offshore_height(depth):
    assert st.estimate_surf(2.0, 12.0, depth, coastal=True, shelf_width_km=40.0) == (2.0, "unknown_depth")


@pytest.mark.parametrize("h110", ["0", "1"])
def test_the_null_control_the_served_height_is_unchanged_under_either_convention(monkeypatch, h110):
    """The old code returned (Hs, 'shelf') from the same branch, BEFORE `publish_surf_height`, so no H1/10 factor
    reached it under either label. Pinned both ways: the height is the offshore Hs, and the new label is not
    convertible, so a future caller cannot start converting this path by accident."""
    monkeypatch.setenv("SURF_HEIGHT_H110", h110)
    h, regime = st.estimate_surf(1.7, 11.0, None, coastal=True)
    assert h == 1.7 and regime == "unknown_depth"
    assert "unknown_depth" not in shc._CONVERTIBLE
    assert shc.to_surf_convention(h, regime) == h


def test_a_usable_depth_keeps_its_physical_regimes():
    for depth in (8.0, 25.0, 60.0):
        _, regime = st.estimate_surf(2.0, 12.0, depth, coastal=True, shelf_width_km=20.0)
        assert regime in ("shelf", "shoaling", "breaking")
    assert st.estimate_surf(2.0, 12.0, None, coastal=False) == (2.0, "open_ocean"), "not coastal: not surf"


def test_through_the_serving_producer_a_geometry_without_depth_is_named():
    """LESSONS L-P17: one test through the producer the app serves from. `surf_point.estimate_surf_at` is the ONE
    FORECAST COMPOSITION's height half; a resolved geometry with no shelf depth must reach the label, unconverted."""
    from services.weather_pipeline.surf_point import SurfGeometry, estimate_surf_at
    geo = SurfGeometry(depth_m=None, shelf_width_km=0.0, coastal=True, shore_normal_deg=None,
                       shore_normal_src="none", magnet_factor=1.0, magnet_name=None, break_depth_m=None,
                       nearshore=True)
    h, regime = estimate_surf_at(21.5, -158.0, 2.0, 12.0, swell_from_deg=None, geometry=geo)
    assert regime == "unknown_depth" and h == pytest.approx(2.0, rel=0.01)


def test_the_grid_keeps_an_unknown_depth_cell_as_it_kept_a_shelf_cell():
    """`surf_transform_grid` hides only open_ocean/calm/unknown; a no-depth coastal cell stays visible, as before."""
    class V:
        def __init__(self):
            self.lat, self.lng, self.speed, self.period, self.is_valid = 21.5, -158.0, 2.0, 12.0, True
            self.u, self.v = 1.2, -1.6

    cell = V()
    assert st.surf_transform_grid([cell], depth_fn=lambda la, ln: None) == (1, 0), "transformed, not masked"
    assert (cell.speed, cell.u, cell.v, cell.is_valid) == (2.0, 1.2, -1.6, True), "the offshore height, unchanged"

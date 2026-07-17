"""Unit tests for the per-CELL gridded size climatology (grid_size_climatology.py) — the rating BAND's
local-calibration reference field — and its serve seam (rating_transform_grid reference_fn)."""
import pytest

from services.weather_pipeline import grid_size_climatology as gc
from services.weather_pipeline.spot_size_climatology import merge_samples


# ─────────────────────────── lattice keys ───────────────────────────
def test_cell_key_quantization():
    assert gc.cell_key(0.0, 0.0) == "45,90"                    # (0+90)//2, (0+180)//2
    assert gc.cell_key(28.4, -80.6) == gc.cell_key(28.9, -80.1)  # same 2° cell
    assert gc.cell_key(28.4, -80.6) != gc.cell_key(28.4, -78.1)  # next cell east
    assert gc.cell_key(None, 10.0) is None
    assert gc.cell_key(10.0, 185.0) == gc.cell_key(10.0, -175.0)  # antimeridian wrap


# ─────────────────────────── accumulation ───────────────────────────
def _pt(lat, lng, h, t=10.0):
    return {"latitude": lat, "longitude": lng,
            "hourly": {"time": ["2026-07-12T00:00:00Z"], "wave_height": [h], "wave_period": [t]}}


def _fns(depth=6.0, coastal=True, width=20.0):
    return dict(depth_fn=lambda la, ln: depth, coastal_fn=lambda la, ln: coastal,
                width_fn=lambda la, ln: width)


def test_accumulate_coastal_cells_only():
    pts = [_pt(28.5, -80.5, 1.5), _pt(30.5, -80.5, 1.5)]
    calls = []

    def coastal_fn(la, ln):
        calls.append(la)
        return la < 30.0                                        # only the first point is coastal

    obj = gc.accumulate_points_into_grid_climatology(
        None, pts, depth_fn=lambda la, ln: 6.0, coastal_fn=coastal_fn, width_fn=lambda la, ln: 20.0)
    assert len(calls) == 2
    assert gc.cell_key(28.5, -80.5) in obj["cells"]
    assert gc.cell_key(30.5, -80.5) not in obj["cells"]          # open-water/offshore point skipped
    assert obj["schema_version"] == gc.SCHEMA_VERSION
    assert obj["lattice_deg"] == gc.LATTICE_DEG


def test_accumulate_folds_across_runs_and_skips_bad_points():
    pts = [_pt(28.5, -80.5, 1.5), _pt(28.6, -80.4, 1.2),         # same cell
           _pt(28.5, -80.5, None), {"latitude": 1.0}]            # missing height / malformed
    obj = gc.accumulate_points_into_grid_climatology(None, pts, **_fns())
    key = gc.cell_key(28.5, -80.5)
    n1 = obj["cells"][key]["n"]
    assert n1 >= 1                                               # both real samples fold into the one cell
    obj2 = gc.accumulate_points_into_grid_climatology(obj, [_pt(28.5, -80.5, 1.4)], **_fns())
    assert obj2["cells"][key]["n"] > n1                          # second run accumulates, not replaces


def test_accumulate_excludes_subrideable_days():
    # A trace 0.1 m offshore swell breaks below the 0.2 m rideability floor -> merge_samples drops it,
    # so flat days never drag a coast's "good day" reference down (mirrors the spot blob's floor).
    pts = [_pt(28.5, -80.5, 0.1)]
    obj = gc.accumulate_points_into_grid_climatology(None, pts, **_fns())
    key = gc.cell_key(28.5, -80.5)
    assert key not in obj["cells"] or obj["cells"][key]["n"] == 0


# ─────────────────────────── serving ───────────────────────────
def test_reference_for_exact_cell_and_bootstrap():
    key = gc.cell_key(28.5, -80.5)
    well = {"lattice_deg": 2.0, "cells": {key: {"hist": merge_samples(None, [0.6, 0.7, 0.8] * 8)}}}
    ref = gc.reference_for(well, 28.5, -80.5)
    assert ref is not None and 0.4 <= ref <= 1.2                 # small-wave coast -> small reference
    sparse = {"lattice_deg": 2.0, "cells": {key: {"hist": merge_samples(None, [0.6, 0.7])}}}
    assert gc.reference_for(sparse, 28.5, -80.5) is None         # under MIN_SAMPLES -> bootstrap default


def test_reference_for_neighbor_fallback():
    # The queried cell has no climatology (e.g. a fine dynamic-lane cell whose 2° center classified
    # open-ocean) but its coastal neighbor does -> inherit the neighborhood reference.
    neighbor = gc.cell_key(28.5, -78.5)                          # one cell east
    obj = {"lattice_deg": 2.0, "cells": {neighbor: {"hist": merge_samples(None, [2.0, 2.2, 2.4] * 8)}}}
    ref = gc.reference_for(obj, 28.5, -80.5)
    assert ref is not None and ref >= 1.5                        # big-wave neighborhood
    assert gc.reference_for(obj, -40.0, 100.0) is None           # far away -> nothing to inherit
    assert gc.reference_for(None, 28.5, -80.5) is None


def test_band_and_glyph_saturate_identically():
    """The band's per-cell reference must come out of the SAME p80+clamp math as the glyph's per-spot
    reference — identical histograms must yield identical references (the consistency gate)."""
    from services.weather_pipeline.spot_size_climatology import reference_from_hist
    hist = merge_samples(None, [0.5, 0.6, 0.7, 0.8, 0.9] * 5)
    key = gc.cell_key(28.5, -80.5)
    grid_ref = gc.reference_for({"lattice_deg": 2.0, "cells": {key: {"hist": hist}}}, 28.5, -80.5)
    assert grid_ref == reference_from_hist(hist)


# ─────────────────────────── rating_transform_grid seam ───────────────────────────
class _Vec:
    def __init__(self, lat, lng, speed, period=11.0, direction=270.0):
        self.lat = lat; self.lng = lng; self.speed = speed
        self.period = period; self.direction = direction
        self.u = 1.0; self.v = 0.5; self.is_valid = True


def _transform(reference_fn):
    from services.weather_pipeline.surf_rating import rating_transform_grid
    # 0.4 m ≈ a genuinely SMALL day post-SURF-v3: the v3 Komar/recal chain reads 0.8 m offshore as a
    # solid ~1.2 m surf day (accurate — the v2 number was the underread), which defeated this test's
    # small-day premise. The scenario intent (local reference LIFTS a small-wave coast) needs surf
    # below the 0.6 m local reference's neighborhood, so feed a knee-high day.
    vecs = [_Vec(28.5, -80.5, 0.4)]                              # ~1.3 ft offshore swell
    n, _ = rating_transform_grid(
        vecs, lambda la, ln: 6.0, coastal_fn=lambda la, ln: True, width_fn=lambda la, ln: 20.0,
        wind_fn=lambda la, ln: (2.0, 90.0), shore_normal_fn=lambda la, ln: 270.0,
        reference_fn=reference_fn)
    assert n == 1
    return vecs[0].speed * 10.0                                  # decode score from the height channel


def test_rating_transform_local_reference_lifts_small_wave_coast():
    baseline = _transform(None)                                  # global 1.2 m default
    local = _transform(lambda la, ln: 0.6)                       # FL-style small good-day reference
    big = _transform(lambda la, ln: 4.0)                         # big-wave coast reference
    assert local > baseline                                      # same day rates HIGHER on a small-wave coast
    assert big < baseline                                        # and LOWER where the coast wants size
    crash = _transform(lambda la, ln: (_ for _ in ()).throw(RuntimeError("boom")))
    assert crash == pytest.approx(baseline)                      # a reference error never kills the band


def test_apply_surf_overlay_threads_reference_under_flag():
    """The serve wiring must build the reference_fn ONLY under RATING_LOCAL_SIZE (the same flag as the
    glyph path — band and glyphs flip together) and pass it into rating_transform_grid."""
    import inspect
    from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay
    src = inspect.getsource(apply_surf_overlay)
    assert 'os.environ.get("RATING_LOCAL_SIZE", "0") == "1"' in src
    assert "load_grid_size_climatology_l2_cached" in src
    assert "reference_fn=reference_fn" in src


def test_gfs_mid_ingest_wires_grid_climatology():
    """The GFS global_mid ingest folds hour-0 breaking heights into the grid blob (gated, never fatal)."""
    import inspect
    from services.weather_pipeline.marine_mid_res_ingestion import ingest_gfs_marine_global_mid_impl
    src = inspect.getsource(ingest_gfs_marine_global_mid_impl)
    assert "RATING_GRID_SIZE_CLIMATOLOGY" in src
    assert "accumulate_points_into_grid_climatology" in src
    assert "upload_grid_size_climatology_l2" in src

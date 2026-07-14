"""Goldens for the DATA-EXTENT CLAMP in filter_grid_to_bbox (2026-07-14).

The June-15 window-padding (262d37bc) filled the requested window past the product's real
lattice with is_valid=False cells and claimed the window as bounds/coverage — a stopgap for
the pre-wash era that, by July, masked the partial-coverage machinery (live symptom: dead
animation zone east of the florida tile's -79 data edge, no wash fallback, sticky resident).
The clamp keeps rectangular INTERIOR fill but never mints EXTERIOR padding.
"""
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.route_helpers import filter_grid_to_bbox
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)


def make_product(west=-85.0, east=-79.0, south=24.0, north=26.0, res=1.0, skip_cells=()):
    """A rectangular product lattice at `res` spacing; positions in skip_cells are omitted
    (interior holes)."""
    vectors = []
    lat = south
    while lat <= north + 1e-9:
        lng = west
        while lng <= east + 1e-9:
            if (round(lat, 4), round(lng, 4)) not in skip_cells:
                vectors.append(GridVector(lat=round(lat, 4), lng=round(lng, 4),
                                          u=1.0, v=0.0, speed=1.0, period=8.0))
            lng += res
        lat += res
    bounds = CoverageBounds(west=west, south=south, east=east, north=north)
    cols = int(round((east - west) / res)) + 1
    rows = int(round((north - south) / res)) + 1
    grid = NormalizedGrid(bounds=bounds, cols=cols, rows=rows, vectors=vectors)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800, resolution=res,
    )


def test_window_past_data_edge_is_clamped_not_padded():
    # The live shape: product data ends at -79; the window pokes to -77. Pre-fix the output
    # claimed E=-77 with dead columns; now it must claim the TRUE data edge.
    p = make_product()
    out = filter_grid_to_bbox(p, "-81.0,24.0,-77.0,26.0")
    assert out.grid.bounds.east == -79.0
    assert max(v.lng for v in out.grid.vectors) == -79.0
    assert all(v.is_valid is not False for v in out.grid.vectors)  # no exterior dead cells
    assert out.coverage.east == -79.0  # the coverage CLAIM tells the truth too


def test_window_inside_data_unchanged():
    p = make_product()
    out = filter_grid_to_bbox(p, "-83.0,24.0,-81.0,26.0")
    assert out.grid.bounds.west == -83.0
    assert out.grid.bounds.east == -81.0
    assert out.grid.cols == 3


def test_window_fully_outside_data_returns_honest_empty():
    p = make_product()
    out = filter_grid_to_bbox(p, "-77.0,24.0,-75.0,26.0")
    assert out.grid.cols == 0
    assert out.grid.vectors == []


def test_interior_holes_keep_rectangular_fill():
    # A missing INTERIOR cell must still be filled (WebGL needs rectangles) — the clamp only
    # forbids exterior padding.
    p = make_product(skip_cells={(25.0, -82.0)})
    out = filter_grid_to_bbox(p, "-83.0,24.0,-81.0,26.0")
    assert out.grid.cols * out.grid.rows == len(out.grid.vectors)
    hole = [v for v in out.grid.vectors if v.lat == 25.0 and v.lng == -82.0]
    assert len(hole) == 1 and hole[0].is_valid is False


def test_kill_switch_restores_window_padding(monkeypatch):
    monkeypatch.setenv("GRID_CLIP_TO_DATA_EXTENT", "0")
    p = make_product()
    out = filter_grid_to_bbox(p, "-81.0,24.0,-77.0,26.0")
    assert out.grid.bounds.east == -77.0  # June-15 behavior: window claimed
    dead = [v for v in out.grid.vectors if v.is_valid is False]
    assert dead  # exterior padding present again

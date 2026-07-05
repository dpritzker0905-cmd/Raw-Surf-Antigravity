"""Validity census in the backend truthTag (zoom-in cleared-rect forensics, 2026-07-05).

compute_truth_tag must report invalidCount (is_valid:false cells) and validZeroCount
(is_valid:true cells whose speed is exactly 0.0 — the land-cell-leak signature on a total-sea
waves grid) so a cleared-rectangle report is attributable from the served response alone.
"""
from datetime import datetime, timezone

from services.weather_pipeline.route_helpers import compute_truth_tag
from services.weather_pipeline.schemas import GridVector


def _tag(vectors):
    now = datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc)
    return compute_truth_tag(
        model="GFS", domain="marine", layer="waves",
        valid_time=now, run_time=now,
        product_id="test.json", provider="open-meteo", upstream_model="ncep_gfswave025",
        is_dynamic_viewport_product=False, coverage_scope="regional",
        requested_bbox="-120,33,-119,34", served_bbox="-120,33,-119,34",
        cols=2, rows=2, vectors=vectors,
    )


def test_census_counts_invalid_and_valid_zero():
    tag = _tag([
        GridVector(lat=33.0, lng=-120.0, speed=1.2, direction=200.0, u=0.4, v=1.1, is_valid=True),
        GridVector(lat=33.0, lng=-119.75, speed=0.0, direction=0.0, u=0.0, v=0.0, is_valid=False),
        GridVector(lat=33.25, lng=-120.0, speed=0.0, direction=0.0, u=0.0, v=0.0, is_valid=True),
        GridVector(lat=33.25, lng=-119.75, speed=0.9, direction=210.0, u=0.4, v=0.8, is_valid=True),
    ])
    assert tag["invalidCount"] == 1
    assert tag["validZeroCount"] == 1
    assert tag["nonzeroCount"] == 2
    assert tag["vectorCount"] == 4


def test_census_zero_on_clean_grid():
    tag = _tag([
        GridVector(lat=33.0, lng=-120.0, speed=1.2, direction=200.0, u=0.4, v=1.1, is_valid=True),
        GridVector(lat=33.0, lng=-119.75, speed=0.8, direction=190.0, u=0.1, v=0.8, is_valid=True),
    ])
    assert tag["invalidCount"] == 0
    assert tag["validZeroCount"] == 0


def test_census_empty_vectors():
    tag = _tag([])
    assert tag["invalidCount"] == 0
    assert tag["validZeroCount"] == 0
    assert tag["vectorCount"] == 0

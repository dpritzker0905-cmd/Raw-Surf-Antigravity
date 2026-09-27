"""/point says which frame actually answered (2026-09-27).

`valid_time` on a point response echoes the ASK, like /grid's always has. Measured live that day: a 04Z
request at a buoy was answered from the 03Z product (identical Hs to the 03Z answer) and a 05Z request
from the 06Z product, both labelled with the hour asked for. /grid solved this in 2026-07 with additive
honesty fields stamped by `grid_resolver.stamp_frame_honesty`; /point now carries the same three.
"""
import re
from datetime import datetime, timezone
from pathlib import Path

from services.weather_pipeline.grid_resolver import stamp_frame_honesty
from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse


def _point(frame_dt):
    return NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime(2026, 9, 26, 22, tzinfo=timezone.utc), valid_time=frame_dt,
        product_id="gfs_marine_waves_us_west_coast_socal_20260928T030000Z.json",
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=32.53, requested_lng=-117.43, sampled_lat=32.5,
                                    sampled_lng=-117.5, speed=1.04, direction=270.0, u=0.0, v=0.0,
                                    period=12.0, interpolation_method="nearest"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800)


def test_an_off_cycle_ask_says_which_frame_answered():
    r = _point(datetime(2026, 9, 28, 3, tzinfo=timezone.utc))
    ask = datetime(2026, 9, 28, 4, tzinfo=timezone.utc)
    stamp_frame_honesty(r, ask, "2026-09-28T04:00:00Z")
    r.valid_time = ask                                   # the echo the frontend contract keeps
    assert (r.served_valid_time, r.frame_offset_hours, r.frame_substituted) == (
        "2026-09-28T03:00:00Z", -1.0, True)
    assert r.valid_time == ask


def test_an_on_cycle_ask_is_not_flagged():
    t = datetime(2026, 9, 28, 3, tzinfo=timezone.utc)
    r = _point(t)
    stamp_frame_honesty(r, t, "2026-09-28T03:00:00Z")
    assert (r.served_valid_time, r.frame_offset_hours, r.frame_substituted) == (
        "2026-09-28T03:00:00Z", 0.0, False)


def test_the_fields_are_on_the_wire_with_honest_defaults():
    r = _point(datetime(2026, 9, 28, 3, tzinfo=timezone.utc))
    dumped = r.model_dump() if hasattr(r, "model_dump") else r.dict()
    assert (dumped["served_valid_time"], dumped["frame_offset_hours"], dumped["frame_substituted"]) == (
        None, 0.0, False)


def test_every_sampling_site_stamps_before_the_echo():
    """Structural: a sample_point site that overwrites valid_time without stamping first would publish
    the ask as the answer again. Every site must be followed by the stamp, then the echo."""
    src = (Path(__file__).resolve().parents[1] / "services/weather_pipeline/point_resolution.py").read_text(encoding="utf-8")
    samples = len(re.findall(r"response = self\.sampler\.sample_point\(product, lat, lng\)", src))
    stamped = len(re.findall(
        r"response = self\.sampler\.sample_point\(product, lat, lng\)\n\s+"
        r"stamp_frame_honesty\(response, target_dt, valid_time_str\)[^\n]*\n\s+response\.valid_time = target_dt",
        src))
    assert samples >= 3 and stamped == samples

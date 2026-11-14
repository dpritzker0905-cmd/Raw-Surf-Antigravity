"""ICON swell_2 served from its stored derived product, DARK by default (2026-11-13, option B; icon_swell2_serve.py).

Off (the default): /grid and /point answer "unsupported" whatever is stored. On: they answer from a stored product only where one
covers the asked time; with none, still "unsupported" (never a live upstream fetch for a layer ICON does not have); any failure in
the check fails closed to today's answer.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.weather_pipeline import icon_swell2_serve as S

T = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
BOUNDS = SimpleNamespace(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _item(t, model="ICON", layer="swell_2", estimated=True):
    return SimpleNamespace(model=model, domain="marine", layer=layer, region_id="global_coarse", is_estimated=estimated,
                           valid_time_start=t, valid_time_end=t, filename=f"{model}_{layer}_{t:%H}.json", resolution=10.0,
                           coverage=BOUNDS, is_test_fixture=False, provider="estimated", source_dataset="estimated_blend",
                           coverage_mode="global_tile", tile_id=None, run_time=t - timedelta(hours=6), ingested_at=t)


def _manifest(*items):
    return SimpleNamespace(products=list(items))


def test_dark_by_default_refuses_even_with_a_stored_product(monkeypatch):
    monkeypatch.delenv("ICON_SWELL2_SERVE", raising=False)
    assert S.serve_on() is False
    assert S.refuse(_manifest(_item(T)), "marine", T) is True


def test_on_serves_only_where_a_stored_product_covers_the_time(monkeypatch):
    monkeypatch.setenv("ICON_SWELL2_SERVE", "1")
    assert S.refuse(_manifest(_item(T)), "marine", T) is False                       # a product at the asked time
    assert S.refuse(_manifest(_item(T)), "marine", T + timedelta(hours=2)) is False  # within the +-3 h candidate window
    assert S.refuse(_manifest(_item(T)), "marine", T + timedelta(hours=12)) is True  # none covers it: still unsupported
    assert S.refuse(_manifest(_item(T, model="GFS")), "marine", T) is True           # another model's swell_2 never counts


def test_a_failing_check_fails_closed(monkeypatch):
    monkeypatch.setenv("ICON_SWELL2_SERVE", "1")
    assert S.refuse(None, "marine", T) is True


def test_both_routes_ask_the_gate_before_refusing():
    here = Path(__file__).resolve().parents[1] / "services" / "weather_pipeline"
    for name, unsupported in (("grid_resolver.py", "make_unsupported_icon_swell2_grid_response"),
                              ("point_resolution.py", "make_unsupported_icon_swell2_point_response")):
        src = (here / name).read_text(encoding="utf-8")
        gate = src.index("_icon_swell2_refuse(")
        assert gate < src.index(f"return {unsupported}(")
        assert "_icon_swell2_serve_on()" in src[gate - 400:gate + 200]

"""O4 (Fable audit 2026-11-10): the backend side paths that showed surf without the one chain.

CMP-5  /api/conditions/{id} forecast rows: from the precomputed rate_one_spot frames (rated), `no_data` where none.
CMP-6  /api/surf-conditions with a target time: the height is labelled an unrated Open-Meteo estimate.
CMP-7  `_breaking_ft` fails CLOSED (pinned in test_spot_conditions_surf_transform / test_surf_conditions_surf_transform).
"""
import asyncio
import inspect
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import side_paths

NOW = datetime(2026, 11, 10, 13, 20, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _flags(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.delenv("SIDE_PATHS_THROUGH_CHAIN", raising=False)


def test_preview_times_sit_on_the_glyph_frame_grid():
    assert side_paths.preview_times(NOW, 3) == ["2026-11-10T15:00:00Z", "2026-11-10T18:00:00Z", "2026-11-10T21:00:00Z"]
    on_grid = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    assert side_paths.preview_times(on_grid, 1) == ["2026-11-10T12:00:00Z"]


def _blob_loader(items_by_vt):
    """A fake precomputed blob read: `precomputed_item` is patched to look up by valid time."""
    return lambda: {"fake": True, "items": items_by_vt}


def test_the_rows_are_the_glyph_frames_with_their_rating_and_no_data_elsewhere(monkeypatch):
    from services.weather_pipeline import spot_hub_composition as hub
    frames = {"2026-11-10T15:00:00Z": {"surf_height_m": 1.2, "offshore_hs_m": 2.0, "score": 71.3, "level": "good"},
              "2026-11-10T18:00:00Z": {"surf_height_m": 0.9, "offshore_hs_m": 1.8, "score": 40.0, "level": "unknown"}}
    asked = []

    def fake_item(obj, spot, model, vt, exact):
        asked.append((spot["id"], model, vt, exact))
        it = obj["items"].get(vt)
        return (it, "precomputed", vt) if it else (None, "live", None)
    monkeypatch.setattr(hub, "precomputed_item", fake_item)
    rows = asyncio.run(side_paths.rated_preview_rows("s1", 28.3, -80.6, "GFS", now=NOW, load_l2=_blob_loader(frames)))
    assert len(rows) == 6 and all(a[3] is True for a in asked), "exact frames only: a neighbouring hour is not this one"
    assert rows[0]["wave_height_ft"] == round(1.2 * 3.28084, 1) and rows[0]["rating"] == 71.3
    assert rows[0]["rating_level"] == "good" and rows[0]["offshore_height_ft"] == round(2.0 * 3.28084, 1)
    assert rows[0]["status"] is None and rows[0]["source"] == "precomputed"
    assert rows[1]["rating_level"] is None, "'unknown' is not a level to show"
    for r in rows[2:]:
        assert r["status"] == "no_data" and r["wave_height_ft"] is None and r["rating"] is None


def test_an_unreadable_blob_gives_no_data_rows_not_an_exception(monkeypatch):
    def boom():
        raise OSError("L2 down")
    rows = asyncio.run(side_paths.rated_preview_rows("s1", 28.3, -80.6, "GFS", now=NOW, load_l2=boom))
    assert len(rows) == 6 and all(r["status"] == "no_data" for r in rows)


def test_the_route_reads_the_rated_rows_and_never_the_provider_while_the_flag_is_on():
    from routes.surf_data import conditions
    src = inspect.getsource(conditions.get_spot_conditions)
    on, off = src.split("else:", 1)[0], src.split("if _side.enabled():", 1)[1]
    assert "_side.rated_preview_rows(" in src and "provider.fetch_point" not in on.split("if _side.enabled():")[1]
    assert "provider.fetch_point" in off, "the kill switch keeps the old preview"


def test_a_target_time_estimate_says_it_is_unrated():
    r = side_paths.label_unrated_estimate({"wave_height_ft": 3.4, "source": "open-meteo"})
    assert r["rating"] is None and r["rating_status"] == "not_rated" and r["height_basis"] == "open_meteo_sea_estimate"
    assert "rating_status" not in side_paths.label_unrated_estimate({"wave_height_ft": None})


def test_the_kill_switch_restores_all_three(monkeypatch):
    monkeypatch.setenv("SIDE_PATHS_THROUGH_CHAIN", "0")
    assert side_paths.enabled() is False
    assert "rating_status" not in side_paths.label_unrated_estimate({"wave_height_ft": 3.4})


def test_the_surf_conditions_lane_labels_its_estimate():
    from services import surf_conditions
    assert "_side.label_unrated_estimate(result)" in inspect.getsource(surf_conditions.get_surf_conditions)


@pytest.mark.parametrize("failure", ["exception", "empty"])
def test_a_rated_preview_failure_preserves_current_and_reads_unavailable(monkeypatch, failure):
    """The isolation contract of the default path (the provider path's lives in test_audit_conditions_isolation):
    whatever the preview does, `current` survives and the preview says it has nothing."""
    from pathlib import Path
    import importlib.util
    from types import SimpleNamespace
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    monkeypatch.setenv("SPOT_HUB_RATE_ONE_SPOT", "0")
    path = Path(__file__).parents[1] / "routes/surf_data/conditions.py"
    spec = importlib.util.spec_from_file_location("o4_conditions_routes", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    current = dict(wave_height_ft=3.5, wave_direction=90, wave_period=10, swell_height_ft=2.8, swell_direction=85,
                   label="Waist high", updated_at="2026-10-02T12:00:00Z", rating=72)

    async def resolve(**kwargs):
        return {"current_conditions": current.copy()}

    async def rows(*a, **k):
        if failure == "exception":
            raise RuntimeError("blob read failed")
        return [side_paths.preview_row(None, "2026-10-02T12:00:00Z", None)]

    class Database:
        async def execute(self, statement):
            return SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(
                latitude=28.369, longitude=-80.603, name="Synthetic surf spot"))

    async def database():
        yield Database()

    async def must_not_fetch(**kwargs):
        raise AssertionError("the rated preview must not call the upstream provider")
    monkeypatch.setattr(module.point_resolution_service, "resolve_spot_conditions", resolve)
    monkeypatch.setattr(module.point_resolution_service.provider, "fetch_point", must_not_fetch)
    monkeypatch.setattr(side_paths, "rated_preview_rows", rows)
    app = FastAPI()
    app.include_router(module.router, prefix="/api")
    app.dependency_overrides[module.get_db] = database
    with TestClient(app) as client:
        body = client.get("/api/conditions/synthetic?model=GFS").json()
    assert body["current"]["wave_height_ft"] == 3.5 and body["current"]["rating"] == 72
    assert body["forecast_status"] == "unavailable"
    assert body["forecast"] == ([] if failure == "exception" else [side_paths.preview_row(None, "2026-10-02T12:00:00Z", None)])

"""The serve-side run-age cutoff (reliability lane PR 5): /capabilities carries the age of the CYCLE served per row.

Why it is needed: /api/health/data ages a lane by INGEST time, so a stuck cycle re-ingested every 4 h reads fresh
(2026-11-24 03:31Z: health said GFS/marine 2.5 h old while the published GFS marine frames were cycle 12Z of 11-23,
15+ h old). Pins: verified cycles only, global products only, the newest wins; the cutoff verdict and its override;
the label never withholds a row; the kill switch; a broken manifest never breaks /capabilities."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline import run_age as ra

NOW = datetime(2026, 11, 24, 3, 30, tzinfo=timezone.utc)


def _p(model="GFS", layer="waves", domain="marine", cycle="2026-11-23T12:00:00Z", status="known", region="global_mid",
       ingested="2026-11-24T01:00:00Z", source="ncep_gfswave025"):
    return SimpleNamespace(model=model, layer=layer, domain=domain, model_run_time=cycle, model_run_time_status=status,
                           region_id=region, run_time=ingested, source_dataset=source, coverage_mode=None)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ("RUN_AGE_SERVE", "RUN_AGE_CUTOFF_H_GFS"):
        monkeypatch.delenv(k, raising=False)
    ra._reset_for_tests()


def test_the_age_is_the_cycles_not_the_ingest_time():
    got = ra.describe(ra.newest_cycles([_p()])[("GFS", "marine", "waves")], "GFS", NOW)
    assert got == {"cycle": "2026-11-23T12:00:00Z", "age_h": 15.5, "cutoff_h": 18.0, "stale": False,
                   "source": "ncep_gfswave025"}


def test_newest_verified_global_cycle_wins():
    products = [_p(cycle="2026-11-23T00:00:00Z"), _p(cycle="2026-11-23T12:00:00Z"),
                _p(cycle="2026-11-24T00:00:00Z", status="estimated"),          # not verified: ignored
                _p(cycle="2026-11-24T00:00:00Z", region="hawaii")]             # regional pilot: ignored
    assert ra.newest_cycles(products)[("GFS", "marine", "waves")]["cycle"] == datetime(2026, 11, 23, 12, tzinfo=timezone.utc)


def test_a_stuck_cycle_is_stale_past_the_cutoff_and_the_cutoff_is_a_variable(monkeypatch):
    stuck = ra.newest_cycles([_p(cycle="2026-11-23T00:00:00Z")])[("GFS", "marine", "waves")]
    assert ra.describe(stuck, "GFS", NOW)["stale"] is True                    # 27.5 h > 18 h
    monkeypatch.setenv("RUN_AGE_CUTOFF_H_GFS", "36")
    assert ra.describe(stuck, "GFS", NOW)["stale"] is False
    assert ra.cutoff_h("EURO") == 30.0 and ra.cutoff_h("CMEMS") == 48.0 and ra.cutoff_h("NEW") == 30.0


def test_rows_are_labelled_never_dropped():
    rows = [{"model": "GFS", "domain": "marine", "layer": "waves"}, {"model": "ICON", "domain": "marine", "layer": "waves"}]
    out = ra.run_age_for_rows(rows, SimpleNamespace(products=[_p(cycle="2026-11-23T00:00:00Z")]), NOW)
    assert len(out) == 2 and out[0]["run_age"]["stale"] is True and out[1]["run_age"] is None
    assert "run_age" not in rows[0]                                            # the input rows are not mutated


def test_kill_switch_and_a_broken_manifest(monkeypatch):
    rows = [{"model": "GFS", "domain": "marine", "layer": "waves"}]
    monkeypatch.setenv("RUN_AGE_SERVE", "0")
    assert ra.run_age_for_rows(rows, SimpleNamespace(products=[_p()]), NOW) == rows
    monkeypatch.delenv("RUN_AGE_SERVE")

    class Boom:
        @property
        def products(self):
            raise OSError("manifest unreadable")
    assert ra.run_age_for_rows(rows, Boom(), NOW) == rows


def test_capabilities_carry_run_age_on_every_row(monkeypatch):
    from pathlib import Path
    from services.weather_pipeline import capabilities as caps
    from services.weather_pipeline import store
    monkeypatch.setattr(store.ProductStore, "get_manifest", lambda self: SimpleNamespace(products=[_p()]))
    rows = ra.run_age_for_rows(caps.get_weather_capabilities())
    assert rows and all("run_age" in r for r in rows)
    route = (Path(__file__).resolve().parents[1] / "routes" / "weather.py").read_text(encoding="utf-8")
    handler = route.split('@router.get("/capabilities")')[1].split("@router.")[0]
    assert "run_age_for_rows(get_weather_capabilities())" in handler and "asyncio.to_thread" in handler
    gfs = next(r for r in rows if r["model"] == "GFS" and r["domain"] == "marine" and r["layer"] == "waves")
    assert gfs["run_age"]["cycle"] == "2026-11-23T12:00:00Z" and gfs["run_age"]["cutoff_h"] == 18.0
    caps.validate_capabilities_contract(rows)                                  # the contract still holds

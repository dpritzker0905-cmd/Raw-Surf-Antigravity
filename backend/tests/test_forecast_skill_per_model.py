"""The skill ledger must score EVERY model we could serve, not just the one we do.

WHY THIS EXISTS. The ledger scored only `BUOY_CALIBRATION_MODEL` (default GFS) — which is also
`/spot-ratings`' default — against Open-Meteo's best-match blend, and reading the archive for the
first time showed a 0.104 m MAE gap in the competitor's favour (0.304 vs 0.199, paired over 3,852
cells, 42 of 59 buoys). The question nobody had asked was whether that is a RAW-SURF gap or a GFS
gap. Measured at 60 buoys, one hour, same coordinates, 100% paired:

    GFS MAE 0.388    ICON MAE 0.324    EURO MAE 0.223   (EURO closest at 29 of 60)

EURO wins every observed-height band, worst for GFS on flat water (0.616 vs 0.263). That decides
which model the product should default to — and it must NOT be decided on one hour, which is what
scoring all three continuously is for.

★ THE CONTRACT UNDER TEST IS BACKWARD COMPATIBILITY AS MUCH AS THE NEW BEHAVIOUR. The existing
archive is an append-only series keyed partly on `source`; renaming the primary source would have
silently split the history at today's date and made every prior row incomparable. So the primary
model must keep the bare `raw_surf` name, and only comparison lanes get a suffix.
"""
import pytest

from services.weather_pipeline import forecast_skill as FS


# ── THE BACKWARD-COMPATIBILITY HALF (the thing most likely to break silently) ──────────────────
def test_the_served_model_keeps_the_bare_source_name():
    """A rename here splits the append-only archive in two without any error."""
    assert FS.source_for("GFS", "GFS") == "raw_surf"
    assert FS.source_for("gfs", "GFS") == "raw_surf"        # case must not fork the series


def test_a_comparison_model_gets_a_distinct_suffixed_source():
    assert FS.source_for("EURO", "GFS") == "raw_surf:EURO"
    assert FS.source_for("ICON", "GFS") == "raw_surf:ICON"


def test_rows_default_to_the_legacy_source_so_existing_callers_are_unchanged():
    report = {"spots": [{"buoy_id": "44065", "residual": {"model_hs_m": 1.4, "model_tp_s": 9.0}}]}
    rows = FS.rows_from_calibration_report(report, "2026-08-04T00:00:00Z", 24)
    assert [r["source"] for r in rows] == ["raw_surf"]


def test_rows_carry_an_explicit_source_when_given_one():
    report = {"spots": [{"buoy_id": "44065", "residual": {"model_hs_m": 1.4, "model_tp_s": 9.0}}]}
    rows = FS.rows_from_calibration_report(report, "2026-08-04T00:00:00Z", 24, source="raw_surf:EURO")
    assert [r["source"] for r in rows] == ["raw_surf:EURO"]


def test_the_two_sources_do_not_collide_in_the_dedupe_key():
    """Same buoy, same target, same lead, different model — both rows must survive, or the
    comparison silently keeps whichever was written first."""
    base = {"buoy_id": "44065", "target_time": "2026-08-04T00:00:00Z", "lead_h": 24.0}
    assert FS.dedupe_key({**base, "source": "raw_surf"}) != \
           FS.dedupe_key({**base, "source": "raw_surf:EURO"})


# ── THE MODEL LIST ────────────────────────────────────────────────────────────────────────────
def test_the_default_compares_the_two_models_we_do_not_serve(monkeypatch):
    monkeypatch.delenv("FORECAST_SKILL_COMPARE_MODELS", raising=False)
    assert FS.compare_models("GFS") == ["ICON", "EURO"]


def test_the_primary_is_never_double_counted(monkeypatch):
    """Listing the served model as a comparison would score it twice under two source names and
    quietly halve its apparent error spread."""
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "GFS,ICON,EURO")
    assert "GFS" not in FS.compare_models("GFS")
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "gfs,euro")
    assert FS.compare_models("GFS") == ["EURO"]


def test_the_kill_switch_restores_the_previous_behaviour_exactly(monkeypatch):
    """Empty must mean 'primary only' — the cost knob has to have an off position, because each
    extra model is one more calibrate_spots per lead (3x the resolve work at the default)."""
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "")
    assert FS.compare_models("GFS") == []
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "   ")
    assert FS.compare_models("GFS") == []


def test_duplicates_and_whitespace_do_not_multiply_the_cost(monkeypatch):
    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", " euro , EURO ,icon ")
    assert FS.compare_models("GFS") == ["EURO", "ICON"]


# ── THE CONTROL: the ledger must actually ASK for each model ──────────────────────────────────
def test_the_ledger_resolves_every_model_and_labels_each_row(monkeypatch):
    """A registry of model names proves nothing if the loop asks for one model three times. This
    asserts the MODEL ARGUMENT reaching `calibrate_spots`, not just the source labels."""
    asked = []

    async def fake_calibrate(resolver, spots, model, target):
        asked.append((model, target))
        return {"spots": [{"buoy_id": "44065", "residual": {"model_hs_m": 1.0, "model_tp_s": 8.0}}]}

    monkeypatch.setenv("FORECAST_SKILL_COMPARE_MODELS", "EURO")
    rows = []
    for mdl in ["GFS"] + FS.compare_models("GFS"):
        src = FS.source_for(mdl, "GFS")
        for lead in FS.LEADS_H:
            import asyncio
            rep = asyncio.run(fake_calibrate(None, None, mdl, f"t+{lead}"))
            rows.extend(FS.rows_from_calibration_report(rep, f"t+{lead}", lead, source=src))

    assert {m for m, _ in asked} == {"GFS", "EURO"}, "both models must be resolved"
    assert len(asked) == 2 * len(FS.LEADS_H), "every model must cover every lead"
    assert {r["source"] for r in rows} == {"raw_surf", "raw_surf:EURO"}


def test_summary_separates_the_sources(monkeypatch):
    """The whole point is a per-model number; a summary that pools them answers nothing."""
    scored = [
        {"source": "raw_surf", "buoy_id": "1", "target_time": "2026-08-04T00:00:00Z",
         "lead_h": 24.0, "err_m": 0.40},
        {"source": "raw_surf:EURO", "buoy_id": "1", "target_time": "2026-08-04T00:00:00Z",
         "lead_h": 24.0, "err_m": 0.10},
    ]
    summary = FS.skill_summary(scored)
    assert summary, "skill_summary returned nothing for two valid rows"
    sources = {r.get("source") for r in summary}
    assert "raw_surf" in sources and "raw_surf:EURO" in sources, (
        f"per-model sources were pooled or dropped: {sources}")

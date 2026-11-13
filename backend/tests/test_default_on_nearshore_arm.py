"""The default-ON filter's NEARSHORE arm (2026-11-10): breaking height (`hb_proxy`) and a descriptive rating census.

`hs_station` (the primary) cannot see a fix that moves only the breaking height or the rating at the coast, so the filter
read NO_CHANGE for exactly the fixes the Fable audit queued (CMP-2, CMP-1, JAC-1). These pin: a nearshore WORSE blocks
even when the primary is inert; NO_CHANGE needs BOTH quantities inert; the census counts moves and never blocks; the
kill switch restores the primary-only filter. Synthetic items and rows only (no cache, no network)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))
sys.path.insert(0, HERE)

import default_on_filter as dof  # noqa: E402
from services.weather_pipeline import guardrail_stats as gs  # noqa: E402
from test_flag_guardrail import STATIONS, items  # noqa: E402

CTX = {"stations": list(STATIONS.values())}


def _rows(scores, levels=None):
    levels = levels or ["fair"] * len(scores)
    return [{"station": "a", "valid": f"2026-10-01T{h:02d}:00Z", "lead_h": 24, "anchor": True, "role": "nearshore",
             "outputs": {"score": s, "level": lv, "surf_height_m": 1.0}} for h, (s, lv) in enumerate(zip(scores, levels))]


def _patch(monkeypatch, primary, nearshore, rows_off=None, rows_on=None):
    monkeypatch.setattr(dof, "sweep", lambda f, v: [(1, 1.0), (2, 2.0)])
    monkeypatch.setattr(dof, "replay_pair", lambda ctx, f, v: (primary, rows_off or [], rows_on or []))
    monkeypatch.setattr(dof, "nearshore_items", lambda ctx, a, b: nearshore)


def _inert():
    return [dict(i, f_cand=i["f_ref"]) for i in items()]


def test_a_breaking_height_loss_blocks_when_the_primary_is_inert(monkeypatch):
    """THE DEFECT: a fix that only moves the breaking height read NO_CHANGE and passed with no evidence."""
    _patch(monkeypatch, _inert(), items(harm=0.06))
    r = dof.evaluate("X", CTX)
    assert r["quantities"]["hs_station"]["verdict"] == gs.NO_CHANGE
    assert r["quantities"]["hb_proxy"]["verdict"] == gs.WORSE
    assert r["verdict"] == gs.WORSE and r["blocks"] is True
    assert any(x.startswith("hb_proxy:") for x in r["reasons"])


def test_a_breaking_height_gain_reads_better_not_no_change(monkeypatch):
    _patch(monkeypatch, _inert(), items(harm=-0.06))
    r = dof.evaluate("X", CTX)
    assert r["verdict"] == gs.BETTER and r["blocks"] is False


def test_no_change_needs_both_quantities_inert(monkeypatch):
    _patch(monkeypatch, _inert(), _inert())
    assert dof.evaluate("X", CTX)["verdict"] == gs.NO_CHANGE


def test_an_untested_nearshore_arm_never_upgrades_inert_to_evidence(monkeypatch):
    """Primary inert and no nearshore pairs: UNTESTABLE, which the PR must report, not NO_CHANGE dressed as a pass."""
    _patch(monkeypatch, _inert(), [])
    r = dof.evaluate("X", CTX)
    assert r["verdict"] == gs.UNTESTABLE and r["blocks"] is False


def test_a_primary_loss_still_blocks_whatever_the_nearshore_says(monkeypatch):
    _patch(monkeypatch, items(harm=0.06), items(harm=-0.06))
    assert dof.evaluate("X", CTX)["blocks"] is True


def test_the_kill_switch_is_the_primary_only_filter(monkeypatch):
    monkeypatch.setenv("DEFAULT_ON_NEARSHORE_ARM", "0")
    _patch(monkeypatch, _inert(), items(harm=0.06))
    r = dof.evaluate("X", CTX)
    assert r["verdict"] == gs.NO_CHANGE and r["blocks"] is False and "hb_proxy" not in r["quantities"]


def test_the_rating_census_counts_moves_and_never_blocks(monkeypatch):
    off = _rows([50.0, 60.0, 70.0, 40.0], ["fair", "good", "good", "fair"])
    on = _rows([50.0, 60.02, 75.0, 30.0], ["fair", "good", "epic", "poor"])
    c = dof.rating_census(off, on)
    assert c == {"n": 4, "score_changed": 2, "level_changed": 2, "mean_delta": -1.245, "mean_abs_delta": 3.755}
    _patch(monkeypatch, _inert(), _inert(), off, on)
    r = dof.evaluate("X", CTX)
    assert r["rating_census"]["level_changed"] == 2 and r["blocks"] is False


def test_the_census_ignores_offshore_and_non_anchor_rows():
    off = _rows([50.0]) + [{"station": "o", "valid": "v", "lead_h": 24, "anchor": True, "role": "offshore",
                            "outputs": {"score": 10.0}}]
    on = _rows([90.0]) + [{"station": "o", "valid": "v", "lead_h": 24, "anchor": True, "role": "offshore",
                           "outputs": {"score": 99.0}}]
    assert dof.rating_census(off, on)["n"] == 1


def test_combine_rules():
    W, B, N, C, U = gs.WORSE, gs.BETTER, gs.NOT_WORSE, gs.NO_CHANGE, gs.UNTESTABLE
    assert dof.combine(C, W) == W and dof.combine(W, B) == W
    assert dof.combine(C, C) == C and dof.combine(C, U) == U and dof.combine(U, U) == U
    assert dof.combine(N, B) == B and dof.combine(C, N) == N and dof.combine(U, N) == N


def test_the_markdown_names_both_quantities_and_the_surface_limit(monkeypatch):
    _patch(monkeypatch, _inert(), items(harm=-0.06), _rows([50.0]), _rows([55.0]))
    md = dof.markdown([dof.evaluate("X", CTX)], {"start": "s", "end": "e", "leads": "24"})
    assert "`hb_proxy`" in md and "rating census" in md and "invisible here" in md

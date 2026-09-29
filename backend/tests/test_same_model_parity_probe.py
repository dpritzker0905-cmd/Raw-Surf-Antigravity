"""The same-model parity probe (2026-09-29): our served GFS lane against the SAME model from Open-Meteo, forecast to
forecast, at the ledger's buoys. It found that every 0.25-deg regional node is a 2x2 block mean shifted half a cell
north-west (our node matches Open-Meteo's NW 2x2 mean to MAE 0.010 m on 72% of rows; its own cell on 14%).

These pin what the instrument must never get wrong: its control is the LEDGER'S OWN control lane (the first draft
re-derived it and counted Open-Meteo's coastal 0.0 as a forecast, reporting ours +0.128 m high), rows with no number
on either side are dropped, groups and the positive control are computed as documented, and too few rows REFUSE.
"""
from datetime import datetime, timedelta, timezone

import pytest

from scripts import same_model_parity_probe as P

NOW = datetime(2026, 9, 29, 18, 0, tzinfo=timezone.utc)


def _ours(hs, pid="gfs_marine_waves_florida_east_coast_20260930T180000Z.json", method="bilinear", cycle_age_h=6.0):
    return {"point": {"speed": hs, "interpolation_method": method}, "product_id": pid, "frame_offset_hours": 0.0,
            "model_run_time": (NOW - timedelta(hours=cycle_age_h)).isoformat()}


@pytest.mark.parametrize("pid,tier", [
    ("gfs_marine_waves_florida_east_coast_20260930T180000Z.json", "regional"),
    ("gfs_marine_waves_global_mid_20260930T180000Z.json", "global_mid"),
    ("gfs_marine_waves_global_coarse_20260930T180000Z.json", "global_coarse"),
    (None, "none"), ("", "none"), ("somethingelse.json", "other"),
])
def test_the_tier_comes_from_the_served_product(pid, tier):
    assert P.tier_of(pid) == tier


def test_a_row_needs_a_number_on_both_sides():
    t = NOW + timedelta(hours=24)
    assert P.make_row("41009", 28.5, -80.2, t, 24, _ours(1.0), None, NOW) is None
    assert P.make_row("41009", 28.5, -80.2, t, 24, _ours(None), 0.9, NOW) is None
    assert P.make_row("41009", 28.5, -80.2, t, 24, _ours(1.0, method="unavailable"), 0.9, NOW) is None
    row = P.make_row("41009", 28.5, -80.2, t, 24, _ours(1.0), 0.9, NOW)
    assert row["diff_m"] == pytest.approx(0.1) and row["on_frame"] is True and row["tier"] == "regional"
    assert row["cycle_age_h"] == 6.0
    off = P.make_row("41009", 28.5, -80.2, t + timedelta(hours=1), 25, _ours(1.0), 0.9, NOW)
    assert off["on_frame"] is False
    # The FRAME is the hour, not the lead: run at 19Z, a +24 h target lands off the 3-hourly frame.
    late = P.make_row("41009", 28.5, -80.2, NOW + timedelta(hours=25), 24, _ours(1.0), 0.9, NOW + timedelta(hours=1))
    assert late["on_frame"] is False


def test_the_summary_groups_and_isolates_the_positive_control():
    t = NOW + timedelta(hours=24)
    rows = [P.make_row("a", 0, 0, t, 24, _ours(1.10), 1.0, NOW),                                   # regional +0.10
            P.make_row("b", 0, 0, t, 24, _ours(0.90), 1.0, NOW),                                   # regional -0.10
            P.make_row("c", 0, 0, t, 24, _ours(1.30, pid="gfs_marine_waves_global_mid_x.json"), 1.0, NOW),
            P.make_row("d", 0, 0, t, 24, _ours(1.0, cycle_age_h=20), 1.0, NOW)]                    # stale: not control
    s = P.summarize(rows)
    assert s["n"] == 4 and s["bias_m"] == pytest.approx(0.075, abs=1e-4)
    assert s["groups"]["tier"]["global_mid"]["bias_m"] == pytest.approx(0.30)
    assert s["groups"]["tier"]["global_mid"]["share_of_sq"] == pytest.approx(0.09 / 0.11, abs=1e-3)
    assert s["positive_control"] == {"n": 2, "bias_m": 0.0, "mae_m": 0.1}
    assert set(s["groups"]["cycle_age"]) == {"6-12h", "12-24h"}                                 # 6.0 h is not "<6h"


def test_the_control_is_the_ledgers_own_lane(monkeypatch):
    """Mirror, never re-derive: the probe must call forecast_skill.fetch_om_forecast_rows with the ledger's model and
    source, and must never see a row the ledger would drop (its 0.0-is-a-hole rule lives there)."""
    import services.weather_pipeline.forecast_skill as fs
    seen = {}

    def fake(buoys, now, leads_h=None, timeout=60, model=None, source=None):
        seen.update(model=model, source=source, leads=leads_h)
        return [{"buoy_id": "41009", "target_time": "2026-09-30T18:00:00Z", "lead_h": 24.0, "hs_m": 1.0}]

    monkeypatch.setattr(fs, "fetch_om_forecast_rows", fake)
    rows = P.ledger_control_rows({"41009": (28.5, -80.2)}, NOW)
    assert seen == {"model": fs.OM_CONTROL_MODEL, "source": fs.SOURCE_OM_GFS, "leads": P.LEADS}
    assert rows[0]["hs_m"] == 1.0


def test_the_run_pairs_our_answer_at_each_control_row_and_refuses_when_blind():
    buoys = {"41009": (28.5, -80.2), "44013": (42.3, -70.6)}
    control = [{"buoy_id": "41009", "target_time": "2026-09-30T18:00:00Z", "lead_h": 24.0, "hs_m": 1.0},
               {"buoy_id": "44013", "target_time": "2026-09-30T19:00:00Z", "lead_h": 25.0, "hs_m": 0.8},
               {"buoy_id": "nope", "target_time": "2026-09-30T18:00:00Z", "lead_h": 24.0, "hs_m": 2.0}]
    asked = []

    def ours(lat, lng, t):
        asked.append((lat, lng, t.isoformat()))
        return _ours(1.05)

    r = P.run(buoys, NOW, ours=ours, control_rows=lambda b, n: control, pause=0)
    assert len(r["rows"]) == 2 and r["control_rows"] == 3 and len(asked) == 2
    assert {x["on_frame"] for x in r["rows"]} == {True, False}
    assert P.decision_lines(r)[0].startswith("REFUSED")                       # 2 rows < MIN_ROWS

    def broken(b, n):
        raise TimeoutError("open-meteo down")
    blind = P.run(buoys, NOW, ours=ours, control_rows=broken, pause=0)
    assert blind["summary"]["n"] == 0 and blind["failures"]["control"] == 1
    assert P.decision_lines(blind)[0].startswith("REFUSED")


def test_enough_rows_print_the_decision_line_and_every_group():
    control = [{"buoy_id": f"b{i}", "target_time": "2026-09-30T18:00:00Z", "lead_h": 24.0, "hs_m": 1.0}
               for i in range(40)]
    buoys = {f"b{i}": (10.0, float(i)) for i in range(40)}
    r = P.run(buoys, NOW, ours=lambda la, lo, t: _ours(1.02), control_rows=lambda b, n: control, pause=0)
    lines = P.decision_lines(r)
    assert lines[0].startswith("SAME_MODEL_PARITY n=40 bias=+0.02")
    assert {ln.split(":")[0].strip() for ln in lines[1:]} == {"by tier", "by method", "by frame", "by lead",
                                                             "by cycle_age"}

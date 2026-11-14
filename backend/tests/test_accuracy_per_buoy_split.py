"""Pins for scripts/accuracy_per_buoy_split.py: the per-buoy split of the accuracy monitor's paired gaps (2026-11-12).

The split exists to replace an ESTIMATE (log 2026-11-12-fable-accuracy-monitor-red.md), so each test checks it against a
known answer built into synthetic rows: an instrument must reproduce a planted result before it is trusted with a real one.
"""
from datetime import datetime, timedelta, timezone

from scripts.accuracy_per_buoy_split import (
    BEST_MATCH, PRIMARY, SAME_MODEL, day_block_interval, gap, hole_keys_view, index_rows, paired,
    detection_control, gate_window_lines, report_lines, split, unanswered, unanswered_lines, wiring_check,
)

NOW = datetime(2026, 11, 12, 12, tzinfo=timezone.utc)


def _row(source, buoy, day, hour, lead, err, obs_hs=1.0, obs_shift=0):
    t = NOW - timedelta(days=day) + timedelta(hours=hour - 12)
    return {"source": source, "buoy_id": buoy, "target_time": t.strftime("%Y-%m-%dT%H:00:00Z"), "lead_h": float(lead),
            "err_m": err, "obs_hs_m": obs_hs,
            "obs_time": (t + timedelta(minutes=obs_shift)).strftime("%Y-%m-%dT%H:%M:00+00:00")}


def _world():
    """Two open buoys every source scores, one hole buoy the same-model control cannot score. Known answers:
    open buoy A: ours |0.2| vs best_match |0.1| -> gap +0.1; vs control |0.2| -> 0.0.
    open buoy B: ours |0.1| vs best_match |0.1| -> 0.0; vs control |0.3| -> -0.2.
    hole buoy H: ours |0.6| vs best_match |0.2| -> +0.4; no control rows."""
    rows = []
    for day in range(6):
        for lead in (24, 48, 72):
            rows += [_row(PRIMARY, "A", day, 6, lead, 0.2), _row(BEST_MATCH, "A", day, 6, lead, -0.1),
                     _row(SAME_MODEL, "A", day, 6, lead, -0.2),
                     _row(PRIMARY, "B", day, 6, lead, -0.1), _row(BEST_MATCH, "B", day, 6, lead, 0.1),
                     _row(SAME_MODEL, "B", day, 6, lead, 0.3),
                     _row(PRIMARY, "H", day, 6, lead, 0.6), _row(BEST_MATCH, "H", day, 6, lead, 0.2)]
    return rows


def test_pairing_requires_the_same_observation_like_head_to_head():
    ours = {("A", "t", 1): {"err_m": 0.1, "obs_hs_m": 1.0, "obs_time": "2026-11-12T00:00:00+00:00"}}
    same = {("A", "t", 1): {"err_m": 0.2, "obs_hs_m": 1.0, "obs_time": "2026-11-12T00:00:00+00:00"}}
    moved = {("A", "t", 1): {"err_m": 0.2, "obs_hs_m": 1.0, "obs_time": "2026-11-12T00:30:00+00:00"}}
    blind = {("A", "t", 1): {"err_m": 0.2, "obs_hs_m": None, "obs_time": "2026-11-12T00:00:00+00:00"}}
    assert paired(ours, same) == ([("A", "t", 1)], 0, 0)
    assert paired(ours, moved) == ([], 1, 0)
    assert paired(ours, blind) == ([], 0, 1)


def test_split_recovers_the_planted_per_buoy_gaps():
    idx = index_rows(_world(), NOW)
    bm = split(idx, BEST_MATCH)
    assert round(bm["by_buoy"][("A", 72)][3], 6) == 0.1
    assert round(bm["by_buoy"][("B", 72)][3], 6) == 0.0
    assert round(bm["by_buoy"][("H", 72)][3], 6) == 0.4
    assert round(bm["pooled"][72][3], 6) == round((0.1 + 0.0 + 0.4) / 3, 6)
    sm = split(idx, SAME_MODEL)
    assert ("H", 72) not in sm["by_buoy"]
    assert round(sm["by_buoy"][("B", 24)][3], 6) == -0.2


def test_hole_view_measures_best_matchs_own_mae_and_the_share_instead_of_assuming_them():
    h = hole_keys_view(index_rows(_world(), NOW), 48)
    assert h["buoys"] == ["H"] and h["n"] == 6 and h["subset"] is True
    assert round(h["mae_best_match"], 6) == 0.2 and round(h["delta"], 6) == 0.4
    # pooled best_match gap = (0.1 + 0.0 + 0.4)/3 over 18 keys; H carries 6 x 0.4 of the 18 x 0.1667 total -> 80%
    assert round(h["share_of_pooled_gap"], 6) == 0.8


def test_subset_check_reports_control_keys_outside_best_match():
    rows = _world() + [_row(PRIMARY, "C", 1, 6, 24, 0.1), _row(SAME_MODEL, "C", 1, 6, 24, 0.1)]
    h = hole_keys_view(index_rows(rows, NOW), 24)
    assert h["subset"] is False and h["n_same_model_not_in_best_match"] == 1


def test_wiring_check_returns_its_seed_at_one_buoy_and_nothing_elsewhere():
    rec, other = wiring_check(index_rows(_world(), NOW), "B")
    assert abs(rec - 0.05) < 1e-12 and other == 0.0


def test_interval_resamples_days_is_seeded_and_refuses_thin_input():
    idx = index_rows(_world(), NOW)
    ours = {k: v for k, v in idx[PRIMARY].items() if k[2] == 3}
    theirs = {k: v for k, v in idx[BEST_MATCH].items() if k[2] == 3}
    keys = paired(ours, theirs)[0]
    a, b = day_block_interval(keys, ours, theirs), day_block_interval(keys, ours, theirs)
    assert a == b and a[0] <= gap(keys, ours, theirs)[3] <= a[1]
    two_days = [k for k in keys if k[1][:10] in sorted({k[1][:10] for k in keys})[:2]]
    assert day_block_interval(two_days, ours, theirs) is None


def test_window_drops_old_targets_and_non_finite_errors():
    rows = [_row(PRIMARY, "A", 20, 6, 24, 0.1), _row(PRIMARY, "A", 1, 6, 24, float("nan"))]
    assert index_rows(rows, NOW) == {}


def test_report_prints_aggregates_only_and_passes_its_control():
    lines, ok = report_lines(index_rows(_world(), NOW), NOW)
    text = "\n".join(lines)
    assert ok is True and "PASS" in text
    assert "obs_time" not in text and "obs_hs_m" not in text and "err_m" not in text
    assert "measured hole list (9)" in text


def _noisy_world(days=12):
    """Served errors all clearly positive (> 0.05 m), so a +0.05 m seed moves every |err| by exactly +0.05; per-day
    spread so the interval is not degenerate."""
    rows = []
    for day in range(days):
        jitter = 0.02 * (day % 3)
        for buoy in ("A", "B"):
            rows += [_row(PRIMARY, buoy, day, 6, 72, 0.30 + jitter), _row(BEST_MATCH, buoy, day, 6, 72, 0.20)]
    return rows


def test_detection_control_notices_a_seeded_regression_before_pairing():
    base, hit, iv, excludes = detection_control(_noisy_world(), NOW, 14)
    assert round(hit - base, 6) == 0.05 and excludes is True


def test_detection_control_is_not_arithmetic_when_errors_straddle_the_seed():
    rows = [_row(PRIMARY, "A", d, 6, 72, -0.04) for d in range(10)] + [_row(BEST_MATCH, "A", d, 6, 72, 0.1) for d in range(10)]
    base, hit, _iv, _x = detection_control(rows, NOW, 14)
    assert round(hit - base, 6) == -0.03     # |-0.04 + 0.05| = 0.01: a +0.05 seed LOWERS this row's error


def test_unanswered_counts_reference_keys_with_no_served_row_and_nothing_else():
    """Known answer: buoy N has 6 best_match keys per lead and a served row on 2 of them at +72 h only -> 4/6 there and
    6/6 at +24 and +48 h; the three buoys every lane scores read 0/6. A paired gap sees none of this."""
    rows = _world()
    for day in range(6):
        for lead in (24, 48, 72):
            rows.append(_row(BEST_MATCH, "N", day, 6, lead, 0.1))
            if lead == 72 and day < 2:
                rows.append(_row(PRIMARY, "N", day, 6, lead, 0.3))
    un = unanswered(index_rows(rows, NOW), BEST_MATCH)
    assert un[("N", 72)] == (4, 6) and un[("N", 24)] == (6, 6) and un[("N", 48)] == (6, 6)
    assert all(un[(b, lead)] == (0, 6) for b in "ABH" for lead in (24, 48, 72))            # the null arm
    assert un == unanswered(index_rows(rows + [_row(PRIMARY, "Z", 1, 6, 72, 0.2)], NOW), BEST_MATCH)   # a served-only key is not one


def test_unanswered_lines_name_only_buoys_with_a_gap_and_carry_no_row_field():
    rows = _world() + [_row(BEST_MATCH, "N", d, 6, 72, 0.1) for d in range(6)]
    text = chr(10).join(unanswered_lines(index_rows(rows, NOW)))
    assert "+72h pooled 6 / 24" in text and "+24h pooled 0 / 18" in text
    assert "N       +24h 0/0 | +48h 0/0 | +72h 6/6" in text
    assert all(("  %s " % b) not in text for b in "ABH")
    assert "obs_time" not in text and "err_m" not in text and "target_time" not in text
    assert "no served row where best_match scored" in chr(10).join(report_lines(index_rows(rows, NOW), NOW)[0])


def test_three_day_blocks_need_three_blocks():
    idx = index_rows(_world(), NOW)                      # 6 days -> two 3-day blocks: thin
    assert split(idx, BEST_MATCH)["pooled"][72][6] is None
    long = index_rows(_noisy_world(12), NOW)             # 12 days -> four 3-day blocks
    assert split(long, BEST_MATCH)["pooled"][72][6] is not None


def test_gate_window_is_the_monitors_seven_days_and_report_labels_the_wiring_check():
    lines = gate_window_lines(_noisy_world(12), NOW)
    assert lines[0].startswith("== gate window: pooled, 7 days") and any("3-day" in x for x in lines)
    text = "\n".join(report_lines(index_rows(_world(), NOW), NOW, rows=_world())[0])
    assert "wiring check (arithmetic, not detection)" in text and "detection control:" in text

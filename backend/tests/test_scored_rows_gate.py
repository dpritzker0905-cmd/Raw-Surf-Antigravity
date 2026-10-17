"""The ONE-OFF scored-rows gate (ledger commitment 1335): its arithmetic, its aggregates-only output, its read-only
enforcement and its dispatch-only workflow.

Every instrument here is tested in BOTH directions with a positive and a null control (LESSONS L-S4): the scalar lane that
is better says YES and the planted regression says NO; the identical lane is exactly null; the planted +0.13 m shadow
shift is recovered and a planted 0 shift is not invented. A gate that was never seen to say NO is theatre.
"""
import ast
import random
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

from scripts import forecast_accuracy_monitor as monitor
from scripts import scored_rows_gate as cli
from services.weather_pipeline import forecast_skill as fs
from services.weather_pipeline import scored_rows_analysis as sra

BACKEND = Path(__file__).resolve().parents[1]
WORKFLOWS = BACKEND.parent / ".github" / "workflows"
COASTS = {"46001": "pacific_ne", "51001": "hawaii", "41001": "atlantic_se", "44001": "atlantic_ne", "42001": "gulf"}
T0 = datetime(2026, 10, 3, tzinfo=timezone.utc)


def _time(i):
    return (T0 + timedelta(hours=3 * i)).strftime("%Y-%m-%dT%H:00:00Z")


def _row(source, buoy, i, lead, hs, obs, **extra):
    t = _time(i)
    return {"source": source, "buoy_id": buoy, "target_time": t, "lead_h": float(lead), "hs_m": round(hs, 4),
            "obs_hs_m": round(obs, 4), "obs_time": t, "err_m": round(hs - obs, 4), **extra}


def world(per=120, kind="better", seed=7):
    """Served and scalar rows for five coasts x three leads; scalar = served + d with d >= 0.
    better:     the served lane always under-reads (-0.15..-0.45 m) and d <= half the error: every cell improves.
    null:       the scalar lane IS the served lane.
    coast_loss: atlantic_se is already exact, so any shift there is pure loss.
    flat_loss:  a sixth of the rows are exact forecasts under 0.5 m, so any shift there is pure loss."""
    rnd = random.Random(seed)
    rows = []
    for buoy in COASTS:
        for lead in (24, 48, 72):
            for i in range(per):
                if kind == "coast_loss" and COASTS[buoy] == "atlantic_se":
                    obs = 1.0 + 2.5 * rnd.random()
                    served, d = obs, 0.3 * rnd.random()
                elif kind == "flat_loss" and i % 6 == 0:
                    obs = 0.1 + 0.35 * rnd.random()
                    served, d = obs, 0.4 * rnd.random()
                else:
                    obs = 1.0 + 2.5 * rnd.random()
                    e = -(0.15 + 0.3 * rnd.random())
                    served, d = obs + e, (0.0 if kind == "null" else abs(e) * 0.5 * rnd.random())
                rows.append(_row(sra.SERVED, buoy, i, lead, served, obs))
                rows.append(_row(sra.SCALAR, buoy, i, lead, served + d, obs))
    return rows


def pairs_with(errors, shifts):
    """Pair rows with chosen served errors and scalar shifts, all at one observation (2.0 m)."""
    rows = []
    for i, (e, d) in enumerate(zip(errors, shifts)):
        rows.append(_row(sra.SERVED, "46001", i, 24, 2.0 + e, 2.0))
        rows.append(_row(sra.SCALAR, "46001", i, 24, 2.0 + e + d, 2.0))
    return rows


# ---- the pooled arithmetic is the ledger's own ------------------------------------------------------------------
def test_pooled_per_lead_equals_head_to_head_to_the_digit():
    rows = world(per=80)
    ref = {r["lead_h"]: r for r in fs.head_to_head(rows, primary=sra.SERVED) if r["source"] == sra.SCALAR}
    pooled = sra.tables(rows)["pooled"]
    assert set(ref) == {24, 48, 72}
    for lead, h in ref.items():
        c = pooled[("all sea", lead)]
        assert c["n"] == h["n_paired"] == 5 * 80
        assert round(c["mae_ref"], 4) == h["mae_ours_m"] and round(c["mae_cand"], 4) == h["mae_theirs_m"]
        assert round(c["delta"], 4) == pytest.approx(h["delta_m"], abs=1.5e-4)
        assert round(c["ref_wins"], 4) == h["win_rate"]


def test_a_different_verifying_observation_is_not_a_pair():
    rows = [dict(r, obs_hs_m=r["obs_hs_m"] + 0.01) if r["source"] == sra.SCALAR else r for r in world(per=20)]
    assert sra.paired(rows) == []
    rows = [dict(r, obs_time="2026-12-01T00:00:00Z") if r["source"] == sra.SCALAR else r for r in world(per=20)]
    assert sra.paired(rows) == []


def test_rows_without_a_finite_error_or_height_are_not_paired():
    rows = world(per=20)
    rows[0]["err_m"] = float("nan")
    rows[3]["hs_m"] = None
    assert len(sra.paired(rows)) == 5 * 3 * 20 - 2


# ---- the gate says YES, says NO, and refuses ---------------------------------------------------------------------
def test_gate_says_yes_when_the_scalar_lane_is_better_everywhere():
    g = sra.gate(sra.tables(world()))
    assert g["verdict"] == "YES" and g["violators"] == [] and g["cells_checked"] > 20


def test_gate_says_no_and_names_the_planted_coast():
    g = sra.gate(sra.tables(world(kind="coast_loss")))
    assert g["verdict"] == "NO"
    assert {v["group"] for v in g["violators"] if v["dim"] == "coast"} == {"atlantic_se"}
    assert all(v["delta"] < -sra.GATE_MAX_LOSS_M for v in g["violators"])


def test_gate_says_no_and_names_the_planted_forecast_band():
    g = sra.gate(sra.tables(world(kind="flat_loss")))
    assert g["verdict"] == "NO"
    assert {v["group"] for v in g["violators"] if v["dim"] == "band"} == {"fc flat <0.5m"}


def test_null_control_an_identical_lane_is_exactly_null():
    rows = world(kind="null")
    for c in sra.tables(rows)["pooled"].values():
        assert c["delta"] == 0 and c["ties"] == 1.0 and c["unchanged"] == 1.0 and c["gain_uniform"] == 0
    assert sra.gate(sra.tables(rows))["verdict"] == "YES"


@pytest.mark.parametrize("loss,expected", [(0.005, "YES"), (0.0051, "NO")])
def test_gate_boundary_is_strictly_more_than_max_loss(loss, expected):
    tab = {"pooled": {("all sea", "all"): {"n": 500, "delta": -loss, "violations": 0.0}}}
    assert sra.gate(tab)["verdict"] == expected


@pytest.mark.parametrize("n,expected", [(99, "REFUSED"), (100, "NO")])
def test_a_cell_decides_only_from_n_100(n, expected):
    tab = {"pooled": {("all sea", "all"): {"n": n, "delta": -0.05, "violations": 0.0}}}
    assert sra.gate(tab, min_n=100)["verdict"] == expected


def test_gate_refuses_blind_never_yes():
    assert sra.gate(sra.tables([]))["verdict"] == "REFUSED"
    assert sra.gate(sra.tables(world(per=3)))["verdict"] == "REFUSED"          # every cell below n = 100


def test_gate_refuses_when_the_two_lanes_are_not_one_product():
    rows = world(per=200)
    for r in rows:
        if r["source"] == sra.SCALAR and r["obs_hs_m"] > 2.5:      # a share of the scalar rows land BELOW the served ones
            r["hs_m"] -= 0.6
            r["err_m"] = round(r["hs_m"] - r["obs_hs_m"], 4)
    assert sra.gate(sra.tables(rows))["verdict"] == "REFUSED"


# ---- bias versus spread, exactly ----------------------------------------------------------------------------------
def test_gain_splits_exactly_into_spread_and_bias_parts():
    c = sra.tables(world())["pooled"][("all sea", "all")]
    assert c["gain_spread"] + c["gain_bias"] == pytest.approx(c["delta"], abs=1e-12)
    assert c["bias_cand"] - c["bias_ref"] == pytest.approx(c["shift"], abs=1e-4)       # err_m is rounded to 4 places
    assert c["violations"] == 0 and c["delta"] > 0


def test_a_uniform_shift_is_worth_exactly_its_own_uniform_counterfactual():
    c = sra.cell_stats([(a, b) for _, a, b in sra.paired(pairs_with([-0.5] * 100, [0.1] * 100))])
    assert c["delta"] == pytest.approx(0.1) and c["gain_uniform"] == pytest.approx(0.1)


def test_a_shift_that_lands_where_the_errors_are_beats_the_uniform_one():
    errors = [-0.5] * 50 + [0.0] * 50
    c = sra.cell_stats([(a, b) for _, a, b in sra.paired(pairs_with(errors, [0.5] * 50 + [0.0] * 50))])
    assert c["delta"] == pytest.approx(0.25) and c["shift"] == pytest.approx(0.25)
    assert c["gain_uniform"] == pytest.approx(0.0, abs=1e-9)         # shifting every error by +0.25 buys nothing
    assert c["gain_spread"] == pytest.approx(0.25) and c["gain_bias"] == pytest.approx(0.0, abs=1e-9)


# ---- aggregates only ----------------------------------------------------------------------------------------------
def test_a_cell_below_ten_pairs_is_dropped_at_birth_and_prints_n_lt_10():
    small = [r for r in world(per=9) if r["buoy_id"] == "46001"]          # 9 pairs a lead, 27 over all leads
    tab = sra.tables(small)
    assert tab["coast"][("pacific_ne", 24)] == {"suppressed": True}        # not even its n survives
    assert tab["pooled"][("all sea", 48)] == {"suppressed": True}
    assert tab["coast"][("pacific_ne", "all")]["n"] == 27
    assert "n<10" in sra.render_report({}, small)
    ten = sra.tables([r for r in world(per=10) if r["buoy_id"] == "46001"])
    assert ten["coast"][("pacific_ne", 24)]["n"] == 10                      # exactly ten is shown


def test_the_suppression_floor_cannot_be_lowered_by_a_caller():
    nine = [(a, b) for _, a, b in sra.paired(pairs_with([-0.3] * 9, [0.1] * 9))]
    assert sra.cell(nine, min_n=1) == {"suppressed": True}
    assert sra.cell(nine * 2, min_n=1)["n"] == 18
    assert sra.tables(pairs_with([-0.3] * 9, [0.1] * 9), min_n=1)["pooled"][("all sea", "all")] == {"suppressed": True}


def test_suppressed_cells_carry_no_numbers_anywhere_in_the_report():
    small = [r for r in world(per=9) if r["buoy_id"] == "46001"]
    text = sra.render_report({"since": "window-start"}, small)
    suppressed_lines = [ln for ln in text.splitlines() if "n<10" in ln]
    assert suppressed_lines
    for ln in suppressed_lines:
        cells = [c.strip() for c in ln.strip("|").split("|")]
        assert all(c in ("-", "n<10") or not re.fullmatch(r"[+-]?\d+(\.\d+)?%?", c) for c in cells[2:])


def test_the_report_names_no_buoy_no_target_time_and_no_row_value():
    rnd = random.Random(11)
    rows = []
    for buoy in ("46999", "51998", "41997"):
        for i in range(30):
            obs = 1.0 + rnd.random()
            served = obs - 0.0123456 * (i + 1)
            rows += [_row(sra.SERVED, buoy, i, 48, served, obs),
                     _row(sra.SCALAR, buoy, i, 48, served + 0.0098765 * (i + 1), obs),
                     _row(sra.SHADOW, buoy, i, 48, served, obs)]
    text = sra.render_report({"since": "window-start", "until": "now", "rows_read": len(rows)}, rows)
    for r in rows:
        assert r["buoy_id"] not in text and r["target_time"] not in text
    assert not re.search(r"\d{4}-\d{2}-\d{2}T\d{2}", text)
    assert not any(str(r["hs_m"]) in text or str(r["err_m"]) in text for r in rows)
    tab = sra.tables(rows)
    assert all("buoy" not in str(k).lower() for dim in tab.values() for k in dim)


def test_the_report_has_every_required_section():
    text = sra.render_report({"since": "s"}, world(per=60))
    for needle in ("**GATE:", "Served vs raw_surf:GFS_SCALAR, paired", "Bias versus spread", "Replication",
                   "same-model control", "Open-Meteo marine", "Built CONSENSUS shadow"):
        assert needle in text, needle


# ---- grouping and the other tables --------------------------------------------------------------------------------
def test_forecast_band_edges_are_the_ledgers_and_use_the_served_forecast():
    assert [sra.fc_band(x) for x in (0.0, 0.49, 0.5, 1.49, 1.5, 2.99, 3.0, 8.0)] == [
        "fc flat <0.5m", "fc flat <0.5m", "fc small 0.5-1.5m", "fc small 0.5-1.5m",
        "fc rideable 1.5-3m", "fc rideable 1.5-3m", "fc big >3m", "fc big >3m"]
    rows = pairs_with([-1.0] * 20, [0.0] * 20)                    # served forecast 1.0 m, observation 2.0 m
    assert set(g for g, _ in sra.tables(rows)["band"]) == {"fc small 0.5-1.5m"}


def test_coasts_come_from_the_ledgers_own_region_of():
    tab = sra.tables(world(per=20))
    assert {g for g, _ in tab["coast"]} == set(COASTS.values())


def test_the_halves_replicate_a_stable_gain_and_expose_a_flip():
    stable = sra.halves(world(per=200))
    assert set(stable) == {"first half", "second half"}
    assert all(c["delta"] > 0 for half in stable.values() for c in half.values())
    rnd = random.Random(9)
    rows = world(per=200, kind="null")
    for r in rows:
        if r["source"] == sra.SCALAR and r["target_time"] > "2026-10-16":       # worse in the second half only
            r["hs_m"] -= 0.4 * rnd.random()
            r["err_m"] = round(r["hs_m"] - r["obs_hs_m"], 4)
    flip = sra.halves(rows)
    assert flip["first half"][24]["delta"] == 0 and flip["second half"][24]["delta"] < 0


def test_three_way_measures_the_share_of_the_reference_gap_the_scalar_closes():
    rows = []
    for i in range(60):
        obs = 2.0
        rows += [_row(sra.SERVED, "46001", i, 24, obs + 0.30, obs), _row(sra.SCALAR, "46001", i, 24, obs + 0.15, obs),
                 _row(sra.CONTROL, "46001", i, 24, obs + 0.10, obs)]
    c = sra.three_way(rows, sra.CONTROL)[24]
    assert c["n"] == 60 and c["served_minus_ref"] == pytest.approx(0.20) and c["scalar_minus_ref"] == pytest.approx(0.05)
    assert c["closed"] == pytest.approx(0.75) and c["scalar_wins_vs_ref"] == 0.0
    assert sra.three_way(rows, sra.MARINE) == {}                    # no marine rows: no line, not a fabricated one


def _consensus_rows(shift, n=40, lead=48, tier="regional", buoy="46001"):
    rows = []
    for i in range(n):
        obs = 2.0
        hs = {"raw_surf": 1.8, "raw_surf:ICON": 2.4, "raw_surf:EURO": 2.1}
        for src, v in hs.items():
            rows.append(_row(src, buoy, i, lead, v, obs, tier=tier, frame_off_h=0.0, cycle_age_h=3.0))
        equal = sum(hs.values()) / 3
        rows.append(_row(sra.SHADOW, buoy, i, lead, equal + shift(lead), obs, tier=tier, frame_off_h=0.0, cycle_age_h=3.0))
    return rows


def test_construction_recovers_a_planted_shift_and_does_not_invent_one():
    con = sra.construction(_consensus_rows(lambda lead: 0.13))
    assert con[("all", "all", 48)]["signed_mean"] == pytest.approx(0.13) and con[("all", "all", 48)]["abs_median"] == pytest.approx(0.13)
    con = sra.construction(_consensus_rows(lambda lead: 0.0))
    assert con[("all", "all", 48)]["signed_mean"] == pytest.approx(0.0, abs=1e-9)
    assert con[("all", "all", 48)]["mae_shadow"] == pytest.approx(con[("all", "all", 48)]["mae_equal"])


def test_construction_localises_a_shift_to_the_lead_the_tier_and_the_coast_that_carry_it():
    rows = (_consensus_rows(lambda l: 0.13, lead=48, tier="global_mid", buoy="46001")      # the defect: +48 h, global_mid, pacific_ne
            + _consensus_rows(lambda l: 0.0, lead=48, tier="regional", buoy="51001")
            + _consensus_rows(lambda l: 0.0, lead=24, tier="global_mid", buoy="46001"))
    con = sra.construction(rows)
    assert con[("shadow tier", "global_mid", 48)]["signed_mean"] == pytest.approx(0.13)
    assert con[("shadow tier", "regional", 48)]["signed_mean"] == pytest.approx(0.0, abs=1e-9)
    assert con[("shadow tier", "global_mid", 24)]["signed_mean"] == pytest.approx(0.0, abs=1e-9)
    assert con[("coast", "pacific_ne", 48)]["signed_mean"] == pytest.approx(0.13)
    assert con[("coast", "hawaii", 48)]["signed_mean"] == pytest.approx(0.0, abs=1e-9)
    assert con[("all", "all", 48)]["signed_mean"] == pytest.approx(0.065)
    solo = sra.construction(_consensus_rows(lambda l: 0.13, tier="global_mid"))
    assert solo[("member tiers", "EURO=global_mid ICON=global_mid", 48)]["n"] == 40
    assert solo[("frames", "shadow=on_frame members=on_frame", 48)]["n"] == 40
    assert solo[("cycles", "shadow=fresh members=fresh", 48)]["n"] == 40


def test_construction_flags_stale_cycles_and_snapped_frames():
    rows = _consensus_rows(lambda l: 0.1)
    for r in rows:
        if r["source"] == sra.SHADOW:
            r["cycle_age_h"], r["frame_off_h"] = 12.0, 1.0
    con = sra.construction(rows)
    assert ("cycles", "shadow=stale members=fresh", 48) in con
    assert ("frames", "shadow=snapped members=on_frame", 48) in con


def test_construction_below_ten_keys_is_suppressed():
    con = sra.construction(_consensus_rows(lambda l: 0.13, n=9))
    assert con and all(c == {"suppressed": True} for c in con.values())


# ---- the loader is the monitor's, and the gate cannot write ------------------------------------------------------
def test_the_default_loader_is_the_monitors_own(monkeypatch):
    seen = []
    monkeypatch.setattr(monitor, "_fetch_scored_month", lambda m, t: seen.append((m, t)) or [{"source": sra.SERVED}])
    read, kept = cli.load_rows(["2026-10"], date(2026, 10, 17))
    assert seen == [("2026-10", date(2026, 10, 17))] and read == 1 and len(kept) == 1
    assert cli.monitor is monitor


def test_the_real_monitor_loader_reads_the_frozen_month_and_the_day_objects(monkeypatch):
    store = {"calibration/skill/scored-2026-10.json": [{"source": sra.SERVED, "k": "frozen"}, {"source": "other"}],
             "calibration/skill/scored-2026-10-16.json": [{"source": sra.SCALAR, "k": "day"}]}
    monkeypatch.setattr(monitor, "_fetch_l2", lambda key, timeout=30: store.get(key, monitor.ABSENT))
    read, kept = cli.load_rows(["2026-10"], date(2026, 10, 17))
    assert read == 3 and [r["k"] for r in kept] == ["frozen", "day"]          # the unrelated lane is dropped on arrival
    store["calibration/skill/scored-2026-10-16.json"] = None                  # an unreadable day object: blind, not empty
    monkeypatch.setattr(monitor, "_fetch_l2", lambda key, timeout=30: store.get(key, monitor.ABSENT))
    with pytest.raises(cli.Unreadable):
        cli.load_rows(["2026-10"], date(2026, 10, 17))


def test_months_between_and_window():
    assert cli.months_between(datetime(2026, 9, 28, tzinfo=timezone.utc), datetime(2026, 11, 2, tzinfo=timezone.utc)) == [
        "2026-09", "2026-10", "2026-11"]
    assert cli.months_between(datetime(2026, 12, 5, tzinfo=timezone.utc), datetime(2027, 1, 2, tzinfo=timezone.utc)) == [
        "2026-12", "2027-01"]
    rows = [{"target_time": "2026-10-02T23:00:00Z"}, {"target_time": "2026-10-03T00:00:00Z"}, {"target_time": "junk"}]
    assert cli.in_window(rows, T0) == [rows[1]]


def test_the_guard_refuses_every_method_but_get():
    import http.client
    with cli.read_only_http("allowed.example"):
        conn = http.client.HTTPConnection("allowed.example")
        for method in ("POST", "PUT", "DELETE", "PATCH", "post"):
            with pytest.raises(cli.ReadOnlyViolation):
                conn.request(method, "/x")
            with pytest.raises(cli.ReadOnlyViolation):
                conn.putrequest(method, "/x")
        with pytest.raises(cli.ReadOnlyViolation):
            conn.request("GET", "/x", body=b"payload")
        conn.putrequest("GET", "/x")                                          # a plain GET to the allowed host passes
        conn.close()


def test_the_guard_refuses_another_host_and_is_removed_afterwards():
    import http.client
    before = (http.client.HTTPConnection.request, http.client.HTTPConnection.putrequest)
    with cli.read_only_http("allowed.example"):
        with pytest.raises(cli.ReadOnlyViolation):
            http.client.HTTPSConnection("elsewhere.example").request("GET", "/")
    assert (http.client.HTTPConnection.request, http.client.HTTPConnection.putrequest) == before


def test_a_violation_cannot_be_swallowed_by_the_loaders_broad_except(monkeypatch):
    import urllib.request
    assert not issubclass(cli.ReadOnlyViolation, Exception)
    monkeypatch.setenv("SUPABASE_URL", "https://allowed.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key-not-real")

    class Writing(urllib.request.Request):
        def get_method(self):
            return "POST"
    monkeypatch.setattr(monitor.urllib.request, "Request", Writing)
    with cli.read_only_http("allowed.example"):
        with pytest.raises(cli.ReadOnlyViolation):
            monitor._fetch_l2("calibration/skill/scored-2026-10.json")


def test_the_code_has_no_write_path():
    banned_calls = {"urlopen", "post", "put", "delete", "patch", "upload_calibration_l2", "upload", "remove", "unlink",
                    "system", "Popen", "run", "dispatch"}
    banned_imports = {"requests", "httpx", "supabase", "aiohttp", "subprocess", "buoy_calibration", "store"}
    opens = []
    for path in (BACKEND / "scripts" / "scored_rows_gate.py", BACKEND / "services" / "weather_pipeline" / "scored_rows_analysis.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
                assert name not in banned_calls, (path.name, name)
                if name == "open":
                    opens.append((path.name, [getattr(a, "value", None) for a in node.args[1:2]]))
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                mods = [a.name for a in node.names] + ([node.module] if isinstance(node, ast.ImportFrom) and node.module else [])
                assert not {m.split(".")[-1] for m in mods} & banned_imports, (path.name, mods)
    assert opens == [("scored_rows_gate.py", ["a"])]                            # the runner's own step-summary file, append


# ---- the CLI end to end, on fakes --------------------------------------------------------------------------------
def _fake_archive(monkeypatch, rows):
    half = len(rows) // 2
    store = {"calibration/skill/scored-2026-10.json": rows[:half], "calibration/skill/scored-2026-10-16.json": rows[half:]}
    monkeypatch.setattr(monitor, "_fetch_l2", lambda key, timeout=30: store.get(key, monitor.ABSENT))


def test_main_prints_the_report_writes_the_summary_and_never_a_secret(monkeypatch, tmp_path, capsys):
    secret, project = "s3cr3t-key-value-0042", "proj-abc123.example.test"
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("SUPABASE_URL", f"https://{project}")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", secret)
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    rows = world()
    _fake_archive(monkeypatch, rows)
    code = cli.main([], now=datetime(2026, 10, 17, tzinfo=timezone.utc))
    out = capsys.readouterr()
    assert code == cli.DONE and "**GATE: YES**" in out.out
    assert summary.read_text(encoding="utf-8").strip() == out.out.strip()
    for stream in (out.out, out.err, summary.read_text(encoding="utf-8")):
        assert secret not in stream and project not in stream and "Bearer" not in stream
        assert not any(buoy in stream for buoy in COASTS)


def test_main_exits_blind_on_an_unreadable_archive_and_without_credentials(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.example.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k-not-real")
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setattr(monitor, "_fetch_l2", lambda key, timeout=30: None)
    assert cli.main([], now=datetime(2026, 10, 17, tzinfo=timezone.utc)) == cli.BLIND
    assert "blind" in capsys.readouterr().out
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY")
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    assert cli.main([], now=datetime(2026, 10, 17, tzinfo=timezone.utc)) == cli.BLIND


def test_main_exits_blind_when_no_cell_reaches_the_floor(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.example.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k-not-real")
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    _fake_archive(monkeypatch, world(per=3))
    assert cli.main([], now=datetime(2026, 10, 17, tzinfo=timezone.utc)) == cli.BLIND
    assert "**GATE: REFUSED**" in capsys.readouterr().out


def test_min_n_can_never_be_lowered_below_the_suppression_floor(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_URL", "https://proj.example.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "k-not-real")
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    _fake_archive(monkeypatch, world(per=5))
    cli.main(["--min-n", "1"], now=datetime(2026, 10, 17, tzinfo=timezone.utc))
    out = capsys.readouterr().out
    assert "n >= 10" in out and "n >= 1 " not in out


# ---- the workflow: dispatch-only, no secret values, the monitor's secret names ----------------------------------------
def _wf(name):
    path = WORKFLOWS / name
    return path.read_text(encoding="utf-8"), yaml.safe_load(path.read_text(encoding="utf-8"))


def _secret_names(text):
    return set(re.findall(r"secrets\.([A-Z0-9_]+)", text))


def test_workflow_is_dispatch_only_read_only_and_bounded():
    text, doc = _wf("scored-rows-gate.yml")
    triggers = doc.get("on", doc.get(True))
    assert set(triggers) == {"workflow_dispatch"}
    assert doc["permissions"] == {"contents": "read"}
    assert doc["concurrency"]["group"] == "scored-rows-gate"
    job = doc["jobs"]["gate"]
    assert job["timeout-minutes"] == 15 and set(doc["jobs"]) == {"gate"}
    uses = [s["uses"] for s in job["steps"] if "uses" in s]
    assert uses == ["actions/checkout@v5"]                                      # no artifact upload, nothing else
    assert "upload-artifact" not in text and "schedule" not in triggers


def test_workflow_secret_names_match_the_monitors_and_hold_no_values():
    text, _ = _wf("scored-rows-gate.yml")
    monitor_text, _ = _wf("forecast-accuracy-monitor.yml")
    assert _secret_names(text) == _secret_names(monitor_text) == {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"}
    assert not re.search(r"eyJ[A-Za-z0-9_-]{10,}|sb_secret|sbp_|https?://[a-z0-9-]+\.supabase\.(co|in)|[A-Za-z0-9+/_-]{40,}", text)
    expressions = set(re.findall(r"\$\{\{\s*([^}]+?)\s*\}\}", text))
    assert expressions == {"secrets.SUPABASE_URL", "secrets.SUPABASE_SERVICE_ROLE_KEY", "inputs.since", "inputs.min_n",
                           "inputs.max_loss_m"}


def test_workflow_never_traces_and_never_puts_inputs_in_the_shell_line():
    text, doc = _wf("scored-rows-gate.yml")
    assert "set -x" not in text and "xtrace" not in text and "ACTIONS_STEP_DEBUG" not in text
    run = [s for s in doc["jobs"]["gate"]["steps"] if "run" in s][0]
    assert "${{" not in run["run"] and run["run"].lstrip().startswith("set -o pipefail")
    assert "python3 scripts/scored_rows_gate.py" in run["run"] and run["working-directory"] == "backend"


def test_workflow_header_says_one_off_why_and_the_removal():
    text, _ = _wf("scored-rows-gate.yml")
    head = text.split("name:")[0]
    for needle in ("ONE-OFF", "1335", "DELETE THIS FILE", "OWNER'S WORD", "workflow_dispatch", "PUBLIC", "AGGREGATES",
                   "GET only", "default branch"):
        assert needle.lower() in head.lower(), needle

"""The nearshore judge's CONSENSUS ARM (roadmap stage 5): the equal-mean GFS/EURO/ICON input, graded AFTER the transform.

The skill ledger grades the three-model consensus at deep buoys, where the equal mean was best-calibrated on big
swells (bias -0.10 / -0.03 / -0.02 m at 24 / 48 / 72 h). Users see the NEARSHORE height, and GFS-Wave's regional
input bias differs by coast (x1.10-1.27 on Florida's east coast, x0.85-0.89 in SoCal, x0.54-0.85 in the Gulf), so a
consensus input has to be graded where the transform lands too. These pin: the arm is the FULL equal mean or
nothing; it carries the primary's period and bearing (the ingest design); each member is graded alone beside it;
a member that cannot answer costs only the consensus; and it is off, asking nothing extra, unless requested.
"""
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

from services.weather_pipeline import surf_point
from services.weather_pipeline.nearshore_validation import PAIR_MEMBERS, equal_consensus, model_hs_at_station

STATION, SPOT = (32.93, -117.39), (32.93, -117.26)
GEOM = SimpleNamespace(shore_normal_deg=270.0, depth_m=40.0, shelf_width_km=8.0)
DEPTH = 18.0
SEAS = {"GFS": (0.8, 9.0, 270.0), "EURO": (1.0, 10.0, 275.0), "ICON": (1.2, 11.0, 280.0)}
_WF = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "nearshore-validation.yml"


def _members(**over):
    m = {k: {"hs": v[0], "tp": v[1], "dir": v[2]} for k, v in SEAS.items()}
    m.update(over)
    return m


def test_the_consensus_is_the_full_equal_mean_with_the_primarys_period_and_bearing():
    c = equal_consensus(_members())
    assert c == {"hs": pytest.approx(1.0), "tp": 9.0, "dir": 270.0}


@pytest.mark.parametrize("bad", [None, {}, {"hs": None, "tp": 10.0, "dir": 275.0}, {"hs": float("nan")},
                                 {"hs": -0.1}, {"hs": "x"}])
def test_a_missing_or_broken_member_means_no_consensus_not_a_two_model_mean(bad):
    assert equal_consensus(_members(EURO=bad)) is None
    assert equal_consensus(None) is None


def _runner():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_nearshore_validation.py"
    spec = importlib.util.spec_from_file_location("run_nearshore_validation", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.GRADED_MIN_STATION_HOURS = 1   # a fresh copy: these grade the arms' plumbing on a few rows, not the VA-03 floor
    return mod


def _run(monkeypatch, tmp_path, capsys, consensus=True, fail=(), shadow=None):
    monkeypatch.delenv("SURF_SHELF_CF_SCALE", raising=False)
    runner = _runner()
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    table = {"generated_at": now.isoformat(), "pairs": [{
        "station": "100p1", "station_lat": STATION[0], "station_lng": STATION[1], "station_depth_m": DEPTH,
        "spots": [{"name": "Torrey Pines", "lat": SPOT[0], "lng": SPOT[1]}]}]}
    asked = []

    def fetch(url, timeout=60.0):
        model = url.split("model=")[1].split("&")[0]
        asked.append(model)
        if model in fail:
            raise TimeoutError(f"{model} timed out")
        if model == "CONSENSUS":                      # the built shadow (D-009): 404 unless a test serves one
            if shadow is None:
                raise TimeoutError("HTTP 404 no_backend_coverage")
            return {"point": {"speed": shadow[0], "period": shadow[1], "direction": shadow[2]}}
        hs, tp, dr = SEAS[model]
        return {"point": {"speed": hs, "period": tp, "direction": dr}, "upstream_provider": "x"}

    monkeypatch.setattr(runner, "load_pairs", lambda: table)
    monkeypatch.setattr(runner, "probe_stations", lambda pairs, hours: (
        {"100p1": [{"time": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "hs_m": 1.1, "flag": 1}]}, [], []))
    monkeypatch.setattr(runner, "_fetch_json", fetch)
    monkeypatch.setattr(surf_point, "resolve_surf_geometry", lambda lat, lng: GEOM)
    for k in ("NEARSHORE_VAL_TRAINS", "NEARSHORE_VAL_MOP", "NEARSHORE_VAL_NWPS", "NEARSHORE_VAL_MOP_GRID_DIR",
              "NEARSHORE_VAL_BACKFILL_H", "NEARSHORE_VAL_CONSENSUS"):
        monkeypatch.delenv(k, raising=False)
    out = tmp_path / "report.json"
    monkeypatch.setattr(sys, "argv", ["run_nearshore_validation.py", "--json", str(out)]
                        + (["--consensus"] if consensus else []))
    assert runner.main() == 0
    return json.loads(out.read_text(encoding="utf-8")), asked, capsys.readouterr().out


def _at(hs, tp, dr):
    return model_hs_at_station(hs, tp, dr, GEOM.shore_normal_deg, DEPTH, GEOM.depth_m, GEOM.shelf_width_km)


def test_the_arm_grades_the_consensus_and_each_member_through_the_same_transform(monkeypatch, tmp_path, capsys):
    report, asked, out = _run(monkeypatch, tmp_path, capsys)
    assert sorted(asked) == ["CONSENSUS", "EURO", "GFS", "ICON"]     # + the built shadow (D-009)
    obs = 1.1
    assert report["consensus_ab"]["arm"]["bias_m"] == pytest.approx(_at(1.0, 9.0, 270.0) - obs, abs=1e-4)
    assert report["consensus_ab"]["bulk"]["bias_m"] == pytest.approx(_at(0.8, 9.0, 270.0) - obs, abs=1e-4)
    assert report["member_ab"]["EURO"]["arm"]["bias_m"] == pytest.approx(_at(1.0, 10.0, 275.0) - obs, abs=1e-4)
    assert report["member_ab"]["ICON"]["arm"]["bias_m"] == pytest.approx(_at(1.2, 11.0, 280.0) - obs, abs=1e-4)
    assert report["point_api"]["calls"] == 4 and report["point_api"]["consensus"] is True
    assert "shadow_ab" not in report                  # no shadow served here: the arm is absent, the row is not
    assert "CONSENSUS_AB n=1 station_hours=1" in out and "MEMBER_AB EURO n=1" in out and "MEMBER_AB ICON n=1" in out
    same = report["consensus_ab"]["same_rows"]
    assert set(same) == {"gfs", "consensus", "euro", "icon", "pair_gfs_euro"}, "every candidate, paired"
    assert same["pair_gfs_euro"]["bias_m"] == pytest.approx(_at(0.9, 9.0, 270.0) - obs, abs=1e-4)
    assert report["pair_ab"]["arm"]["bias_m"] == pytest.approx(_at(0.9, 9.0, 270.0) - obs, abs=1e-4)
    assert "PAIR_AB n=1" in out and "gfs_euro=" in out
    assert same["icon"]["bias_m"] == pytest.approx(_at(1.2, 11.0, 280.0) - obs, abs=1e-4)
    assert "SAME_ROWS gfs=" in out and " euro=" in out.split("SAME_ROWS")[1]


def test_same_rows_pairs_the_members_only_on_hours_the_consensus_exists(monkeypatch, tmp_path, capsys):
    """A member graded on MORE hours than the consensus (another member missing) must not enter its paired row."""
    from services.weather_pipeline.nearshore_validation import build_report
    row = lambda obs, **k: {"station": "s", "obs_time": obs, "obs_hs_m": 1.0, "model_hs_m": 0.8, **k}  # noqa: E731
    matched = [row("t1", model_hs_euro_m=1.0, model_hs_icon_m=1.2, model_hs_consensus_m=1.0),
               row("t2", model_hs_euro_m=3.0)]                        # ICON missing: no consensus this hour
    rep = build_report(matched, n_stations=1, n_obs=2, n_preds=2)
    assert rep["consensus_ab"]["same_rows"]["euro"]["mae_m"] == pytest.approx(0.0)
    assert rep["member_ab"]["EURO"]["arm"]["mae_m"] == pytest.approx(1.0), "the member arm keeps its own rows"


def test_the_pair_is_gfs_and_euro_with_the_primarys_period_and_bearing_whatever_icon_does():
    assert equal_consensus(_members(), PAIR_MEMBERS) == {"hs": pytest.approx(0.9), "tp": 9.0, "dir": 270.0}
    assert equal_consensus(_members(ICON=None), PAIR_MEMBERS)["hs"] == pytest.approx(0.9)
    assert equal_consensus(_members(EURO=None), PAIR_MEMBERS) is None
    assert equal_consensus(_members(), ("EURO", "ICON")) is None, "GFS carries the period and bearing: required"


def test_an_icon_outage_keeps_the_pair_and_drops_only_the_three_model_mean(monkeypatch, tmp_path, capsys):
    report, _asked, out = _run(monkeypatch, tmp_path, capsys, fail=("ICON",))
    assert "consensus_ab" not in report and report["pair_ab"]["n"] == 1 and "PAIR_AB n=1" in out


def test_a_member_that_cannot_answer_costs_only_the_consensus(monkeypatch, tmp_path, capsys):
    report, _asked, out = _run(monkeypatch, tmp_path, capsys, fail=("EURO",))
    assert report["available"] and report["n_matched"] == 1, "the served row is still graded"
    assert "consensus_ab" not in report and "CONSENSUS_AB" not in out
    assert list(report["member_ab"]) == ["ICON"] and "pair_ab" not in report, "no EURO, no pair"


def test_off_by_default_it_asks_nothing_extra(monkeypatch, tmp_path, capsys):
    report, asked, out = _run(monkeypatch, tmp_path, capsys, consensus=False)
    assert asked == ["GFS"] and report["point_api"]["calls"] == 1
    assert "consensus_ab" not in report and "member_ab" not in report and "MEMBER_AB" not in out


def test_the_workflow_can_request_it_and_surfaces_its_lines():
    doc = yaml.safe_load(_WF.read_text(encoding="utf-8"))
    on = doc.get("on") if "on" in doc else doc.get(True)
    assert on["workflow_dispatch"]["inputs"]["consensus"]["default"] == "0"
    text = _WF.read_text(encoding="utf-8")
    assert "NEARSHORE_VAL_CONSENSUS: ${{ github.event.inputs.consensus || '0' }}" in text
    grep = next(line for line in text.splitlines() if 'grep -E "^VERDICT' in line)
    for tag in ("CONSENSUS_AB", "SHADOW_AB", "MEMBER_AB", "PAIR_AB", "LEGACY_FRICTION_AB"):
        assert f"^{tag}" in grep, f"{tag} must survive the tail window"


# ── THE BUILT SHADOW ARM (D-009) ─────────────────────────────────────────────────────────────────────────

def test_the_built_shadow_is_graded_through_the_same_transform_with_a_construction_check(monkeypatch, tmp_path,
                                                                                         capsys):
    """A correct build serves the equal mean on GFS's period and bearing: its arm equals the computed consensus arm,
    and the offshore construction gap is 0."""
    report, asked, out = _run(monkeypatch, tmp_path, capsys, shadow=(1.0, 9.0, 270.0))
    s = report["shadow_ab"]
    assert s["arm"]["bias_m"] == pytest.approx(report["consensus_ab"]["arm"]["bias_m"], abs=1e-6)
    assert s["built_vs_computed"] == {"n": 1, "median_m": 0.0, "p90_m": 0.0}
    assert "SHADOW_AB n=1" in out and "BUILT_VS_COMPUTED" in out


def test_a_wrong_build_shows_as_a_construction_gap(monkeypatch, tmp_path, capsys):
    report, _, _ = _run(monkeypatch, tmp_path, capsys, shadow=(1.4, 9.0, 270.0))
    assert report["shadow_ab"]["built_vs_computed"]["median_m"] == pytest.approx(0.4, abs=1e-4)


def test_the_point_route_accepts_the_shadow_model_and_nothing_else_new():
    import re
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "routes" / "weather.py").read_text(encoding="utf-8")
    point = src[src.index('@router.get("/point"'):src.index("async def get_point")]
    body = src[src.index("async def get_point"):src.index("async def get_point") + 600]
    assert 'pattern="^(GFS|ICON|EURO|CONSENSUS)$"' in body
    assert src.count("CONSENSUS)$") == 1, "only /point accepts the shadow; /grid and the rest stay GFS|ICON|EURO"
    assert point.startswith('@router.get("/point"') and re.search(r"NormalizedPointResponse", point)

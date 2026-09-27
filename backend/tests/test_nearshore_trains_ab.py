"""The nearshore judge grades the swell-train flip before anyone makes it (roadmap stage 3, 2026-09-27).

SURF_PARTITIONS is built and off. With it on, the served height transforms each swell train on its own
period and bearing instead of shoaling one blended sea. Offshore buoys cannot judge that (it changes
nothing offshore); the CDIP nearshore instruments can. Probed live that day: Steamer Lane's total
1.59 m / 12.5 s splits into 1.07 m / 10.1 s, 0.38 m / 14.6 s and 1.59 m / 8.4 s wind sea. The runner's
opt-in `--trains` arm grades what the flag would serve beside the bulk arm on the same hours.

Both halves of the arm are pinned to the served code, not to a copy: the trains to the served lane's
`_resolve_partitions`, the height to `estimate_surf_partitioned`.
"""
import importlib.util
from pathlib import Path

import pytest

from services.weather_pipeline import nearshore_validation as NV
from services.weather_pipeline.point_resolution import PointResolutionService

RATIO = {"method": "wave_component_ratio_estimation"}
NAN = float("nan")


class _Point:
    def __init__(self, speed, period, direction):
        self.speed, self.period, self.direction = speed, period, direction


class _Resp:
    def __init__(self, point, basis=None):
        self.point, self.estimate_basis = point, basis


def _payload(a):
    if a is None:
        return {"point": None}
    speed, period, direction, basis = (a + (None,))[:4]
    return {"point": {"speed": speed, "period": period, "direction": direction}, "estimate_basis": basis}


CASES = {
    "three real trains (Steamer Lane, live)": {
        "swell_1": (1.0747, 10.1, 259.65), "swell_2": (0.3798, 14.58, 204.2),
        "wind_waves": (1.5926, 8.41, 305.67), "total": (1.5877, 12.46)},
    "a ratio-derived train is not spectrum": {
        "swell_1": (0.86, 12.1, 200.9), "swell_2": (0.57, 10.0, 240.9, RATIO),
        "wind_waves": (0.30, 6.0, 290.0), "total": (0.95, 12.1)},
    "zero, NaN and missing layers are skipped": {
        "swell_1": (1.70, 10.4, 39.8), "swell_2": (0.0, 0.0, 0.0),
        "wind_waves": (NAN, 4.2, 320.0), "total": (1.70, 10.4)},
    "a NaN bearing is nulled, the train kept": {
        "swell_1": (0.9, 13.0, NAN), "swell_2": None, "wind_waves": (0.5, 6.0, 300.0), "total": (1.0, 13.0)},
    "trains that do not represent the sea fall back": {
        "swell_1": (0.2, 9.0, 270.0), "swell_2": None, "wind_waves": (0.1, 5.0, 300.0), "total": (1.5, 12.0)},
}


def _same(a, b):
    if a is None or b is None:
        return a is b
    strip = lambda t: {k: v for k, v in t.items() if k != "h"}  # noqa: E731
    return len(a) == len(b) and all(strip(x) == strip(y) and x["h"] == pytest.approx(y["h"], rel=1e-12)
                                    for x, y in zip(a, b))


@pytest.mark.asyncio
@pytest.mark.parametrize("name", list(CASES))
async def test_the_arm_uses_exactly_the_trains_the_served_lane_would(monkeypatch, name):
    case = CASES[name]
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    svc = PointResolutionService.__new__(PointResolutionService)

    async def internal(model, domain, layer, lat, lng, valid_time_str, **kw):
        a = case.get(layer)
        if a is None:
            return _Resp(None)
        return _Resp(_Point(*a[:3]), a[3] if len(a) > 3 else None)

    monkeypatch.setattr(svc, "_resolve_point_internal", internal, raising=False)
    total_h, total_tp = case["total"]
    served = await svc._resolve_partitions("GFS", "waves", 36.95, -122.02, "t", total_h, total_tp)
    ours = NV.station_trains([(k, _payload(case.get(layer))) for layer, k in
                              (("swell_1", "swell"), ("swell_2", "swell"), ("wind_waves", "windsea"))],
                             total_h, total_tp)
    assert _same(ours, served), f"{name}: the arm would grade trains the product never serves"


def test_the_station_height_is_the_served_partitioned_composition(monkeypatch):
    """THE COMPOSITION PIN, spectral half: in the composable configuration (linear shoaling, no H1/10,
    cap unreachable, one depth in every role) `estimate_surf_partitioned` computes each train's
    Kf x Ks x exposure x Kr in quadrature, which is this arm's model."""
    from services.weather_pipeline.surf_transform import estimate_surf_partitioned
    for k, v in {"SURF_V3_KOMAR": "0", "SURF_HEIGHT_H110": "0", "SURF_V3_MAGNETS": "0",
                 "SURF_CAP_SEAM_MONOTONE": "0"}.items():
        monkeypatch.setenv(k, v)
    trains = [{"h": 1.07, "tp": 10.1, "dir": 259.7, "kind": "swell"},
              {"h": 0.38, "tp": 14.6, "dir": 204.2, "kind": "swell"},
              {"h": 1.2, "tp": 8.4, "dir": None, "kind": "windsea"}]
    for normal, depth, width in [(250.0, 20.0, 12.0), (180.0, 15.0, 40.0), (300.0, 28.0, 90.0)]:
        served, _ = estimate_surf_partitioned(trains, depth, coastal=True, shelf_width_km=width,
                                              shore_normal_deg=normal, break_depth_m=10_000.0)
        ours = NV.model_hs_at_station_trains(trains, normal, depth, depth, width)
        assert ours == pytest.approx(served, rel=1e-12)


def test_one_train_is_the_bulk_arm():
    args = (255.0, 20.0, 60.0, 15.0)
    assert NV.model_hs_at_station_trains([{"h": 1.5, "tp": 13.0, "dir": 270.0}], *args) == pytest.approx(
        NV.model_hs_at_station(1.5, 13.0, 270.0, *args), rel=1e-12)
    assert NV.model_hs_at_station_trains([], *args) is None
    assert NV.model_hs_at_station_trains([{"h": 0.0, "tp": 9.0, "dir": 1.0}], *args) is None


def _row(station, bulk, trains, obs, used=True):
    return {"station": station, "model_hs_m": bulk, "model_hs_trains_m": trains, "obs_hs_m": obs,
            "trains_used": used}


def test_the_ab_grades_both_arms_on_the_same_hours():
    rows = [_row("254p1", 1.0, 1.2, 1.3), _row("254p1", 1.0, 1.1, 1.0), _row("153p1", 0.8, 0.8, 1.0, used=False)]
    ab = NV.trains_ab(rows)
    assert ab["n"] == 3
    assert ab["bulk"]["mae_m"] == pytest.approx((0.3 + 0.0 + 0.2) / 3, abs=1e-4)
    assert ab["as_flipped"]["mae_m"] == pytest.approx((0.1 + 0.1 + 0.2) / 3, abs=1e-4)
    only = ab["trains_only"]
    assert only["n"] == 2 and only["trains_closer_share"] == 0.5
    assert only["bulk"]["bias_m"] == pytest.approx(-0.15) and only["trains"]["bias_m"] == pytest.approx(0.0)
    assert only["by_station"] == {"254p1": {"n": 2, "bulk_mae_m": 0.15, "trains_mae_m": 0.1}}


def test_a_tie_is_not_a_win_for_the_trains():
    """Where the trains equal the bulk (one train, or a symmetric split) the flip changed nothing; a
    share that counted ties would credit the flip with hours it did not move."""
    assert NV.trains_ab([_row("254p1", 1.0, 1.0, 1.2)])["trains_only"]["trains_closer_share"] == 0.0


def test_no_arm_no_block_and_the_bulk_report_is_unchanged():
    plain = [{"station": "254p1", "model_hs_m": 1.0, "obs_hs_m": 1.3}]
    assert NV.trains_ab(plain) is None
    rep = NV.build_report(plain, n_stations=1, n_obs=1, n_preds=1)
    assert "trains_ab" not in rep and rep["stations"]["254p1"]["bias_m"] == pytest.approx(-0.3)
    rep = NV.build_report([_row("254p1", 1.0, 1.2, 1.3)], n_stations=1, n_obs=1, n_preds=1)
    assert rep["trains_ab"]["n"] == 1
    assert rep["stations"]["254p1"]["bias_m"] == pytest.approx(-0.3), "the served (bulk) number is graded as before"


def _runner():
    path = Path(__file__).resolve().parents[1] / "scripts" / "run_nearshore_validation.py"
    spec = importlib.util.spec_from_file_location("run_nearshore_validation", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_runner_asks_for_the_served_layers_and_survives_a_failing_one():
    runner = _runner()
    assert runner.TRAIN_LAYERS == PointResolutionService._PARTITION_LAYERS
    asked = []

    def fetch(url):
        asked.append(url)
        if "layer=swell_2" in url:
            raise OSError("boom")
        return {"point": {"speed": 1.0, "period": 12.0, "direction": 270.0}}

    out = runner.fetch_train_answers(fetch, "https://x", 36.95, -122.02, "2026-09-27T09:00")
    assert [k for k, _ in out] == ["swell", "windsea"]
    assert [u.split("layer=")[1].split("&")[0] for u in asked] == ["swell_1", "swell_2", "wind_waves"]
    assert all("model=GFS" in u and "valid_time=2026-09-27T09:00" in u for u in asked)

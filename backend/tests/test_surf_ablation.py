"""The S0 surf-chain ablation (scripts/surf_ablation.py): rule docs/weather-program/log/2026-11-16-fable-surf-ablation-s0-prereg.md.

These pin that it runs the PRODUCTION chain with the chain's own switches (never a copy of the physics), that it leaves
the environment exactly as it found it, that a contribution is served over served-with-the-factor-off, and that the
all-off pass and the interaction term are reported."""
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import surf_ablation as ab  # noqa: E402

from services.weather_pipeline import surf_point  # noqa: E402

OWNER = (29.77, -81.25)


def fake_chain(lat, lng, hs, tp, direction, geometry, partitions=None):
    """A product chain that reads the same switches: 1.4 (komar) x 0.9 (exposure) x 0.873 (Kr) x 1.27 (H1/10)."""
    h = hs
    h *= 1.4 if os.environ.get("SURF_V3_KOMAR", "1") != "0" else 1.0
    h *= 0.9 if os.environ.get("SURF_V3_EXPOSURE", "1") != "0" else 1.0
    h *= float(os.environ.get("SURF_REFRACTION_KR", "0.873"))
    h *= 1.27 if os.environ.get("SURF_HEIGHT_H110", "1") == "1" else 1.0
    return h, "shoaling"


def test_the_switches_are_the_chains_own_and_the_environment_is_restored(monkeypatch):
    assert set(ab.FACTORS) == {"komar", "exposure", "refraction", "magnet", "h110", "cap"}
    assert ab.FACTORS["komar"] == {"SURF_V3_KOMAR": "0"} and ab.FACTORS["h110"] == {"SURF_HEIGHT_H110": "0"}
    assert ab.FACTORS["refraction"] == {"SURF_REFRACTION_KR": "1.0"} and len(ab.ALL_OFF) == 6
    monkeypatch.delenv("SURF_V3_KOMAR", raising=False)
    monkeypatch.setenv("SURF_HEIGHT_H110", "1")
    before = dict(os.environ)
    with ab.switched(ab.ALL_OFF):
        assert os.environ["SURF_V3_KOMAR"] == "0" and os.environ["SURF_HEIGHT_H110"] == "0"
    with pytest.raises(RuntimeError):
        with ab.switched(ab.FACTORS["komar"]):
            raise RuntimeError("x")
    assert dict(os.environ) == before and "SURF_V3_KOMAR" not in os.environ
    ab.ablate(1.0, 2.0, 1.0, 8.0, chain=fake_chain)
    assert dict(os.environ) == before


def test_a_contribution_is_served_over_served_with_the_factor_off():
    a = ab.ablate(1.0, 2.0, 2.0, 8.0, chain=fake_chain)
    assert a["served_m"] == pytest.approx(2.0 * 1.4 * 0.9 * 0.873 * 1.27) and a["regime"] == "shoaling"
    assert a["contribution"]["komar"] == pytest.approx(1.4) and a["contribution"]["exposure"] == pytest.approx(0.9)
    assert a["contribution"]["refraction"] == pytest.approx(0.873) and a["contribution"]["h110"] == pytest.approx(1.27)
    assert a["contribution"]["magnet"] == pytest.approx(1.0) and a["contribution"]["cap"] == pytest.approx(1.0)
    assert a["all_off_m"] == pytest.approx(2.0) and a["all_factors"] == pytest.approx(1.4 * 0.9 * 0.873 * 1.27)
    assert a["interaction"] == pytest.approx(1.0)                         # a pure product has no interaction
    assert a["ratio_to_offshore"] == pytest.approx(1.4 * 0.9 * 0.873 * 1.27)
    calm = ab.ablate(1.0, 2.0, 0.0, 8.0, chain=fake_chain)
    assert calm["contribution"]["komar"] is None and calm["interaction"] is None and calm["ratio_to_offshore"] is None


def test_it_runs_the_production_chain_and_not_a_copy():
    g = surf_point.resolve_surf_geometry(*OWNER)
    a = ab.ablate(OWNER[0], OWNER[1], 1.12, 7.28, 52.0, geometry=g)
    direct, regime = surf_point.estimate_surf_at(OWNER[0], OWNER[1], 1.12, 7.28, 52.0, geometry=g)
    assert a["served_m"] == direct and a["regime"] == regime
    # the owner's hour: the Komar step raises the number and the H1/10 step raises it again; switching either off lowers it
    assert a["off_m"]["komar"] < a["served_m"] and a["off_m"]["h110"] < a["served_m"]
    assert a["contribution"]["komar"] > 1.2 and a["contribution"]["h110"] == pytest.approx(1.27, abs=0.01)
    assert a["contribution"]["refraction"] < 1.0 and a["all_off_m"] < a["served_m"]
    # here no ceiling binds, so the six factors multiply back to served / all-off: the interaction term is 1
    assert a["interaction"] == pytest.approx(1.0, abs=1e-9)
    assert math.prod(a["contribution"].values()) == pytest.approx(a["served_m"] / a["all_off_m"])
    src = open(ab.__file__, encoding="utf-8").read()
    assert "estimate_surf_at" in src and "komar_breaker_height" not in src and "shoaling_coefficient" not in src


def test_period_variants_rerun_the_served_chain_on_each_period_and_skip_a_missing_one():
    out = ab.period_variants(1.0, 2.0, 1.0, {"peak": 7.3, "mean": 4.8, "wind_sea": None, "bad": 0.0}, chain=fake_chain)
    assert set(out) == {"peak", "mean"} and out["mean"]["tp_s"] == 4.8
    g = surf_point.resolve_surf_geometry(*OWNER)
    real = ab.period_variants(OWNER[0], OWNER[1], 1.12, {"peak": 7.28, "mean": 4.8}, 52.0, geometry=g)
    assert real["mean"]["surf_m"] < real["peak"]["surf_m"]                # a shorter period shoals less in this chain


def test_the_interval_is_over_spots_and_small_groups_print_no_interval():
    g = ab.geometric_mean_ci([1.0, 4.0])
    assert g == {"n": 2, "gmean": 2.0, "ci95": None}
    wide = ab.geometric_mean_ci([1.0, 1.1, 1.2, 1.3, 1.4, 1.5])
    assert wide["n"] == 6 and wide["ci95"][0] < wide["gmean"] < wide["ci95"][1]
    assert wide == ab.geometric_mean_ci([1.0, 1.1, 1.2, 1.3, 1.4, 1.5])   # seeded: deterministic
    assert ab.geometric_mean_ci([None, 0, -1]) == {"n": 0}
    assert ab.geometric_mean_ci([1.5] * 6)["ci95"] == [1.5, 1.5]


def test_decompose_and_summarize_group_by_class_and_sea_state():
    class G:
        shore_normal_deg, swell_normal_deg, depth_m, break_depth_m, magnet_factor = 90.0, None, 20.0, None, 1.0
    panel = [("s%d" % i, 1.0 + i, 2.0, "coast", "open_beach" if i % 2 else "pier") for i in range(12)]
    seen = []

    def chain(lat, lng, hs, tp, direction, geometry, partitions=None):
        seen.append(direction)
        return fake_chain(lat, lng, hs, tp, direction, geometry)
    rows = ab.decompose(panel, resolve=lambda lat, lng: G(), chain=chain)
    assert len(rows) == 12 * len(ab.SEA_STATES) * len(ab.ANGLES_OFF_NORMAL) and {90.0, 135.0} == set(seen)
    s = ab.summarize([r for r in rows if r["angle_off_normal"] == 0.0])
    assert len(s) == 2 * len(ab.SEA_STATES) and all(e["spots"] == 6 for e in s)
    e = next(x for x in s if x["class"] == "pier" and x["sea_state"] == "report")
    assert e["contribution"]["komar"]["gmean"] == 1.4 and e["contribution"]["komar"]["ci95"] == [1.4, 1.4]
    assert e["ratio_to_offshore"]["gmean"] == round(1.4 * 0.9 * 0.873 * 1.27, 3) and e["regimes"] == ["shoaling"]
    text = ab.render(s)
    assert "| pier | report | 6 |" in text and "komar" in text and math.isfinite(e["all_factors"]["gmean"])

    class NoNormal(G):
        shore_normal_deg = None
    assert len(ab.decompose(panel[:1], resolve=lambda lat, lng: NoNormal(), chain=fake_chain)) == len(ab.SEA_STATES)

"""TIDE MOVES THE BREAKING DEPTH, AND NOTHING ELSE.

WHY THIS EXISTS (MASTER-AUDIT-10.0 row H). Tide was the highest-reach ABSENT nearshore term: over
227,088 real served spot-hours a uniform -1.5 m offset moved **1.694%** of them by a median **45.6%**
— nineteen times the reach of the whole slope/gamma thread — and its input was already in the repo
(`tide.tide_state_at` -> `height_m`, Open-Meteo `sea_level_height_msl`), reaching only the QUALITY
factor `tide_fit` and never the height.

DATUM. `sea_level_height_msl` is signed metres about mean sea level; ETOPO break depths are
MSL-referenced. So `cap_depth = d + eta` is datum-consistent — more water at high tide, less at low.

⛔ IT MUST NOT TOUCH `depth_m`. That is a ~139 km shelf median feeding cross-shelf friction; a metre
of tide against Santa Cruz's 452 m shelf median is noise pretending to be signal.

★★★ THE JACOBIAN IS THE POINT, AND THIS SUITE ASSERTS ON IT. The term must be SHARPLY SELECTIVE —
measured 2026-08-07, dFt/d(eta):
    2 m / 12 s on a 3.5 m reef   +1.416 ft/m        6 m / 18 s at Pipeline's 11.1 m   0.000 (inert)
    4 m / 16 s on a 3.5 m reef   +2.657 ft/m        2 m / 12 s at the p90 55.5 m      0.000 (inert)
It binds exactly where a shallow break meets surf big enough to feel bottom, and is inert
everywhere else. A term that moved every spot equally would be a bug, not a tide.

⚠️ REACH IS ASYMMETRIC, because only LOWERING the cap can newly bind: eta -1.5 m moved 6.80% of
sampled cells (median -34.7%), eta +1.5 m moved 2.77% (median +44.4%). Quote the frame: that sample
is 462 asset coords x 5 conditions weighted toward bigger surf, NOT the served distribution the
1.694% came from.
"""
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FT = 3.28084
PIPELINE = (21.665, -158.051)


def _tf(flag="1"):
    os.environ["SURF_TIDE_DEPTH"] = flag
    import services.weather_pipeline.surf_transform as mod
    return importlib.reload(mod)


def _shallow(mod, Hs, Tp, eta, d_break=3.5):
    """A shallow reef where the cap binds — the regime tide actually governs."""
    return mod.estimate_surf(Hs, Tp, 2534.5, coastal=True, shelf_width_km=25.8,
                             break_depth_m=d_break, water_level_m=eta)[0]


# ── THE LOAD-BEARING CLAIM FOR A HIGH-RISK CHANGE: nothing moves by default ──────────────────

@pytest.mark.parametrize("flag", ["0", "1"])
def test_water_level_zero_is_byte_identical(flag):
    """Default 0.0 must reproduce the legacy value EXACTLY, flag on or off. This is what makes the
    change safe to merge before it is safe to enable."""
    mod = _tf(flag)
    for Hs, Tp, d in [(1.0, 10.0, 3.5), (2.0, 12.0, 3.5), (4.0, 16.0, 3.5),
                      (2.0, 12.0, 11.1), (6.0, 18.0, 11.1), (0.5, 8.0, 55.5)]:
        legacy = mod.estimate_surf(Hs, Tp, 2534.5, coastal=True, shelf_width_km=25.8,
                                   break_depth_m=d)[0]
        explicit = mod.estimate_surf(Hs, Tp, 2534.5, coastal=True, shelf_width_km=25.8,
                                     break_depth_m=d, water_level_m=0.0)[0]
        assert legacy == explicit, f"water_level_m=0.0 moved {Hs}m/{Tp}s/{d}m: {legacy} != {explicit}"


def test_the_flag_OFF_ignores_a_real_tide__THE_KILL_SWITCH():
    """SURF_TIDE_DEPTH=0 must discard even a large offset — a kill switch that cannot be pulled is
    not a kill switch."""
    off = _tf("0")
    base = _shallow(off, 2.0, 12.0, 0.0)
    for eta in (-1.5, -0.75, 0.75, 1.5):
        assert _shallow(off, 2.0, 12.0, eta) == base, (
            f"eta {eta} moved the height with SURF_TIDE_DEPTH=0")


# ── THE PHYSICS ──────────────────────────────────────────────────────────────────────────────

def test_the_tide_moves_the_height_where_the_cap_BINDS():
    """THE ONE THAT WOULD HAVE CAUGHT IT — with a control that must NOT move."""
    on = _tf("1")
    low = _shallow(on, 2.0, 12.0, -1.5)
    mid = _shallow(on, 2.0, 12.0, 0.0)
    high = _shallow(on, 2.0, 12.0, +1.5)
    assert low < mid, f"a -1.5 m low tide did not lower a capped 3.5 m reef ({low} vs {mid})"
    assert high >= mid, "a +1.5 m high tide lowered the height — the sign is inverted"


def test_the_tide_is_INERT_where_the_cap_does_not_bind__THE_CONTROL():
    """A term that moved everything would be a bug. Pipeline's 11.1 m break is deep enough that a
    2 m/12 s swell never reaches the cap, so tide must change nothing there."""
    on = _tf("1")
    base = on.estimate_surf(2.0, 12.0, 2534.5, coastal=True, shelf_width_km=25.8,
                            break_depth_m=11.1)[0]
    for eta in (-1.5, -0.75, 0.75, 1.5):
        got = on.estimate_surf(2.0, 12.0, 2534.5, coastal=True, shelf_width_km=25.8,
                               break_depth_m=11.1, water_level_m=eta)[0]
        assert got == base, (
            f"tide moved an UNCAPPED spot (eta {eta}: {got} vs {base}) — the offset is leaking past "
            f"the depth-limited cap into a term it must not touch")


def test_the_tide_MUST_NOT_reach_the_SHELF_FRICTION_depth():
    """⭐ THIS TEST EXISTS BECAUSE MUTATION TESTING FOUND THE HOLE, NOT BECAUSE I PREDICTED IT.

    The suite originally proved the offset reaches the cap and is inert on an UNCAPPED spot — and a
    mutation that moved `depth_m` (the ~139 km shelf median feeding `shelf_dissipation`) as well as
    `_cap_depth` passed all ten tests. The existing inert control could not see it: it used a
    2534.5 m shelf, where +-1.5 m is numerically invisible.

    ⚠️ TWO MUTATIONS WERE NEEDED TO FIND IT, AND THE FIRST ONE TAUGHT MORE THAN IT CAUGHT.
    Reassigning `depth_m` at the cap block is a NO-OP: `shelf_dissipation` is called ~86 lines
    earlier (surf_transform.py:412) and has already consumed it. Only a leak placed BEFORE that call
    is reachable — which is exactly the edit a future author would make if they read "apply the tide
    to the depth" and applied it at the top.

    Discriminating case, found by measurement: shelf 20 m / width 150 km, where Kf is neither
    saturated nor floored. The leak shows as -0.1705 ft; the correct code shows 0.0000.
    """
    on = _tf("1")
    base = on.estimate_surf(2.0, 14.0, 20.0, coastal=True, shelf_width_km=150.0,
                            break_depth_m=60.0)[0]
    for eta in (-1.5, -0.75, 0.75, 1.5):
        got = on.estimate_surf(2.0, 14.0, 20.0, coastal=True, shelf_width_km=150.0,
                               break_depth_m=60.0, water_level_m=eta)[0]
        assert got == base, (
            f"eta {eta} m changed the height on a shelf-friction-dominated, UNCAPPED case "
            f"({got} vs {base}). The tide is reaching `depth_m` and altering cross-shelf "
            f"dissipation — a metre of tide against a 139 km shelf median is noise, and this is "
            f"the one place the offset must never be applied.")


def test_the_jacobian_is_monotone_and_saturates():
    """Bigger surf on the same shallow reef must be MORE tide-sensitive, because more of its range
    sits against the cap. Measured: +1.416 ft/m at 2 m/12 s, +2.657 at 4 m/16 s."""
    on = _tf("1")

    def jac(Hs, Tp):
        return (_shallow(on, Hs, Tp, 1.5) - _shallow(on, Hs, Tp, -1.5)) * FT / 3.0

    small, big = jac(2.0, 12.0), jac(4.0, 16.0)
    assert small > 0 and big > 0, f"non-positive tide sensitivity: {small}, {big}"
    assert big > small, (
        f"bigger surf is not more tide-sensitive ({big:.3f} vs {small:.3f} ft/m) — the cap is not "
        f"the binding term it is supposed to be")


def test_a_spring_low_cannot_produce_a_negative_height__THE_FLOOR():
    """MANDATORY, NOT DEFENSIVE. Retained break depths bottom out at exactly
    _MIN_TRUSTWORTHY_DEPTH_M = 3.0, so an offset past -3 m drives cap_depth <= 0 and
    `min(H, cap)` returns a NEGATIVE surf height."""
    on = _tf("1")
    for d, eta in [(3.0, -3.0), (3.0, -5.0), (3.5, -10.0), (0.5, -1.5)]:
        h = on.estimate_surf(2.0, 12.0, 2534.5, coastal=True, shelf_width_km=25.8,
                             break_depth_m=d, water_level_m=eta)[0]
        assert h is not None and h > 0, (
            f"break_depth {d} m with eta {eta} m produced {h} — a non-positive breaking height")


# ── COMPOSITION: both paths, and the production entry point ──────────────────────────────────

def test_the_SPECTRAL_path_carries_the_tide_too():
    """Every partition breaks in the same water at the same hour. A spectral path that dropped the
    offset would be a second forecast path — the defect the sim shipped twice."""
    on = _tf("1")
    parts = [{"h": 1.6, "tp": 14.0, "dir": 280.0, "kind": "swell"},
             {"h": 0.8, "tp": 6.0, "dir": 300.0, "kind": "windsea"}]
    base = on.estimate_surf_partitioned(parts, 2534.5, coastal=True, shelf_width_km=25.8,
                                        shore_normal_deg=280.0, break_depth_m=3.5)[0]
    low = on.estimate_surf_partitioned(parts, 2534.5, coastal=True, shelf_width_km=25.8,
                                       shore_normal_deg=280.0, break_depth_m=3.5,
                                       water_level_m=-1.5)[0]
    assert base is not None and low is not None, "SETUP BROKEN: the spectral path returned None"
    assert low < base, (
        "the spectral path ignored the tide while the scalar path honoured it — that is two "
        "different forecasts of the same hour")


def test_it_reaches_the_PRODUCTION_entry_point():
    """`estimate_surf_at` is the mandated composition entry. A parameter that stops at the physics
    module is 'wired but never executed' — this repo has shipped that twice."""
    _tf("1")
    import services.weather_pipeline.surf_point as sp
    importlib.reload(sp)

    g = sp.resolve_surf_geometry(*PIPELINE)
    # Pipeline's real break is 11.1 m — deep enough that a 2 m/12 s swell never reaches the cap.
    # Substitute a shallow reef so the tide term is in its binding regime.
    if hasattr(g, "_replace"):
        shallow = g._replace(break_depth_m=3.5)          # NamedTuple
    else:
        import dataclasses
        shallow = dataclasses.replace(g, break_depth_m=3.5)

    base, _ = sp.estimate_surf_at(PIPELINE[0], PIPELINE[1], 2.0, 12.0, 315.0, geometry=shallow)
    low, _ = sp.estimate_surf_at(PIPELINE[0], PIPELINE[1], 2.0, 12.0, 315.0, geometry=shallow,
                                 water_level_m=-1.5)
    assert low < base, (
        f"estimate_surf_at ignored water_level_m ({low} vs {base}) — the parameter does not reach "
        f"the production composition entry point")

    zero, _ = sp.estimate_surf_at(PIPELINE[0], PIPELINE[1], 2.0, 12.0, 315.0, geometry=shallow,
                                  water_level_m=0.0)
    assert zero == base, "water_level_m=0.0 moved the value through estimate_surf_at"


def test_no_serving_caller_supplies_it_yet__RECORDED_NOT_ASSUMED():
    """⚠️ HONEST STATE. The physics is in and proven; the SERVING wiring is a separate step. This
    test records that fact by execution so nobody reads an available parameter as a live one — and
    it will FAIL the moment someone wires it, which is exactly when this note must be re-read."""
    import ast
    import pathlib
    root = pathlib.Path(__file__).resolve().parent.parent / "services" / "weather_pipeline"
    callers = []
    for p in root.glob("*.py"):
        try:
            tree = ast.parse(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call)
                    and getattr(node.func, "attr", getattr(node.func, "id", "")) in
                    ("estimate_surf_at", "estimate_surf", "estimate_surf_partitioned")
                    and any(k.arg == "water_level_m" for k in node.keywords)):
                callers.append(p.name)
    assert set(callers) <= {"surf_point.py", "surf_transform.py"}, (
        f"a serving-path module now supplies water_level_m ({sorted(set(callers))}). Good — but "
        f"re-read row H first: enabling SURF_TIDE_DEPTH moves served values, and the guardrail is a "
        f"served-height delta census, not this unit suite.")

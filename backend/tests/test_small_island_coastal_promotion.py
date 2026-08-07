"""A 0.25 deg LAND MASK CANNOT SEE A SMALL ISLAND — and the chain was publishing the OFFSHORE
significant height as the surf height at 18 catalogued spots because of it.

WHY THIS EXISTS (MASTER-AUDIT-10.0 §0b.3, risk-matrix row G). `surf_transform` does
`if not coastal: return float(Hs_m), 'open_ocean'` — it returns the offshore Hs byte-identically.
`coastal` came from `bathymetry.is_coastal`, which asks a 0.25 deg (~28 km) mask whether ANY land
sits within +-3 cells (~83 km). Barbados, the Maldives, Cape Verde, Fernando de Noronha, Tuvalu,
Micronesia and the Marshall Islands do not fill a 28 km cell, so the mask answered "no land" and
the whole nearshore transform was skipped.

⛔ THAT IS CLAUDE.md's FIRST BINDING RULE INVERTED — "NEVER report marine `point.speed` as the surf
height" — at destination spots people fly to. Soup Bowl at Hs 2.0 m read 6.6 ft "Overhead", which
was the offshore number with a label on it.

★★★ THE FORENSIC MARKER, AND WHY THIS SUITE ASSERTS ON IT RATHER THAN ON VALUES.
Measured at HEAD before the fix, dFt/dHs at those spots was **exactly 3.28084 ft/m and CONSTANT** —
that is the metres-to-feet conversion, i.e. the identity function, i.e. no transform ran at all. A
coastal control gives 4.68 -> 3.19 ft/m, DECREASING, which is what shoaling saturating toward a
depth cap looks like. A Jacobian assertion is SCALE-FREE: it keeps working when the constants move,
which a hard-coded "6.6 ft" would not. The repo's height constants are an ERA5-gated workstream and
this suite must not become a second place that pins them.

⚠️ The 18 all serve the SAME value after the fix (9.56 ft at Hs 2.0 / Tp 12 on the normal) despite
break depths from 11.1 m to 352.0 m. That is NOT this fix failing to use geometry — it is
MASTER-AUDIT-10.0 §1.13 measured from another angle: with the swell on the shore normal and a deep
shelf, the served chain reduces to Komar(Hs,Tp) x Kr and the depth grids do not enter. A coastal
control (Pipeline) produces the identical number.
"""
import importlib
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FT = 3.28084
HS_GRID = (0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0)
TP = 12.0

# Named members of the affected set, so a failure says WHICH beach broke.
SOUP_BOWL = (13.2152, -59.4880)
KANDOOMA = (3.9167, 73.5000)
NORONHA = (-3.8568, -32.3880)
PIPELINE = (21.665, -158.051)   # always coastal — the control that must never move


def _sp(flag="1"):
    """Reload surf_point under a given kill-switch value. The flag is read at call time, but the
    reload keeps this honest if that ever changes."""
    os.environ["SURF_COASTAL_FROM_SHORE_NORMAL"] = flag
    import services.weather_pipeline.surf_point as mod
    return importlib.reload(mod)


def _asset_coords():
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "services", "weather_pipeline", "data", "shore_normals.json")
    if not os.path.exists(p):
        return []
    doc = json.load(open(p, encoding="utf-8"))
    entries = doc["entries"] if isinstance(doc, dict) and "entries" in doc else doc
    out = []
    for e in entries:
        if isinstance(e, dict) and "lat" in e:
            out.append((float(e["lat"]), float(e["lng"])))
        elif isinstance(e, (list, tuple)) and len(e) >= 2:
            out.append((float(e[0]), float(e[1])))
    return out


def _curve(mod, lat, lng):
    """Served breaking height in ft across HS_GRID, swell on the shore normal."""
    g = mod.resolve_surf_geometry(lat, lng)
    sdir = g.shore_normal_deg if g.shore_normal_deg is not None else 270.0
    return g, [mod.estimate_surf_at(lat, lng, hs, TP, sdir, geometry=g) for hs in HS_GRID]


def _jacobian(curve):
    return [(curve[i + 1][0] - curve[i][0]) * FT / (HS_GRID[i + 1] - HS_GRID[i])
            for i in range(len(HS_GRID) - 1)]


def _is_identity(jac, tol=1e-4):
    """Constant and equal to the metres->feet conversion == no transform ran."""
    return all(abs(j - FT) < tol for j in jac)


# ── THE DEFECT, ASSERTED ON ITS FINGERPRINT ──────────────────────────────────────────────────

@pytest.mark.parametrize("lat,lng,name", [
    (SOUP_BOWL[0], SOUP_BOWL[1], "Soup Bowl, Barbados"),
    (KANDOOMA[0], KANDOOMA[1], "Kandooma Right, Maldives"),
    (NORONHA[0], NORONHA[1], "Fernando de Noronha"),
])
def test_the_offshore_identity_is_gone(lat, lng, name):
    """THE ONE THAT WOULD HAVE CAUGHT IT."""
    mod = _sp("1")
    g, curve = _curve(mod, lat, lng)

    assert g.coastal is True, f"{name}: still not coastal, so estimate_surf will short-circuit"
    assert all(r != "open_ocean" for _, r in curve), (
        f"{name}: still returns regime 'open_ocean', which returns the OFFSHORE Hs verbatim")

    jac = _jacobian(curve)
    assert not _is_identity(jac), (
        f"{name}: dFt/dHs is still constant {FT} ft/m — that is the metres-to-feet conversion, so "
        f"NO nearshore transform ran and the served 'surf height' is the offshore significant "
        f"height with a label on it. Jacobian: {[round(j, 3) for j in jac]}")

    # A real transform saturates: the marginal ft-per-metre must FALL as the sea grows.
    assert jac[0] > jac[-1], (
        f"{name}: dFt/dHs is not decreasing ({jac[0]:.3f} -> {jac[-1]:.3f}); shoaling toward a "
        f"depth cap must show diminishing returns")

    i2 = HS_GRID.index(2.0)
    assert curve[i2][0] * FT > 2.0 * FT + 0.5, (
        f"{name}: breaking height at Hs 2.0 m is still ~the offshore {2.0 * FT:.2f} ft")


def test_the_kill_switch_restores_the_defect_exactly__THE_CONTROL():
    """MUTATION CONTROL. If the flag OFF does not reproduce the identity Jacobian, these tests are
    passing for some other reason and prove nothing about this fix."""
    off = _sp("0")
    g, curve = _curve(off, *SOUP_BOWL)
    assert g.coastal is False
    assert all(r == "open_ocean" for _, r in curve)
    assert _is_identity(_jacobian(curve)), (
        "with the fix disabled the Jacobian is NOT the identity — the pre-fix behaviour this suite "
        "claims to correct is not what actually happened, so re-derive the finding")
    _sp("1")


def test_the_coastal_control_never_moves():
    """Pipeline is coastal under every instrument. It must be bit-identical across the flag, and it
    must still hit the repo's recorded height anchor."""
    on = _sp("1")
    _, c_on = _curve(on, *PIPELINE)
    off = _sp("0")
    _, c_off = _curve(off, *PIPELINE)
    assert c_on == c_off, "the flag moved a spot that was already coastal — scope has leaked"

    mod = _sp("1")
    g = mod.resolve_surf_geometry(*PIPELINE)
    h, _ = mod.estimate_surf_at(PIPELINE[0], PIPELINE[1], 12.0, 18.0, 315.0, geometry=g)
    assert abs(h * FT - 29.50) < 0.05, (
        f"Pipeline 12 m/18 s = {h * FT:.2f} ft, expected the recorded 29.50 ft anchor "
        f"(a legacy-constants restore would give 45.52 ft)")


# ── BLAST RADIUS: the census, so the scope cannot widen silently ──────────────────────────────

def test_the_blast_radius_is_bounded_and_is_only_promotions():
    """Runs the full asset. Two things must hold: only spots that were coastal=False change, and
    every change is a promotion carrying asset/override evidence — never a demotion."""
    coords = _asset_coords()
    if len(coords) < 100:
        pytest.skip("shore_normals.json unavailable in this environment")

    off = _sp("0")
    before = {c: off.resolve_surf_geometry(*c) for c in coords}
    on = _sp("1")
    after = {c: on.resolve_surf_geometry(*c) for c in coords}

    changed = [c for c in coords if before[c].coastal != after[c].coastal]

    assert all(before[c].coastal is False and after[c].coastal is True for c in changed), (
        "a DEMOTION occurred — this fix may only ever promote")
    assert all(after[c].shore_normal_src.startswith(("etopo", "override")) for c in changed), (
        "a spot was promoted without asset or override evidence of a shoreline")

    # Everything else must be untouched, field for field.
    for c in coords:
        if c in set(changed):
            continue
        assert before[c] == after[c], f"{c} changed but was not in the promoted set"

    # Recorded at 2026-08-07: 18 of 1386. Bounded, not pinned to the exact number — the asset is
    # expected to grow, and a test that fails when a new island is catalogued would be noise.
    assert 0 < len(changed) <= 60, (
        f"{len(changed)} of {len(coords)} coords promoted (recorded 2026-08-07: 18 of 1386). "
        f"A large jump means `is_coastal` or the asset changed shape — re-measure before trusting.")


def test_every_promoted_spot_leaves_the_open_ocean_regime():
    """The promotion is only worth anything if it actually reaches the served height."""
    coords = _asset_coords()
    if len(coords) < 100:
        pytest.skip("shore_normals.json unavailable in this environment")

    off = _sp("0")
    was_open = [c for c in coords if off.resolve_surf_geometry(*c).coastal is False]
    assert was_open, "SETUP BROKEN: no coordinate reproduces the pre-fix defect"

    on = _sp("1")
    still_open = []
    for c in was_open:
        g, curve = _curve(on, *c)
        if any(r == "open_ocean" for _, r in curve) or _is_identity(_jacobian(curve)):
            still_open.append(c)
    assert not still_open, (
        f"{len(still_open)} of {len(was_open)} previously-open_ocean spots still serve the offshore "
        f"identity: {still_open[:5]}")

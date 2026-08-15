"""THE CAP SEAM: a rising offshore sea must never DROP the published surf height.

THE DEFECT (recorded 11.0 §3.8/E1-03 as "the H1/10 cap seam"; re-measured by Master Codex Audit 1.0
MC-01 and reproduced at HEAD c1566c8b, 2026-08-15): `estimate_surf` decides saturation by comparing
the PRE-conversion height against the γ·d cap, but returns the POST-conversion (×1.27, H1/10) value
on the unsaturated branch and the UN-converted cap on the saturated one. Published height therefore
climbs to 1.27·cap and then falls onto cap as offshore Hs rises 0.01 m:

    steep shelf, Tp 10 s: Hs 9.40 → 9.41 m published 8.2294 → 6.4800 m  (−21.3%, = exactly 1/1.27)
    38 of 48 probe traces contain such a drop; 6.48 = 0.81 × 8.0 m = the cap itself.

THE REPAIR (`SURF_CAP_SEAM_MONOTONE`, default OFF — dark until the owner flips it): saturate in the
published statistic's OWN space — publish min(converted, cap) — implemented at the single shared
point `surf_height_convention.publish_surf_height`. The cap stays UNconverted (γ·d is already an
individual-maximum-wave criterion; see that module). Consequences, each pinned below:

  * monotone and continuous in Hs for fixed geometry/period/direction/tide/flags;
  * published height never exceeds the function's own physical ceiling;
  * `regime == 'breaking'` exactly when the ceiling binds (downstream regime consumers stay honest);
  * differs from legacy ONLY inside the over-ceiling band [cap/1.27, cap), where it clips to cap;
  * deep saturation (the 29.50 ft Pipeline-class anchor) is byte-unmoved;
  * H110 OFF ⇒ the repair is a no-op (there is no seam without the conversion);
  * flag OFF ⇒ byte-identical legacy, over-ceiling values and all (the kill switch has teeth).

Blast radius for the eventual flip: the depth-limited cap binds on 0.145% of served spot-hours
(n=227,088, 2026-08-07), concentrated on big-wave frames — the safety-critical ones.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import surf_height_convention as SHC          # noqa: E402
from services.weather_pipeline.surf_transform import (                       # noqa: E402
    breaker_index, estimate_surf, estimate_surf_partitioned,
)

FLAG = "SURF_CAP_SEAM_MONOTONE"

# (depth_m, shelf_width_km, break_depth_m) — the probe's coastal geometries. Direction args stay
# None/None (exposure factor 1.0) so the sweep isolates the Hs axis; one off-axis case is separate.
GEOMETRIES = {
    "steep_shelf": (100.0, 10.0, 8.0),
    "wide_shelf": (20.0, 200.0, 4.0),
    "medium": (50.0, 30.0, 5.0),
}
PERIODS = (8.0, 10.0, 14.0, 18.0)

# Every flag the transform reads at call time: cleared so code DEFAULTS are what is measured
# (H110 ON, Kr 0.797, break depth ON, tide OFF — the served composition).
_ENV = ("SURF_HEIGHT_H110", "SURF_REFRACTION_KR", "SURF_CAP_SEAM_MONOTONE", "SURF_BREAK_DEPTH",
        "SURF_TIDE_DEPTH", "SURF_V3_SLOPE_GAMMA", "SURF_V3_KOMAR", "SURF_V3_MAGNETS",
        "SURF_V3_SHELF_RECAL", "SURF_V3_EXPOSURE", "SURF_V3_JACK_MAX", "SURF_SHELF_KF_FLOOR",
        "SURF_GAMMA_FIELD_CEILING", "SURF_EXPOSURE_RECONCILED", "SURF_V3_NORMAL_OVERRIDES")


@pytest.fixture
def flags(monkeypatch):
    for var in _ENV:
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


def _cap(tp, geometry):
    depth, width, bd = GEOMETRIES[geometry]
    return breaker_index(tp, slope=depth / (width * 1000.0)) * bd


def _sweep(tp, geometry, lo=0.10, hi=12.00, step=0.02, swell=None, normal=None):
    depth, width, bd = GEOMETRIES[geometry]
    hs = lo
    out = []
    while hs <= hi + 1e-9:
        h, regime = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width,
                                  swell_from_deg=swell, shore_normal_deg=normal,
                                  break_depth_m=bd)
        out.append((round(hs, 4), float(h), regime))
        hs += step
    return out


# ── THE REPAIR, PINNED (all red on the unrepaired tree with the flag ON) ────────────────────────

@pytest.mark.parametrize("geometry", sorted(GEOMETRIES))
@pytest.mark.parametrize("tp", PERIODS)
def test_published_height_is_monotone_in_offshore_hs(flags, tp, geometry):
    """MC-01 acceptance criterion 1: fixed geometry/period/direction/tide/config ⇒ increasing
    offshore Hs must not decrease the published surf height."""
    flags.setenv(FLAG, "1")
    trace = _sweep(tp, geometry)
    drops = [(a, b) for a, b in zip(trace, trace[1:]) if b[1] - a[1] < -1e-9]
    assert not drops, (
        f"{geometry}/Tp={tp}: published surf FELL as Hs rose, e.g. Hs {drops[0][0][0]}→"
        f"{drops[0][1][0]} m published {drops[0][0][1]:.4f}→{drops[0][1][1]:.4f} m — the cap seam")


@pytest.mark.parametrize("geometry", sorted(GEOMETRIES))
@pytest.mark.parametrize("tp", PERIODS)
def test_published_height_never_exceeds_its_own_ceiling(flags, tp, geometry):
    """The over-ceiling band is the seam's other face: legacy publishes up to 1.27×cap, 27% above
    the depth-limited maximum the same call computed. With the repair, never."""
    flags.setenv(FLAG, "1")
    cap = _cap(tp, geometry)
    over = [(hs, h) for hs, h, _ in _sweep(tp, geometry) if h > cap + 1e-9]
    assert not over, (
        f"{geometry}/Tp={tp}: published {over[0][1]:.4f} m exceeds the γ·d ceiling {cap:.4f} m "
        f"at Hs {over[0][0]} m — the statistic overshot its own physical maximum")


@pytest.mark.parametrize("geometry", sorted(GEOMETRIES))
def test_regime_says_breaking_exactly_when_the_ceiling_binds(flags, geometry):
    """Downstream consumers publish `regime`; it must mean what it says: 'breaking' ⇔ the
    published value IS the cap. Legacy violates ⇐ inside the band (h > cap yet regime 'shelf')."""
    flags.setenv(FLAG, "1")
    cap = _cap(14.0, geometry)
    for hs, h, regime in _sweep(14.0, geometry):
        if regime == "breaking":
            assert h == pytest.approx(cap, abs=1e-9), (hs, h, cap)
        else:
            assert h < cap + 1e-9, (
                f"{geometry}: Hs {hs} published {h:.4f} ≥ cap {cap:.4f} under regime "
                f"'{regime}' — the label lies about saturation")


@pytest.mark.parametrize("geometry", sorted(GEOMETRIES))
@pytest.mark.parametrize("tp", PERIODS)
def test_the_repair_changes_only_the_over_ceiling_band(flags, tp, geometry):
    """THE THEOREM, and the mutation trap: fixed output == legacy output wherever legacy respected
    the ceiling, and == the cap wherever legacy overshot it. Kills a double conversion (below-band
    values would inflate), a missing conversion (deflate), and any drift outside the band."""
    flags.setenv(FLAG, "0")
    legacy = _sweep(tp, geometry)
    flags.setenv(FLAG, "1")
    fixed = _sweep(tp, geometry)
    cap = _cap(tp, geometry)
    assert len(legacy) == len(fixed)
    for (hs, hl, rl), (_, hf, rf) in zip(legacy, fixed):
        if hl <= cap + 1e-9:
            assert hf == pytest.approx(hl, abs=1e-12) and rf == rl, (
                f"{geometry}/Tp={tp} Hs={hs}: repair moved a value OUTSIDE the band "
                f"({hl:.6f}→{hf:.6f}, {rl}→{rf})")
        else:
            assert hf == pytest.approx(cap, abs=1e-9) and rf == "breaking", (
                f"{geometry}/Tp={tp} Hs={hs}: in-band value not clipped to the cap "
                f"({hl:.6f}→{hf:.6f}, want {cap:.6f})")


def test_fine_sweep_across_the_crossover_has_no_negative_step(flags):
    """The audit's exact reproduction, at 10× finer resolution around the crossover: the largest
    recorded jump was Hs 9.40→9.41 m on the steep shelf at Tp 10 s with a 45° swell offset
    (exposure 0.868 — the offset moves the crossover, so it is part of the reproduction).
    Walk ±0.3 m in 1 mm steps."""
    flags.setenv(FLAG, "1")
    trace = _sweep(10.0, "steep_shelf", lo=9.10, hi=9.70, step=0.001, swell=135.0, normal=90.0)
    drops = [(a, b) for a, b in zip(trace, trace[1:]) if b[1] - a[1] < -1e-9]
    assert not drops, f"negative step at the crossover survives the repair: {drops[0]}"


def test_partitioned_contributions_respect_the_ceiling(flags):
    """The partitioned path already caps its quadrature TOTAL post-conversion; with the repair each
    train's contribution is ceiling-respecting too, so a single in-band train equals the total-field
    answer instead of smuggling 1.27×cap into the sum."""
    flags.setenv(FLAG, "1")
    depth, width, bd = GEOMETRIES["steep_shelf"]
    cap = _cap(14.0, "steep_shelf")
    # find an Hs whose LEGACY total-field answer overshoots the cap (the band is where they differ)
    flags.setenv(FLAG, "0")
    band = [hs for hs, h, _ in _sweep(14.0, "steep_shelf") if h > cap + 1e-9]
    assert band, "no over-ceiling band found — the seam this file repairs has changed shape"
    flags.setenv(FLAG, "1")
    hs = band[len(band) // 2]
    total = estimate_surf(hs, 14.0, depth, coastal=True, shelf_width_km=width, break_depth_m=bd)
    part = estimate_surf_partitioned([{"h": hs, "tp": 14.0, "dir": None, "kind": "swell"}],
                                     depth, coastal=True, shelf_width_km=width, break_depth_m=bd)
    assert part[0] == pytest.approx(total[0], abs=1e-9)
    assert part[0] <= cap + 1e-9 and part[1] == "breaking"


# ── CONTROLS (green before AND after — the kill switch, the anchors, the no-op axes) ────────────

def test_flag_off_is_byte_identical_legacy_including_the_defect(flags):
    """The kill switch has teeth: OFF preserves the legacy seam EXACTLY — over-ceiling value,
    regime label, and the 1/1.27 drop — pinned on the audit's headline case. If this ever fails
    the legacy path drifted, which the dark rollout promised it cannot."""
    flags.setenv(FLAG, "0")
    depth, width, bd = GEOMETRIES["steep_shelf"]
    before, r_before = estimate_surf(9.40, 10.0, depth, coastal=True, shelf_width_km=width,
                                     swell_from_deg=135.0, shore_normal_deg=90.0,
                                     break_depth_m=bd)
    after, r_after = estimate_surf(9.41, 10.0, depth, coastal=True, shelf_width_km=width,
                                   swell_from_deg=135.0, shore_normal_deg=90.0,
                                   break_depth_m=bd)
    assert before == pytest.approx(8.2294, abs=5e-4) and r_before == "shelf"
    assert after == pytest.approx(6.4800, abs=5e-4) and r_after == "breaking"
    assert before / after == pytest.approx(SHC.H110_OVER_HS, abs=1e-3), (
        "the legacy drop is no longer exactly the H1/10 factor — the seam's mechanism changed")


def test_deep_saturation_is_unmoved_by_the_repair(flags):
    """The 29.50-ft-class anchor: far past the band both paths return the naked cap, so the repair
    must be invisible there (test_height_anchors pins the same point against the H110/Kr pair)."""
    depth, width, bd = GEOMETRIES["steep_shelf"]
    flags.setenv(FLAG, "0")
    legacy = estimate_surf(12.0, 18.0, depth, coastal=True, shelf_width_km=width, break_depth_m=bd)
    flags.setenv(FLAG, "1")
    fixed = estimate_surf(12.0, 18.0, depth, coastal=True, shelf_width_km=width, break_depth_m=bd)
    assert legacy == fixed and fixed[1] == "breaking"


def test_h110_off_makes_the_repair_a_noop(flags):
    """No conversion, no seam: with SURF_HEIGHT_H110=0 the repair must change nothing anywhere."""
    flags.setenv("SURF_HEIGHT_H110", "0")
    for tp in (10.0, 14.0):
        flags.setenv(FLAG, "0")
        legacy = _sweep(tp, "steep_shelf")
        flags.setenv(FLAG, "1")
        assert _sweep(tp, "steep_shelf") == legacy


def test_off_axis_exposure_keeps_the_monotone_property(flags):
    """One off-axis control: the exposure factor scales H before the cap, so monotonicity must
    survive a 45° swell/shore-normal offset too."""
    flags.setenv(FLAG, "1")
    depth, width, bd = GEOMETRIES["steep_shelf"]
    prev = None
    hs = 0.10
    while hs <= 12.0 + 1e-9:
        h, _ = estimate_surf(hs, 12.0, depth, coastal=True, shelf_width_km=width,
                             swell_from_deg=135.0, shore_normal_deg=90.0, break_depth_m=bd)
        if prev is not None:
            assert h - prev >= -1e-9, f"off-axis drop at Hs {hs:.2f}: {prev:.4f}→{h:.4f}"
        prev = h
        hs += 0.02


# ── THE FLAG REGISTRY MUST TELL THE TRUTH ABOUT BOTH FLAGS ──────────────────────────────────────

def _registry_default(name):
    import ast
    path = os.path.join(backend_dir, "routes", "admin", "surf_forecast.py")
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "_RATING_FLAGS" for t in node.targets):
            table = ast.literal_eval(node.value)
            assert name in table, f"{name} is not declared in _RATING_FLAGS — undeclared switch"
            return table[name][0]
    raise AssertionError("_RATING_FLAGS not found")


def test_the_new_flag_is_declared_and_its_registry_default_matches_the_code(flags):
    """A new os.environ.get in a rating surface is a REGISTRY EDIT (2026-08-14 lesson, and the
    2026-08-04 omission before it): declared, default OFF, and the panel's default == the code's."""
    assert _registry_default(FLAG) == "0"
    assert SHC.cap_seam_monotone_enabled() is False, "the repair must ship DARK (default OFF)"
    flags.setenv(FLAG, "1")
    assert SHC.cap_seam_monotone_enabled() is True


def test_the_h110_registry_default_matches_the_code_default(flags):
    """FOUND STALE 2026-08-15: the registry declared SURF_HEIGHT_H110 default '0' while the code
    default has been '1' since 2026-08-05 — so /admin/surf-forecast/status, the ONE instrument that
    can read Render, reported the height convention OFF whenever the env did not set it. The
    registry default must equal the code default or the panel fabricates the flag state."""
    assert _registry_default("SURF_HEIGHT_H110") == "1", (
        "registry says '0' but surf_height_convention.enabled() defaults ON — the admin panel "
        "misreports the live statistic")
    assert SHC.enabled() is True

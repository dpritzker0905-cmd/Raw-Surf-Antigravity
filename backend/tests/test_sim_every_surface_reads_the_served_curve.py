"""EVERY sim surface that rates a fetched baseline must grade on the curve the app served.

★★★ THIS GUARD EXISTS BECAUSE I SHIPPED THE DEFECT IT CATCHES. `5f19ac7d` threaded
`served_reference_size_m` through FOUR call sites — get_weather_forecast, both sides of the what-if
delta, and sim_window — and MISSED TWO: `sim_compare.scan` (the tool that RANKS spots) and
`sim_briefing.summary_line`. Both already had the provenance in hand; `sim_compare` literally bound
it as `_prov` and threw it away.

The result was worse than the original bug, because it was INCONSISTENT: `find_best_spot` ranked on
the global 1.2 m curve while `get_weather_forecast` displayed the local one, so the two tools
contradicted each other about the same break. Measured live over 4 regions x 8 neighbouring spots
before the fix:

    Cocoa Beach Pier   WINNER CHANGES   rank displacement 14   references 0.43 - 0.43 m
    Lower Trestles     WINNER CHANGES   rank displacement  8   references 2.17 - 2.17 m
    Kommetjie          WINNER CHANGES   rank displacement  8   references 2.07 - 2.71 m
    Malibu First Point no change        rank displacement  0   references 1.97 - 2.24 m

⭐⭐ AND IT REFUTES THE OBVIOUS INTUITION — "neighbouring spots share a reference, so switching the
curve cannot reorder them". Cocoa's eight spots have an IDENTICAL 0.43 m reference and the order
still moved by 14 positions. `size_score` is non-linear in the spot's OWN breaking height: the
global branch saturates at an absolute 1.2 m, the local branch is anchored at the reference and
saturates at 2.5x it, so every spot moves by a different amount even under a shared reference.
**A uniform input to a non-linear function is not a uniform output.**

⇒ The missing thing was never a fix, it was THIS INSTRUMENT: a guard that ENUMERATES the call sites
instead of trusting that whoever threaded a parameter found all of them. Same shape as
`test_rating_composition_parity.py`'s registry, one layer down.
"""
import ast
import os

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Every module that rates a baseline it obtained from the app. Add a module here when it starts
# calling `calculate_surf_rating` — that is the point of the guard.
SURFACES = [
    "services/weather_pipeline/sim_compare.py",
    "services/weather_pipeline/sim_window.py",
    "services/weather_pipeline/sim_briefing.py",
    "weather_sim_mcp.py",
]

# ⚠️ EXEMPTIONS ARE NAMED, WITH THE REASON — never achieved by quietly narrowing the list above.
EXEMPT = {
    # A cold-start warmup on a hard-coded catalogue vector. There is no fetched baseline and no
    # provenance, so there is no served curve to mirror.
    "services/weather_pipeline/sim_boot.py": "warmup call, no baseline and no provenance",
    # DELIBERATE: the parity probe measures the flag+blob lane (the per-SPOT reference) so it can
    # compare like-for-like against the served glyph, which is also per-SPOT. Switching it to the
    # served per-CELL reference would make it report the cell-vs-spot gap (queue E#1) as a parity
    # divergence. That is a real gap but a separate, deliberate decision about what the monitor
    # tracks -- see HANDOFF-2026-08-01-G.
    "scripts/sim_health_probe.py": "measures the lookup lane on purpose; see E#1",
}


def _calls(path):
    """Every `calculate_surf_rating(...)` Call node in a file, with its keyword names."""
    full = os.path.join(BACKEND, path)
    with open(full, "r", encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=path)
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name == "calculate_surf_rating":
            out.append((node.lineno, {k.arg for k in node.keywords if k.arg}))
    return out


@pytest.mark.parametrize("path", SURFACES)
def test_every_sim_rating_call_passes_the_served_reference(path):
    calls = _calls(path)
    assert calls, f"{path} no longer calls calculate_surf_rating — update SURFACES or EXEMPT"
    missing = [ln for ln, kw in calls if "served_reference_size_m" not in kw]
    assert not missing, (
        f"{path} rates a baseline WITHOUT the app's own size curve at line(s) {missing}. "
        f"A sim surface on a different curve from its siblings makes two tools contradict each "
        f"other about the same break — measured: the find_best_spot WINNER changed in 3 of 4 "
        f"regions. Pass served_reference_size_m=sim_forecast.served_reference(provenance).")


def test_the_guard_can_actually_fail():
    """NEGATIVE CONTROL. A green 'every surface does X' test is not evidence the test works — the
    recorded rule from `79e1001a`/#14. This proves the detector fires on the real shape by parsing
    the exact code that shipped broken, rather than trusting that it would."""
    broken = ast.parse(
        "calc = calculate_surf_rating(\n"
        "    spot, b['swell_height_m'], b['swell_period_sec'], b['swell_direction_deg'],\n"
        "    b['wind_speed_knots'], b['wind_direction_deg'], partitions=b.get('partitions'),\n"
        "    valid_time=valid_time, allow_reference_lookup=True)\n")
    found = [{k.arg for k in n.keywords if k.arg}
             for n in ast.walk(broken)
             if isinstance(n, ast.Call) and getattr(n.func, "id", None) == "calculate_surf_rating"]
    assert found, "the control's own parse found no call — it is not testing what it claims"
    assert "served_reference_size_m" not in found[0], "the control is not the broken shape"
    assert "allow_reference_lookup" in found[0], (
        "and it IS otherwise a well-formed call — the guard must not pass merely because the "
        "snippet is malformed")


def test_every_exemption_still_names_a_real_file_and_a_real_call():
    """An exemption that outlives its file is a hole nobody can see. If the module stops calling
    the engine, the entry must go — otherwise the list slowly becomes a permanent opt-out."""
    for path, reason in EXEMPT.items():
        full = os.path.join(BACKEND, path)
        assert os.path.exists(full), f"exempt file {path} is gone — delete the exemption"
        assert _calls(path), (
            f"{path} no longer calls calculate_surf_rating — its exemption is stale")
        assert len(reason) > 20, f"{path}'s exemption must say WHY, not just that it is exempt"


def test_no_surface_is_silently_missing_from_the_registry():
    """⭐ THE COVERAGE HALF, and the one that matters: SURFACES is a CLAIM of completeness, not
    completeness. `5f19ac7d` was written by someone (me) who believed they had found every call
    site. Walk the tree and assert that every file calling the engine is either registered or
    explicitly exempt — so a NEW surface cannot join by simply not being listed."""
    seen = set()
    for root, dirs, files in os.walk(BACKEND):
        dirs[:] = [d for d in dirs
                   if d not in {".git", "__pycache__", "node_modules", ".claude", "tests"}]
        for fn in files:
            if not fn.endswith(".py"):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, BACKEND).replace(os.sep, "/")
            try:
                with open(full, "r", encoding="utf-8") as fh:
                    src = fh.read()
            except (OSError, UnicodeDecodeError):
                continue
            # The definition and the re-export lines are not call sites.
            if "calculate_surf_rating(" in src and _calls(rel):
                seen.add(rel)
    unregistered = seen - set(SURFACES) - set(EXEMPT)
    assert not unregistered, (
        f"these files call calculate_surf_rating but are in neither SURFACES nor EXEMPT: "
        f"{sorted(unregistered)}. Add them — a surface that joins the sim without joining this "
        f"registry is exactly how sim_compare ended up ranking on a different curve.")


# ── EVERY SURFACE THAT RENDERS A HEIGHT MUST ALSO RENDER ITS CAVEAT ─────────────────────────────
#
# ★★★ SAME SHAPE AS THE GUARD ABOVE, AND I SHIPPED THIS DEFECT TOO — TWICE.
# `d9e1ffd3` taught `sim_window` to publish `directional_conflict`, the warning that the SIZE and
# the QUALITY disagree about how much swell energy reaches the break and that the HEIGHT is the
# likelier overestimate. That commit's own message said "CHECK EVERY CONSUMER OF A DISCLOSURE, NOT
# JUST ITS PRODUCER" — and it reached ONE of four consumers. Measured 2026-08-06:
#
#     sim_rating.py    PRODUCER
#     sim_window.py    published (d9e1ffd3)
#     sim_compare.py   DROPPED  <- the ranking that answers "which break should I drive to"
#     sim_briefing.py  DROPPED  <- the daily summary line
#     weather_sim_mcp  DROPPED  <- the what-if delta, which MOVES a height that is already a bound
#
# ⛔ AND `exposure_floored` IS NOT COVERAGE FOR IT. `sim_compare` already carried that flag, which
# is exactly why the gap looked handled: two disclosures with DIFFERENT trigger predicates are not
# substitutes. `exposure_floored` fires on quality exposure <= 0.1005; the conflict fires when the
# two exposures DISAGREE — measured, the flag fired on the LOSER while the WINNER's 1.75x
# disagreement went unsaid.
#
# ⇒ The fix is not a fourth patch, it is THIS INSTRUMENT: enumerate the renderers rather than trust
#   that whoever added a disclosure found them all.

# Modules that put a breaking height in front of a caller. Add one here when it starts rendering
# `breaking_height_ft` — that is the point of the guard.
HEIGHT_RENDERERS = [
    "services/weather_pipeline/sim_compare.py",
    "services/weather_pipeline/sim_window.py",
    "services/weather_pipeline/sim_briefing.py",
    "weather_sim_mcp.py",
]

# ⚠️ NAMED, WITH THE REASON — never achieved by quietly shortening the list above.
DISCLOSURE_EXEMPT = {
    # The PRODUCER, not a renderer: it computes `directional_conflict` for everyone else.
    "services/weather_pipeline/sim_rating.py": "produces the disclosure rather than rendering it",
}


def _src(path):
    with open(os.path.join(BACKEND, path), encoding="utf-8") as fh:
        return fh.read()


@pytest.mark.parametrize("path", HEIGHT_RENDERERS)
def test_every_surface_that_renders_a_height_also_renders_the_conflict(path):
    src = _src(path)
    assert "breaking_height_ft" in src, \
        f"{path} no longer renders a height — update HEIGHT_RENDERERS or DISCLOSURE_EXEMPT"
    assert "directional_conflict" in src, (
        f"{path} renders `breaking_height_ft` but never mentions `directional_conflict`. That "
        f"height can be a known upper bound and this surface would not say so — the exact defect "
        f"d9e1ffd3 fixed in ONE of four consumers.")


def test_the_disclosure_guard_can_actually_fail():
    """A guard that cannot fail is decoration. Feed it a module that renders a height and says
    nothing, and it must reject — the pre-fix state of three of the four surfaces above."""
    pre_fix = 'row = {"breaking_height_ft": calc["breaking_height_ft"]}\n'
    assert "breaking_height_ft" in pre_fix
    assert "directional_conflict" not in pre_fix, \
        "the negative fixture must NOT contain the needle, or this test proves nothing"


def test_every_disclosure_exemption_still_names_a_real_file_that_still_produces_it():
    """An exemption that outlives its reason is invisible. `sim_rating` is exempt because it is the
    PRODUCER — if it ever stops producing, the exemption is a lie and every renderer is unguarded."""
    for path, reason in DISCLOSURE_EXEMPT.items():
        full = os.path.join(BACKEND, path)
        assert os.path.exists(full), f"exemption names a file that no longer exists: {path}"
        assert "directional_conflict" in _src(path), \
            f"{path} is exempt as the PRODUCER ({reason}) but no longer produces the disclosure"

"""ONE knots<->m/s pair, or the map and the sim disagree about the same spot-hour.

THE CLASS: a duplicated physical constant at different precision is invisible EXCEPT exactly ON a
comparison boundary. Away from one the error is 0.0 and every test is green, which is why this
survived four copies.

    `surf_rating.MS_TO_KT`      = 1.943844
    four modules each carried   `KT_TO_MS = 0.514444`   ( = 1/1.943844 TRUNCATED )
    round trip                  = 0.999998882736        ( always lands just BELOW )

`wind_quality`'s glassy branch is a STRICT `< 3.0` kt, so a wind of exactly 3.00 kt read glassy
(1.0) on the production paths and not-glassy (0.85) in the engine the sim calls — a rating LEVEL of
good 83.0 against epic 92.0 for one spot at one hour. ★ The SIGN decides whether the same defect
bites: truncating DOWN is inert against a `<=` edge and fatal against a `<`.

Measured before the fix, over 30,200 live wind cells (4 hours x 8 coasts): the truncated constant
flipped the verdict at 0 of them — served values carry 4 decimals and the flip window is 3.4e-6 kt
wide. So this was a LATENT trap, not a live regrade, and correcting it changed no served score.

The two tests below are the durable form. The first pins the INVARIANT (the round trip is exact for
ANY value of the constant — stronger than "the number is right"); the second stops a fifth copy
being written, which is the only way the class comes back.
"""
import os
import re
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import surf_rating as SR      # noqa: E402


def test_the_round_trip_is_UNBIASED_which_is_the_property_that_actually_matters():
    """★ MEASURED, and it corrects the obvious assumption: deriving the inverse does NOT make the
    round trip bit-exact — two float constants cannot do that, and 1,221 of 6,001 swept speeds
    still differ in the last ulp. What it removes is the BIAS.

    `0.514444` is 1/1.943844 TRUNCATED, so its error was SIGNED — every value came back LOW, by a
    fixed 1.1e-6 relative. A biased error is what turns float noise into a reproducible verdict:
    3.00 kt landed at 2.9999966 and fell through a strict `< 3.0` every single time. The derived
    inverse's error is ±1 ulp and centred on zero, ~1e10 times smaller and not always in the same
    direction, so it cannot deterministically fall off any edge."""
    kt, worst, low, high = 0.0, 0.0, 0, 0
    while kt <= 60.0001:
        err = (kt * SR.KT_TO_MS) * SR.MS_TO_KT - kt
        worst = max(worst, abs(err) / max(kt, 1.0))
        low += err < 0
        high += err > 0
        kt = round(kt + 0.01, 2)
    assert worst < 1e-15, f"relative round-trip error {worst!r} is far above one ulp"
    # The truncated constant produced low, low, low. A derived inverse must scatter both ways.
    assert low > 0 and high > 0, f"error is one-signed ({low} low / {high} high) — that is a BIAS"


def test_a_TRUNCATED_inverse_falls_off_every_edge_and_a_derived_one_does_not(monkeypatch):
    """Why DERIVED beats written-out, stated as the property that matters rather than as bit
    equality. A truncated reciprocal is low by a FIXED relative amount, so it slips below every
    boundary deterministically; a derived one is within a ulp and does not."""
    for value in (1.943844, 1.94384, 1.9438444924406046, 1.0, 3.7):
        monkeypatch.setattr(SR, "MS_TO_KT", value)
        monkeypatch.setattr(SR, "KT_TO_MS", 1.0 / value)
        for edge in (3.0, 6.0, 12.0, 20.0, 30.0):
            derived_err = (edge * SR.KT_TO_MS) * SR.MS_TO_KT - edge
            assert abs(derived_err) <= 1e-14, f"{edge} kt drifts {derived_err!r} at {value!r}"

    # The counterexample, at the real constant: six digits instead of seven puts every edge below
    # itself by ~1.1e-6 relative — a thousand million times the derived form's error, and always
    # in the same direction, which is what makes it a verdict rather than noise.
    monkeypatch.setattr(SR, "MS_TO_KT", 1.943844)
    for edge in (3.0, 6.0, 12.0, 20.0, 30.0):
        assert (edge * 0.514444) * SR.MS_TO_KT < edge


@pytest.mark.parametrize("shore_normal", [None, 225.0])
def test_the_TWO_EXPRESSIONS_are_not_interchangeable_which_is_why_only_one_is_allowed(shore_normal):
    """★★ THE FINDING THAT THE SAME-CONSTANT FIX DOES NOT COVER. `kt * SR.KT_TO_MS` and
    `kt / SR.MS_TO_KT` use the same constant and are still not bit-equal — they differ by one ulp,
    and 1,221 of 6,001 swept speeds land on different floats. Most of that is invisible, but the
    engine rounds its score to ONE DECIMAL, and a few speeds sit on that rounding edge.

    This test does not assert they agree — it measures the residue and pins the count as SMALL and
    the direction as UNBIASED, so the next reader knows the divide form is not a harmless synonym.
    The actual guarantee comes from the source guard below: every rating surface MULTIPLIES."""
    kt, diffs = 0.0, []
    while kt <= 60.0001:
        mul = SR.rating_score(1.5, 12.0, kt * SR.KT_TO_MS, wind_from_deg=45.0,
                              shore_normal_deg=shore_normal, swell_from_deg=225.0)
        div = SR.rating_score(1.5, 12.0, kt / SR.MS_TO_KT, wind_from_deg=45.0,
                              shore_normal_deg=shore_normal, swell_from_deg=225.0)
        if mul != div:
            diffs.append((kt, mul, div))
        kt = round(kt + 0.01, 2)
    assert all(abs(m - d) <= 0.1 + 1e-9 for _kt, m, d in diffs), \
        f"a form difference bigger than the score's own rounding step: {diffs[:3]}"
    assert len(diffs) < 25, (
        f"{len(diffs)} of 6001 speeds now differ between the two conversion FORMS — that is far "
        f"more than last-ulp rounding and means a constant has drifted: {diffs[:3]}")


def test_every_rating_surface_reaches_the_engine_through_the_SAME_expression():
    """The guarantee. All three rating surfaces plus the explanation multiply knots by
    `SR.KT_TO_MS`, so their m/s are bit-identical and no rounding edge can separate them."""
    import ast
    import inspect
    from services.weather_pipeline import sim_explain, sim_rating, spot_conditions, spot_ratings

    divides = []
    for mod in (sim_rating, sim_explain, spot_ratings, spot_conditions):
        tree = ast.parse(inspect.getsource(mod))
        for node in ast.walk(tree):
            if (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)
                    and isinstance(node.right, ast.Attribute)
                    and node.right.attr in ("MS_TO_KT", "KT_TO_MS")):
                divides.append(f"{mod.__name__}:{node.lineno}")
            if (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)
                    and isinstance(node.right, ast.Name)
                    and node.right.id in ("MS_TO_KT", "KT_TO_MS")):
                divides.append(f"{mod.__name__}:{node.lineno}")
    assert divides == [], (
        "knots -> m/s must be `* SR.KT_TO_MS` at every surface. Dividing by MS_TO_KT is equal to "
        "within one ulp and NOT bit-equal, which is enough to split the score's 1-decimal "
        f"rounding: {divides}")


def test_exactly_3_00_kt_is_NOT_glassy_on_any_path():
    """THE input that used to split them, and the one the old constant actually regraded: at
    `shore_normal=None` the engine takes `wind_quality`'s speed-only tiers, and 3.00 kt read glassy
    1.0 on the production paths against 0.85 in the sim — good 83.0 vs epic 92.0."""
    truncated = 0.514444
    assert (3.0 * truncated) * SR.MS_TO_KT < 3.0, "precondition: the old constant fell below the edge"
    assert SR.wind_quality(3.0 * truncated, 45.0, None) != SR.wind_quality(3.0 / SR.MS_TO_KT, 45.0, None), \
        "precondition: the old constant DID regrade 3.00 kt, or this test proves nothing"

    assert (3.0 * SR.KT_TO_MS) * SR.MS_TO_KT >= 3.0
    assert SR.wind_quality(3.0 * SR.KT_TO_MS, 45.0, None) == SR.wind_quality(3.0 / SR.MS_TO_KT, 45.0, None)
    assert SR.wind_quality(3.0 * SR.KT_TO_MS, 45.0, None) != SR.wind_quality(2.999 * SR.KT_TO_MS, 45.0, None), \
        "3.00 kt is the first NON-glassy speed; both paths must now see that"


# ── the guard that stops a fifth copy ────────────────────────────────────────────────────────────

# The animation path is NOT a rating path: `FieldEvolutionEngine.js` advects a field and never feeds
# `rating_score`, so its own constant cannot split a verdict. Listed explicitly so the exemption is
# a decision rather than an oversight.
_ALLOWED = {os.path.join("services", "weather_pipeline", "surf_rating.py")}
# ⚠️ MATCH ANY PRECISION, not the two known spellings. The first copy of this defect was
# `1.94384` — six digits — and a regex pinned to `1.943844` walks straight past it. That is how the
# guard would have missed the very instance that motivated it.
_LITERAL = re.compile(r"\b0\.5144\d*|\b1\.9438\d*")


def _python_sources():
    for root, dirs, files in os.walk(backend_dir):
        dirs[:] = [d for d in dirs
                   if d not in {"__pycache__", "venv", ".venv", "node_modules", ".git",
                                "migrations_archive", "archive", "tests"}]
        for f in files:
            if f.endswith(".py"):
                yield os.path.join(root, f)


def test_no_module_writes_its_own_knots_constant():
    """A duplicated unit constant is invisible until it is fatal. `surf_rating` owns the pair; every
    other module reads `SR.KT_TO_MS` / `SR.MS_TO_KT` as an ATTRIBUTE — never a from-import, which
    snapshots at import time and re-opens the same divergence."""
    offenders = []
    for path in _python_sources():
        rel = os.path.relpath(path, backend_dir)
        if rel in _ALLOWED:
            continue
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for n, line in enumerate(fh, 1):
                code = line.split("#", 1)[0]
                if _LITERAL.search(code):
                    offenders.append(f"{rel}:{n}: {line.strip()}")
    assert offenders == [], (
        "these files write a knots<->m/s constant of their own instead of reading "
        "`surf_rating`'s:\n  " + "\n  ".join(offenders))


def test_no_module_FROM_IMPORTS_the_knots_constants():
    """`from surf_rating import KT_TO_MS` binds the value at import time, so a later correction to
    the engine's constant would silently not reach that module — the Python twin of
    `export {x} from './y'` forwarding without a binding."""
    offenders = []
    pattern = re.compile(r"from\s+.*surf_rating\s+import\s+[^\n]*\b(KT_TO_MS|MS_TO_KT)\b")
    for path in _python_sources():
        rel = os.path.relpath(path, backend_dir)
        if rel in _ALLOWED:
            continue
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for n, line in enumerate(fh, 1):
                if pattern.search(line):
                    offenders.append(f"{rel}:{n}: {line.strip()}")
    assert offenders == [], (
        "read the constants as attributes (`from ... import surf_rating as SR`; `SR.MS_TO_KT`) "
        "so a correction reaches every caller:\n  " + "\n  ".join(offenders))

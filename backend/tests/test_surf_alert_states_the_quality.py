"""A SURF ALERT MUST NOT CALL A BLOWN-OUT DAY "perfect conditions".

THE DEFECT (2026-08-05). `routes/surf_data/alerts.py` resolves a spot through
`resolve_spot_conditions`, which runs the mandated chain and writes `rating` / `rating_level`
(observation-gated) into `current_conditions`. The alert loop then read ONLY `wave_height_ft` and
`wave_period`, matched on the user's height bounds, and sent:

    "Waves are {h}ft @ {p}s - perfect conditions!"

unconditionally. The quality was in the same dict, unread.

CLAUDE.md, verbatim:

    "★ A size without a quality is also incomplete: a blown-out 6 ft and a groomed 6 ft must not
     render identically."

They rendered IDENTICALLY — byte-for-byte the same push — and the mandate names alerts explicitly
among the surfaces it binds. ⚠️ A notification is worse than a screen for this class: the user acts
on it without looking at anything else.

⚠️ WHAT IS DELIBERATELY UNCHANGED: WHEN the alert fires. The user asked to be told at a height
range and that is still exactly the trigger. Adding a quality floor would silently drop alerts they
asked for; it is a product decision and needs a column on the alert. Only the CLAIM is fixed.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from routes.surf_data.alerts import surf_alert_body                      # noqa: E402


# ── the mandate, stated as a test ───────────────────────────────────────────────────────────────

def test_a_blown_out_6ft_and_a_groomed_6ft_do_NOT_render_identically():
    """The mandate's own sentence. This is the whole point of the file."""
    blown = surf_alert_body(6.0, 9, rating=8.4, rating_level="very_poor")
    groomed = surf_alert_body(6.0, 15, rating=88.0, rating_level="epic")
    assert blown != groomed
    # and the difference must be the QUALITY, not merely the period
    same_sea = surf_alert_body(6.0, 15, rating=8.4, rating_level="very_poor")
    assert same_sea != groomed, (
        "two 6 ft / 15 s days with opposite quality still read identically — the alert is "
        "reporting size and period only, which is the defect this file exists to prevent."
    )


def test_the_body_never_claims_perfection_on_height_alone():
    """The literal regression: the old string asserted the day was perfect with no quality read."""
    for rating, level in [(8.4, "very_poor"), (35.0, "poor_fair"), (88.0, "epic"), (None, None)]:
        body = surf_alert_body(6.0, 12, rating, level)
        assert "perfect conditions" not in body.lower(), (
            f"the alert claims perfection for rating={rating!r} level={level!r}: {body!r}"
        )


def test_the_quality_actually_appears_when_it_is_known():
    body = surf_alert_body(4.2, 13, rating=8.4, rating_level="very_poor")
    assert "4.2ft" in body and "13s" in body          # size still reported
    assert "very poor" in body                        # underscore rendered for humans
    assert "8/100" in body                            # and the number, so it is checkable


def test_a_MISSING_quality_is_STATED_not_guessed():
    """`rating` is None whenever the chain could not grade the hour. Saying nothing would leave the
    old implication ("we told you, so it must be good") intact; this says the quality is unknown."""
    body = surf_alert_body(6.0, 12, rating=None, rating_level=None)
    assert "unavailable" in body.lower()
    assert "perfect" not in body.lower()
    assert "6.0ft" in body                            # the part that IS known is still reported


def test_a_level_without_a_number_still_reports_the_level():
    """`rating_level` can be present while `rating` is None on an older frame. Report what exists."""
    body = surf_alert_body(6.0, 12, rating=None, rating_level="fair_good")
    assert "fair good" in body
    assert "/100" not in body                         # no invented number
    assert "unavailable" not in body.lower()


def test_the_helper_is_PURE_and_needs_no_database__THE_CONTROL():
    """Without this the tests above could be passing against a stub. The defect lived inside an
    async DB loop, which is a large part of why nothing tested it — the fix is only durable because
    the text is now computed by a module-level pure function."""
    import inspect

    assert not inspect.iscoroutinefunction(surf_alert_body)
    params = list(inspect.signature(surf_alert_body).parameters)
    assert params == ["wave_height_ft", "wave_period", "rating", "rating_level"], params
    # called twice with the same inputs -> byte-identical output, no hidden state
    a = surf_alert_body(5.0, 11, 42.0, "fair")
    b = surf_alert_body(5.0, 11, 42.0, "fair")
    assert a == b


def test_the_route_uses_the_helper_rather_than_rebuilding_the_string():
    """A pure helper nobody calls is the disease this repo keeps curing. Assert the ROUTE calls it,
    and that the old literal is gone from the module entirely."""
    import ast

    src = open(os.path.join(backend_dir, "routes/surf_data/alerts.py"), encoding="utf-8").read()
    tree = ast.parse(src)

    # ⚠️ CHECK LIVE STRING LITERALS, NOT THE RAW SOURCE. A first version asserted
    # `"perfect conditions" not in src` and went red on THIS FIX's own comments, which quote the old
    # string to explain what was removed. That is the "an audit read its own comment as evidence"
    # class, inverted: a guard tripping on the documentation of the thing it guards. Docstrings are
    # excluded for the same reason — the record of a defect must not read as the defect.
    docstrings = {
        node.body[0].value
        for node in ast.walk(tree)
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        and node.body and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
        and isinstance(node.body[0].value.value, str)
    }
    live = [n for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and n not in docstrings]
    offenders = [n.value[:70] for n in live if "perfect condition" in n.value.lower()]
    assert not offenders, (
        f"a LIVE string literal in alerts.py still claims perfection: {offenders}"
    )
    called = any(
        isinstance(n, ast.Call)
        and (n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", None))
        == "surf_alert_body"
        for n in ast.walk(ast.parse(src))
    )
    assert called, "alerts.py defines surf_alert_body but never CALLS it"

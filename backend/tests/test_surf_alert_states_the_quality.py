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


# ── the census ──────────────────────────────────────────────────────────────────────────────────
#
# ⛔⛔ THIS SECTION IS THE FIX FOR THE SECOND DEFECT, AND IT IS THE MORE IMPORTANT ONE.
#
# The original guard opened ONE HARD-CODED PATH:
#
#     src = open(os.path.join(backend_dir, "routes/surf_data/alerts.py"))
#
# and `routes/surf_data/alerts.py` is a MANUAL `POST /alerts/check` that nothing schedules. The job
# that actually fires is `scheduler/surf_alerts.py`, registered in `scheduler/__init__.py:43-45` on
# `IntervalTrigger(minutes=15)` and confirmed live in `/api/health`:
#
#     {"id": "check_surf_alerts", "trigger": "interval[0:15:00]"}
#
# So this file was green for ~8 days while the LIVE path sent
# `"Waves are {h}ft - perfect conditions!"` on height alone. The assertions were never the weak
# part. **AN EXPLICIT FILE LIST IN A GUARD IS THE BUG** — this repo's own recorded class,
# "THE CENSUS IS THE DEFECT, NOT THE ASSERTION".
#
# ⇒ The census below DISCOVERS its subjects by walking the tree for anything that emits a surf
#   alert. A fourth emitter added tomorrow is graded automatically, with no edit here.

def _iter_backend_sources():
    """Every .py under backend/, minus caches, vendored trees and the test suite itself."""
    import os as _os
    skip = {"__pycache__", ".pytest_cache", "node_modules", "scratch", "alembic", "migrations",
            "tests"}
    for dp, dn, fn in _os.walk(backend_dir):
        dn[:] = [d for d in dn if d not in skip]
        for f in fn:
            if f.endswith(".py"):
                yield _os.path.join(dp, f)


def _surf_alert_emitters():
    """DISCOVER every surf-alert emission. Returns {relpath: (tree, [emitting Call nodes])}.

    An emitter is a call to `Notification(type="surf_alert")` or to `send_push_notification` whose
    `data` dict carries `type: "surf_alert"`. Both are structural, so a renamed variable or a
    reformatted string cannot hide a site from this census.

    ⚠️ THE CALL NODES ARE RETURNED, NOT JUST THE MODULE, and that distinction is load-bearing. The
    first version of this census returned modules and then asked "does this MODULE build a body
    inline?" — which red-flagged `routes/notifications/push_payloads.py` for the thirteen f-string
    bodies belonging to its OTHER notification types (mention, booking reminder, gallery purchase…)
    and would have demanded a booking reminder be composed by `surf_alert_body`. Caught by running
    the guard against the unmodified tree before touching any behaviour, which is the only reason
    it was caught at all.
    """
    import ast as _ast
    import os as _os

    found = {}
    for path in _iter_backend_sources():
        try:
            tree = _ast.parse(open(path, encoding="utf-8").read())
        except (SyntaxError, UnicodeDecodeError):
            continue
        calls = []
        for n in _ast.walk(tree):
            if not isinstance(n, _ast.Call):
                continue
            name = (n.func.attr if isinstance(n.func, _ast.Attribute)
                    else getattr(n.func, "id", None))
            kw = {k.arg: k.value for k in n.keywords if k.arg}
            hit = False
            if name == "Notification":
                t = kw.get("type")
                hit = isinstance(t, _ast.Constant) and t.value == "surf_alert"
            elif name == "send_push_notification":
                d = kw.get("data")
                if isinstance(d, _ast.Dict):
                    hit = any(
                        isinstance(k2, _ast.Constant) and k2.value == "type"
                        and isinstance(v2, _ast.Constant) and v2.value == "surf_alert"
                        for k2, v2 in zip(d.keys, d.values)
                    )
            if hit:
                calls.append(n)
        if calls:
            found[_os.path.relpath(path, backend_dir).replace(os.sep, "/")] = (tree, calls)
    return found


def _live_string_constants(tree):
    """String literals that are NOT docstrings.

    ⚠️ CHECK LIVE LITERALS, NOT THE RAW SOURCE. A first version of this guard asserted
    `"perfect conditions" not in src` and went red on the FIX's own comments, which quote the old
    string to explain what was removed — a guard tripping on the documentation of the thing it
    guards. Docstrings are excluded for the same reason: the record of a defect must not read as
    the defect.
    """
    import ast as _ast
    docstrings = {
        node.body[0].value
        for node in _ast.walk(tree)
        if isinstance(node, (_ast.Module, _ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef))
        and node.body and isinstance(node.body[0], _ast.Expr)
        and isinstance(node.body[0].value, _ast.Constant)
        and isinstance(node.body[0].value.value, str)
    }
    return [n for n in _ast.walk(tree)
            if isinstance(n, _ast.Constant) and isinstance(n.value, str) and n not in docstrings]


def test_the_census_DISCOVERS_the_emitters_and_finds_the_scheduled_one__THE_CONTROL():
    """Without this control the census could be silently matching nothing and every assertion below
    would pass vacuously — which is precisely how the hard-coded version failed."""
    emitters = _surf_alert_emitters()
    assert "scheduler/surf_alerts.py" in emitters, (
        "the census did not find the SCHEDULED alert job — it is registered in "
        "scheduler/__init__.py:43-45 on IntervalTrigger(minutes=15) and is the path that actually "
        f"fires. Census returned: {sorted(emitters)}"
    )
    assert "routes/surf_data/alerts.py" in emitters, sorted(emitters)
    assert len(emitters) >= 2, sorted(emitters)


def test_NO_surf_alert_emitter_claims_perfection():
    """The literal regression, applied to every discovered emitter rather than to one named file."""
    offenders = {}
    for rel, (tree, _calls) in _surf_alert_emitters().items():
        bad = [n.value[:70] for n in _live_string_constants(tree)
               if "perfect condition" in n.value.lower()]
        if bad:
            offenders[rel] = bad
    assert not offenders, (
        f"a LIVE string literal still claims perfection on height alone: {offenders}"
    )


def test_every_surf_alert_that_BUILDS_a_body_uses_the_shared_composer():
    """A surf-alert emission may PASS a body through (a transport wrapper) or BUILD one inline. If
    it builds one, it must build it with `surf_alert_body`.

    ⚠️ SCOPED TO THE SURF-ALERT CALL ITSELF, not to the module — see `_surf_alert_emitters`.

    This is what exempts `routes/notifications/push_payloads.py:notify_surf_alert_triggered`: it
    passes `message=alert_summary`, a plain name supplied by its caller, so it composes nothing.
    It is exempt BY STRUCTURE, not by being named in an exception list — the same discipline this
    whole section exists to enforce. (It also has zero production callers at the time of writing;
    11 of the 18 `notify_*` functions in that module are in the same state.)
    """
    import ast as _ast

    offenders = {}
    for rel, (tree, calls) in _surf_alert_emitters().items():
        inline = [k.arg for c in calls for k in c.keywords
                  if k.arg in ("body", "message") and isinstance(k.value, _ast.JoinedStr)]
        if not inline:
            continue                                   # transport wrapper — nothing to compose
        calls_composer = any(
            isinstance(n, _ast.Call)
            and (n.func.attr if isinstance(n.func, _ast.Attribute)
                 else getattr(n.func, "id", None)) == "surf_alert_body"
            for n in _ast.walk(tree)
        )
        if not calls_composer:
            offenders[rel] = inline
    assert not offenders, (
        "these modules build a surf-alert body inline instead of calling surf_alert_body — the "
        f"quality is in the same dict they already fetched: {offenders}"
    )

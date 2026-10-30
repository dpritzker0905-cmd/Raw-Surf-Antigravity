"""Static guard: Notification(...) and CreditTransaction(...) are built only with columns the models really have.

(Phase 0, 2026-10-26.) The booking / payout / refund mapping found a family of silent breakages that share one
cause: a route builds `Notification(message=..., action_url=..., metadata=...)` or
`CreditTransaction(profile_id=...)` with keywords the model does not have, which raises TypeError at runtime
(swallowed by a try/except for notifications, a 500 for money rows), or omits NOT NULL ledger columns. Fixed so far:
the remind-crew and gallery_ready notifications, the dispute refund row and the admin refund row. This test walks
every call in the backend so the next one is caught when it is written. Known leftovers are listed and may only
shrink.
"""
import ast
import os
import sys

from models import CreditTransaction, Notification

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCAN_DIRS = ("routes", "scheduler", "services", "utils")
# NOT NULL columns a ledger row must carry (the helpers in utils/credits.py always set them).
LEDGER_REQUIRED = {"user_id", "amount", "balance_before", "balance_after", "transaction_type"}

# "file:Model:kind" leftovers found by this scan that are NOT fixed in this PR. Shrink only: delete a line when fixed.
# The reviewed crew fulfillment repair now supplies balance_before. No known constructor leftovers remain;
# financial behavior is qualified separately by the crew checkout/fulfillment fixtures.
KNOWN = set()


def _columns(model):
    return {c.key for c in model.__table__.columns}


def _py_files():
    for top in SCAN_DIRS:
        for folder, _dirs, files in os.walk(os.path.join(BACKEND, top)):
            for name in files:
                if name.endswith(".py"):
                    yield os.path.join(folder, name)


def _violations():
    notification_cols, ledger_cols = _columns(Notification), _columns(CreditTransaction)
    found = set()
    for path in _py_files():
        rel = os.path.relpath(path, BACKEND).replace(os.sep, "/")
        with open(path, encoding="utf-8-sig") as fh:  # a few files carry a BOM
            tree = ast.parse(fh.read())
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
                continue
            if node.func.id not in ("Notification", "CreditTransaction") or any(k.arg is None for k in node.keywords):
                continue  # not ours, or built with **kwargs (cannot be checked statically)
            model = node.func.id
            given = {k.arg for k in node.keywords}
            columns = notification_cols if model == "Notification" else ledger_cols
            unknown = sorted(given - columns)
            if unknown:
                found.add(f"{rel}:{model}:unknown {','.join(unknown)}")
            if model == "CreditTransaction":
                missing = sorted(LEDGER_REQUIRED - given)
                if missing:
                    found.add(f"{rel}:{model}:missing {','.join(missing)}")
    return found


def test_notifications_and_ledger_rows_use_real_columns():
    violations = _violations()
    assert violations <= KNOWN, sorted(violations - KNOWN)


def test_the_known_leftovers_only_shrink():
    assert KNOWN <= _violations(), sorted(KNOWN - _violations())  # fixed ones must be removed from KNOWN


def test_the_scan_really_detects_a_bad_call(tmp_path, monkeypatch):
    """Positive control: the walker flags a deliberately wrong constructor."""
    bad = tmp_path / "routes"
    bad.mkdir()
    (bad / "bad.py").write_text("n = Notification(user_id='u', message='m', action_url='x')\n"
                                "t = CreditTransaction(profile_id='u', amount=1)\n", encoding="utf-8")
    monkeypatch.setattr(sys.modules[__name__], "BACKEND", str(tmp_path))
    found = _violations()
    assert "routes/bad.py:Notification:unknown action_url,message" in found
    assert "routes/bad.py:CreditTransaction:unknown profile_id" in found

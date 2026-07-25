"""Regression contracts for the sensitive routes changed in the July security WIP."""
from __future__ import annotations

import ast
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]

STRICT_AUTH_FUNCTIONS = {
    "routes/subscriptions_billing/credits.py": {
        "purchase_credits",
        "get_user_balance",
        "get_credit_history",
        "get_credit_summary",
    },
    "routes/subscriptions_billing/payments.py": {
        "create_checkout_session",
        "get_checkout_status",
        "get_payment_history",
        "update_photographer_pricing",
        "create_identity_verification_session",
    },
    "routes/messages/conversations.py": {"get_conversations"},
    "routes/bookings/booking_lifecycle.py": {"create_user_booking"},
    "routes/bookings/crew_payments.py": {"get_crew_payment_details"},
    "routes/bookings/stripe_checkout.py": {"create_booking_with_stripe"},
}


def _dependency_targets(function: ast.AsyncFunctionDef) -> set[str]:
    targets = set()
    for default in function.args.defaults:
        if not isinstance(default, ast.Call) or not isinstance(default.func, ast.Name):
            continue
        if default.func.id != "Depends" or not default.args:
            continue
        target = default.args[0]
        if isinstance(target, ast.Name):
            targets.add(target.id)
    return targets


def test_sensitive_routes_require_verified_bearer_identity():
    for relative_path, function_names in STRICT_AUTH_FUNCTIONS.items():
        tree = ast.parse((BACKEND / relative_path).read_text(encoding="utf-8"))
        functions = {
            node.name: node for node in tree.body
            if isinstance(node, ast.AsyncFunctionDef) and node.name in function_names
        }
        assert functions.keys() == function_names
        for function in functions.values():
            dependencies = _dependency_targets(function)
            assert "get_current_user_id" in dependencies
            assert "get_user_id_from_jwt_or_query" not in dependencies


def test_private_media_migration_backfills_thumbnails_before_bucket_flip():
    migration = (BACKEND.parent / "supabase_scripts/migrate_private_chat_media.sql").read_text(
        encoding="utf-8"
    )

    assert migration.count("media_thumbnail_url LIKE") == 4
    assert migration.count("SET media_thumbnail_url =") == 2
    assert migration.index("SET media_thumbnail_url =") < migration.index("UPDATE storage.buckets")


def test_private_media_write_paths_fail_closed_when_storage_is_unavailable():
    direct_messages = (BACKEND / "routes/messages/features.py").read_text(encoding="utf-8")
    crew_chat = (BACKEND / "routes/crew/crew_chat_media.py").read_text(encoding="utf-8")

    assert direct_messages.count("Private media storage is temporarily unavailable") == 2
    assert "/api/uploads/chat_media/" not in direct_messages
    assert "Private media storage is temporarily unavailable" in crew_chat
    assert "CREW_CHAT_UPLOAD_DIR" not in crew_chat


def test_request_a_pro_checkout_identity_and_webhook_are_fail_closed():
    payments = (BACKEND / "routes/subscriptions_billing/payments.py").read_text(encoding="utf-8")

    assert "user_id: str" not in payments.split("class CheckoutRequest", 1)[1].split(
        "class CheckoutStatusRequest", 1
    )[0]
    assert "transaction.user_id != user_id" in payments
    assert "STRIPE_WEBHOOK_SECRET is not configured" in payments
    assert "stripe.Webhook.construct_event(body, signature, webhook_secret)" in payments
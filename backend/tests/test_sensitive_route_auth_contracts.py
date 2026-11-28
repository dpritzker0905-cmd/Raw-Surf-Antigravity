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
    "routes/sessions/active.py": {"get_surfer_active_session"},
    "routes/sessions/pricing.py": {"get_participant_credits"},
    "routes/photographer/participants.py": {"get_live_session_participants"},
    "routes/bookings/crud.py": {"get_user_live_sessions"},
    "routes/bookings/booking_lifecycle.py": {
        "create_user_booking",
        "complete_booking",
        "mark_content_delivered",
        "share_booking_to_feed",
        "leave_live_session",
    },
    "routes/bookings/booking_cancellation.py": {"cancel_booking"},
    "routes/bookings/crew_payments.py": {"get_crew_payment_details"},
    "routes/bookings/stripe_checkout.py": {"create_booking_with_stripe"},
}

SUBJECT_BOUND_FUNCTIONS = {
    ("routes/sessions/active.py", "get_surfer_active_session"): "surfer_id",
    ("routes/sessions/pricing.py", "get_participant_credits"): "user_id",
    ("routes/photographer/participants.py", "get_live_session_participants"): "photographer_id",
    ("routes/bookings/crud.py", "get_user_live_sessions"): "user_id",
}

PUBLIC_COARSE_STATUS_FUNCTIONS = {
    ("routes/sessions/active.py", "get_active_session"): "photographer_id",
    ("routes/photographer/sessions.py", "get_active_session"): "photographer_id",
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


def _has_identity_mismatch_guard(function: ast.AsyncFunctionDef, path_parameter: str) -> bool:
    for node in ast.walk(function):
        if not isinstance(node, ast.Compare) or len(node.ops) != 1:
            continue
        if not isinstance(node.ops[0], ast.NotEq) or len(node.comparators) != 1:
            continue
        operands = (node.left, node.comparators[0])
        names = {operand.id for operand in operands if isinstance(operand, ast.Name)}
        if names == {path_parameter, "current_user_id"}:
            return True
    return False


def _coarse_guard_return(function: ast.AsyncFunctionDef, path_parameter: str) -> bool:
    for node in function.body:
        if not isinstance(node, ast.If) or not _has_identity_mismatch_guard(node, path_parameter):
            continue
        returns = [statement for statement in node.body if isinstance(statement, ast.Return)]
        if len(returns) != 1:
            continue
        value = returns[0].value
        if isinstance(value, ast.Dict):
            return (
                len(value.keys) == 1
                and isinstance(value.keys[0], ast.Constant)
                and value.keys[0].value == "active"
            )
        if isinstance(value, ast.Call) and isinstance(value.func, ast.Name):
            return (
                value.func.id == "PublicActiveSessionResponse"
                and not value.args
                and [keyword.arg for keyword in value.keywords] == ["active"]
            )
    return False


def test_sensitive_routes_enforce_verified_identity_boundaries():
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
            path_parameter = SUBJECT_BOUND_FUNCTIONS.get((relative_path, function.name))
            if path_parameter:
                assert _has_identity_mismatch_guard(function, path_parameter)

    for (relative_path, function_name), path_parameter in PUBLIC_COARSE_STATUS_FUNCTIONS.items():
        tree = ast.parse((BACKEND / relative_path).read_text(encoding="utf-8"))
        function = next(
            node for node in tree.body
            if isinstance(node, ast.AsyncFunctionDef) and node.name == function_name
        )
        dependencies = _dependency_targets(function)
        assert "get_optional_user_id" in dependencies
        assert "get_current_user_id" not in dependencies
        assert _coarse_guard_return(function, path_parameter)


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

def test_public_upload_contract_is_disjoint_from_private_media():
    upload_storage = (BACKEND / "routes/uploads/storage.py").read_text(encoding="utf-8")
    provision = (BACKEND.parent / "supabase_scripts/provision_public_media_buckets.sql").read_text(
        encoding="utf-8"
    )

    for bucket in ("avatars", "conditions", "gallery", "general", "stories", "user-gallery"):
        assert f'"{bucket}"' in upload_storage
        assert f"'{bucket}'" in provision
    assert "if bucket not in PUBLIC_UPLOAD_BUCKETS" in upload_storage
    assert "create_bucket(" not in upload_storage
    public_bucket_block = upload_storage.split("PUBLIC_UPLOAD_BUCKETS = ", 1)[1].split(")", 1)[0]
    assert "chat_media" not in public_bucket_block
    assert "crew_chat" not in public_bucket_block
    assert "RAISE EXCEPTION" in provision

"""One transactional wallet fulfillment for webhook and checkout status readers.

The conditional payment UPDATE claims a purchase exactly once. Its wallet/ledger
effect shares the caller's transaction, so a failed commit rolls back the claim.
"""
import ast
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json

from sqlalchemy import select, update

from models import PaymentTransaction, Profile
from utils.credits import add_credits
from utils.revenue_routing import is_hobbyist_creator, is_pro_creator


def wallet_credit_amount(transaction):
    raw = transaction.transaction_metadata or '{}'
    try:
        metadata = json.loads(raw)
    except json.JSONDecodeError:
        # Older deposit records were written with str(dict), not JSON.
        metadata = ast.literal_eval(raw)
    if not isinstance(metadata, dict):
        raise ValueError('Invalid payment metadata')
    kind = metadata.get('type')
    if kind in ('subscription', 'photo_subscription'):
        return None  # Dedicated subscription handlers own these entitlements.
    value = metadata.get('credits')
    if kind == 'request_a_pro_deposit':
        value = transaction.amount
    if isinstance(value, bool):
        raise ValueError('Invalid credit amount')
    try:
        amount = Decimal(str(value))
        paid_amount = Decimal(str(transaction.amount))
    except InvalidOperation as exc:
        raise ValueError('Invalid credit amount') from exc
    if not amount.is_finite() or not paid_amount.is_finite() or not 0 < amount <= paid_amount:
        raise ValueError('Invalid credit amount')
    return float(amount)


async def fulfill_wallet_payment(db, transaction):
    """Return (credited amount, balance), without committing the caller's transaction."""
    amount = wallet_credit_amount(transaction)
    if amount is None:
        return 0.0, None
    claimed = await db.execute(
        update(PaymentTransaction).where(
            PaymentTransaction.id == transaction.id,
            PaymentTransaction.payment_status.not_in(('paid', 'completed')),
            PaymentTransaction.status != 'completed',
        ).values(payment_status='paid', status='completed', updated_at=datetime.now(timezone.utc))
        .returning(PaymentTransaction.id).execution_options(synchronize_session=False)
    )
    if claimed.scalar_one_or_none() is None:
        result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
        user = result.scalar_one_or_none()
        return 0.0, user.credit_balance if user else None
    success, balance, error = await add_credits(
        transaction.user_id, amount, 'stripe_topup', db,
        description='Stripe wallet funding', reference_type='payment_transaction', reference_id=transaction.id,
    )
    if not success:
        raise RuntimeError(error)
    result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
    user = result.scalar_one()
    if is_pro_creator(user.role):
        user.withdrawable_credits = balance
    elif is_hobbyist_creator(user.role):
        user.gear_only_credits = balance
    await db.refresh(transaction)
    return amount, balance

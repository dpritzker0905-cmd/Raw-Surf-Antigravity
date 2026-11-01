"""
Credit system utilities - 1 Credit = $1
Handles all credit transactions with proper logging and balance updates
"""
import logging
import math
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
from models import Profile, CreditTransaction

logger = logging.getLogger(__name__)


def clean_amount(amount):
    """The amount as whole cents (a float rounded to 2 places), or None when it is not a usable amount.

    Not usable = not a number, not finite, or negative. A negative "debit" is a credit, and NaN passes every
    `<` / `>` comparison, so both must be refused HERE, where every caller's money goes through. A refund is an
    explicit positive add_credits, never a negative deduction. Zero is allowed (a no-op row, as before).
    """
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return round(value, 2)


async def _balance_row(user_id: str, db: AsyncSession):
    """The Profile re-read from the database inside this transaction, REFRESHING an already-loaded copy.

    Without populate_existing the ORM hands back the instance the caller loaded earlier, with its stale balance.
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id).execution_options(populate_existing=True))
    return result.scalar_one_or_none()


async def get_balance(user_id: str, db: AsyncSession) -> float:
    """Get user's current credit balance"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    return user.credit_balance if user else 0.0


async def has_sufficient_credits(user_id: str, amount: float, db: AsyncSession) -> bool:
    """Check if user has enough credits"""
    balance = await get_balance(user_id, db)
    return balance >= amount


async def _locked_balance_row(user_id, db):
    result = await db.execute(select(Profile).where(Profile.id == user_id)
                              .with_for_update().execution_options(populate_existing=True))
    return result.scalar_one_or_none()


def cash_credit_balance(user):
    """Cash-eligible part of the wallet; promotional credits are a total subset."""
    return max(0.0, round((user.credit_balance or 0) - (user.spend_only_credits or 0), 2))


def _sync_cash_pockets(user, cash_delta=0.0):
    from utils.revenue_routing import is_pro_creator, is_hobbyist_creator
    cash = cash_credit_balance(user)
    if is_pro_creator(user.role):
        user.withdrawable_credits = min(cash, max(0.0, (user.withdrawable_credits or 0) + cash_delta))
    elif is_hobbyist_creator(user.role):
        user.gear_only_credits = min(cash, max(0.0, (user.gear_only_credits or 0) + cash_delta))


def consume_spend_only_for_debit(user, amount):
    """Classify an already-applied legacy total debit; caller records its ledger.

    This preserves the caller's transaction/concurrency behavior, not a new lock.
    """
    amount = clean_amount(amount)
    if amount is None:
        raise ValueError("Invalid amount")
    promo_before = user.spend_only_credits or 0
    total_after = user.credit_balance or 0
    if total_after < 0 or not 0 <= promo_before <= total_after + amount:
        raise ValueError("Wallet accounting needs reconciliation")
    consumed = min(promo_before, amount)
    user.spend_only_credits = round(promo_before - consumed, 2)
    _sync_cash_pockets(user)
    return consumed


async def deduct_credits(
    user_id: str, amount: float, transaction_type: str, db: AsyncSession,
    description: str = None, reference_type: str = None,
    reference_id: str = None, counterparty_id: str = None, transaction_id: str = None,
    consume_spend_only: bool = True
) -> tuple[bool, float, str]:
    """Debit bonus credits first, or cash only for explicitly funded settlements.

    The row lock protects provenance while the conditional UPDATE still guards
    the total/subset invariant. The caller owns commit/rollback.
    """
    amount = clean_amount(amount)
    if amount is None:
        return False, 0, "Invalid amount"
    user = await _locked_balance_row(user_id, db)
    if user is None:
        return False, 0, "User not found"
    balance_before = user.credit_balance or 0
    promo_before = user.spend_only_credits or 0
    if not 0 <= promo_before <= balance_before:
        return False, balance_before, "Wallet accounting needs reconciliation"
    promo_used = min(promo_before, amount) if consume_spend_only else 0.0
    claimed = await db.execute(
        update(Profile).where(Profile.id == user_id,
                              func.coalesce(Profile.credit_balance, 0) >= amount,
                              func.coalesce(Profile.credit_balance, 0) -
                              func.coalesce(Profile.spend_only_credits, 0) >= amount - promo_used,
                              func.coalesce(Profile.spend_only_credits, 0) == promo_before)
        .values(credit_balance=func.coalesce(Profile.credit_balance, 0) - amount,
                spend_only_credits=func.coalesce(Profile.spend_only_credits, 0) - promo_used)
        .execution_options(synchronize_session=False))
    user = await _balance_row(user_id, db)
    if claimed.rowcount == 0:
        return False, user.credit_balance, "Insufficient credits or wallet changed"
    _sync_cash_pockets(user)
    db.add(CreditTransaction(**({'id': transaction_id} if transaction_id else {}),
                            user_id=user_id, amount=-amount, spend_only_amount=-promo_used,
                            balance_before=balance_before, balance_after=user.credit_balance,
                            transaction_type=transaction_type, reference_type=reference_type,
                            reference_id=reference_id, counterparty_id=counterparty_id,
                            description=description))
    return True, user.credit_balance, ""


async def add_credits(
    user_id: str, amount: float, transaction_type: str, db: AsyncSession,
    description: str = None, reference_type: str = None,
    reference_id: str = None, counterparty_id: str = None,
    spend_only_amount: float = 0.0, refund_of_transaction_id: str = None
) -> tuple[bool, float, str]:
    """Credit a wallet, preserving the explicitly classified promotional subset."""
    amount, promo = clean_amount(amount), clean_amount(spend_only_amount)
    if amount is None or promo is None or promo > amount:
        return False, 0, "Invalid amount"
    user = await _locked_balance_row(user_id, db)
    if user is None:
        return False, 0, "User not found"
    balance_before = user.credit_balance or 0
    promo_before = user.spend_only_credits or 0
    if not 0 <= promo_before <= balance_before:
        return False, balance_before, "Wallet accounting needs reconciliation"
    granted = await db.execute(
        update(Profile).where(Profile.id == user_id)
        .values(credit_balance=func.coalesce(Profile.credit_balance, 0) + amount,
                spend_only_credits=func.coalesce(Profile.spend_only_credits, 0) + promo)
        .execution_options(synchronize_session=False))
    if granted.rowcount == 0:
        return False, 0, "User not found"
    user = await _balance_row(user_id, db)
    _sync_cash_pockets(user, amount - promo)
    db.add(CreditTransaction(user_id=user_id, amount=amount, spend_only_amount=promo,
                            refund_of_transaction_id=refund_of_transaction_id,
                            balance_before=balance_before, balance_after=user.credit_balance,
                            transaction_type=transaction_type, reference_type=reference_type,
                            reference_id=reference_id, counterparty_id=counterparty_id,
                            description=description))
    return True, user.credit_balance, ""


async def add_spend_only_credits(user_id, amount, transaction_type, db, **kwargs):
    return await add_credits(user_id, amount, transaction_type, db,
                             spend_only_amount=amount, **kwargs)


async def transfer_credits(
    from_user_id: str,
    to_user_id: str,
    amount: float,
    transaction_type: str,
    db: AsyncSession,
    platform_fee_percent: float = 0.20,  # 20% platform fee
    reference_type: str = None,
    reference_id: str = None,
    description: str = None
) -> tuple[bool, dict, str]:
    """
    Transfer credits from one user to another with platform fee.
    Returns: (success: bool, details: dict, error_message: str)
    """
    # Calculate amounts
    platform_fee = amount * platform_fee_percent
    recipient_amount = amount - platform_fee
    
    # Retain source provenance if recipient credit fails.
    debit_id = str(uuid4())
    # Deduct from sender
    success, new_balance, error = await deduct_credits(
        user_id=from_user_id,
        amount=amount,
        transaction_type=transaction_type,
        db=db,
        description=description,
        reference_type=reference_type,
        reference_id=reference_id,
        counterparty_id=to_user_id, transaction_id=debit_id
    )
    
    if not success:
        return False, {}, error
    
    # Add to recipient (minus platform fee)
    success, recipient_balance, error = await add_credits(
        user_id=to_user_id,
        amount=recipient_amount,
        transaction_type=f"{transaction_type}_earning",
        db=db,
        description=f"Earning from {description}" if description else None,
        reference_type=reference_type,
        reference_id=reference_id,
        counterparty_id=from_user_id
    )
    
    if not success:
        # Rollback sender deduction (this shouldn't happen in production)
        await refund_credits(
            user_id=from_user_id, amount=amount, db=db,
            description="Transfer failed - refund", original_transaction_id=debit_id,
        )
        return False, {}, error
    
    return True, {
        "total_paid": amount,
        "platform_fee": platform_fee,
        "recipient_received": recipient_amount,
        "sender_new_balance": new_balance,
        "recipient_new_balance": recipient_balance
    }, ""


async def refund_credits(
    user_id: str, amount: float, db: AsyncSession, reference_type: str = None,
    reference_id: str = None, description: str = None, original_transaction_id: str = None,
    transaction_type: str = "refund", allow_legacy_cash_refund: bool = False,
    counterparty_id: str = None
) -> tuple[bool, float, str]:
    """Restore each original debit's cash/promo composition, with refund caps.

    Partial refunds restore promotional credits first. An explicit original ID
    is preferred; reference-based callers can span multiple debits. Historical
    unlinked cash refunds remain compatible only without promotional history.
    """
    amount = clean_amount(amount)
    if amount is None:
        return False, 0, "Invalid amount"
    user = await _locked_balance_row(user_id, db)
    if user is None:
        return False, 0, "User not found"
    query = select(CreditTransaction).where(CreditTransaction.user_id == user_id,
                                            CreditTransaction.amount < 0)
    if original_transaction_id:
        query = query.where(CreditTransaction.id == original_transaction_id)
    elif reference_type and reference_id:
        query = query.where(CreditTransaction.reference_type == reference_type,
                            CreditTransaction.reference_id == reference_id)
    else:
        query = query.where(CreditTransaction.id == '')
    result = await db.execute(query.order_by(CreditTransaction.created_at, CreditTransaction.id)
                              .with_for_update())
    originals = result.scalars().all()
    if not originals:
        promo_history = await db.execute(select(CreditTransaction.id).where(
            CreditTransaction.user_id == user_id, CreditTransaction.spend_only_amount != 0).limit(1))
        has_promo = (user.spend_only_credits or 0) > 0 or promo_history.scalar_one_or_none() is not None
        if original_transaction_id or (has_promo and not allow_legacy_cash_refund):
            return False, user.credit_balance, "Original debit required for refund"
        return await add_credits(user_id, amount, transaction_type, db,
                                 description=description or "Refund",
                                 reference_type=reference_type, reference_id=reference_id,
                                 counterparty_id=counterparty_id)
    allocations = []
    remaining = amount
    for original in originals:
        refunded_result = await db.execute(select(CreditTransaction).where(
            CreditTransaction.refund_of_transaction_id == original.id,
            CreditTransaction.user_id == user_id, CreditTransaction.amount >= 0))
        refunded = refunded_result.scalars().all()
        available = max(0.0, round(-original.amount - sum(row.amount for row in refunded), 2))
        promo_available = max(0.0, round(-(original.spend_only_amount or 0)
                                        - sum(row.spend_only_amount or 0 for row in refunded), 2))
        take = min(remaining, available)
        if take:
            allocations.append((original.id, take, min(take, promo_available)))
            remaining = round(remaining - take, 2)
        if remaining == 0:
            break
    if remaining > 0:
        return False, user.credit_balance, "Refund exceeds remaining original payment"
    balance = user.credit_balance
    for original_id, take, promo in allocations:
        success, balance, error = await add_credits(
            user_id, take, transaction_type, db, description=description or "Refund",
            reference_type=reference_type, reference_id=reference_id,
            spend_only_amount=promo, refund_of_transaction_id=original_id,
            counterparty_id=counterparty_id)
        if not success:
            return False, balance, error
    return True, balance, ""


async def get_transaction_history(
    user_id: str,
    db: AsyncSession,
    limit: int = 50,
    transaction_type: str = None
) -> list:
    """Get user's credit transaction history"""
    query = select(CreditTransaction).where(
        CreditTransaction.user_id == user_id
    )
    
    if transaction_type:
        query = query.where(CreditTransaction.transaction_type == transaction_type)
    
    query = query.order_by(CreditTransaction.created_at.desc()).limit(limit)
    
    result = await db.execute(query)
    transactions = result.scalars().all()
    
    return [
        {
            "id": t.id,
            "amount": t.amount,
            "spend_only_amount": t.spend_only_amount or 0,
            "refund_of_transaction_id": t.refund_of_transaction_id,
            "balance_before": t.balance_before,
            "balance_after": t.balance_after,
            "transaction_type": t.transaction_type,
            "reference_type": t.reference_type,
            "reference_id": t.reference_id,
            "description": t.description,
            "created_at": t.created_at.isoformat()
        }
        for t in transactions
    ]

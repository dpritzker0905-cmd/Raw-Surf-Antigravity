"""
Credit system utilities - 1 Credit = $1
Handles all credit transactions with proper logging and balance updates
"""
import logging
import math

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


async def deduct_credits(
    user_id: str,
    amount: float,
    transaction_type: str,
    db: AsyncSession,
    description: str = None,
    reference_type: str = None,
    reference_id: str = None,
    counterparty_id: str = None
) -> tuple[bool, float, str]:
    """
    Deduct credits from user's balance.
    Returns: (success: bool, new_balance: float, error_message: str)

    The check and the subtraction are ONE statement (UPDATE ... WHERE credit_balance >= :amount), so two
    concurrent debits cannot both pass a stale check and overdraw: the second one's WHERE fails. Amounts must be
    finite and non-negative (see clean_amount).
    """
    cents = clean_amount(amount)
    if cents is None:
        logger.warning("deduct_credits refused a non-finite or negative amount for user %s", user_id)
        return False, 0, "Invalid amount"
    amount = cents

    claimed = await db.execute(
        update(Profile)
        .where(Profile.id == user_id, func.coalesce(Profile.credit_balance, 0) >= amount)
        .values(credit_balance=func.coalesce(Profile.credit_balance, 0) - amount)
        .execution_options(synchronize_session=False))
    user = await _balance_row(user_id, db)
    if user is None:
        return False, 0, "User not found"
    if claimed.rowcount == 0:
        return False, user.credit_balance, f"Insufficient credits. Need {amount:.2f}, have {user.credit_balance:.2f}"

    balance_after = user.credit_balance
    balance_before = balance_after + amount

    # Log the transaction
    transaction = CreditTransaction(
        user_id=user_id,
        amount=-amount,  # Negative for debit
        balance_before=balance_before,
        balance_after=balance_after,
        transaction_type=transaction_type,
        reference_type=reference_type,
        reference_id=reference_id,
        counterparty_id=counterparty_id,
        description=description
    )
    db.add(transaction)
    
    return True, balance_after, ""


async def add_credits(
    user_id: str,
    amount: float,
    transaction_type: str,
    db: AsyncSession,
    description: str = None,
    reference_type: str = None,
    reference_id: str = None,
    counterparty_id: str = None
) -> tuple[bool, float, str]:
    """
    Add credits to user's balance.
    Returns: (success: bool, new_balance: float, error_message: str)

    One UPDATE adds to the stored balance (a concurrent credit is not overwritten by a stale absolute value).
    Amounts must be finite and non-negative (see clean_amount).
    """
    cents = clean_amount(amount)
    if cents is None:
        logger.warning("add_credits refused a non-finite or negative amount for user %s", user_id)
        return False, 0, "Invalid amount"
    amount = cents

    granted = await db.execute(
        update(Profile).where(Profile.id == user_id)
        .values(credit_balance=func.coalesce(Profile.credit_balance, 0) + amount)
        .execution_options(synchronize_session=False))
    if granted.rowcount == 0:
        return False, 0, "User not found"
    user = await _balance_row(user_id, db)
    if user is None:
        return False, 0, "User not found"

    balance_after = user.credit_balance
    balance_before = balance_after - amount

    # Log the transaction
    transaction = CreditTransaction(
        user_id=user_id,
        amount=amount,  # Positive for credit
        balance_before=balance_before,
        balance_after=balance_after,
        transaction_type=transaction_type,
        reference_type=reference_type,
        reference_id=reference_id,
        counterparty_id=counterparty_id,
        description=description
    )
    db.add(transaction)
    
    return True, balance_after, ""


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
    
    # Deduct from sender
    success, new_balance, error = await deduct_credits(
        user_id=from_user_id,
        amount=amount,
        transaction_type=transaction_type,
        db=db,
        description=description,
        reference_type=reference_type,
        reference_id=reference_id,
        counterparty_id=to_user_id
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
        await add_credits(
            user_id=from_user_id,
            amount=amount,
            transaction_type="refund",
            db=db,
            description="Transfer failed - refund"
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
    user_id: str,
    amount: float,
    db: AsyncSession,
    reference_type: str = None,
    reference_id: str = None,
    description: str = None
) -> tuple[bool, float, str]:
    """
    Refund credits to user's balance.
    """
    return await add_credits(
        user_id=user_id,
        amount=amount,
        transaction_type="refund",
        db=db,
        description=description or "Refund",
        reference_type=reference_type,
        reference_id=reference_id
    )


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

"""
Credit system utilities - 1 Credit = $1
Handles all credit transactions with proper logging and balance updates
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import Profile, CreditTransaction


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
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        return False, 0, "User not found"
    
    if user.credit_balance < amount:
        return False, user.credit_balance, f"Insufficient credits. Need {amount:.2f}, have {user.credit_balance:.2f}"
    
    balance_before = user.credit_balance
    user.credit_balance -= amount
    balance_after = user.credit_balance
    
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
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        return False, 0, "User not found"
    
    balance_before = user.credit_balance
    user.credit_balance += amount
    balance_after = user.credit_balance
    
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

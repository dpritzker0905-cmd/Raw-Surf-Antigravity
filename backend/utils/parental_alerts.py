"""
Parental Alert Utilities
Send notifications to parents when their Grom makes purchases above the approval threshold.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import Profile, Notification
import json


async def check_and_send_spending_alert(
    db: AsyncSession,
    grom_id: str,
    amount: float,
    description: str,
    transaction_type: str
) -> bool:
    """
    Check if a Grom's purchase exceeds the parent's approval threshold
    and send a notification if so.
    
    Args:
        db: Database session
        grom_id: ID of the Grom making the purchase
        amount: Amount spent (positive value)
        description: Description of the purchase
        transaction_type: Type of transaction (e.g., 'dispatch_deposit', 'booking_payment')
    
    Returns:
        True if notification was sent, False otherwise
    """
    # Amount should be positive for comparison
    amount = abs(amount)
    
    # Get the Grom and their parental controls
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    # Only proceed if this is a Grom with a linked parent
    if not grom or not grom.parent_id:
        return False
    
    # Check if there's an approval threshold set
    parental_controls = grom.parental_controls or {}
    approval_threshold = parental_controls.get('require_approval_above')
    
    # Only send notification if purchase exceeds threshold
    if approval_threshold is None or amount <= approval_threshold:
        return False
    
    # Get parent info
    parent_result = await db.execute(
        select(Profile).where(Profile.id == grom.parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        return False
    
    # Create notification for parent
    notification = Notification(
        user_id=parent.id,
        type='grom_spending_alert',
        title=f'{grom.full_name} made a purchase',
        body=f'${amount:.2f} - {description}. This exceeds your ${approval_threshold:.2f} approval threshold.',
        data=json.dumps({
            'grom_id': grom_id,
            'grom_name': grom.full_name,
            'amount': amount,
            'description': description,
            'transaction_type': transaction_type,
            'approval_threshold': approval_threshold,
            'alert_type': 'spending_alert'
        })
    )
    db.add(notification)
    # Note: Caller should handle the commit
    
    return True


async def check_monthly_limit_exceeded(
    db: AsyncSession,
    grom_id: str,
    new_purchase_amount: float
) -> dict:
    """
    Check if a new purchase would exceed the Grom's monthly spending limit.
    
    Returns:
        dict with 'allowed' (bool), 'monthly_spent' (float), 'monthly_limit' (float or None)
    """
    from datetime import datetime, timedelta
    from sqlalchemy import func
    from models import CreditTransaction
    
    # Get the Grom
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        return {'allowed': True, 'monthly_spent': 0, 'monthly_limit': None}
    
    parental_controls = grom.parental_controls or {}
    monthly_limit = parental_controls.get('spending_limit')
    
    if monthly_limit is None:
        return {'allowed': True, 'monthly_spent': 0, 'monthly_limit': None}
    
    # Calculate spending this month
    month_ago = datetime.utcnow() - timedelta(days=30)
    monthly_result = await db.execute(
        select(func.sum(func.abs(CreditTransaction.amount)))
        .where(CreditTransaction.user_id == grom_id)
        .where(CreditTransaction.amount < 0)
        .where(CreditTransaction.created_at >= month_ago)
    )
    monthly_spent = float(monthly_result.scalar() or 0)
    
    # Check if new purchase would exceed limit
    new_purchase_amount = abs(new_purchase_amount)
    would_exceed = (monthly_spent + new_purchase_amount) > monthly_limit
    
    return {
        'allowed': not would_exceed,
        'monthly_spent': monthly_spent,
        'monthly_limit': monthly_limit,
        'remaining': max(0, monthly_limit - monthly_spent)
    }

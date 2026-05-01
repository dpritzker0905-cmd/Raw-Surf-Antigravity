"""Grom HQ monitoring — activity logs, spending summary/controls/alerts."""
# ============ ACTIVITY MONITORING ============

@router.get("/activity/{grom_id}")
async def get_grom_activity(
    grom_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get activity data for a linked Grom.
    Only the linked parent can view this data.
    """
    from models import Post, CreditTransaction
    from datetime import datetime, timedelta
    
    # Verify grom is linked to this parent
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this Grom's activity")
    
    # Get posts count
    posts_result = await db.execute(
        select(func.count(Post.id)).where(Post.author_id == grom_id)
    )
    total_posts = posts_result.scalar() or 0
    
    # Get recent posts (last 7 days)
    week_ago = datetime.utcnow() - timedelta(days=7)
    recent_posts_result = await db.execute(
        select(func.count(Post.id))
        .where(Post.author_id == grom_id)
        .where(Post.created_at >= week_ago)
    )
    recent_posts = recent_posts_result.scalar() or 0
    
    # Get transactions (credits spent)
    transactions_result = await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == grom_id)
        .order_by(CreditTransaction.created_at.desc())
        .limit(10)
    )
    transactions = transactions_result.scalars().all()
    
    transaction_list = [{
        "id": t.id,
        "type": t.transaction_type,
        "amount": float(t.amount) if t.amount else 0,
        "description": t.description,
        "created_at": t.created_at.isoformat() if t.created_at else None
    } for t in transactions]
    
    # Calculate total spent
    total_spent_result = await db.execute(
        select(func.sum(CreditTransaction.amount))
        .where(CreditTransaction.user_id == grom_id)
        .where(CreditTransaction.amount < 0)  # Negative = spending
    )
    total_spent = abs(total_spent_result.scalar() or 0)
    
    # Sessions joined (from profile stats)
    sessions_joined = grom.total_sessions or 0
    
    # Build activity summary
    return {
        "grom_id": grom_id,
        "grom_name": grom.full_name,
        "activity": {
            "total_posts": total_posts,
            "posts_this_week": recent_posts,
            "sessions_joined": sessions_joined,
            "total_spent": total_spent,
            "credits_balance": float(grom.credit_balance) if grom.credit_balance else 0
        },
        "recent_transactions": transaction_list,
        "parental_controls": grom.parental_controls or {}
    }


@router.get("/spending-summary/{grom_id}")
async def get_spending_summary(
    grom_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed spending summary for a Grom.
    Shows spending by category and recent purchases.
    """
    from models import CreditTransaction, GearPurchase
    from datetime import datetime, timedelta
    
    # Verify authorization
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom or grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get spending by type
    spending_result = await db.execute(
        select(
            CreditTransaction.transaction_type,
            func.sum(func.abs(CreditTransaction.amount)).label('total')
        )
        .where(CreditTransaction.user_id == grom_id)
        .where(CreditTransaction.amount < 0)
        .group_by(CreditTransaction.transaction_type)
    )
    spending_by_type = {row.transaction_type: float(row.total) for row in spending_result.all()}
    
    # Get gear purchases
    gear_result = await db.execute(
        select(GearPurchase)
        .where(GearPurchase.user_id == grom_id)
        .order_by(GearPurchase.created_at.desc())
        .limit(5)
    )
    gear_purchases = gear_result.scalars().all()
    
    gear_list = [{
        "id": g.id,
        "credits_spent": float(g.credits_spent) if g.credits_spent else 0,
        "affiliate_partner": g.affiliate_partner,
        "status": g.status,
        "created_at": g.created_at.isoformat() if g.created_at else None
    } for g in gear_purchases]
    
    # Calculate monthly spending
    month_ago = datetime.utcnow() - timedelta(days=30)
    monthly_result = await db.execute(
        select(func.sum(func.abs(CreditTransaction.amount)))
        .where(CreditTransaction.user_id == grom_id)
        .where(CreditTransaction.amount < 0)
        .where(CreditTransaction.created_at >= month_ago)
    )
    monthly_spending = float(monthly_result.scalar() or 0)
    
    return {
        "grom_id": grom_id,
        "grom_name": grom.full_name,
        "credits_balance": float(grom.credit_balance) if grom.credit_balance else 0,
        "spending_by_category": spending_by_type,
        "monthly_spending": monthly_spending,
        "recent_gear_purchases": gear_list,
        "spending_limit": grom.parental_controls.get('spending_limit') if grom.parental_controls else None
    }


class SpendingLimitUpdate(BaseModel):
    monthly_limit: Optional[float] = None
    require_approval_above: Optional[float] = None
    allowed_categories: Optional[list] = None


@router.post("/spending-controls/{grom_id}")
async def update_spending_controls(
    grom_id: str,
    parent_id: str,
    controls: SpendingLimitUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Update spending controls for a Grom.
    Parent can set monthly limits and require approval for purchases.
    """
    # Verify authorization
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
    if not grom or grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Update parental controls
    current_controls = grom.parental_controls or {}
    
    if controls.monthly_limit is not None:
        current_controls['spending_limit'] = controls.monthly_limit
    if controls.require_approval_above is not None:
        current_controls['require_approval_above'] = controls.require_approval_above
    if controls.allowed_categories is not None:
        current_controls['allowed_spending_categories'] = controls.allowed_categories
    
    grom.parental_controls = current_controls
    flag_modified(grom, 'parental_controls')
    await db.commit()
    
    return {
        "success": True,
        "parental_controls": grom.parental_controls
    }



# ============ PARENTAL SPENDING ALERTS ============

class SpendingAlertRequest(BaseModel):
    grom_id: str
    amount: float
    description: str
    transaction_type: str  # 'purchase', 'live_session_buyin', 'booking_payment', etc.


async def send_parental_spending_alert(
    db: AsyncSession,
    grom_id: str,
    amount: float,
    description: str,
    transaction_type: str
) -> bool:
    """
    Send a notification to the parent when their Grom makes a purchase
    above the approval threshold.
    Returns True if notification was sent, False if not needed.
    """
    from models import Notification
    import json
    
    # Get the Grom and their parental controls
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    
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
        title=f'🛒 {grom.full_name} made a purchase',
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
    await db.commit()
    
    return True


@router.post("/spending-alert")
async def trigger_spending_alert(
    request: SpendingAlertRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Endpoint to trigger a parental spending alert.
    Called when a Grom makes a purchase that exceeds the approval threshold.
    """
    sent = await send_parental_spending_alert(
        db=db,
        grom_id=request.grom_id,
        amount=request.amount,
        description=request.description,
        transaction_type=request.transaction_type
    )
    
    return {
        "success": True,
        "notification_sent": sent,
        "message": "Alert sent to parent" if sent else "No alert needed (below threshold or no parent linked)"
    }


@router.get("/spending-alerts/{parent_id}")
async def get_spending_alerts(
    parent_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """
    Get recent spending alerts for a parent.
    """
    from models import Notification
    
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == parent_id)
        .where(Notification.type == 'grom_spending_alert')
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    alerts = result.scalars().all()
    
    import json
    return {
        "alerts": [{
            "id": a.id,
            "title": a.title,
            "body": a.body,
            "data": json.loads(a.data) if a.data else None,
            "is_read": a.is_read,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in alerts],
        "count": len(alerts)
    }


# ============ FAMILY ACTIVITY FEED ============

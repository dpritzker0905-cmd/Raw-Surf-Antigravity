"""Grom HQ purchase requests — create, list, approve, deny."""
from fastapi import Depends, HTTPException, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from datetime import datetime, timezone
import json
from models import Notification, Profile, RoleEnum
from utils.grom_parent import is_grom_parent_eligible

from .family import PurchaseRequestBody
router = APIRouter()


@router.post("/purchase-request/{grom_id}")
async def submit_purchase_request(
    grom_id: str,
    data: PurchaseRequestBody,
    db: AsyncSession = Depends(get_db)
):
    """
    Grom submits a purchase request for parental approval.
    Creates a notification for the parent with the request details.
    """
    from models import Notification
    import logging
    logger = logging.getLogger(__name__)

    # Verify Grom exists and has a parent
    grom_result = await db.execute(
        select(Profile).where(Profile.id == grom_id)
    )
    grom = grom_result.scalar_one_or_none()

    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")

    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Only Grom accounts can submit purchase requests")

    if not grom.parent_id:
        raise HTTPException(status_code=400, detail="No parent linked. Ask your parent to link your account first.")

    # Check monthly spending limit
    from utils.parental_alerts import check_monthly_limit_exceeded
    limit_check = await check_monthly_limit_exceeded(db, grom_id, data.amount)
    if not limit_check['allowed']:
        raise HTTPException(
            status_code=403,
            detail=f"Monthly spending limit reached (${limit_check['monthly_spent']:.2f} / ${limit_check['monthly_limit']:.2f}). Ask your parent to increase it."
        )

    # Check for duplicate pending requests for same item
    existing = await db.execute(
        select(Notification)
        .where(Notification.user_id == grom.parent_id)
        .where(Notification.type == 'grom_purchase_request')
        .where(Notification.is_read == False)
    )
    existing_requests = existing.scalars().all()
    for req in existing_requests:
        try:
            req_data = json.loads(req.data) if req.data else {}
            if req_data.get('item_id') == data.item_id and req_data.get('grom_id') == grom_id:
                return {
                    "success": True,
                    "message": "Request already pending! Your parent will see it.",
                    "already_pending": True,
                    "request_id": req.id
                }
        except (json.JSONDecodeError, TypeError):
            pass

    # Create notification for parent
    request_data = {
        "grom_id": grom_id,
        "grom_name": grom.full_name,
        "grom_avatar": grom.avatar_url,
        "item_type": data.item_type,
        "item_id": data.item_id,
        "item_name": data.item_name,
        "amount": data.amount,
        "quality_tier": data.quality_tier,
        "status": "pending",
        "metadata": data.metadata or {}
    }

    notification = Notification(
        user_id=grom.parent_id,
        type='grom_purchase_request',
        title=f'🛒 {grom.full_name} wants to buy something',
        body=f'{data.item_name} — ${data.amount:.2f}',
        data=json.dumps(request_data),
        is_read=False
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    logger.info(f"[GromPurchase] Request created: {grom.full_name} -> {data.item_name} (${data.amount:.2f})")

    return {
        "success": True,
        "message": "Purchase request sent to your parent!",
        "request_id": notification.id,
        "already_pending": False
    }


@router.get("/purchase-requests/{parent_id}")
async def get_purchase_requests(
    parent_id: str,
    status: str = "pending",
    db: AsyncSession = Depends(get_db)
):
    """
    Get all pending purchase requests for a parent.
    Used by the GromHQ Purchase Requests panel.
    """
    from models import Notification

    # Verify parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")

    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view purchase requests")

    # Fetch purchase request notifications
    query = (
        select(Notification)
        .where(Notification.user_id == parent_id)
        .where(Notification.type == 'grom_purchase_request')
        .order_by(Notification.created_at.desc())
        .limit(50)
    )

    # Filter by status
    if status == "pending":
        query = query.where(Notification.is_read == False)

    result = await db.execute(query)
    notifications = result.scalars().all()

    requests = []
    for notif in notifications:
        try:
            req_data = json.loads(notif.data) if notif.data else {}
        except (json.JSONDecodeError, TypeError):
            req_data = {}

        # Only include requests matching the status filter
        req_status = req_data.get("status", "pending")
        if status != "all" and req_status != status:
            continue

        requests.append({
            "id": notif.id,
            "grom_id": req_data.get("grom_id"),
            "grom_name": req_data.get("grom_name"),
            "grom_avatar": req_data.get("grom_avatar"),
            "item_type": req_data.get("item_type"),
            "item_id": req_data.get("item_id"),
            "item_name": req_data.get("item_name"),
            "amount": req_data.get("amount", 0),
            "quality_tier": req_data.get("quality_tier"),
            "status": req_status,
            "created_at": notif.created_at.isoformat() if notif.created_at else None
        })

    return {
        "requests": requests,
        "pending_count": len([r for r in requests if r["status"] == "pending"])
    }


@router.post("/purchase-requests/{request_id}/approve")
async def approve_purchase_request(
    request_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Parent approves a Grom purchase request.
    This marks the request as approved and creates a notification
    for the Grom to complete the purchase.
    """
    from models import Notification
    import logging
    logger = logging.getLogger(__name__)

    # Verify parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    if not parent or not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can approve requests")

    # Get the request notification
    notif_result = await db.execute(
        select(Notification)
        .where(Notification.id == request_id)
        .where(Notification.user_id == parent_id)
        .where(Notification.type == 'grom_purchase_request')
    )
    notif = notif_result.scalar_one_or_none()

    if not notif:
        raise HTTPException(status_code=404, detail="Purchase request not found")

    # Parse request data
    try:
        req_data = json.loads(notif.data) if notif.data else {}
    except (json.JSONDecodeError, TypeError):
        req_data = {}

    if req_data.get("status") == "approved":
        return {"success": True, "message": "Already approved", "already_processed": True}

    if req_data.get("status") == "denied":
        raise HTTPException(status_code=400, detail="This request was already denied")

    grom_id = req_data.get("grom_id")

    # Update request status
    req_data["status"] = "approved"
    req_data["approved_by"] = parent_id
    req_data["approved_at"] = datetime.now(timezone.utc).isoformat()
    notif.data = json.dumps(req_data)
    notif.is_read = True

    # Notify the Grom
    grom_notif = Notification(
        user_id=grom_id,
        type='purchase_approved',
        title='✅ Purchase Approved!',
        body=f'Your parent approved: {req_data.get("item_name")} — ${req_data.get("amount", 0):.2f}',
        data=json.dumps({
            "item_type": req_data.get("item_type"),
            "item_id": req_data.get("item_id"),
            "item_name": req_data.get("item_name"),
            "amount": req_data.get("amount"),
            "quality_tier": req_data.get("quality_tier"),
            "approved_by": parent_id,
            "request_id": request_id
        })
    )
    db.add(grom_notif)
    await db.commit()

    logger.info(f"[GromPurchase] Approved: {req_data.get('grom_name')} -> {req_data.get('item_name')}")

    return {
        "success": True,
        "message": f"Approved {req_data.get('item_name')} for {req_data.get('grom_name')}",
        "grom_id": grom_id,
        "item_type": req_data.get("item_type"),
        "item_id": req_data.get("item_id")
    }


@router.post("/purchase-requests/{request_id}/deny")
async def deny_purchase_request(
    request_id: str,
    parent_id: str,
    reason: str = "",
    db: AsyncSession = Depends(get_db)
):
    """
    Parent denies a Grom purchase request.
    """
    from models import Notification
    import logging


    logger = logging.getLogger(__name__)

    # Verify parent
    parent_result = await db.execute(
        select(Profile).where(Profile.id == parent_id)
    )
    parent = parent_result.scalar_one_or_none()
    if not parent or not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can deny requests")

    # Get the request notification
    notif_result = await db.execute(
        select(Notification)
        .where(Notification.id == request_id)
        .where(Notification.user_id == parent_id)
        .where(Notification.type == 'grom_purchase_request')
    )
    notif = notif_result.scalar_one_or_none()

    if not notif:
        raise HTTPException(status_code=404, detail="Purchase request not found")

    try:
        req_data = json.loads(notif.data) if notif.data else {}
    except (json.JSONDecodeError, TypeError):
        req_data = {}

    if req_data.get("status") in ("approved", "denied"):
        return {"success": True, "message": "Already processed", "already_processed": True}

    grom_id = req_data.get("grom_id")

    # Update request status

"""Sessions active — active session queries and photo purchase."""
from pydantic import BaseModel
from fastapi import Depends, HTTPException, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from database import get_db
from typing import Optional
from models import GalleryItem, LiveSessionParticipant, Profile
from .schemas import ActiveSessionResponse, SessionParticipantResponse
from utils.credits import deduct_credits, add_credits

router = APIRouter()

@router.get("/sessions/active/{photographer_id}", response_model=Optional[ActiveSessionResponse])
async def get_active_session(photographer_id: str, db: AsyncSession = Depends(get_db)):
    photographer_result = await db.execute(
        select(Profile)
        .where(Profile.id == photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not photographer.is_shooting:
        return None
    
    participants_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(selectinload(LiveSessionParticipant.surfer))
    )
    participants = participants_result.scalars().all()
    
    participant_responses = []
    for p in participants:
        participant_responses.append(SessionParticipantResponse(
            id=p.id,
            surfer_id=p.surfer_id,
            surfer_name=p.surfer.full_name if p.surfer else None,
            surfer_avatar=p.surfer.avatar_url if p.surfer else None,
            selfie_url=p.selfie_url,
            amount_paid=p.amount_paid,
            payment_method=p.payment_method,
            status=p.status,
            joined_at=p.joined_at
        ))
    
    return ActiveSessionResponse(
        photographer_id=photographer.id,
        photographer_name=photographer.full_name,
        spot_id=photographer.current_spot_id,
        spot_name=photographer.current_spot.name if photographer.current_spot else None,
        session_price=photographer.session_price or 25.0,
        participants_count=len(participant_responses),
        participants=participant_responses
    )

# NOTE: Leave session endpoint is in bookings.py with proper 10-minute refund logic

@router.get("/sessions/my-active/{surfer_id}")
async def get_surfer_active_session(surfer_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.surfer_id == surfer_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(
            selectinload(LiveSessionParticipant.photographer),
            selectinload(LiveSessionParticipant.spot)
        )
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        return {"active": False}
    
    return {
        "active": True,
        "session_id": participant.id,
        "photographer_id": participant.photographer_id,
        "photographer_name": participant.photographer.full_name if participant.photographer else None,
        "spot_name": participant.spot.name if participant.spot else None,
        "joined_at": participant.joined_at.isoformat(),
        "amount_paid": participant.amount_paid
    }



class PurchasePhotoRequest(BaseModel):
    gallery_item_id: str


@router.post("/sessions/{session_id}/purchase-photo")
async def purchase_photo_in_session(
    session_id: str,
    data: PurchasePhotoRequest,
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Purchase a photo during an active live session.
    Uses the photographer's per-photo price.
    """
    from models import GalleryItem, GalleryPurchase
    
    # Verify surfer is in the session
    participant_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.id == session_id)
        .where(LiveSessionParticipant.surfer_id == surfer_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(selectinload(LiveSessionParticipant.photographer))
    )
    participant = participant_result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=403, detail="Not in this session or session ended")
    
    # Get the gallery item
    item_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == data.gallery_item_id)
        .where(GalleryItem.photographer_id == participant.photographer_id)
    )
    gallery_item = item_result.scalar_one_or_none()
    
    if not gallery_item:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Check if already purchased
    existing_purchase = await db.execute(
        select(GalleryPurchase)
        .where(GalleryPurchase.gallery_item_id == data.gallery_item_id)
        .where(GalleryPurchase.buyer_id == surfer_id)
    )
    if existing_purchase.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already purchased this photo")
    
    # Get surfer
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    
    photographer = participant.photographer
    
    # Use photographer's per-photo price (SmugMug style)
    photo_price = photographer.live_photo_price or gallery_item.price or 5.0
    
    # Check if subscription quota covers this item (photo or video)
    from routes.photo_subscriptions import try_use_subscription_quota


    quota_type = 'video' if gallery_item.media_type == 'video' else 'photo'
    sub_quota_result = await try_use_subscription_quota(
        db, surfer_id, photographer.id, quota_type
    )
    subscription_covered = sub_quota_result.get("used", False)
    
    if subscription_covered:
        # Subscription covers this photo — no charge
        photo_price = 0.0
        new_balance = surfer.credit_balance or 0
    else:
        # Process payment
        success, new_balance, error = await deduct_credits(
            user_id=surfer_id,
            amount=photo_price,
            transaction_type='live_photo_purchase',
            db=db,
            description=f"Photo purchase from {photographer.full_name}",
            reference_type='gallery_item',
            reference_id=data.gallery_item_id,
            counterparty_id=photographer.id
        )
        
        if not success:
            raise HTTPException(status_code=400, detail=error)
        
        # Credit photographer (80% after platform fee)
        await add_credits(
            user_id=photographer.id,
            amount=photo_price * 0.80,
            transaction_type='gallery_sale',
            db=db,
            description=f"Photo sale to {surfer.full_name}",
            reference_type='gallery_item',
            reference_id=data.gallery_item_id,
            counterparty_id=surfer_id
        )
    
    # Create purchase record
    purchase = GalleryPurchase(
        gallery_item_id=data.gallery_item_id,
        buyer_id=surfer_id,
        photographer_id=photographer.id,
        amount_paid=photo_price,
        payment_method='subscription' if subscription_covered else 'credits'
    )
    db.add(purchase)
    
    # Update gallery item stats
    gallery_item.purchase_count += 1
    
    # Update participant's amount paid
    participant.amount_paid += photo_price
    
    await db.commit()
    
    return {
        "message": "Included with subscription!" if subscription_covered else "Photo purchased successfully",
        "amount_paid": photo_price,
        "subscription_covered": subscription_covered,
        "new_balance": new_balance,
        "download_url": gallery_item.original_url
    }




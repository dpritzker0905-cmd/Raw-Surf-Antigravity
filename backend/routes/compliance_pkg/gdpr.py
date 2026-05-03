"""
GDPR Data Management
Handles:
- User data export (Article 20 — Data Portability)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, TosViolation, TosAcknowledgement,
    Post, Comment, Booking, GalleryPurchase, PaymentTransaction,
    Message, Follow, CheckIn, Review
)

router = APIRouter(prefix="/compliance", tags=["compliance"])


# ============ HELPERS ============

def _serialize_row(row, exclude_fields=None):
    """Convert a SQLAlchemy row to a safe dict, excluding sensitive fields."""
    exclude = set(exclude_fields or [])
    exclude.update({'password_hash', '_sa_instance_state'})
    result = {}
    for key in row.__table__.columns.keys():
        if key in exclude:
            continue
        val = getattr(row, key, None)
        if isinstance(val, datetime):
            result[key] = val.isoformat()
        elif hasattr(val, 'value'):  # Enum
            result[key] = val.value
        else:
            result[key] = val
    return result


# ============ GDPR DATA EXPORT ============

@router.post("/data-export/{user_id}")
async def export_user_data(
    user_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """GDPR Article 20 — Data Portability. Export all user data as structured JSON.
    Admin-only. Collects data across all tables and returns a downloadable package."""
    
    # Verify user exists
    profile_result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    export = {
        "export_meta": {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "exported_by_admin": admin.id,
            "user_id": user_id,
            "format_version": "1.0"
        },
        "profile": _serialize_row(profile),
    }
    
    # Posts
    posts_result = await db.execute(
        select(Post).where(Post.author_id == user_id).order_by(Post.created_at.desc())
    )
    export["posts"] = [_serialize_row(p) for p in posts_result.scalars().all()]
    
    # Comments
    comments_result = await db.execute(
        select(Comment).where(Comment.author_id == user_id).order_by(Comment.created_at.desc())
    )
    export["comments"] = [_serialize_row(c) for c in comments_result.scalars().all()]
    
    # Bookings (as photographer or surfer)
    bookings_result = await db.execute(
        select(Booking).where(
            (Booking.photographer_id == user_id) | (Booking.surfer_id == user_id)
        ).order_by(Booking.created_at.desc())
    )
    export["bookings"] = [_serialize_row(b) for b in bookings_result.scalars().all()]
    
    # Gallery purchases
    purchases_result = await db.execute(
        select(GalleryPurchase).where(GalleryPurchase.buyer_id == user_id)
    )
    export["gallery_purchases"] = [_serialize_row(p) for p in purchases_result.scalars().all()]
    
    # Payment transactions
    payments_result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.user_id == user_id)
    )
    export["payment_transactions"] = [_serialize_row(t) for t in payments_result.scalars().all()]
    
    # Messages sent
    messages_result = await db.execute(
        select(Message).where(Message.sender_id == user_id).order_by(Message.created_at.desc()).limit(500)
    )
    export["messages_sent"] = [_serialize_row(m) for m in messages_result.scalars().all()]
    
    # Check-ins
    checkins_result = await db.execute(
        select(CheckIn).where(CheckIn.user_id == user_id)
    )
    export["check_ins"] = [_serialize_row(c) for c in checkins_result.scalars().all()]
    
    # Follows (who they follow)
    follows_result = await db.execute(
        select(Follow).where(Follow.follower_id == user_id)
    )
    export["following"] = [_serialize_row(f) for f in follows_result.scalars().all()]
    
    # Followers
    followers_result = await db.execute(
        select(Follow).where(Follow.followed_id == user_id)
    )
    export["followers"] = [_serialize_row(f) for f in followers_result.scalars().all()]
    
    # Reviews (given and received)
    reviews_given = await db.execute(
        select(Review).where(Review.reviewer_id == user_id)
    )
    export["reviews_given"] = [_serialize_row(r) for r in reviews_given.scalars().all()]
    
    reviews_received = await db.execute(
        select(Review).where(Review.reviewed_id == user_id)
    )
    export["reviews_received"] = [_serialize_row(r) for r in reviews_received.scalars().all()]
    
    # ToS acknowledgements
    tos_result = await db.execute(
        select(TosAcknowledgement).where(TosAcknowledgement.user_id == user_id)
    )
    export["tos_acknowledgements"] = [_serialize_row(t) for t in tos_result.scalars().all()]
    
    # Violations
    violations_result = await db.execute(
        select(TosViolation).where(TosViolation.user_id == user_id)
    )
    export["tos_violations"] = [_serialize_row(v) for v in violations_result.scalars().all()]
    
    # Summary stats
    export["summary"] = {
        "total_posts": len(export["posts"]),
        "total_comments": len(export["comments"]),
        "total_bookings": len(export["bookings"]),
        "total_purchases": len(export["gallery_purchases"]),
        "total_payments": len(export["payment_transactions"]),
        "total_messages": len(export["messages_sent"]),
        "total_check_ins": len(export["check_ins"]),
        "total_following": len(export["following"]),
        "total_followers": len(export["followers"]),
    }
    
    return export

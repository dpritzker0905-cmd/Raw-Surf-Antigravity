"""
GDPR Data Management
Handles:
- User data export (Article 20 — Data Portability)
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone

from database import get_db
from deps.admin_auth import get_current_admin
from core.security import get_current_user_id
from models import (
    Profile, TosViolation, TosAcknowledgement,
    Post, Comment, Booking, GalleryPurchase, PaymentTransaction,
    Message, Follow, CheckIn, Review, ConditionReport, ObservationMedia,
    WebauthnCredential, UserMfa, MfaRecoveryCode, MfaChallenge,
)
from services.surf_truth_erasure import erase_surf_truth, export_surf_truth
import asyncio
import logging

router =APIRouter(prefix="/compliance", tags=["compliance"])
logger = logging.getLogger(__name__)


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
    
    # Bookings (as photographer or the surfer who created it). Booking has no surfer_id: the old filter raised
    # AttributeError, so this export never completed.
    bookings_result = await db.execute(
        select(Booking).where(
            (Booking.photographer_id == user_id) | (Booking.creator_id == user_id)
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
        select(Follow).where(Follow.following_id == user_id)
    )
    export["followers"] = [_serialize_row(f) for f in followers_result.scalars().all()]
    
    # Reviews (given and received)
    reviews_given = await db.execute(
        select(Review).where(Review.reviewer_id == user_id)
    )
    export["reviews_given"] = [_serialize_row(r) for r in reviews_given.scalars().all()]
    
    reviews_received = await db.execute(
        select(Review).where(Review.reviewee_id == user_id)
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

    # Surf-truth observations, photo facts and observer status (T1 P3)
    export.update(await export_surf_truth(db, user_id))

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
        "total_surf_observations": len(export["surf_observations"]),
    }
    
    return export


# ============ GDPR SELF-SERVICE DATA DELETION (Article 17) ============

@router.post("/delete-my-data")
async def request_data_deletion(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
    immediate: bool = False,
):
    """GDPR Article 17. By default the deletion is SCHEDULED with a 30-day restore window (services/account_deletion):
    the account is locked and signed out at once, a restore link is emailed, and the full erasure below runs after 30
    days. `?immediate=true` erases at once."""
    from services import account_deletion
    if immediate:
        result = await erase_account(db, user_id)
        from models import AccountDeletion
        row = await db.get(AccountDeletion, user_id)
        now = datetime.now(timezone.utc)
        if row is None:
            db.add(AccountDeletion(profile_id=user_id, status=account_deletion.PURGED, requested_at=now,
                                   purge_after=now, purged_at=now))
        else:
            row.status, row.purged_at, row.restore_token_hash = account_deletion.PURGED, now, None
        await db.commit()
        return {**result, "mode": "immediate"}
    profile = await db.get(Profile, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    email, name = profile.email, profile.full_name
    row, token = await account_deletion.schedule(db, profile)
    await db.commit()
    purge_after = row.purge_after.isoformat()
    from services.account_deletion_email import send_restore_email
    emailed = await send_restore_email(email, token, name, purge_after)
    logger.info("Deletion scheduled for a user (restorable for %d days)", account_deletion.GRACE_DAYS)
    return {
        "success": True,
        "mode": "scheduled",
        "purge_after": purge_after,
        "restore_email_sent": emailed,
        "message": (f"Your account is locked and will be permanently deleted in {account_deletion.GRACE_DAYS} days. "
                    "Use the link we emailed you to restore it before then."),
    }


class RestoreRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


@router.post("/restore-account")
async def restore_account(request: Request, data: RestoreRequest, db: AsyncSession = Depends(get_db)):
    """Restore an account scheduled for deletion, from the emailed link. No session needed: the request revoked them.
    One answer for an unknown, used or expired link, so the endpoint reveals nothing."""
    from core.rate_limiter import rate_limit_check
    from services import account_deletion
    rate_limit_check(request, max_requests=10, window_seconds=300, key_prefix="restore_account:")
    profile = await account_deletion.restore(db, data.token)
    if profile is None:
        raise HTTPException(status_code=400, detail="This restore link is not valid or has expired.")
    await db.commit()
    return {"success": True, "message": "Your account is restored. Sign in with your password."}


async def erase_account(db: AsyncSession, user_id: str) -> dict:
    """The full, irreversible erasure: run at once on `?immediate=true`, or by the daily job when the restore window
    ends (services/account_deletion.purge_due). Commits.

    What gets deleted:
    - Posts, comments, reactions
    - Follows (follower + following)
    - Check-ins, reviews
    - Surf-truth observations, photo facts and observer status (services/surf_truth_erasure.py)
    - Condition reports, and their photos/videos in the PUBLIC conditions bucket (after the commit, best effort,
      reported in `media`: services/account_erasure_media.py)
    - Sign-in: the password, passkeys and second-factor secrets are removed and the account is marked suspended, so
      nobody can sign in to the anonymized profile again, and every session token already issued is revoked
      (core/session_revocation: refused within a minute on every server process, at once on this one).
    - Messages (sender side anonymized)
    - Profile data is anonymized (name, bio, avatar cleared)

    What is RETAINED for legal/financial compliance:
    - Payment transactions (required for tax/audit)
    - Booking records (financial obligation)
    - ToS violations (legal hold)
    - ToS acknowledgements (proof of consent)

    This is irreversible.
    """
    from sqlalchemy import delete, update

    # Verify user exists
    profile_result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")

    logger.info("GDPR erasure running for a user")

    # 1. Delete posts and comments
    await db.execute(delete(Comment).where(Comment.author_id == user_id))
    await db.execute(delete(Post).where(Post.author_id == user_id))

    # 2. Delete social graph
    await db.execute(delete(Follow).where(
        (Follow.follower_id == user_id) | (Follow.following_id == user_id)
    ))

    # 3. Delete check-ins
    await db.execute(delete(CheckIn).where(CheckIn.user_id == user_id))

    # 4. Delete reviews given
    await db.execute(delete(Review).where(Review.reviewer_id == user_id))

    # 4b. Surf-truth observations (device GPS, photo EXIF), photo facts and observer status (T1 P3). Same
    # transaction: if this fails the whole request rolls back rather than reporting a partial deletion. The media
    # URLs are read first, so their files can be removed from public storage after the commit.
    media_urls = list((await db.execute(select(ObservationMedia.media_url)
                                        .where(ObservationMedia.user_id == user_id))).scalars().all())
    media_urls += list((await db.execute(select(ConditionReport.media_url)
                                         .where(ConditionReport.photographer_id == user_id))).scalars().all())
    await erase_surf_truth(db, user_id)
    await db.execute(delete(ConditionReport).where(ConditionReport.photographer_id == user_id))

    # 4c. Sign-in (advisor limit on #1022): no password, passkey or second factor survives, and the account is marked
    # suspended, which the password and MFA paths already refuse.
    for model in (WebauthnCredential, MfaRecoveryCode, MfaChallenge, UserMfa):
        await db.execute(delete(model).where(model.user_id == user_id))
    from core.session_revocation import note_revoked, revoke
    revoked_at = await revoke(db, user_id, "account_deleted")

    # 5. Anonymize messages (don't delete — recipient still has the conversation)
    await db.execute(
        update(Message)
        .where(Message.sender_id == user_id)
        .values(content="[deleted]", media_url=None)
    )

    # 6. Anonymize profile (don't delete — foreign keys in bookings, payments)
    profile.full_name = "Deleted User"
    profile.username = f"deleted_{user_id[:8]}"
    profile.bio = None
    profile.avatar_url = None
    profile.email = f"deleted_{user_id[:8]}@deleted.rawsurf.app"
    profile.wetsuit_color = None
    profile.rash_guard_color = None
    profile.stance = None
    profile.password_hash = None
    profile.is_suspended = True
    profile.suspended_at = datetime.now(timezone.utc)
    profile.suspended_reason = "account deleted at the user's request"
    # These are the REAL column names. The old code set phone / instagram_handle / website / board_description /
    # is_active / is_deleted, none of which is a Profile column, so those assignments silently did nothing, and the
    # home and on-demand positions below were never cleared. A loop over names catches a future rename loudly.
    for column in ("instagram_url", "website_url", "portfolio_url", "location",
                   "home_latitude", "home_longitude", "home_location_name",
                   "on_demand_latitude", "on_demand_longitude", "on_demand_city"):
        if column not in Profile.__table__.columns:
            raise RuntimeError(f"GDPR erasure names a Profile column that does not exist: {column}")
        setattr(profile, column, None)

    await db.commit()
    note_revoked(user_id, revoked_at)          # this process refuses the user's tokens from now on

    # 7. The files, now that the rows are gone (storage is not transactional; reported, never hidden).
    from routes.uploads.core import UPLOAD_DIR
    from services.account_erasure_media import delete_account_media
    media = await asyncio.to_thread(delete_account_media, user_id, media_urls, UPLOAD_DIR)

    logger.info("GDPR erasure completed for a user")

    return {
        "success": True,
        "message": "Your account data has been deleted. Profile has been anonymized. Financial records are retained for legal compliance.",
        "retained": ["payment_transactions", "bookings", "tos_acknowledgements", "tos_violations"],
        "media": media,
    }

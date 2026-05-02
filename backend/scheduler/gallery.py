"""Gallery selection deadline expiry processing — runs daily at 4am UTC."""
import logging
import json
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
async def process_selection_deadline_expiry_task():
    """
    Process expired surfer selection deadlines.
    - If auto_select_on_expiry=True: Auto-select top photos based on view count/favorites
    - If auto_select_on_expiry=False: Forfeit selection (photographer keeps photos)
    - If auto_select_on_expiry=None and not set: Send reminder notification
    
    Runs daily at 4am UTC.
    """
    from database import async_session_maker
    from sqlalchemy import select
    from models import (
        SurferSelectionQuota, Gallery, GalleryItem, SurferGalleryItem,
        Profile, Notification
    )
    
    logger.info("[Scheduler] Processing selection deadline expiry...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            
            # Find expired quotas that haven't been processed
            expired_quotas_result = await db.execute(
                select(SurferSelectionQuota)
                .where(SurferSelectionQuota.selection_deadline <= now)
                .where(SurferSelectionQuota.status == 'pending_selection')
            )
            expired_quotas = expired_quotas_result.scalars().all()
            
            logger.info(f"[Scheduler] Found {len(expired_quotas)} expired selection quotas")
            
            processed_count = 0
            auto_selected_count = 0
            forfeited_count = 0
            reminded_count = 0
            
            for quota in expired_quotas:
                try:
                    surfer_id = quota.surfer_id
                    gallery_id = quota.gallery_id
                    
                    # Get surfer info
                    surfer_result = await db.execute(
                        select(Profile).where(Profile.id == surfer_id)
                    )
                    surfer = surfer_result.scalar_one_or_none()
                    
                    if not surfer:
                        continue
                    
                    # Get gallery info
                    gallery_result = await db.execute(
                        select(Gallery).where(Gallery.id == gallery_id)
                    )
                    gallery = gallery_result.scalar_one_or_none()
                    
                    if not gallery:
                        continue
                    
                    if quota.auto_select_on_expiry is True:
                        # AUTO-SELECT: Pick top photos based on engagement
                        remaining_picks = quota.photos_allowed - quota.photos_selected
                        
                        if remaining_picks > 0:
                            # Get gallery items not yet selected, sorted by engagement
                            available_items_result = await db.execute(
                                select(GalleryItem)
                                .where(GalleryItem.gallery_id == gallery_id)
                                .where(GalleryItem.is_selected_by_surfer == False)
                                .order_by(
                                    GalleryItem.is_favorite.desc(),
                                    GalleryItem.view_count.desc()
                                )
                                .limit(remaining_picks)
                            )
                            items_to_select = available_items_result.scalars().all()
                            
                            for item in items_to_select:
                                # Create surfer gallery item (selection)
                                surfer_item = SurferGalleryItem(
                                    surfer_id=surfer_id,
                                    gallery_item_id=item.id,
                                    selection_type='auto_selected',
                                    selected_at=now
                                )
                                db.add(surfer_item)
                                item.is_selected_by_surfer = True
                                quota.photos_selected += 1
                            
                            quota.status = 'auto_completed'
                            auto_selected_count += 1
                            
                            # Notify surfer
                            notification = Notification(
                                user_id=surfer_id,
                                type='selection_auto_completed',
                                title='Photos Auto-Selected',
                                body=f"Your selection deadline expired. We auto-selected {len(items_to_select)} photos from '{gallery.title}' based on your viewing history.",
                                data={"gallery_id": gallery_id, "count": len(items_to_select)}
                            )
                            db.add(notification)
                        else:
                            quota.status = 'completed'
                    
                    elif quota.auto_select_on_expiry is False:
                        # FORFEIT: User chose to lose remaining selections
                        quota.status = 'forfeited'
                        forfeited_count += 1
                        
                        # Notify surfer
                        notification = Notification(
                            user_id=surfer_id,
                            type='selection_forfeited',
                            title='Selection Period Ended',
                            body=f"Your selection period for '{gallery.title}' has ended. Remaining picks were forfeited.",
                            data={"gallery_id": gallery_id}
                        )
                        db.add(notification)
                    
                    else:
                        # UNDECIDED: Send reminder and extend by 3 days (once)
                        if not quota.expiry_reminder_sent:
                            quota.expiry_reminder_sent = True
                            quota.selection_deadline = now + timedelta(days=3)  # Grace period
                            reminded_count += 1
                            
                            # Notify surfer to make a choice
                            notification = Notification(
                                user_id=surfer_id,
                                type='selection_expiry_warning',
                                title='Selection Deadline Extended',
                                body=f"You have 3 more days to select your photos from '{gallery.title}'. Please choose: auto-select or forfeit.",
                                data={
                                    "gallery_id": gallery_id,
                                    "remaining_picks": quota.photos_allowed - quota.photos_selected,
                                    "action_required": True
                                }
                            )
                            db.add(notification)
                        else:
                            # Already reminded once, force auto-select
                            quota.auto_select_on_expiry = True
                            # Will be processed in next run
                    
                    processed_count += 1
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Error processing quota {quota.id}: {str(e)}")
                    continue
            
            await db.commit()
            
            if processed_count > 0:
                logger.info(f"[Scheduler] Processed {processed_count} expired quotas: {auto_selected_count} auto-selected, {forfeited_count} forfeited, {reminded_count} reminded")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in selection deadline expiry: {str(e)}")



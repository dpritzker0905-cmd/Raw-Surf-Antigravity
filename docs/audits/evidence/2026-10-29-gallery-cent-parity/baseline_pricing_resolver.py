"""Shared contextual prices for gallery quotes and single-item purchases.

Preserves the quote route's established precedence and truthiness fallbacks.
Entitlement consumption, subscription quota, payment and download URLs stay with callers.
"""
from sqlalchemy import select, func
from models import GalleryPurchase, GalleryItem, LiveSession, LiveSessionParticipant


async def resolve_item_pricing(item, photographer, db, viewer_id, purchased_tiers=()):
    # ============ CONTEXTUAL PRICING LOOKUP ============
    session_price_override = None
    is_session_participant = False
    session_photos_included = 0
    photos_already_claimed = 0
    participant_locked_prices = None

    if viewer_id and item.gallery_id:
        gallery = item.gallery
        if gallery and gallery.live_session_id:
            participant_result = await db.execute(
                select(LiveSessionParticipant)
                .where(LiveSessionParticipant.live_session_id == gallery.live_session_id)
                .where(LiveSessionParticipant.surfer_id == viewer_id)
                .where(LiveSessionParticipant.status.in_(['active', 'completed']))
            )
            participant = participant_result.scalar_one_or_none()

            if participant:
                is_session_participant = True

                if participant.locked_price_web or participant.locked_price_standard or participant.locked_price_high:
                    participant_locked_prices = {
                        'web': participant.locked_price_web,
                        'standard': participant.locked_price_standard,
                        'high': participant.locked_price_high
                    }

                session_result = await db.execute(
                    select(LiveSession)
                    .where(LiveSession.id == gallery.live_session_id)
                )
                session = session_result.scalar_one_or_none()

                if session:
                    if not participant_locked_prices:
                        session_price_override = session.session_photo_price or session.photo_price
                    session_photos_included = session.photos_included or 0

                    claimed_result = await db.execute(
                        select(func.count(GalleryPurchase.id))
                        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
                        .where(GalleryItem.gallery_id == gallery.id)
                        .where(GalleryPurchase.buyer_id == viewer_id)
                    )
                    photos_already_claimed = claimed_result.scalar() or 0

    pricing = {}
    is_free_from_session = is_session_participant and photos_already_claimed < session_photos_included

    if item.media_type == 'video':
        pricing = {
            "type": "video",
            "tiers": [
                {
                    "tier": "720p", "label": "HD (720p)",
                    "price": item.price_720p or (photographer.video_price_720p if photographer else 8.0) or 8.0,
                    "is_purchased": "720p" in purchased_tiers
                },
                {
                    "tier": "1080p", "label": "Full HD (1080p)",
                    "price": item.price_1080p or (photographer.video_price_1080p if photographer else 15.0) or 15.0,
                    "is_purchased": "1080p" in purchased_tiers
                },
                {
                    "tier": "4k", "label": "Ultra HD (4K)",
                    "price": item.price_4k or (photographer.video_price_4k if photographer else 30.0) or 30.0,
                    "is_purchased": "4k" in purchased_tiers
                }
            ]
        }
    else:
        gallery_obj = item.gallery if item.gallery_id else None

        if gallery_obj and (gallery_obj.price_web or gallery_obj.price_standard or gallery_obj.price_high):
            general_price_web = item.price_web or gallery_obj.price_web or (photographer.photo_price_web if photographer else 3.0) or 3.0
            general_price_standard = item.price_standard or gallery_obj.price_standard or (photographer.photo_price_standard if photographer else 5.0) or 5.0
            general_price_high = item.price_high or gallery_obj.price_high or (photographer.photo_price_high if photographer else 10.0) or 10.0
        else:
            general_price_web = item.price_web or (photographer.photo_price_web if photographer else 3.0) or 3.0
            general_price_standard = item.price_standard or (photographer.photo_price_standard if photographer else 5.0) or 5.0
            general_price_high = item.price_high or (photographer.photo_price_high if photographer else 10.0) or 10.0

        if is_free_from_session:
            final_price_web = final_price_standard = final_price_high = 0.0
            price_source = 'free_from_buyin'
        elif item.locked_price_web or item.locked_price_standard or item.locked_price_high:
            final_price_web = item.locked_price_web or general_price_web
            final_price_standard = item.locked_price_standard or general_price_standard
            final_price_high = item.locked_price_high or general_price_high
            price_source = 'item_locked'
        elif participant_locked_prices:
            final_price_web = participant_locked_prices.get('web') or general_price_web
            final_price_standard = participant_locked_prices.get('standard') or general_price_standard
            final_price_high = participant_locked_prices.get('high') or general_price_high
            price_source = 'participant_locked'
        elif session_price_override is not None:
            final_price_web = final_price_standard = final_price_high = session_price_override
            price_source = 'session_override'
        else:
            final_price_web = general_price_web
            final_price_standard = general_price_standard
            final_price_high = general_price_high
            price_source = 'general'

        pricing = {
            "type": "photo",
            "tiers": [
                {
                    "tier": "web", "label": "Web Quality (800px)",
                    "price": final_price_web, "general_price": general_price_web,
                    "is_purchased": "web" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                },
                {
                    "tier": "standard", "label": "Standard (1920px)",
                    "price": final_price_standard, "general_price": general_price_standard,
                    "is_purchased": "standard" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                },
                {
                    "tier": "high", "label": "High Resolution (Original)",
                    "price": final_price_high, "general_price": general_price_high,
                    "is_purchased": "high" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                }
            ]
        }

    return {
        "pricing": pricing,
        "is_session_participant": is_session_participant,
        "session_photos_included": session_photos_included,
        "photos_already_claimed": photos_already_claimed,
        "is_free_from_session": is_free_from_session,
        "session_price_override": session_price_override,
        "has_locked_pricing": bool(participant_locked_prices or item.locked_price_web or item.locked_price_standard),
    }

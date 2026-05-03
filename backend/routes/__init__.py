# Routes module initialization
from fastapi import APIRouter

# ─── Domain packages ────────────────────────────────────────────────────────────
from .social import router as social_router
from .notifications import router as notifications_router
from .subscriptions_billing import router as subscriptions_billing_router
from .profiles import router as profiles_router
from .compliance_pkg import router as compliance_router
from .crew import router as crew_router
from .career_hub import router as career_hub_router
from .live import router as live_router
from .surf_data import router as surf_data_router
from .explore_discover import router as explore_discover_router

# ─── Existing domain packages ───────────────────────────────────────────────────
from .posts import router as posts_router
from .surf_spots import router as surf_spots_router
from .sessions import router as sessions_router
from .messages import router as messages_router
from .uploads import router as uploads_router
from .gallery import router as gallery_router
from .bookings import router as bookings_router
from .photographer import router as photographer_router
from .dispatch import router as dispatch_router
from .condition_reports import router as condition_reports_router
from .grom_hq import router as grom_hq_router
from .surfer_gallery import router as surfer_gallery_router

# ─── Admin packages ─────────────────────────────────────────────────────────────
from .admin import admin_router, admin_analytics_router
from .admin import (
    admin_moderation_router, admin_p1_router, admin_p2_router,
    admin_analytics_enhanced_router, admin_support_router,
    admin_content_mod_router, admin_communications_router,
    admin_system_router, admin_finance_router, admin_content_mgmt_router,
)

# ─── Standalone route files (small, focused — no package needed) ─────────────────
from .auth import router as auth_router
from .password_reset import router as password_reset_router
from .checkins import router as checkins_router
from .stories import router as stories_router
from .ai_tagging import router as ai_tagging_router
from .ai_health import router as ai_health_router
from .ad_controls import router as ad_controls_router
from .gear_hub import router as gear_hub_router
from .reviews import router as reviews_router
from .notes import router as notes_router
from .meta_sharing import router as meta_sharing_router
from .spot_admin import router as spot_admin_router
from .spot_admin import verification_router as spot_verification_router
from .analytics import router as analytics_router
from .pricing_config import router as pricing_config_router
from .health import router as health_router
from .payments import router as payments_router
from .post_collaboration import router as post_collaboration_router
from .surfer_gallery_review import router as surfer_gallery_review_router

# Create main API router
api_router = APIRouter(prefix="/api")

# ─── Include domain packages ────────────────────────────────────────────────────
api_router.include_router(social_router, tags=["Social"])
api_router.include_router(notifications_router, tags=["Notifications"])
api_router.include_router(subscriptions_billing_router, tags=["Subscriptions"])
api_router.include_router(profiles_router, tags=["Profiles"])
api_router.include_router(compliance_router, tags=["Compliance"])
api_router.include_router(crew_router, tags=["Crew"])
api_router.include_router(career_hub_router, tags=["Career Hub"])
api_router.include_router(live_router, tags=["Live"])
api_router.include_router(surf_data_router, tags=["Surf Data"])
api_router.include_router(explore_discover_router, tags=["Explore"])

# ─── Include existing packages ──────────────────────────────────────────────────
api_router.include_router(posts_router, tags=["Posts"])
api_router.include_router(surf_spots_router, tags=["Surf Spots"])
api_router.include_router(sessions_router, tags=["Sessions"])
api_router.include_router(messages_router, tags=["Messages"])
api_router.include_router(uploads_router, tags=["Uploads"])
api_router.include_router(gallery_router, tags=["Gallery"])
# NOTE: bookings_router MUST be included before photographer_router
# because /bookings/nearby must be matched before /bookings/{booking_id}
api_router.include_router(bookings_router, tags=["Bookings"])
api_router.include_router(photographer_router, tags=["Photographer"])
api_router.include_router(dispatch_router, tags=["Dispatch"])
api_router.include_router(condition_reports_router, tags=["Condition Reports"])
api_router.include_router(grom_hq_router, tags=["Grom HQ"])
api_router.include_router(surfer_gallery_router, tags=["Surfer Gallery"])

# ─── Include admin routers ──────────────────────────────────────────────────────
api_router.include_router(admin_router, tags=["Admin"])
api_router.include_router(admin_analytics_router, tags=["Admin Analytics"])
api_router.include_router(admin_moderation_router, tags=["Admin Moderation"])
api_router.include_router(admin_p1_router, tags=["Admin P1 Features"])
api_router.include_router(admin_p2_router, tags=["Admin P2 Features"])
api_router.include_router(admin_analytics_enhanced_router, tags=["Admin Analytics Enhanced"])
api_router.include_router(admin_support_router, tags=["Admin Support"])
api_router.include_router(admin_content_mod_router, tags=["Admin Content Moderation"])
api_router.include_router(admin_communications_router, tags=["Admin Communications"])
api_router.include_router(admin_system_router, tags=["Admin System"])
api_router.include_router(admin_finance_router, tags=["Admin Finance"])
api_router.include_router(admin_content_mgmt_router, tags=["Admin Content Management"])

# ─── Include standalone routes ──────────────────────────────────────────────────
api_router.include_router(auth_router, tags=["Auth"])
api_router.include_router(password_reset_router, tags=["Auth"])
api_router.include_router(checkins_router, tags=["Check-ins"])
api_router.include_router(stories_router, tags=["Stories"])
api_router.include_router(ai_tagging_router, tags=["AI Tagging"])
api_router.include_router(ai_health_router, tags=["AI Health"])
api_router.include_router(ad_controls_router, tags=["Ad Controls"])
api_router.include_router(gear_hub_router, tags=["Gear Hub"])
api_router.include_router(reviews_router, tags=["Reviews"])
api_router.include_router(notes_router, tags=["Notes"])
api_router.include_router(meta_sharing_router, tags=["Meta Sharing"])
api_router.include_router(spot_admin_router, tags=["Admin Spots"])
api_router.include_router(spot_verification_router, tags=["Spot Verification"])
api_router.include_router(analytics_router, tags=["Admin Analytics"])
api_router.include_router(pricing_config_router, tags=["Pricing Config"])
api_router.include_router(health_router, tags=["Health"])
api_router.include_router(payments_router, tags=["Payments"])
api_router.include_router(post_collaboration_router, tags=["Post Collaboration"])
api_router.include_router(surfer_gallery_review_router, tags=["Surfer Gallery Review"])


@api_router.get("/")
async def root():
    return {"message": "Raw Surf OS API", "status": "active"}

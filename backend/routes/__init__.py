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
from .auth_pkg import router as auth_pkg_router
from .ai import router as ai_router
from .content import router as content_router
from .commerce import router as commerce_router
from .reviews_pkg import router as reviews_pkg_router
from .surfer_gallery_review_pkg import router as surfer_gallery_review_router

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
    admin_moderation_router, admin_moderation_reports_router,
    admin_p1_router, admin_p2_router, admin_p2_campaigns_router,
    admin_analytics_enhanced_router, admin_analytics_settings_router,
    admin_support_router,
    admin_content_mod_router, admin_communications_router,
    admin_system_router, admin_finance_router, admin_content_mgmt_router,
    admin_ab_analytics_router, admin_test_accounts_router,
    admin_user_journey_router,
)

# ─── Standalone route files (infrastructure — no package needed) ─────────────────
from .health import router as health_router

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
api_router.include_router(auth_pkg_router, tags=["Auth"])
api_router.include_router(ai_router, tags=["AI"])
api_router.include_router(content_router, tags=["Content"])
api_router.include_router(commerce_router, tags=["Commerce"])
api_router.include_router(reviews_pkg_router, tags=["Reviews"])
api_router.include_router(surfer_gallery_review_router, tags=["Surfer Gallery Review"])

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
api_router.include_router(admin_moderation_reports_router, tags=["Admin Moderation Reports"])
api_router.include_router(admin_p1_router, tags=["Admin P1 Features"])
api_router.include_router(admin_p2_router, tags=["Admin P2 Features"])
api_router.include_router(admin_analytics_enhanced_router, tags=["Admin Analytics Enhanced"])
api_router.include_router(admin_support_router, tags=["Admin Support"])
api_router.include_router(admin_content_mod_router, tags=["Admin Content Moderation"])
api_router.include_router(admin_communications_router, tags=["Admin Communications"])
api_router.include_router(admin_system_router, tags=["Admin System"])
api_router.include_router(admin_finance_router, tags=["Admin Finance"])
api_router.include_router(admin_content_mgmt_router, tags=["Admin Content Management"])
api_router.include_router(admin_ab_analytics_router, tags=["Admin A/B Analytics"])
api_router.include_router(admin_test_accounts_router, tags=["Admin Test Accounts"])
api_router.include_router(admin_user_journey_router, tags=["Admin User Journey"])
api_router.include_router(admin_analytics_settings_router, tags=["Admin Analytics Settings"])
api_router.include_router(admin_p2_campaigns_router, tags=["Admin P2 Campaigns"])

# ─── Include standalone routes ──────────────────────────────────────────────────
from .strava import router as strava_router
api_router.include_router(health_router, tags=["Health"])
api_router.include_router(strava_router, prefix="/strava", tags=["Strava"])


@api_router.get("/")
async def root():
    return {"message": "Raw Surf OS API", "status": "active"}

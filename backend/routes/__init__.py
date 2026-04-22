# Routes module initialization
from fastapi import APIRouter

# Import all routers
from .auth import router as auth_router
from .password_reset import router as password_reset_router
from .profiles import router as profiles_router
from .subscriptions import router as subscriptions_router
from .credits import router as credits_router
from .posts import router as posts_router
from .surf_spots import router as surf_spots_router
from .sessions import router as sessions_router
from .checkins import router as checkins_router
from .explore import router as explore_router
from .conditions import router as conditions_router
from .surf_reports import router as surf_reports_router
from .alerts import router as alerts_router
from .push import router as push_router
from .messages import router as messages_router
from .notifications import router as notifications_router
from .social import router as social_router
from .stories import router as stories_router
from .uploads import router as uploads_router
from .gallery import router as gallery_router
from .admin import router as admin_router
from .user_media import router as user_media_router
from .profile_content import router as profile_content_router
from .photographer import router as photographer_router
from .bookings import router as bookings_router
from .ai_tagging import router as ai_tagging_router
from .gear_hub import router as gear_hub_router
from .shaka import router as shaka_router
from .impact import router as impact_router
from .leaderboard import router as leaderboard_router
from .challenges import router as challenges_router
from .dispatch import router as dispatch_router
from .friends import router as friends_router
from .payments import router as payments_router
from .notification_preferences import router as notification_preferences_router
from .reviews import router as reviews_router
from .gamification import router as gamification_router
from .career import router as career_router
from .condition_reports import router as condition_reports_router
from .social_live import router as social_live_router
from .livekit import router as livekit_router
from .websocket import router as websocket_router
from .grom_hq import router as grom_hq_router
from .pricing_config import router as pricing_config_router
from .saved_crews import router as saved_crews_router
from .crew_chat import router as crew_chat_router
from .crew_leaderboard import router as crew_leaderboard_router
from .post_collaboration import router as post_collaboration_router
from .ad_controls import router as ad_controls_router
from .admin_analytics import router as admin_analytics_router
from .health import router as health_router
from .geolocation import router as geolocation_router
from .passport import router as passport_router
from .spot_admin import router as spot_admin_router
from .spot_admin import verification_router as spot_verification_router
from .analytics import router as analytics_router
from .notes import router as notes_router
from .meta_sharing import router as meta_sharing_router
from .surfboards import router as surfboards_router
from .surfer_gallery import router as surfer_gallery_router
from .admin_moderation import router as admin_moderation_router
from .admin_p1 import router as admin_p1_router
from .admin_p2 import router as admin_p2_router
from .admin_analytics_enhanced import router as admin_analytics_enhanced_router
from .admin_support import router as admin_support_router
from .admin_content_mod import router as admin_content_mod_router
from .admin_communications import router as admin_communications_router
from .admin_system import router as admin_system_router
from .admin_finance import router as admin_finance_router
from .admin_content_mgmt import router as admin_content_mgmt_router
from .compliance import router as compliance_router
from .username import router as username_router
from .search import router as search_router
from .notification_prefs import router as notification_prefs_router
from .surfer_gallery_review import router as surfer_gallery_review_router
from .waves import router as waves_router
from .blocks import router as blocks_router
from .ai_health import router as ai_health_router

# Create main API router
api_router = APIRouter(prefix="/api")

# Include all sub-routers
api_router.include_router(auth_router, tags=["Auth"])
api_router.include_router(password_reset_router, tags=["Auth"])
api_router.include_router(profiles_router, tags=["Profiles"])
api_router.include_router(profile_content_router, tags=["Profile Content"])
api_router.include_router(subscriptions_router, tags=["Subscriptions"])
api_router.include_router(credits_router, tags=["Credits"])
api_router.include_router(posts_router, tags=["Posts"])
api_router.include_router(surf_spots_router, tags=["Surf Spots"])
api_router.include_router(sessions_router, tags=["Sessions"])
api_router.include_router(checkins_router, tags=["Check-ins"])
api_router.include_router(explore_router, tags=["Explore"])
api_router.include_router(conditions_router, tags=["Conditions"])
api_router.include_router(surf_reports_router, tags=["Surf Reports"])
api_router.include_router(alerts_router, tags=["Alerts"])
api_router.include_router(push_router, tags=["Push Notifications"])
api_router.include_router(messages_router, tags=["Messages"])
api_router.include_router(notifications_router, tags=["Notifications"])
api_router.include_router(social_router, tags=["Social"])
api_router.include_router(stories_router, tags=["Stories"])
api_router.include_router(uploads_router, tags=["Uploads"])
api_router.include_router(gallery_router, tags=["Gallery"])
api_router.include_router(admin_router, tags=["Admin"])
api_router.include_router(user_media_router, tags=["User Media"])
# NOTE: bookings_router MUST be included before photographer_router
# because /bookings/nearby must be matched before /bookings/{booking_id}
api_router.include_router(bookings_router, tags=["Bookings"])
api_router.include_router(photographer_router, tags=["Photographer"])
api_router.include_router(ai_tagging_router, tags=["AI Tagging"])
api_router.include_router(gear_hub_router, tags=["Gear Hub"])
api_router.include_router(shaka_router, tags=["Shaka"])
api_router.include_router(impact_router, tags=["Impact Dashboard"])
api_router.include_router(leaderboard_router, tags=["Leaderboard"])
api_router.include_router(challenges_router, tags=["Challenges"])
api_router.include_router(dispatch_router, tags=["Dispatch"])
api_router.include_router(friends_router, tags=["Friends"])
api_router.include_router(payments_router, tags=["Payments"])
api_router.include_router(notification_preferences_router, tags=["Notification Preferences"])
api_router.include_router(reviews_router, tags=["Reviews"])
api_router.include_router(gamification_router, tags=["Gamification"])
api_router.include_router(career_router, tags=["Career Hub"])
api_router.include_router(condition_reports_router, tags=["Condition Reports"])
api_router.include_router(social_live_router, tags=["Social Live"])
api_router.include_router(livekit_router, tags=["LiveKit"])
api_router.include_router(websocket_router, tags=["WebSocket"])
api_router.include_router(grom_hq_router, tags=["Grom HQ"])
api_router.include_router(pricing_config_router, tags=["Pricing Config"])
api_router.include_router(saved_crews_router, tags=["Saved Crews"])
api_router.include_router(crew_chat_router, tags=["Crew Chat"])
api_router.include_router(crew_leaderboard_router, tags=["Crew Leaderboard"])
api_router.include_router(post_collaboration_router, tags=["Post Collaboration"])
api_router.include_router(ad_controls_router, tags=["Ad Controls"])
api_router.include_router(admin_analytics_router, tags=["Admin Analytics"])
api_router.include_router(health_router, tags=["Health"])
api_router.include_router(geolocation_router, tags=["Geolocation"])
api_router.include_router(passport_router, tags=["Surf Passport"])
api_router.include_router(spot_admin_router, tags=["Admin Spots"])
api_router.include_router(spot_verification_router, tags=["Spot Verification"])
api_router.include_router(analytics_router, tags=["Admin Analytics"])
api_router.include_router(notes_router, tags=["Notes"])
api_router.include_router(meta_sharing_router, tags=["Meta Sharing"])
api_router.include_router(surfboards_router, tags=["Surfboards"])
api_router.include_router(surfer_gallery_router, tags=["Surfer Gallery"])
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
api_router.include_router(compliance_router, tags=["Compliance"])
api_router.include_router(username_router, tags=["Username"])
api_router.include_router(search_router, tags=["Search"])
api_router.include_router(notification_prefs_router, tags=["Notification Preferences"])
api_router.include_router(surfer_gallery_review_router, tags=["Surfer Gallery Review"])
api_router.include_router(waves_router, tags=["Waves"])
api_router.include_router(blocks_router, tags=["User Blocks"])
api_router.include_router(ai_health_router, tags=["AI Health"])

@api_router.get("/")
async def root():
    return {"message": "Raw Surf OS API", "status": "active"}

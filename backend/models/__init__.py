"""
Models package — imports all models from domain-specific modules.
Re-exports everything so `from models import X` works unchanged everywhere.
"""
# Re-export Base for alembic/env.py compatibility
from database import Base  # noqa: F401

# Infrastructure
from .base import generate_uuid  # noqa: F401

# All enums
from .enums import (  # noqa: F401
    RoleEnum, SubscriptionTierEnum, EliteTierEnum, VerificationStatusEnum,
    DispatchRequestStatusEnum, GalleryTierEnum, SessionModeEnum, GearCategory,
    SponsorshipType, FriendshipStatusEnum, ReviewStatusEnum, BadgeTypeEnum,
    CrewBadgeTypeEnum, DisputeStatusEnum, DisputeTypeEnum, ReportReasonEnum,
    ReportStatusEnum, PayoutHoldReasonEnum, AuditLogCategoryEnum,
    VerificationTypeEnum, IdentityVerificationStatusEnum, FraudAlertTypeEnum,
    TosViolationTypeEnum, PromoCodeTypeEnum, TicketCategoryEnum,
    TicketPriorityEnum, TicketStatusEnum, ContentModerationStatusEnum,
    AnnouncementTypeEnum, RefundStatusEnum, PhotographerRequestStatusEnum,
)

# Domain models
from .profile import Profile, PasswordResetToken, UsernameHistory  # noqa: F401

from .spots import (  # noqa: F401
    SurfSpot, SpotRefinement, SpotVerification, SpotEditLog,
    SpotOfTheDay, BoardCatalog,
)

from .bookings import (  # noqa: F401
    Booking, BookingParticipant, BookingInvite, BookingWaitlist,
    BookingKeepSeatLog, PhotographerAvailability,
)

from .dispatch import (  # noqa: F401
    DispatchRequest, DispatchRequestParticipant, CancellationExceptionRequest,
    SessionSnapshot, DispatchNotification, PhotographerRequest,
)

from .payments import PaymentTransaction, CreditTransaction, GlobalPricingConfig  # noqa: F401

from .posts import (  # noqa: F401
    Post, PostCollaboration, PostLike, Comment, CommentReaction,
    PostReaction, SavedPost, TaggedMedia, UserMedia, Story, StoryView,
    Hashtag, PostHashtag, PostReport, UserFavorite,
)

from .sessions import (  # noqa: F401
    LiveSessionParticipant, LiveSession, ConditionReport, SocialLiveStream,
)

from .social import (  # noqa: F401
    Follow, Notification, CheckIn, UserStreak, Friend,
    PrivacySetting, Review, PhotographerAlertSubscription,
)

from .messaging import (  # noqa: F401
    Conversation, Message, ConversationParticipant, MessageReaction,
    MessageReadReceipt, TypingIndicator, VoiceNote,
    UserNote, NoteReply, NoteReaction,
)

from .gallery import (  # noqa: F401
    GalleryItem, GalleryPurchase, PhotoTag, SurferGalleryItem,
    SurferGalleryClaimQueue, SurferSelectionQuota, Gallery,
)

from .surf_alerts import (  # noqa: F401
    SurfReport, SurfAlert, PushSubscription, NotificationPreferences,
)

from .gamification import (  # noqa: F401
    AnalyticsEvent, AdminLog, GearCatalog, GearPurchase,
    SponsorshipTransaction, ShakaMessage, VerifiedCause, InstantShakaVideo,
    ImpactLedger, LeaderboardSnapshot, WeeklyChallenge, ChallengeParticipant,
    Badge, XPTransaction, CompetitionResult, Sponsorship, GoldPassBooking,
    Surfboard, SurfPassportCheckIn, SurfPassportStats, SurfLogEntry,
)

from .crew import (  # noqa: F401
    SavedCrew, CrewChatMessage, CrewStats, CrewBadge, UserCrewStats,
)

from .marketplace import (  # noqa: F401
    PhotographerSubscriptionPlan, SurferPhotoSubscription, AdConfig,
)

from .admin import (  # noqa: F401
    Dispute, DisputeMessage, UserReport, UserBlock, PayoutHold,
    AuditLog, VerificationRequest, ImpersonationSession, FraudAlert,
    TosViolation, TosAcknowledgement, UserActivityLog,
)

from .admin_ops import (  # noqa: F401
    PromoCode, PromoCodeRedemption, FeatureFlag, NotificationCampaign,
    CohortAnalysis, SupportTicket, TicketMessage, ContentModerationItem,
    Announcement, MessageTemplate, BulkMessageCampaign, SystemHealthMetric,
    ScheduledJobStatus, SystemAlert, RefundRequest, PayoutBatch,
    FailedPayment, FeaturedContent, HomepageBanner, SpotSEOMetadata,
    AutomatedReport, APIKey, ChangelogEntry, PlatformMetrics,
    PlatformSettings,
)

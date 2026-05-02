"""
Models package — re-exports all models from core.py for backward compatibility.
Every route file does `from models import SomeModel` — this shim ensures
the transition from models.py (monolith) to models/ (package) is zero-breakage.
"""
from .core import (
    generate_uuid, RoleEnum, SubscriptionTierEnum, EliteTierEnum, VerificationStatusEnum, Profile, PasswordResetToken, SurfSpot,
    SpotRefinement, SpotVerification, SpotEditLog, SpotOfTheDay, BoardCatalog, Booking, BookingParticipant, BookingInvite,
    BookingWaitlist, BookingKeepSeatLog, PhotographerAvailability, DispatchRequestStatusEnum, DispatchRequest, DispatchRequestParticipant, CancellationExceptionRequest, SessionSnapshot,
    DispatchNotification, PaymentTransaction, CreditTransaction, Post, PostCollaboration, PostLike, Comment, CommentReaction,
    PostReaction, SavedPost, TaggedMedia, UserMedia, LiveSessionParticipant, Conversation, Message, Follow,
    Notification, CheckIn, UserStreak, SurfReport, SurfAlert, PushSubscription, NotificationPreferences, PhotographerRequestStatusEnum,
    PhotographerRequest, Story, StoryView, GalleryItem, GalleryPurchase, PhotoTag, GalleryTierEnum, SurferGalleryItem,
    SurferGalleryClaimQueue, SurferSelectionQuota, AnalyticsEvent, AdminLog, SessionModeEnum, LiveSession, Gallery, GearCategory,
    GearCatalog, GearPurchase, SponsorshipType, SponsorshipTransaction, ShakaMessage, VerifiedCause, InstantShakaVideo, ImpactLedger,
    LeaderboardSnapshot, WeeklyChallenge, ChallengeParticipant, FriendshipStatusEnum, Friend, PrivacySetting, ConversationParticipant, MessageReaction,
    MessageReadReceipt, TypingIndicator, VoiceNote, ReviewStatusEnum, Review, BadgeTypeEnum, Badge, XPTransaction,
    CompetitionResult, Sponsorship, GoldPassBooking, ConditionReport, SocialLiveStream, GlobalPricingConfig, SavedCrew, CrewChatMessage,
    CrewBadgeTypeEnum, CrewStats, CrewBadge, UserCrewStats, PlatformMetrics, PlatformSettings, AdConfig, SurfPassportCheckIn,
    SurfPassportStats, UserNote, NoteReply, NoteReaction, PhotographerAlertSubscription, PostReport, UserFavorite, Surfboard,
    DisputeStatusEnum, DisputeTypeEnum, Dispute, DisputeMessage, ReportReasonEnum, ReportStatusEnum, UserReport, UserBlock,
    PayoutHoldReasonEnum, PayoutHold, AuditLogCategoryEnum, AuditLog, VerificationTypeEnum, IdentityVerificationStatusEnum, VerificationRequest, ImpersonationSession,
    FraudAlertTypeEnum, FraudAlert, TosViolationTypeEnum, TosViolation, TosAcknowledgement, UserActivityLog, PromoCodeTypeEnum, PromoCode,
    PromoCodeRedemption, FeatureFlag, NotificationCampaign, CohortAnalysis, TicketCategoryEnum, TicketPriorityEnum, TicketStatusEnum, SupportTicket,
    TicketMessage, ContentModerationStatusEnum, ContentModerationItem, AnnouncementTypeEnum, Announcement, MessageTemplate, BulkMessageCampaign, SystemHealthMetric,
    ScheduledJobStatus, SystemAlert, RefundStatusEnum, RefundRequest, PayoutBatch, FailedPayment, FeaturedContent, HomepageBanner,
    SpotSEOMetadata, AutomatedReport, APIKey, ChangelogEntry, UsernameHistory, Hashtag, PostHashtag, PhotographerSubscriptionPlan,
    SurferPhotoSubscription, SurfLogEntry,
)

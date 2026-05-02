"""All enum classes used across models."""
import enum

class RoleEnum(enum.Enum):
    GROM = "Grom"
    SURFER = "Surfer"
    COMP_SURFER = "Comp Surfer"
    PRO = "Pro"
    GROM_PARENT = "Grom Parent"
    HOBBYIST = "Hobbyist"
    PHOTOGRAPHER = "Photographer"
    APPROVED_PRO = "Approved Pro"
    SCHOOL = "School"
    COACH = "Coach"
    RESORT = "Resort"
    WAVE_POOL = "Wave Pool"
    SHOP = "Shop"
    SHAPER = "Shaper"
    DESTINATION = "Destination"
    ADMIN = "Admin"
class SubscriptionTierEnum(enum.Enum):
    FREE = "free"
    BASIC = "basic"
    PREMIUM = "premium"

class EliteTierEnum(enum.Enum):
    """Career tier for competitive surfers"""
    PRO_ELITE = "pro_elite"      # â­+ Top-tier (world-ranked, major sponsors)
    COMPETITIVE = "competitive"  # ðŸ„ Rising talent, regional competitors
    GROM_RISING = "grom_rising"  # ðŸ¼ Promising young talent

class VerificationStatusEnum(enum.Enum):
    """Verification status for competition results"""
    PENDING = "pending"
    COMMUNITY_VERIFIED = "community_verified"  # Admin/AI approved manual entry
    API_SYNCED = "api_synced"                  # Auto-synced from LiveHeats/WSL
    REJECTED = "rejected"

class DispatchRequestStatusEnum(enum.Enum):
    PENDING_PAYMENT = "pending_payment"
    SEARCHING_FOR_PRO = "searching_for_pro"
    ACCEPTED = "accepted"
    EN_ROUTE = "en_route"
    ARRIVED = "arrived"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_PRO_FOUND = "no_pro_found"
    REFUNDED = "refunded"

class GalleryTierEnum(enum.Enum):
    """Service-to-Gallery tier mapping based on booking type"""
    STANDARD = "standard"      # On-Demand/Standard: 1080p max, watermarked until paid
    PRO = "pro"                # Scheduled/Pro: Full RAW/4K/Original resolution



class SessionModeEnum(enum.Enum):
    """Session mode for unified CaptureSession model"""
    LIVE_JOIN = "live_join"      # Mode A: Live session at spot
    ON_DEMAND = "on_demand"      # Mode B: On-Demand photographer request
    SCHEDULED = "scheduled"      # Mode C: Pre-scheduled booking



class GearCategory(enum.Enum):
    CAMERA = 'camera'
    LENS = 'lens'
    HOUSING = 'housing'
    DRONE = 'drone'
    ACCESSORIES = 'accessories'
    SURFBOARD = 'surfboard'
    WETSUIT = 'wetsuit'
    SURF_ACCESSORIES = 'surf_accessories'



class SponsorshipType(enum.Enum):
    PRO_SPONSORSHIP = 'pro_sponsorship'  # From Pro photographer
    IMPACT_DONATION = 'impact_donation'  # From Hobbyist



class FriendshipStatusEnum(enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    BLOCKED = "blocked"



class ReviewStatusEnum(enum.Enum):
    PENDING = "pending"       # Awaiting moderation
    APPROVED = "approved"     # Visible to public
    REJECTED = "rejected"     # Flagged by AI/admin
    HIDDEN = "hidden"         # Hidden by user request


class BadgeTypeEnum(enum.Enum):
    THE_PATRON = "the_patron"           # Hobbyist/Parent funding sessions
    THE_WORKHORSE = "the_workhorse"     # Pro with consistent sessions
    THE_SHARPSHOOTER = "the_sharpshooter"  # High gallery conversion
    THE_BENEFACTOR = "the_benefactor"   # Total contribution milestones


class CrewBadgeTypeEnum(enum.Enum):
    """Badge types for crew achievements"""
    # Frequency Badges
    FREQUENT_FLYERS = "frequent_flyers"        # 10+ sessions together
    DAWN_PATROL = "dawn_patrol"                # 5+ sunrise sessions
    SUNSET_CREW = "sunset_crew"                # 5+ evening sessions
    WEEKEND_WARRIORS = "weekend_warriors"      # 10+ weekend sessions
    
    # Size Badges
    SQUAD_GOALS = "squad_goals"                # 5+ person crew
    DYNAMIC_DUO = "dynamic_duo"                # Regular 2-person crew
    WOLF_PACK = "wolf_pack"                    # 4+ person crew 5+ times
    
    # Loyalty Badges
    RIDE_OR_DIE = "ride_or_die"                # Same crew 10+ times
    VARIETY_PACK = "variety_pack"             # Surfed with 20+ different people
    LOCAL_LEGENDS = "local_legends"            # Same spot 10+ times together
    
    # Savings Badges
    SMART_SPLITTERS = "smart_splitters"        # Saved $500+ via splits
    BUDGET_BOSSES = "budget_bosses"            # Saved $1000+ via splits



class DisputeStatusEnum(enum.Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    AWAITING_RESPONSE = "awaiting_response"
    RESOLVED_REFUND = "resolved_refund"
    RESOLVED_NO_ACTION = "resolved_no_action"
    RESOLVED_PARTIAL = "resolved_partial"
    ESCALATED = "escalated"
    CLOSED = "closed"


class DisputeTypeEnum(enum.Enum):
    PAYMENT = "payment"              # Refund requests, billing issues
    SERVICE_QUALITY = "service_quality"  # Blurry photos, incomplete delivery
    NO_SHOW = "no_show"              # Photographer/surfer didn't show up
    HARASSMENT = "harassment"        # Behavioral issues
    FRAUD = "fraud"                  # Fake profiles, scams
    OTHER = "other"


class ReportReasonEnum(enum.Enum):
    SPAM = "spam"
    INAPPROPRIATE_CONTENT = "inappropriate_content"
    HARASSMENT = "harassment"
    FRAUD = "fraud"
    FAKE_PROFILE = "fake_profile"
    COPYRIGHT = "copyright"
    UNDERAGE = "underage"
    DANGEROUS_BEHAVIOR = "dangerous_behavior"
    OTHER = "other"


class ReportStatusEnum(enum.Enum):
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    ACTION_TAKEN = "action_taken"
    NO_VIOLATION = "no_violation"
    DISMISSED = "dismissed"


class PayoutHoldReasonEnum(enum.Enum):
    DISPUTE_PENDING = "dispute_pending"
    FRAUD_INVESTIGATION = "fraud_investigation"
    CHARGEBACK = "chargeback"
    QUALITY_REVIEW = "quality_review"
    NEW_ACCOUNT = "new_account"  # First 30 days
    MANUAL_REVIEW = "manual_review"
    OTHER = "other"


class AuditLogCategoryEnum(enum.Enum):
    AUTH = "auth"                    # Login, logout, password changes
    USER_MANAGEMENT = "user_mgmt"    # Bans, suspensions, role changes
    FINANCIAL = "financial"          # Refunds, payouts, holds
    CONTENT = "content"              # Content removal, approval
    DISPUTE = "dispute"              # Dispute actions
    REPORT = "report"                # Report handling
    SETTINGS = "settings"            # Platform settings changes
    ADMIN = "admin"                  # Admin-specific actions


class VerificationTypeEnum(enum.Enum):
    PRO_SURFER = "pro_surfer"           # WSL verification
    APPROVED_PRO_PHOTOGRAPHER = "approved_pro_photographer"  # Media/social verification
    COMP_SURFER = "comp_surfer"         # Competition surfer verification
    BUSINESS = "business"               # Business verification


class IdentityVerificationStatusEnum(enum.Enum):
    """Status for identity verification requests"""
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    MORE_INFO_NEEDED = "more_info_needed"


class FraudAlertTypeEnum(enum.Enum):
    LOCATION_SPOOFING = "location_spoofing"
    FAKE_REVIEWS = "fake_reviews"
    CHARGEBACK_PATTERN = "chargeback_pattern"
    SUSPICIOUS_SIGNUPS = "suspicious_signups"
    MULTIPLE_ACCOUNTS = "multiple_accounts"
    PAYMENT_FRAUD = "payment_fraud"
    IDENTITY_MISMATCH = "identity_mismatch"
    BOT_BEHAVIOR = "bot_behavior"


class TosViolationTypeEnum(enum.Enum):
    """Types of Terms of Service violations"""
    LOCATION_FRAUD = "location_fraud"           # Fake GPS coordinates
    FAKE_REVIEWS = "fake_reviews"               # Creating fake reviews
    HARASSMENT = "harassment"                    # Harassing other users
    INAPPROPRIATE_CONTENT = "inappropriate"      # Posting inappropriate content
    SPAM = "spam"                                # Spamming
    SCAM = "scam"                                # Attempting to scam users
    MULTIPLE_ACCOUNTS = "multiple_accounts"      # Operating multiple accounts
    CHARGEBACKS = "chargebacks"                  # Repeated chargebacks
    UNDERAGE = "underage"                        # Underage user without grom link
    IMPERSONATION = "impersonation"              # Impersonating others
    OTHER = "other"                              # Other violations



class PromoCodeTypeEnum(enum.Enum):
    PERCENTAGE = "percentage"       # e.g., 20% off
    FIXED_AMOUNT = "fixed_amount"   # e.g., $10 off
    FREE_CREDITS = "free_credits"   # e.g., 50 free credits
    FIRST_BOOKING = "first_booking" # First booking discount


class TicketCategoryEnum(enum.Enum):
    BILLING = "billing"
    TECHNICAL = "technical"
    ACCOUNT = "account"
    BOOKING = "booking"
    PAYOUT = "payout"
    CONTENT = "content"
    VERIFICATION = "verification"
    OTHER = "other"


class TicketPriorityEnum(enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class TicketStatusEnum(enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING_USER = "waiting_user"
    WAITING_INTERNAL = "waiting_internal"
    RESOLVED = "resolved"
    CLOSED = "closed"


class ContentModerationStatusEnum(enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ESCALATED = "escalated"


class AnnouncementTypeEnum(enum.Enum):
    BANNER = "banner"
    MODAL = "modal"
    TOAST = "toast"
    EMAIL = "email"


class RefundStatusEnum(enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    PROCESSING = "processing"
    COMPLETED = "completed"
    REJECTED = "rejected"
    FAILED = "failed"


class PhotographerRequestStatusEnum(enum.Enum):
    """Status for photographer coverage requests"""
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"
    CANCELLED = "cancelled"





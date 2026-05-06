"""Gallery system: items, purchases, tags, surfer selections."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
class GalleryItem(Base):
    """Photographer gallery items with SmugMug-style quality tiers"""
    __tablename__ = 'gallery_items'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    gallery_id = Column(String(36), ForeignKey('galleries.id', ondelete='SET NULL'), nullable=True, index=True)  # Parent gallery
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    session_id = Column(String(36), nullable=True)  # Legacy - Linked to a live session
    
    # Media URLs for different quality levels
    original_url = Column(String(500), nullable=False)  # High-res original (4K for photos, 4K for videos)
    preview_url = Column(String(500), nullable=False)   # Watermarked preview
    thumbnail_url = Column(String(500), nullable=True)  # Small thumbnail
    
    # Additional quality URLs (generated on upload)
    url_web = Column(String(500), nullable=True)        # 800px web quality
    url_standard = Column(String(500), nullable=True)   # 1920px standard
    url_720p = Column(String(500), nullable=True)       # 720p video
    url_1080p = Column(String(500), nullable=True)      # 1080p video
    
    media_type = Column(String(20), default='image')  # 'image' or 'video'
    
    # Video metadata (for 4K videos from paid photographers)
    video_width = Column(Integer, nullable=True)
    video_height = Column(Integer, nullable=True)
    video_duration = Column(Float, nullable=True)
    
    # Photo metadata
    photo_width = Column(Integer, nullable=True)
    photo_height = Column(Integer, nullable=True)
    
    # Metadata
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)  # JSON array of tags
    
    # ============ DYNAMIC PRICING ENGINE ============
    # Custom price: Manual override set by photographer for premium shots
    # If set, this takes priority over ALL other pricing logic
    custom_price = Column(Float, nullable=True)  # Fixed price override for this specific item
    
    # Default pricing (uses gallery or photographer's settings if not set)
    price = Column(Float, default=5.0)  # Legacy - base price in credits
    price_web = Column(Float, nullable=True)       # Override for web quality
    price_standard = Column(Float, nullable=True)  # Override for standard
    price_high = Column(Float, nullable=True)      # Override for high res
    price_720p = Column(Float, nullable=True)      # Override for 720p video
    price_1080p = Column(Float, nullable=True)     # Override for 1080p video
    price_4k = Column(Float, nullable=True)        # Override for 4K video
    
    # ============ SESSION ORIGIN PRICING (Locks price at upload) ============
    # These fields ensure a surfer's gallery checkout prices match what they agreed to
    # at the time of session join, even if photographer changes rates later
    session_origin_mode = Column(String(30), nullable=True)  # 'live_join', 'on_demand', 'scheduled', null=gallery upload
    locked_price_web = Column(Float, nullable=True)          # Price for web quality locked at session time
    locked_price_standard = Column(Float, nullable=True)     # Price for standard locked at session time  
    locked_price_high = Column(Float, nullable=True)         # Price for high-res locked at session time
    
    is_for_sale = Column(Boolean, default=True)
    
    # Stats
    view_count = Column(Integer, default=0)
    purchase_count = Column(Integer, default=0)
    
    # Surfer tagging
    tagged_surfer_ids = Column(Text, nullable=True)  # JSON array of surfer IDs
    
    # Status
    is_public = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    
    # Soft-delete: When photographer "deletes" an item that surfers have paid for,
    # we hide it from photographer's gallery but keep media alive for paid locker items
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    shot_at = Column(DateTime(timezone=True), nullable=True)  # When the photo was taken
    
    photographer = relationship('Profile', backref='gallery_items')
    gallery = relationship('Gallery', back_populates='items')
    spot = relationship('SurfSpot', backref='gallery_items')



class GalleryPurchase(Base):
    """Tracks gallery item purchases with quality tier"""
    __tablename__ = 'gallery_purchases'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    buyer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    amount_paid = Column(Float, nullable=False)
    payment_method = Column(String(20), default='credits')  # 'credits' or 'stripe'
    
    # Quality tier purchased
    quality_tier = Column(String(20), default='standard')  # 'web', 'standard', 'high', '720p', '1080p', '4k'
    
    # Download tracking
    download_count = Column(Integer, default=0)
    max_downloads = Column(Integer, default=5)
    
    purchased_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    gallery_item = relationship('GalleryItem', backref='purchases')
    buyer = relationship('Profile', foreign_keys=[buyer_id], backref='gallery_purchases')



class PhotoTag(Base):
    """Tracks surfer tags on photos with viewing/claiming status"""
    __tablename__ = 'photo_tags'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Was surfer a participant in the live session?
    was_session_participant = Column(Boolean, default=False)
    
    # Pricing context at time of tagging
    session_photo_price = Column(Float, nullable=True)  # Price from live session (0 = no extra charge)
    
    # Access status
    access_granted = Column(Boolean, default=False)  # True if no extra charge or purchased
    is_gift = Column(Boolean, default=False)  # Photographer explicitly gifted this
    
    # Tracking timestamps
    tagged_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    viewed_at = Column(DateTime(timezone=True), nullable=True)  # First time surfer viewed it
    claimed_at = Column(DateTime(timezone=True), nullable=True)  # When added to their collection
    
    # Relationships
    gallery_item = relationship('GalleryItem', backref='photo_tags')
    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='tagged_photos')
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    live_session = relationship('LiveSession', backref='photo_tags')



# ============ SURFER GALLERY SYSTEM ============
# "My Gallery" / "The Locker" - Surfer's private media collection


class SurferGalleryItem(Base):
    """
    Surfer's personal gallery item - "The Locker"
    Each item links a surfer to a photographer's gallery item with service-tier restrictions
    """
    __tablename__ = 'surfer_gallery_items'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Source context - what booking/session this came from
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # ============ SERVICE-TO-GALLERY TIER MAPPING ============
    # The service type at booking determines gallery features
    service_type = Column(String(30), default='standard')  # 'on_demand', 'scheduled', 'live_join'
    gallery_tier = Column(Enum(GalleryTierEnum), default=GalleryTierEnum.STANDARD)  # Locked by service type
    
    # Quality access - what resolutions this surfer can download
    # Standard tier: max 1080p/Social | Pro tier: Full RAW/4K
    max_photo_quality = Column(String(20), default='standard')  # 'web', 'standard', 'high'
    max_video_quality = Column(String(20), default='1080p')     # '720p', '1080p', '4k'
    
    # ============ PAYMENT & ACCESS STATUS ============
    # Watermarked until paid (for Standard tier)
    is_paid = Column(Boolean, default=False)
    paid_amount = Column(Float, default=0.0)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    payment_method = Column(String(30), nullable=True)  # 'credits', 'stripe', 'crew_split', 'included'
    
    # Access granted via different methods
    # 'pending' = Not yet paid/selected
    # 'pending_selection' = Session has included photos, surfer must select which ones to claim
    # 'purchased' = Surfer paid for this item
    # 'included' = Part of the session's included photo allocation (surfer selected it)
    # 'gifted' = Photographer gifted this item
    # 'crew_split' = Paid via crew split arrangement
    access_type = Column(String(30), default='pending')
    
    # ============ INCLUDED PHOTOS SELECTION TRACKING ============
    # For sessions with "included photos" (e.g., $100 session + 5 free photos)
    # Surfers must select which photos they want before the rest are paywalled
    selection_eligible = Column(Boolean, default=False)  # True if part of "included photos" pool
    selection_deadline = Column(DateTime(timezone=True), nullable=True)  # When selection window closes
    
    # Crew split tracking (media held until crew payment requirements met)
    crew_split_pending = Column(Boolean, default=False)  # True if waiting for crew payment
    crew_split_resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    # ============ VISIBILITY CONTROLS ("The Locker" Logic) ============
    # Private by default - toggling to Public mirrors to public Sessions Tab
    is_public = Column(Boolean, default=False)  # False = Private Locker, True = Public Sessions Tab
    is_favorite = Column(Boolean, default=False)  # Surfer's favorite items
    visibility_changed_at = Column(DateTime(timezone=True), nullable=True)
    
    # ============ AI LINEUP MATCH METADATA ============
    # AI-suggested tag (surfer can confirm/reject)
    ai_suggested = Column(Boolean, default=False)  # True if AI matched this surfer
    ai_confidence = Column(Float, nullable=True)   # 0-1 confidence score
    ai_match_method = Column(String(50), nullable=True)  # 'face_match', 'board_color', 'wetsuit', 'manual'
    surfer_confirmed = Column(Boolean, default=False)  # True if surfer confirmed the AI suggestion
    surfer_rejected = Column(Boolean, default=False)   # True if surfer rejected the suggestion
    
    # ============ SESSION METADATA (from Passport sync) ============
    # These sync to surfer's Passport regardless of tier
    session_date = Column(DateTime(timezone=True), nullable=True)
    spot_name = Column(String(255), nullable=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    
    # Surgical Peak conditions at time of shot
    wind_direction = Column(String(20), nullable=True)
    wind_speed = Column(Float, nullable=True)
    swell_height = Column(Float, nullable=True)
    swell_period = Column(Float, nullable=True)
    swell_direction = Column(String(20), nullable=True)
    tide_height = Column(Float, nullable=True)
    
    # ============ PRESERVED MEDIA URLs ============
    # When a photographer deletes a GalleryItem, these URLs are baked in
    # so surfers never lose access to media they've paid for
    preserved_original_url = Column(String(500), nullable=True)
    preserved_preview_url = Column(String(500), nullable=True)
    preserved_thumbnail_url = Column(String(500), nullable=True)
    preserved_media_type = Column(String(20), nullable=True)
    
    # Timestamps
    added_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    viewed_at = Column(DateTime(timezone=True), nullable=True)
    downloaded_at = Column(DateTime(timezone=True), nullable=True)
    download_count = Column(Integer, default=0)
    
    # Relationships
    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='surfer_gallery_items')
    gallery_item = relationship('GalleryItem', backref='surfer_items')
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    booking = relationship('Booking', backref='gallery_items_for_surfers')
    live_session = relationship('LiveSession', backref='surfer_gallery_items')
    spot = relationship('SurfSpot')
    
    # Unique constraint - one surfer can only have one instance of each gallery item
    __table_args__ = (
        Index('ix_surfer_gallery_unique', 'surfer_id', 'gallery_item_id', unique=True),
    )



class SurferGalleryClaimQueue(Base):
    """
    AI "Review & Claim" queue - pending items for surfer to review
    AI cross-references surfer's Passport (board color, wetsuit, profile photo) to suggest tags
    """
    __tablename__ = 'surfer_gallery_claim_queue'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # AI analysis results
    ai_confidence = Column(Float, nullable=False)  # 0-1 confidence this is the surfer
    ai_match_reasons = Column(Text, nullable=True)  # JSON: ["board_color_match", "wetsuit_pattern", "face_detected"]
    
    # Passport data used for matching
    passport_board_color = Column(String(50), nullable=True)
    passport_wetsuit_color = Column(String(50), nullable=True)
    
    # Session context
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    
    # Status
    status = Column(String(30), default='pending')  # 'pending', 'claimed', 'rejected', 'expired'
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)  # Auto-expire after 7 days
    
    # Relationships
    surfer = relationship('Profile', foreign_keys=[surfer_id])
    gallery_item = relationship('GalleryItem')
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    live_session = relationship('LiveSession')
    booking = relationship('Booking')



class SurferSelectionQuota(Base):
    """
    Tracks "Included Photos" selection quotas per surfer per session.
    When a photographer sets a session price that includes X photos,
    each surfer gets a quota to select their favorites from the uploaded burst.
    """
    __tablename__ = 'surfer_selection_quotas'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # Session context (one of these should be set)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=True, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='CASCADE'), nullable=True, index=True)
    gallery_id = Column(String(36), ForeignKey('galleries.id', ondelete='CASCADE'), nullable=True, index=True)
    
    # Selection quota
    photos_allowed = Column(Integer, nullable=False)  # How many photos surfer can select for free
    photos_selected = Column(Integer, default=0)      # How many they've selected so far
    videos_allowed = Column(Integer, default=0)       # Videos included (if any)
    videos_selected = Column(Integer, default=0)
    
    # Status
    status = Column(String(30), default='pending_selection')  # 'pending_selection', 'selections_complete', 'expired'
    selection_deadline = Column(DateTime(timezone=True), nullable=True)  # 10 days to select (industry standard)
    
    # Expiration behavior (surfer choice)
    # None = not yet chosen, True = auto-select best rated, False = forfeit remaining
    auto_select_on_expiry = Column(Boolean, nullable=True)
    expiry_reminder_sent = Column(Boolean, default=False)  # 3-day warning sent
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)  # When surfer finished selecting
    
    # Relationships
    surfer = relationship('Profile', foreign_keys=[surfer_id])
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    booking = relationship('Booking')
    live_session = relationship('LiveSession')
    gallery = relationship('Gallery')
    
    __table_args__ = (
        # One quota per surfer per session
        Index('ix_selection_quota_booking', 'surfer_id', 'booking_id', unique=True),
        Index('ix_selection_quota_session', 'surfer_id', 'live_session_id', unique=True),
    )



class Gallery(Base):
    """A gallery (collection of items) created after a live session or manually"""
    __tablename__ = 'galleries'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    surf_spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Session reference fields for different session types
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True, index=True)
    dispatch_id = Column(String(36), ForeignKey('dispatch_requests.id', ondelete='SET NULL'), nullable=True, index=True)
    session_type = Column(String(30), nullable=True)  # 'live', 'on_demand', 'booking', 'manual'
    
    # Gallery info
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    cover_image_url = Column(String(500), nullable=True)
    
    # Gallery-specific pricing (overrides photographer defaults)
    price_web = Column(Float, nullable=True)
    price_standard = Column(Float, nullable=True)
    price_high = Column(Float, nullable=True)
    price_720p = Column(Float, nullable=True)
    price_1080p = Column(Float, nullable=True)
    price_4k = Column(Float, nullable=True)
    
    # Locked prices at session time (for participant checkout)
    locked_price_web = Column(Float, nullable=True)
    locked_price_standard = Column(Float, nullable=True)
    locked_price_high = Column(Float, nullable=True)
    
    # Default tier for gallery
    default_tier = Column(Enum(GalleryTierEnum), default=GalleryTierEnum.STANDARD)
    
    # Stats
    item_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    purchase_count = Column(Integer, default=0)
    
    # Status
    is_public = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    is_for_sale = Column(Boolean, default=True)
    
    # Photographer settings for this gallery
    show_watermark_in_selection = Column(Boolean, default=True)  # Whether selection preview shows watermark
    
    # Session date (from live session)
    session_date = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', backref='galleries')
    live_session = relationship('LiveSession', back_populates='gallery')
    surf_spot = relationship('SurfSpot', backref='galleries')
    items = relationship('GalleryItem', back_populates='gallery', cascade='all, delete-orphan')


# ============ GEAR HUB AFFILIATE ENGINE ============


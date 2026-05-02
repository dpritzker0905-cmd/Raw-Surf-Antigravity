"""Posts, comments, reactions, stories, hashtags, and user media."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
class Post(Base):
    __tablename__ = 'posts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    author_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    media_url = Column(Text, nullable=True)  # Optional for check-ins - TEXT for base64 selfies
    media_type = Column(String(20), default='image')  # 'image', 'video', or 'check_in'
    thumbnail_url = Column(Text, nullable=True)  # For video thumbnails - TEXT for flexibility
    caption = Column(Text, nullable=True)
    location = Column(String(255), nullable=True)
    likes_count = Column(Integer, default=0)
    comments_count = Column(Integer, default=0)  # Track comment count
    
    # ============================================================
    # WAVES FEATURE - Short-form vertical video
    # ============================================================
    content_type = Column(String(20), default='post', index=True)  # 'post' or 'wave'
    aspect_ratio = Column(String(10), nullable=True)  # '9:16', '16:9', '1:1', '4:5'
    view_count = Column(Integer, default=0)  # For Waves engagement tracking
    
    # Video metadata
    video_width = Column(Integer, nullable=True)
    video_height = Column(Integer, nullable=True)
    video_duration = Column(Float, nullable=True)
    was_transcoded = Column(Boolean, default=False)
    
    # Check-in fields (for Map â†’ Feed cross-pollination)
    is_check_in = Column(Boolean, default=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    check_in_photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    check_in_session_price = Column(Float, nullable=True)
    
    # ============================================================
    # SESSION LOG METADATA (P1 - Session-Based Social Feed)
    # ============================================================
    
    # Session timing
    session_date = Column(DateTime(timezone=True), nullable=True)  # When the session happened
    session_start_time = Column(String(10), nullable=True)  # "06:45" format
    session_end_time = Column(String(10), nullable=True)    # "08:45" format
    session_label = Column(String(50), nullable=True)       # "Dawn Patrol", "Sunset Session", etc.
    
    # Conditions (auto-filled from forecast, user can override)
    wave_height_ft = Column(Float, nullable=True)           # e.g., 4.5
    wave_period_sec = Column(Integer, nullable=True)        # e.g., 12
    wave_direction = Column(String(10), nullable=True)      # "N", "NE", "E", "SE", "S", "SW", "W", "NW"
    wave_direction_degrees = Column(Float, nullable=True)   # e.g., 90 (for visualization)
    wind_speed_mph = Column(Float, nullable=True)           # e.g., 8.0
    wind_direction = Column(String(10), nullable=True)      # "N", "NE", "E", "SE", "S", "SW", "W", "NW"
    tide_height_ft = Column(Float, nullable=True)           # e.g., 2.3
    tide_status = Column(String(20), nullable=True)         # "Rising", "Falling", "High", "Low"
    conditions_source = Column(String(20), default='manual')  # 'auto', 'manual', 'edited'
    
    # Booking/Gallery link (for photographer posts)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    gallery_id = Column(String(36), nullable=True)          # Link to photographer's gallery
    is_highlight_post = Column(Boolean, default=False)      # Photographer highlight carousel
    
    # Session Log sharing (from Scheduled Tab)
    is_session_log = Column(Boolean, default=False)         # True if shared from booking
    session_invite_open = Column(Boolean, default=False)    # True if friends can join
    session_spots_left = Column(Integer, nullable=True)     # Available spots for crew
    session_price_per_person = Column(Float, nullable=True) # Cost per person to join
    
    # Carousel support (multiple media items)
    is_carousel = Column(Boolean, default=False)
    carousel_media = Column(JSON, default=list)  # [{"url": "...", "type": "image/video", "thumbnail": "..."}]
    
    # Post Settings (user preferences)
    hide_like_count = Column(Boolean, default=False)   # Hide likes from others
    comments_disabled = Column(Boolean, default=False)  # Disable commenting
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    author = relationship('Profile', back_populates='posts', foreign_keys=[author_id])
    likes = relationship('PostLike', back_populates='post', cascade='all, delete-orphan')
    comments = relationship('Comment', back_populates='post', order_by='Comment.created_at', cascade='all, delete-orphan')
    reactions = relationship('PostReaction', back_populates='post', cascade='all, delete-orphan')
    spot = relationship('SurfSpot', backref='check_in_posts')
    check_in_photographer = relationship('Profile', foreign_keys=[check_in_photographer_id])
    collaborators = relationship('PostCollaboration', back_populates='post', foreign_keys='PostCollaboration.post_id', cascade='all, delete-orphan')
    hashtags = relationship('Hashtag', secondary='post_hashtags', back_populates='posts')



class PostCollaboration(Base):
    """
    "I Was There" Collaboration System
    Allows users to collaborate on posts by linking their presence at a session.
    Supports: Invite, Request, Accept, Deny, Untag
    """
    __tablename__ = 'post_collaborations'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Who initiated: 'author' (post owner invited), 'user' (user requested to join)
    initiated_by = Column(String(10), default='author')  # 'author' or 'user'
    
    # Status flow: pending â†’ accepted/denied, or accepted â†’ untagged
    status = Column(String(20), default='pending')  # 'pending', 'accepted', 'denied', 'untagged'
    
    # Optional: User's own media for this session (their clips from same session)
    linked_media_url = Column(Text, nullable=True)
    linked_media_type = Column(String(20), nullable=True)  # 'image', 'video'
    
    # GPS verification (optional)
    verified_by_gps = Column(Boolean, default=False)
    verification_latitude = Column(Float, nullable=True)
    verification_longitude = Column(Float, nullable=True)
    
    # Community flagging
    is_flagged = Column(Boolean, default=False)
    flag_count = Column(Integer, default=0)
    flag_reasons = Column(JSON, default=list)  # ["wasn't there", "fake", etc.]
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    responded_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    post = relationship('Post', back_populates='collaborators', foreign_keys=[post_id])
    user = relationship('Profile', backref='post_collaborations')
    
    __table_args__ = (
        # One collaboration per user per post
        Index('ix_post_collab_post_user', 'post_id', 'user_id', unique=True),
    )



class PostLike(Base):
    """Track post likes"""
    __tablename__ = 'post_likes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    post = relationship('Post', back_populates='likes')
    user = relationship('Profile')
    
    __table_args__ = (
        # Unique constraint: one like per user per post
        Index('ix_post_likes_post_user', 'post_id', 'user_id', unique=True),
    )



class Comment(Base):
    """Comments on posts - supports nested replies via parent_id"""
    __tablename__ = 'comments'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    author_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    parent_id = Column(String(36), ForeignKey('comments.id', ondelete='CASCADE'), nullable=True, index=True)  # For replies
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Edit tracking (Instagram-style "edited" label)
    edited_at = Column(DateTime(timezone=True), nullable=True)  # Timestamp of last edit
    is_edited = Column(Boolean, default=False)  # Quick flag for UI to show "edited" label
    
    post = relationship('Post', back_populates='comments')
    author = relationship('Profile')
    reactions = relationship('CommentReaction', back_populates='comment', cascade='all, delete-orphan')
    # Self-referential relationship for replies
    replies = relationship('Comment', backref=backref('parent', remote_side=[id]), cascade='all, delete-orphan')



class CommentReaction(Base):
    """Emoji reactions to comments (likes, hearts, etc.)"""
    __tablename__ = 'comment_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    comment_id = Column(String(36), ForeignKey('comments.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Emoji reaction - same as post reactions: ðŸ¤™ Shaka, ðŸŒŠ Wave, â¤ï¸ Heart, ðŸ”¥ Fire
    emoji = Column(String(10), nullable=False, default='â¤ï¸')
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    comment = relationship('Comment', back_populates='reactions')
    user = relationship('Profile')
    
    __table_args__ = (
        # Unique constraint: one reaction per user per comment
        Index('ix_comment_reactions_comment_user', 'comment_id', 'user_id', unique=True),
    )



class PostReaction(Base):
    """Emoji reactions to feed posts (Shaka, Wave, Heart, Fire)"""
    __tablename__ = 'post_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Emoji reaction - surf-themed: ðŸ¤™ Shaka, ðŸŒŠ Wave, â¤ï¸ Heart, ðŸ”¥ Fire
    emoji = Column(String(10), nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    post = relationship('Post', back_populates='reactions')
    user = relationship('Profile')
    
    __table_args__ = (
        # Unique constraint: one reaction type per user per post
        Index('ix_post_reactions_post_user_emoji', 'post_id', 'user_id', 'emoji', unique=True),
    )



class SavedPost(Base):
    """Saved/bookmarked posts"""
    __tablename__ = 'saved_posts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')
    post = relationship('Post')
    
    __table_args__ = (
        # Unique constraint: one save per user per post
        {'sqlite_autoincrement': True},
    )



class TaggedMedia(Base):
    """Track users tagged in posts or gallery items"""
    __tablename__ = 'tagged_media'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    tagged_user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Can be tagged in a post or gallery item
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=True, index=True)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=True, index=True)
    
    # Who tagged them
    tagged_by_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    tagged_user = relationship('Profile', foreign_keys=[tagged_user_id])
    tagged_by = relationship('Profile', foreign_keys=[tagged_by_id])
    post = relationship('Post')
    gallery_item = relationship('GalleryItem')




class UserMedia(Base):
    """User's personal media collection (separate from photographer galleries)"""
    __tablename__ = 'user_media'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Media info
    media_url = Column(String(500), nullable=False)
    media_type = Column(String(20), default='image')  # 'image' or 'video'
    thumbnail_url = Column(String(500), nullable=True)
    
    # Source tracking
    source_type = Column(String(30), default='user_upload')  # 'user_upload' or 'photographer_transfer'
    source_photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    source_gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='SET NULL'), nullable=True)
    
    # Metadata
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    
    # Video metadata (for user uploads, capped at 1080p)
    video_width = Column(Integer, nullable=True)
    video_height = Column(Integer, nullable=True)
    video_duration = Column(Float, nullable=True)
    was_transcoded = Column(Boolean, default=False)
    
    # If transferred from photographer, preserve original resolution
    original_width = Column(Integer, nullable=True)
    original_height = Column(Integer, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile', foreign_keys=[user_id], backref='user_media')
    source_photographer = relationship('Profile', foreign_keys=[source_photographer_id])
    source_gallery_item = relationship('GalleryItem')



class Story(Base):
    """Stories - ephemeral content from photographers and surfers"""
    __tablename__ = 'stories'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    author_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Content
    media_url = Column(String(500), nullable=False)  # Image or video URL
    media_type = Column(String(20), default='image')  # 'image' or 'video'
    caption = Column(Text, nullable=True)
    
    # Story type - differentiate photographers from surfers
    story_type = Column(String(20), default='surf')  # 'photographer' (live report) or 'surf' (surfer story)
    
    # Location info (for photographer stories)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_name = Column(String(255), nullable=True)  # Spot name or custom location
    
    # Linked to live session (for photographer stories)
    is_live_report = Column(Boolean, default=False)  # True if posted during active shooting
    
    # Engagement
    view_count = Column(Integer, default=0)
    
    # Stories expire after 24 hours
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_expired = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    author = relationship('Profile', backref='stories')
    spot = relationship('SurfSpot', backref='stories')
    views = relationship('StoryView', back_populates='story', cascade='all, delete-orphan')



class StoryView(Base):
    """Tracks who has viewed a story"""
    __tablename__ = 'story_views'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    story_id = Column(String(36), ForeignKey('stories.id', ondelete='CASCADE'), nullable=False, index=True)
    viewer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    viewed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    story = relationship('Story', back_populates='views')
    viewer = relationship('Profile', backref='story_views')



class Hashtag(Base):
    """
    Stores unique hashtags used across posts.
    Tracks usage count for trending calculations.
    """
    __tablename__ = 'hashtags'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    tag = Column(String(50), unique=True, nullable=False, index=True)  # Lowercase, no # prefix
    post_count = Column(Integer, default=0)  # Number of posts using this hashtag
    last_used = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationship to posts via junction table
    posts = relationship('Post', secondary='post_hashtags', back_populates='hashtags')



class PostHashtag(Base):
    """
    Junction table linking posts to their hashtags.
    Enables many-to-many relationship.
    """
    __tablename__ = 'post_hashtags'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    hashtag_id = Column(String(36), ForeignKey('hashtags.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Unique constraint to prevent duplicate links
    __table_args__ = (
        Index('ix_post_hashtag_unique', 'post_id', 'hashtag_id', unique=True),
    )


# ============================================================
# PHOTOGRAPHER SUBSCRIPTION PLANS & SURFER SUBSCRIPTIONS
# Photographers offer recurring weekly/monthly bundles.
# Surfers subscribe and get quotas for photos, videos,
# live session buy-ins, and discounts on bookings/on-demand.
# ============================================================


class PostReport(Base):
    """Report a post for policy violation"""
    __tablename__ = 'post_reports'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False)
    reporter_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    reason = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), default='pending')  # pending, reviewed, dismissed, actioned
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Relationships - use passive_deletes to let DB handle CASCADE
    post = relationship('Post', backref=backref('reports', passive_deletes=True))
    reporter = relationship('Profile', foreign_keys=[reporter_id], backref='reports_submitted')
    reviewer = relationship('Profile', foreign_keys=[reviewed_by], backref='reports_reviewed')



class UserFavorite(Base):
    """User's saved/favorited posts"""
    __tablename__ = 'user_favorites'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Relationships - use passive_deletes to let DB handle CASCADE
    user = relationship('Profile', backref='favorites')
    post = relationship('Post', backref=backref('favorited_by', passive_deletes=True))
    
    __table_args__ = (
        Index('idx_user_favorite_unique', 'user_id', 'post_id', unique=True),
    )


"""Crew system: saved crews, chat, stats, badges."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
class SavedCrew(Base):
    """
    Saved Crew Presets - Quick-start feature for Pro/Comp surfers
    Allows users to save their frequent surf buddies for instant crew selection
    """
    __tablename__ = 'saved_crews'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    owner_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Preset metadata
    name = Column(String(100), nullable=False)  # e.g., "Dawn Patrol Crew", "Competition Squad"
    is_default = Column(Boolean, default=False)  # Auto-load this crew for On-Demand sessions
    
    # Crew members stored as JSON array
    # Structure: [{"user_id": "...", "name": "...", "email": "...", "avatar_url": "..."}, ...]
    members = Column(JSON, nullable=False, default=list)
    
    # Usage tracking
    times_used = Column(Integer, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    owner = relationship('Profile', backref='saved_crews')



# ============================================================
# CREW CHAT - BOOKING-LINKED MESSAGING
# ============================================================


class CrewChatMessage(Base):
    """
    Crew Chat Messages - Real-time messaging linked to bookings.
    Allows Captains, Crew members, and Photographers to coordinate
    gear, meeting spots, and session details before a shoot.
    """
    __tablename__ = 'crew_chat_messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Message content
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default='text')  # 'text', 'image', 'voice', 'system'
    
    # Media attachment (optional)
    media_url = Column(String(500), nullable=True)
    media_thumbnail_url = Column(String(500), nullable=True)
    
    # Voice note metadata
    voice_duration_seconds = Column(Integer, nullable=True)
    
    # System message data (for auto-generated messages)
    # e.g., "Sarah paid their share" or "Session confirmed!"
    system_data = Column(JSON, nullable=True)
    
    # Read tracking per participant (JSON: {"user_id": timestamp, ...})
    read_by = Column(JSON, default=dict)
    
    # Reactions (JSON: {"emoji": ["user_id1", "user_id2"], ...})
    reactions = Column(JSON, default=dict)
    
    # Threaded replies
    reply_to_id = Column(String(36), ForeignKey('crew_chat_messages.id', ondelete='SET NULL'), nullable=True)
    
    # @Mentions (JSON array: [{"user_id": "...", "username": "...", "start": 0, "end": 10}, ...])
    mentions = Column(JSON, default=list)
    
    # Soft delete
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    booking = relationship('Booking', backref='chat_messages')
    sender = relationship('Profile', backref='crew_chat_messages')


# ============================================================
# CREW LEADERBOARD - STATS & BADGES
# ============================================================


class CrewStats(Base):
    """
    Crew Statistics - Tracks metrics for crew leaderboard
    Represents a unique pair/group of surfers who session together
    """
    __tablename__ = 'crew_stats'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Crew identification - sorted user IDs to ensure uniqueness
    # For pairs: "user_id_1,user_id_2" (alphabetically sorted)
    # For groups: stored in members_hash for efficiency
    crew_hash = Column(String(128), unique=True, nullable=False, index=True)
    
    # Member list (JSON array of user_ids)
    member_ids = Column(JSON, nullable=False, default=list)
    crew_size = Column(Integer, default=2)
    
    # Crew name (optional, user-defined)
    name = Column(String(100), nullable=True)
    
    # Privacy setting
    is_public = Column(Boolean, default=True)  # Configurable per crew
    
    # Core metrics
    total_sessions = Column(Integer, default=0)
    total_waves_caught = Column(Integer, default=0)
    total_money_saved = Column(Float, default=0.0)
    total_photos_shared = Column(Integer, default=0)
    
    # Time-based metrics
    sunrise_sessions = Column(Integer, default=0)      # Sessions before 8 AM
    sunset_sessions = Column(Integer, default=0)       # Sessions after 5 PM
    weekend_sessions = Column(Integer, default=0)      # Saturday/Sunday sessions
    
    # Spot tracking (JSON: {"spot_id": count, ...})
    spot_frequency = Column(JSON, default=dict)
    favorite_spot_id = Column(String(36), nullable=True)
    
    # Streak tracking
    current_streak = Column(Integer, default=0)        # Consecutive weeks surfing together
    longest_streak = Column(Integer, default=0)
    
    # Timestamps
    first_session_at = Column(DateTime(timezone=True), nullable=True)
    last_session_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



class CrewBadge(Base):
    """
    Crew Badges - Achievements earned by crews
    """
    __tablename__ = 'crew_badges'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    crew_stats_id = Column(String(36), ForeignKey('crew_stats.id', ondelete='CASCADE'), nullable=False, index=True)
    
    badge_type = Column(Enum(CrewBadgeTypeEnum), nullable=False)
    
    # Badge metadata
    tier = Column(Integer, default=1)  # Bronze=1, Silver=2, Gold=3
    progress = Column(Integer, default=0)  # Current progress toward next tier
    target = Column(Integer, default=0)    # Target for next tier
    
    earned_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationship
    crew_stats = relationship('CrewStats', backref='badges')



class UserCrewStats(Base):
    """
    Individual user's crew statistics - for profile display
    """
    __tablename__ = 'user_crew_stats'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # Aggregate stats
    total_crew_sessions = Column(Integer, default=0)
    total_unique_buddies = Column(Integer, default=0)
    total_saved_via_splits = Column(Float, default=0.0)
    
    # Personal badges earned (JSON array)
    badges_earned = Column(JSON, default=list)
    
    # Favorite crew (most sessions with)
    favorite_crew_hash = Column(String(128), nullable=True)
    favorite_buddy_id = Column(String(36), nullable=True)
    
    # Timestamps
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationship
    user = relationship('Profile', backref='crew_stats_summary')


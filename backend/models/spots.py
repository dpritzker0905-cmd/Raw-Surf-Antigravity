"""Surf spots, verification, and board catalog."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
class SurfSpot(Base):
    __tablename__ = 'surf_spots'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False, index=True)
    region = Column(String(255), nullable=True)  # e.g., "Central Florida", "South Florida"
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    difficulty = Column(String(50), nullable=True)  # Beginner, Intermediate, Advanced
    best_tide = Column(String(100), nullable=True)
    best_swell = Column(String(100), nullable=True)
    image_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Global Spot Database fields (P1 - NEW)
    osm_id = Column(String(50), nullable=True, index=True)  # OpenStreetMap node ID for deduplication
    country = Column(String(100), nullable=True, index=True)  # e.g., "USA", "Australia", "Indonesia"
    state_province = Column(String(100), nullable=True)  # e.g., "Florida", "California", "Bali"
    import_tier = Column(Integer, default=1)  # 1=East Coast, 2=West Coast/Hawaii, 3=Global
    wave_type = Column(String(100), nullable=True)  # e.g., "Beach Break", "Point Break", "Reef Break"
    
    # Secondary location fields for granular tagging
    secondary_city = Column(String(100), nullable=True)  # e.g., "Cocoa Beach", "Satellite Beach"
    secondary_area = Column(String(100), nullable=True)  # e.g., "Space Coast", "Treasure Coast"
    
    # Precision Pin fields (Iteration 135 - Peak-First)
    original_latitude = Column(Float, nullable=True)  # Pre-adjustment coordinates
    original_longitude = Column(Float, nullable=True)
    is_verified_peak = Column(Boolean, default=False)  # True if manually verified or snapped to water
    accuracy_flag = Column(String(50), default='unverified')  # 'verified', 'low_accuracy', 'unverified', 'crowdsourced'
    verified_by = Column(String(36), nullable=True)  # Admin who verified
    verified_at = Column(DateTime(timezone=True), nullable=True)
    refinement_count = Column(Integer, default=0)  # Number of photographer refinements
    last_refined_at = Column(DateTime(timezone=True), nullable=True)
    
    # Community Verification (Photographer votes)
    community_verified = Column(Boolean, default=False)  # True if 5+ photographers verified accuracy
    verification_votes_yes = Column(Integer, default=0)  # Count of "Yes, pin is accurate" votes
    verification_votes_no = Column(Integer, default=0)  # Count of "No, needs move" votes
    
    # NOAA Buoy Assignment (Admin can manually link)
    noaa_buoy_id = Column(String(50), nullable=True)  # NOAA buoy station ID for forecast data
    
    # Precision Queue flag
    flagged_for_review = Column(Boolean, default=False)  # True if >150m from water (needs admin review)
    
    active_photographers = relationship('Profile', back_populates='current_spot')


class SpotRefinement(Base):
    """Crowdsourced spot location refinements from photographers"""
    __tablename__ = 'spot_refinements'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    proposed_latitude = Column(Float, nullable=False)
    proposed_longitude = Column(Float, nullable=False)
    status = Column(String(20), default='pending')  # 'pending', 'approved', 'rejected'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(String(36), nullable=True)

class SpotVerification(Base):
    """
    Photographer verification votes for spot pin accuracy.
    5+ "Yes" votes from verified photographers = Community Verified badge.
    """
    __tablename__ = 'spot_verifications'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # Verification vote
    is_accurate = Column(Boolean, nullable=False)  # True = "Yes, pin is on peak", False = "No, needs move"
    
    # If not accurate, photographer can suggest new coordinates
    suggested_latitude = Column(Float, nullable=True)
    suggested_longitude = Column(Float, nullable=True)
    suggestion_note = Column(Text, nullable=True)  # Optional note about why pin should move
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    spot = relationship('SurfSpot')
    photographer = relationship('Profile')

class SpotEditLog(Base):
    """
    Admin audit log for spot edits (create, move, delete).
    Maintains complete history of precision changes.
    """
    __tablename__ = 'spot_edit_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    admin_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=False)
    
    # Action type
    action = Column(String(30), nullable=False)  # 'create', 'move', 'delete', 'verify', 'update_buoy'
    
    # Coordinate changes
    old_latitude = Column(Float, nullable=True)
    old_longitude = Column(Float, nullable=True)
    new_latitude = Column(Float, nullable=True)
    new_longitude = Column(Float, nullable=True)
    
    # Metadata changes
    old_name = Column(String(255), nullable=True)
    new_name = Column(String(255), nullable=True)
    old_region = Column(String(255), nullable=True)
    new_region = Column(String(255), nullable=True)
    
    # Water check result
    was_on_land = Column(Boolean, default=False)  # True if pin was placed on land
    override_land_warning = Column(Boolean, default=False)  # True if admin overrode land warning
    
    # NOAA Buoy assignment
    noaa_buoy_id = Column(String(50), nullable=True)  # Assigned buoy for forecast data
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    admin = relationship('Profile')

class SpotOfTheDay(Base):
    """
    Spot of the Day - Social Discovery Engine
    Highlights best nearby spots based on photographer activity and conditions
    """
    __tablename__ = 'spot_of_the_day'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    region = Column(String(100), nullable=False, index=True)  # e.g., "Space Coast", "Gold Coast"
    date = Column(Date, nullable=False, index=True)
    
    # Reason for selection
    reason = Column(String(50), nullable=False)  # 'epic_conditions', 'high_activity', 'pro_shooter', 'trending'
    rating = Column(String(20), nullable=True)  # 'FLAT', 'POOR', 'POOR_TO_FAIR', 'FAIR', 'FAIR_TO_GOOD', 'GOOD', 'EPIC'
    
    # Featured photo from the photographer that triggered this
    featured_photo_url = Column(String(500), nullable=True)
    featured_photographer_id = Column(String(36), ForeignKey('profiles.id'), nullable=True)
    
    # Metrics at time of selection
    active_photographers = Column(Integer, default=0)
    wave_height = Column(String(20), nullable=True)  # e.g., "3-4 ft"
    wind_conditions = Column(String(50), nullable=True)  # e.g., "8kts E"
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    spot = relationship('SurfSpot')
    featured_photographer = relationship('Profile')

class BoardCatalog(Base):
    __tablename__ = 'board_catalog'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    shaper_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    model = Column(String(255), nullable=False)
    length = Column(Float, nullable=False)
    volume = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    shaper = relationship('Profile', back_populates='board_catalog')


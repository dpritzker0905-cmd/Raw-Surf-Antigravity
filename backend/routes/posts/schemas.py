"""
Posts schemas — Pydantic models and constants for the posts domain.
"""
from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime


VALID_REACTIONS = ['🤙', '🌊', '🏄', '🔥', '💯', '❤️', '👏', '😂', '😎', '💪']

class PostCreate(BaseModel):
    media_url: str
    media_type: str = 'image'  # 'image' or 'video'
    thumbnail_url: Optional[str] = None
    caption: Optional[str] = None
    location: Optional[str] = None
    mentions: Optional[List[dict]] = None  # [{"user_id": "...", "username": "..."}, ...]
    # Video metadata
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    video_duration: Optional[float] = None
    was_transcoded: Optional[bool] = False
    # Carousel support
    is_carousel: Optional[bool] = False
    carousel_media: Optional[List[dict]] = None  # [{"url": "...", "type": "image/video", "thumbnail": "..."}]
    # Session metadata
    session_date: Optional[datetime] = None
    session_start_time: Optional[str] = None
    session_end_time: Optional[str] = None
    wave_height_ft: Optional[float] = None
    wave_period_sec: Optional[int] = None
    wave_direction: Optional[str] = None
    wave_direction_degrees: Optional[float] = None
    wind_speed_mph: Optional[float] = None
    wind_direction: Optional[str] = None
    tide_status: Optional[str] = None
    tide_height_ft: Optional[float] = None
    conditions_source: Optional[str] = 'manual'

class CommentCreate(BaseModel):
    content: str
    parent_id: Optional[str] = None  # For replies to other comments

class CommentUpdate(BaseModel):
    """Request body for editing a comment"""
    content: str

class ReactionCreate(BaseModel):
    emoji: str

class ReactionData(BaseModel):
    emoji: str
    user_id: str
    user_name: Optional[str] = None
    avatar_url: Optional[str] = None
    user_role: Optional[str] = None

# Valid surf-themed reactions — must stay in sync with frontend constants/emojis.js → REACTION_EMOJIS
VALID_REACTIONS = ['🤙', '🌊', '🏄', '🔥', '💯', '❤️', '👏', '😂', '😎', '💪']

class CommentResponse(BaseModel):
    id: str
    post_id: str
    author_id: str
    author_name: Optional[str]
    author_username: Optional[str] = None
    author_avatar: Optional[str]
    content: str
    created_at: datetime
    is_edited: bool = False
    edited_at: Optional[datetime] = None

class CollaboratorData(BaseModel):
    """Collaborator info for session posts"""
    id: str
    user_id: str
    full_name: Optional[str]
    username: Optional[str] = None
    avatar_url: Optional[str]
    status: str
    verified_by_gps: bool = False

class SpotData(BaseModel):
    """Surf spot data for session posts"""
    id: str
    name: str
    region: Optional[str]

class PostResponse(BaseModel):
    id: str
    author_id: str
    author_name: Optional[str]
    author_username: Optional[str] = None
    author_avatar: Optional[str]
    author_role: Optional[str] = None
    media_url: Optional[str] = None  # Optional for session log posts
    media_type: str
    thumbnail_url: Optional[str]
    caption: Optional[str]
    location: Optional[str]
    likes_count: int
    comments_count: int = 0
    is_liked_by_user: bool = False
    reactions: List[ReactionData] = []  # Post reactions
    video_width: Optional[int]
    video_height: Optional[int]
    video_duration: Optional[float]
    was_transcoded: bool = False
    created_at: datetime
    recent_comments: List[CommentResponse] = []  # Show latest 2 comments inline
    
    # Session Log Metadata
    session_date: Optional[datetime] = None
    session_start_time: Optional[str] = None
    session_end_time: Optional[str] = None
    session_label: Optional[str] = None
    wave_height_ft: Optional[float] = None
    wave_period_sec: Optional[int] = None
    wave_direction: Optional[str] = None
    wave_direction_degrees: Optional[float] = None
    wind_speed_mph: Optional[float] = None
    wind_direction: Optional[str] = None
    tide_height_ft: Optional[float] = None
    tide_status: Optional[str] = None
    conditions_source: Optional[str] = None
    
    # Spot info
    spot: Optional[SpotData] = None
    
    # Collaborators
    collaborators: List[CollaboratorData] = []
    collaborator_count: int = 0
    
    # Check-in fields
    is_check_in: bool = False
    check_in_spot_name: Optional[str] = None
    check_in_conditions: Optional[str] = None
    
    # Session Log fields (for SessionJoinCard)
    is_session_log: bool = False
    session_invite_open: bool = False
    session_spots_left: Optional[int] = None
    session_price_per_person: Optional[float] = None
    booking_id: Optional[str] = None
    
    # Post settings
    hide_like_count: bool = False
    comments_disabled: bool = False
    
    # Carousel support
    is_carousel: bool = False
    carousel_media: Optional[List[dict]] = []  # [{"url": "...", "type": "image/video", "thumbnail": "..."}]
    
    # Single post view fields
    liked: bool = False
    saved: bool = False


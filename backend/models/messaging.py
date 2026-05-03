"""Conversations, messages, reactions, voice notes, and user notes."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
class Conversation(Base):
    """Direct message conversations between two users"""
    __tablename__ = 'conversations'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    participant_one_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    participant_two_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Instagram-style inbox logic
    # 'primary' = accepted conversation (follows or replied)
    # 'request' = message request (from non-follower, not yet accepted)
    status_for_one = Column(String(20), default='primary')  # primary, request, hidden
    status_for_two = Column(String(20), default='request')  # primary, request, hidden
    
    # Conversation controls per participant
    is_pinned_for_one = Column(Boolean, default=False)
    is_pinned_for_two = Column(Boolean, default=False)
    is_muted_for_one = Column(Boolean, default=False)
    is_muted_for_two = Column(Boolean, default=False)
    is_unread_for_one = Column(Boolean, default=False)  # Manually marked as unread
    is_unread_for_two = Column(Boolean, default=False)
    
    last_message_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_message_preview = Column(String(200), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    participant_one = relationship('Profile', foreign_keys=[participant_one_id], backref='conversations_as_one')
    participant_two = relationship('Profile', foreign_keys=[participant_two_id], backref='conversations_as_two')
    messages = relationship('Message', back_populates='conversation', cascade='all, delete-orphan', order_by='Message.created_at')



class Message(Base):
    """Individual messages within a conversation"""
    __tablename__ = 'messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default='text')  # text, image, video, voice_note, session_invite
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Rich Media Support
    media_url = Column(String(500), nullable=True)  # URL to photo/video/voice note
    media_thumbnail_url = Column(String(500), nullable=True)  # Thumbnail for videos
    
    # Threaded Replies
    reply_to_id = Column(String(36), ForeignKey('messages.id', ondelete='SET NULL'), nullable=True)
    
    # Voice Note Metadata
    voice_duration_seconds = Column(Integer, nullable=True)
    
    conversation = relationship('Conversation', back_populates='messages')
    sender = relationship('Profile', backref='sent_messages')
    reply_to = relationship('Message', remote_side=[id], backref='replies')



class ConversationParticipant(Base):
    """Participants in a group conversation (for group chats)"""
    __tablename__ = 'conversation_participants'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Role in group (for groups)
    role = Column(String(20), default='member')  # 'admin', 'member'
    
    # Notification settings
    is_muted = Column(Boolean, default=False)
    muted_until = Column(DateTime(timezone=True), nullable=True)
    
    # Read status
    last_read_at = Column(DateTime(timezone=True), nullable=True)
    unread_count = Column(Integer, default=0)
    
    # Timestamps
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    left_at = Column(DateTime(timezone=True), nullable=True)
    
    user = relationship('Profile')
    
    __table_args__ = (
        Index('ix_conv_participants_pair', 'conversation_id', 'user_id', unique=True),
    )



class MessageReaction(Base):
    """Emoji reactions to messages"""
    __tablename__ = 'message_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    message_id = Column(String(36), ForeignKey('messages.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Emoji reaction
    emoji = Column(String(10), nullable=False)  # Unicode emoji
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')
    
    __table_args__ = (
        Index('ix_msg_reactions_pair', 'message_id', 'user_id', 'emoji', unique=True),
    )



class MessageReadReceipt(Base):
    """Read receipts for messages"""
    __tablename__ = 'message_read_receipts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    message_id = Column(String(36), ForeignKey('messages.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    read_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')
    
    __table_args__ = (
        Index('ix_msg_read_pair', 'message_id', 'user_id', unique=True),
    )



class TypingIndicator(Base):
    """Typing status (ephemeral - clean up old records)"""
    __tablename__ = 'typing_indicators'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    __table_args__ = (
        Index('ix_typing_pair', 'conversation_id', 'user_id', unique=True),
    )



class VoiceNote(Base):
    """Voice note attachments for messages"""
    __tablename__ = 'voice_notes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    message_id = Column(String(36), ForeignKey('messages.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # Supabase storage URL
    audio_url = Column(String(500), nullable=False)
    duration_seconds = Column(Integer, nullable=False)
    waveform_data = Column(Text, nullable=True)  # JSON array of amplitude values
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



# ============ TWO-WAY REVIEW SYSTEM ============


class UserNote(Base):
    """
    Instagram-style Notes feature
    Short text updates that appear above user avatars in messages
    Notes auto-expire after 24 hours
    """
    __tablename__ = 'user_notes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Note content (max 60 chars like Instagram)
    content = Column(String(60), nullable=False)
    
    # Optional emoji reaction from viewers
    emoji = Column(String(10), nullable=True)  # Primary emoji for the note
    
    # Visibility
    is_active = Column(Boolean, default=True)  # False if manually deleted
    
    # Engagement
    view_count = Column(Integer, default=0)
    reply_count = Column(Integer, default=0)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)  # 24 hours from creation
    
    # Relationships
    user = relationship('Profile', backref='notes')
    
    __table_args__ = (
        Index('idx_user_notes_active', 'user_id', 'is_active'),
        Index('idx_user_notes_expires', 'expires_at'),
    )



class NoteReply(Base):
    """
    Replies to user notes
    Creates a direct message thread when someone replies to a note
    """
    __tablename__ = 'note_replies'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    note_id = Column(String(36), ForeignKey('user_notes.id', ondelete='CASCADE'), nullable=False, index=True)
    replier_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # Reply can be text or just an emoji reaction
    reply_text = Column(String(500), nullable=True)
    reply_emoji = Column(String(10), nullable=True)
    
    # Link to the conversation created by this reply
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='SET NULL'), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    note = relationship('UserNote', backref='replies')
    replier = relationship('Profile', backref='note_replies')




class NoteReaction(Base):
    """
    Emoji reactions to notes (like Instagram's note reactions)
    Multiple users can react with different emojis
    """
    __tablename__ = 'note_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    note_id = Column(String(36), ForeignKey('user_notes.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    emoji = Column(String(10), nullable=False)  # The emoji reaction
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    note = relationship('UserNote', backref='reactions')
    user = relationship('Profile', backref='note_reactions_given')
    
    __table_args__ = (
        # One reaction per user per note
        Index('idx_note_reaction_unique', 'note_id', 'user_id', unique=True),
    )


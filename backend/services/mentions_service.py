"""
Mentions Service - Sitewide @mentions functionality
Handles mention parsing, autocomplete, and notifications
"""
import re
from typing import List, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload
import logging
import json

from models import Profile, Notification, Follow

logger = logging.getLogger(__name__)

# Mention pattern: @[display_name](user_id) or @username
MENTION_PATTERN = re.compile(r'@\[([^\]]+)\]\(([a-f0-9-]+)\)|@(\w+)', re.IGNORECASE)

# For parsing raw @username during typing
USERNAME_PATTERN = re.compile(r'@(\w{2,30})(?:\s|$|[^\w])', re.IGNORECASE)


class MentionsService:
    """
    Centralized service for handling @mentions across the app.
    Works with Crew Chat, DMs, Comments, etc.
    """
    
    @staticmethod
    async def search_mentionable_users(
        query: str,
        current_user_id: str,
        context: str,
        context_id: Optional[str],
        db: AsyncSession,
        limit: int = 10
    ) -> List[Dict]:
        """
        Search for users that can be mentioned.
        
        Args:
            query: Search query (username or name)
            current_user_id: The user doing the search
            context: 'crew_chat', 'dm', 'comment', 'post'
            context_id: booking_id, conversation_id, post_id, etc.
            db: Database session
            limit: Max results
        
        Returns:
            List of mentionable users with id, username, full_name, avatar_url
        """
        results = []
        query_lower = query.lower().strip()
        
        # Context-specific priority users
        priority_user_ids = set()
        
        if context == 'crew_chat' and context_id:
            # Get booking participants
            from models import Booking, BookingParticipant
            booking_result = await db.execute(
                select(Booking).where(Booking.id == context_id)
                .options(selectinload(Booking.participants))
            )
            booking = booking_result.scalar_one_or_none()
            if booking:
                priority_user_ids.add(booking.photographer_id)
                for p in booking.participants or []:
                    priority_user_ids.add(p.participant_id)
        
        elif context == 'dm' and context_id:
            # Get conversation participants
            from models import Conversation, ConversationParticipant
            conv_result = await db.execute(
                select(ConversationParticipant).where(
                    ConversationParticipant.conversation_id == context_id
                )
            )
            participants = conv_result.scalars().all()
            for p in participants:
                priority_user_ids.add(p.user_id)
        
        # Remove current user from priority
        priority_user_ids.discard(current_user_id)
        
        # Search priority users first
        if priority_user_ids and query_lower:
            priority_result = await db.execute(
                select(Profile).where(
                    Profile.id.in_(priority_user_ids),
                    Profile.full_name.ilike(f'%{query_lower}%')
                ).limit(limit)
            )
            for user in priority_result.scalars().all():
                results.append({
                    'user_id': user.id,
                    'username': user.full_name.lower().replace(' ', '_') if user.full_name else user.id[:8],
                    'full_name': user.full_name,
                    'avatar_url': user.avatar_url,
                    'is_priority': True
                })
        
        # If need more results, search followers/following
        if len(results) < limit:
            remaining = limit - len(results)
            existing_ids = {r['user_id'] for r in results}
            existing_ids.add(current_user_id)
            
            # Get users the current user follows
            follows_result = await db.execute(
                select(Profile).join(
                    Follow, Follow.following_id == Profile.id
                ).where(
                    Follow.follower_id == current_user_id,
                    Profile.id.notin_(existing_ids),
                    Profile.full_name.ilike(f'%{query_lower}%') if query_lower else True
                ).limit(remaining)
            )
            for user in follows_result.scalars().all():
                results.append({
                    'user_id': user.id,
                    'username': user.full_name.lower().replace(' ', '_') if user.full_name else user.id[:8],
                    'full_name': user.full_name,
                    'avatar_url': user.avatar_url,
                    'is_priority': False
                })
        
        # If still need more, search all public profiles
        if len(results) < limit and query_lower:
            remaining = limit - len(results)
            existing_ids = {r['user_id'] for r in results}
            existing_ids.add(current_user_id)
            
            all_result = await db.execute(
                select(Profile).where(
                    Profile.id.notin_(existing_ids),
                    Profile.full_name.ilike(f'%{query_lower}%')
                ).limit(remaining)
            )
            for user in all_result.scalars().all():
                results.append({
                    'user_id': user.id,
                    'username': user.full_name.lower().replace(' ', '_') if user.full_name else user.id[:8],
                    'full_name': user.full_name,
                    'avatar_url': user.avatar_url,
                    'is_priority': False
                })
        
        return results
    
    @staticmethod
    def parse_mentions(content: str) -> List[Dict]:
        """
        Parse @mentions from message content.
        
        Supports two formats:
        1. @[Display Name](user_id) - structured mention
        2. @username - raw username mention (to be resolved)
        
        Returns list of mention objects with user_id, display, start, end positions
        """
        mentions = []
        
        for match in MENTION_PATTERN.finditer(content):
            if match.group(2):  # Structured mention: @[name](id)
                mentions.append({
                    'display': match.group(1),
                    'user_id': match.group(2),
                    'start': match.start(),
                    'end': match.end(),
                    'type': 'structured'
                })
            elif match.group(3):  # Raw username: @username
                mentions.append({
                    'username': match.group(3),
                    'start': match.start(),
                    'end': match.end(),
                    'type': 'raw'
                })
        
        return mentions
    
    @staticmethod
    async def resolve_mentions(
        content: str,
        db: AsyncSession
    ) -> tuple[str, List[Dict]]:
        """
        Resolve raw @username mentions to structured format.
        Returns (updated_content, resolved_mentions_list)
        """
        mentions = MentionsService.parse_mentions(content)
        resolved = []
        offset = 0
        new_content = content
        
        for mention in mentions:
            if mention['type'] == 'raw':
                # Look up user by full_name (username-like search)
                # Since we don't have username field, search by full_name
                search_term = mention['username']
                result = await db.execute(
                    select(Profile).where(
                        Profile.full_name.ilike(f'%{search_term}%')
                    ).limit(1)
                )
                user = result.scalar_one_or_none()
                
                if user:
                    # Replace @username with @[Full Name](user_id)
                    old_text = f"@{mention['username']}"
                    new_text = f"@[{user.full_name}]({user.id})"
                    
                    start = mention['start'] + offset
                    end = mention['end'] + offset
                    new_content = new_content[:start] + new_text + new_content[end:]
                    offset += len(new_text) - len(old_text)
                    
                    resolved.append({
                        'user_id': user.id,
                        'username': user.full_name.lower().replace(' ', '_') if user.full_name else user.id[:8],
                        'display': user.full_name,
                        'start': start,
                        'end': start + len(new_text)
                    })
            else:
                # Already structured
                resolved.append({
                    'user_id': mention['user_id'],
                    'display': mention['display'],
                    'start': mention['start'] + offset,
                    'end': mention['end'] + offset
                })
        
        return new_content, resolved
    
    @staticmethod
    async def send_mention_notifications(
        mentions: List[Dict],
        sender_id: str,
        sender_name: str,
        message_preview: str,
        context: str,
        context_id: str,
        message_id: str,
        db: AsyncSession
    ):
        """
        Send push notifications to mentioned users.
        """
        for mention in mentions:
            user_id = mention.get('user_id')
            if not user_id or user_id == sender_id:
                continue
            
            # Create notification
            notification = Notification(
                user_id=user_id,
                type='mention',
                title=f'{sender_name} mentioned you',
                body=message_preview[:100] + ('...' if len(message_preview) > 100 else ''),
                data=json.dumps({
                    'context': context,
                    'context_id': context_id,
                    'message_id': message_id,
                    'sender_id': sender_id,
                    'sender_name': sender_name,
                    'deep_link': f'/messages/{context_id}' if context == 'dm' else f'/bookings/{context_id}/chat'
                })
            )
            db.add(notification)
        
        await db.flush()
        logger.info(f"Sent {len(mentions)} mention notifications from {sender_name}")


# Singleton instance
mentions_service = MentionsService()

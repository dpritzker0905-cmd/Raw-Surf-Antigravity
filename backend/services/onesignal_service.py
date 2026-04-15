"""
OneSignal Push Notification Service
Handles push notifications for note replies, reactions, followers, and messages
"""

import httpx
import os
import json
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone


class OneSignalService:
    """OneSignal Push Notification Service"""
    
    def __init__(self):
        self.app_id = os.environ.get('ONESIGNAL_APP_ID')
        self.api_key = os.environ.get('ONESIGNAL_REST_API_KEY')
        self.api_url = "https://api.onesignal.com/notifications"
        
        if not self.app_id or not self.api_key:
            print("WARNING: OneSignal credentials not configured")
    
    @property
    def headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Key {self.api_key}",
            "Content-Type": "application/json; charset=utf-8"
        }
    
    async def send_notification(
        self,
        external_user_ids: List[str],
        title: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
        url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Send push notification to specific users via their external_id
        """
        if not self.app_id or not self.api_key:
            print("OneSignal not configured, skipping notification")
            return {"success": False, "error": "OneSignal not configured"}
        
        payload = {
            "app_id": self.app_id,
            "include_aliases": {
                "external_id": external_user_ids
            },
            "target_channel": "push",
            "headings": {"en": title},
            "contents": {"en": message},
            "priority": 10
        }
        
        if data:
            payload["data"] = data
        
        if url:
            payload["url"] = url
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.api_url,
                    json=payload,
                    headers=self.headers,
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                print(f"OneSignal notification sent: {result.get('id')}")
                return {"success": True, "notification_id": result.get("id")}
        except httpx.HTTPStatusError as e:
            print(f"OneSignal HTTP error: {e.response.status_code} - {e.response.text}")
            return {"success": False, "error": str(e)}
        except Exception as e:
            print(f"OneSignal error: {e}")
            return {"success": False, "error": str(e)}
    
    async def send_note_reply_notification(
        self,
        recipient_id: str,
        sender_name: str,
        note_content: str,
        conversation_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Send notification when someone replies to a note"""
        return await self.send_notification(
            external_user_ids=[recipient_id],
            title="New Note Reply 💬",
            message=f"{sender_name} replied to your note: \"{note_content[:30]}...\"",
            data={
                "type": "note_reply",
                "sender_name": sender_name,
                "conversation_id": conversation_id
            },
            url=f"/messages/{conversation_id}" if conversation_id else "/messages"
        )
    
    async def send_note_reaction_notification(
        self,
        recipient_id: str,
        reactor_name: str,
        emoji: str,
        note_content: str
    ) -> Dict[str, Any]:
        """Send notification when someone reacts to a note"""
        return await self.send_notification(
            external_user_ids=[recipient_id],
            title=f"Note Reaction {emoji}",
            message=f"{reactor_name} reacted {emoji} to your note",
            data={
                "type": "note_reaction",
                "reactor_name": reactor_name,
                "emoji": emoji
            },
            url="/messages"
        )
    
    async def send_new_follower_notification(
        self,
        recipient_id: str,
        follower_name: str,
        follower_id: str
    ) -> Dict[str, Any]:
        """Send notification when someone follows the user"""
        return await self.send_notification(
            external_user_ids=[recipient_id],
            title="New Follower 🤙",
            message=f"{follower_name} started following you",
            data={
                "type": "new_follower",
                "follower_id": follower_id,
                "follower_name": follower_name
            },
            url=f"/profile/{follower_id}"
        )
    
    async def send_message_notification(
        self,
        recipient_id: str,
        sender_name: str,
        message_preview: str,
        conversation_id: str
    ) -> Dict[str, Any]:
        """Send notification for new direct message"""
        return await self.send_notification(
            external_user_ids=[recipient_id],
            title=f"Message from {sender_name}",
            message=message_preview[:100],
            data={
                "type": "direct_message",
                "sender_name": sender_name,
                "conversation_id": conversation_id
            },
            url=f"/messages/{conversation_id}"
        )
    
    async def send_on_demand_accepted_notification(
        self,
        recipient_id: str,
        photographer_name: str,
        photographer_avatar: Optional[str],
        eta_minutes: int,
        dispatch_id: str,
        spot_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Send notification when photographer accepts on-demand request"""
        location_text = f" at {spot_name}" if spot_name else ""
        return await self.send_notification(
            external_user_ids=[recipient_id],
            title=f"{photographer_name} is on the way!",
            message=f"Your photographer accepted! ETA: ~{eta_minutes} min{location_text}. Get ready to shred!",
            data={
                "type": "on_demand_accepted",
                "dispatch_id": dispatch_id,
                "photographer_name": photographer_name,
                "photographer_avatar": photographer_avatar,
                "eta_minutes": eta_minutes,
                "sound": "arrival"  # Custom sound for urgency
            },
            url=f"/bookings?tab=on-demand&dispatch={dispatch_id}"
        )
    
    async def send_on_demand_arrived_notification(
        self,
        recipient_id: str,
        photographer_name: str,
        dispatch_id: str
    ) -> Dict[str, Any]:
        """Send notification when photographer arrives at location"""
        return await self.send_notification(
            external_user_ids=[recipient_id],
            title=f"{photographer_name} has arrived!",
            message="Your photographer is at the spot. Time to paddle out and catch some waves!",
            data={
                "type": "on_demand_arrived",
                "dispatch_id": dispatch_id,
                "photographer_name": photographer_name,
                "sound": "arrival"
            },
            url=f"/bookings?tab=on-demand&dispatch={dispatch_id}"
        )
    
    async def send_broadcast_notification(
        self,
        title: str,
        message: str,
        segment: str = "Subscribed Users",
        data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Send notification to a segment of users"""
        if not self.app_id or not self.api_key:
            return {"success": False, "error": "OneSignal not configured"}
        
        payload = {
            "app_id": self.app_id,
            "included_segments": [segment],
            "headings": {"en": title},
            "contents": {"en": message},
            "priority": 10
        }
        
        if data:
            payload["data"] = data
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.api_url,
                    json=payload,
                    headers=self.headers,
                    timeout=30.0
                )
                response.raise_for_status()
                return {"success": True, "notification_id": response.json().get("id")}
        except Exception as e:
            return {"success": False, "error": str(e)}


# Singleton instance
onesignal_service = OneSignalService()

"""
Mux Live Streaming Service
Handles real-time video broadcasting for Social Go Live feature
"""
import os
import mux_python
from mux_python.rest import ApiException
from typing import Optional, Dict, Any
import logging

logger = logging.getLogger(__name__)

# Load Mux credentials
MUX_TOKEN_ID = os.environ.get('MUX_TOKEN_ID')
MUX_TOKEN_SECRET = os.environ.get('MUX_TOKEN_SECRET')


class MuxLiveService:
    """Service for managing Mux live streams"""
    
    def __init__(self):
        """Initialize with Mux API client"""
        if not MUX_TOKEN_ID or not MUX_TOKEN_SECRET:
            logger.warning("Mux credentials not configured - live streaming disabled")
            self.configured = False
            return
        
        self.configured = True
        configuration = mux_python.Configuration()
        configuration.username = MUX_TOKEN_ID
        configuration.password = MUX_TOKEN_SECRET
        self.client = mux_python.ApiClient(configuration)
        self.live_stream_api = mux_python.LiveStreamsApi(self.client)
        logger.info("Mux Live Streaming service initialized")
    
    def create_live_stream(
        self,
        broadcaster_name: str = "Live Stream",
        latency_mode: str = "standard",  # "standard" (25-30s), "reduced" (12-20s), "low" (5s)
        reconnect_window: int = 60
    ) -> Dict[str, Any]:
        """
        Create a new live stream for real-time broadcasting.
        
        Args:
            broadcaster_name: Name of the broadcaster for metadata
            latency_mode: Latency setting - use "standard" for mobile broadcasting
            reconnect_window: Seconds to wait for encoder reconnection (0-1800)
        
        Returns:
            Dictionary with stream_key, playback_id, RTMP URLs, etc.
        """
        if not self.configured:
            return {"error": "Mux not configured", "configured": False}
        
        try:
            # Configure VOD creation after live stream ends
            new_asset_settings = mux_python.CreateAssetRequest(
                playback_policies=[mux_python.PlaybackPolicy.PUBLIC]
            )
            
            # Create live stream request
            create_request = mux_python.CreateLiveStreamRequest(
                playback_policies=[mux_python.PlaybackPolicy.PUBLIC],
                new_asset_settings=new_asset_settings,
                latency_mode=latency_mode,
                reconnect_window=reconnect_window
            )
            
            # Execute API request
            response = self.live_stream_api.create_live_stream(create_request)
            
            playback_id = response.data.playback_ids[0].id if response.data.playback_ids else None
            
            return {
                "success": True,
                "live_stream_id": response.data.id,
                "stream_key": response.data.stream_key,
                "playback_id": playback_id,
                "playback_url": f"https://stream.mux.com/{playback_id}.m3u8" if playback_id else None,
                "status": response.data.status,
                "rtmp_url": "rtmp://global-live.mux.com:5222/app",
                "rtmps_url": "rtmps://global-live.mux.com:443/app",
                "latency_mode": response.data.latency_mode,
                "reconnect_window": response.data.reconnect_window
            }
        except ApiException as e:
            logger.error(f"Failed to create Mux live stream: {e}")
            return {"success": False, "error": str(e)}
    
    def get_live_stream(self, live_stream_id: str) -> Dict[str, Any]:
        """
        Get current status and details of a live stream.
        
        Args:
            live_stream_id: Mux live stream ID
        
        Returns:
            Dictionary with stream status, playback info, etc.
        """
        if not self.configured:
            return {"error": "Mux not configured", "configured": False}
        
        try:
            response = self.live_stream_api.get_live_stream(live_stream_id)
            
            return {
                "success": True,
                "live_stream_id": response.data.id,
                "status": response.data.status,  # 'idle', 'active', 'disabled'
                "stream_key": response.data.stream_key,
                "playback_ids": [
                    {
                        "id": pb.id,
                        "policy": pb.policy
                    } for pb in response.data.playback_ids
                ],
                "active_asset_id": response.data.active_asset_id,
                "created_at": response.data.created_at,
                "latency_mode": response.data.latency_mode
            }
        except ApiException as e:
            logger.error(f"Failed to get Mux live stream: {e}")
            return {"success": False, "error": str(e)}
    
    def disable_live_stream(self, live_stream_id: str) -> Dict[str, Any]:
        """
        Disable/stop a live stream immediately.
        The broadcast ends and stream converts to VOD.
        
        Args:
            live_stream_id: Mux live stream ID
        
        Returns:
            Success status
        """
        if not self.configured:
            return {"error": "Mux not configured", "configured": False}
        
        try:
            self.live_stream_api.disable_live_stream(live_stream_id)
            return {"success": True, "message": "Live stream stopped"}
        except ApiException as e:
            logger.error(f"Failed to disable Mux live stream: {e}")
            return {"success": False, "error": str(e)}
    
    def delete_live_stream(self, live_stream_id: str) -> Dict[str, Any]:
        """
        Delete a live stream entirely.
        
        Args:
            live_stream_id: Mux live stream ID
        
        Returns:
            Success status
        """
        if not self.configured:
            return {"error": "Mux not configured", "configured": False}
        
        try:
            self.live_stream_api.delete_live_stream(live_stream_id)
            return {"success": True, "message": "Live stream deleted"}
        except ApiException as e:
            logger.error(f"Failed to delete Mux live stream: {e}")
            return {"success": False, "error": str(e)}
    
    def get_playback_url(self, playback_id: str) -> str:
        """Generate HLS playback URL from playback ID"""
        return f"https://stream.mux.com/{playback_id}.m3u8"
    
    def get_thumbnail_url(self, playback_id: str, time: float = 0) -> str:
        """Generate thumbnail URL for a stream/asset"""
        return f"https://image.mux.com/{playback_id}/thumbnail.png?time={time}"


# Singleton instance
mux_service = MuxLiveService()

/**
 * usePresence — Real-time online/offline presence tracking.
 * 
 * Connects to /ws/presence/{userId} and maintains a set of online user IDs.
 * Sends heartbeats every 30s to keep the user marked as online.
 * Receives user_online / user_offline events for real-time updates.
 * 
 * Usage:
 *   const { onlineUsers, isOnline } = usePresence(userId);
 *   if (isOnline(otherUserId)) { ... }
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import logger from '../utils/logger';

const WS_BASE = process.env.REACT_APP_BACKEND_URL?.replace('https://', 'wss://').replace('http://', 'ws://') || '';

export const usePresence = (userId) => {
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const wsRef = useRef(null);
  const heartbeatRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    if (!userId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = `${WS_BASE}/api/ws/presence/${userId}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.debug('[Presence] Connected');
        
        // Start heartbeat every 30s
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'heartbeat' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'presence_connected':
              // Initial online users list
              setOnlineUsers(new Set(data.online_users || []));
              logger.debug('[Presence] Initial online:', data.online_users?.length || 0, 'users');
              break;
              
            case 'user_online':
              setOnlineUsers(prev => {
                const next = new Set(prev);
                next.add(data.user_id);
                return next;
              });
              break;
              
            case 'user_offline':
              setOnlineUsers(prev => {
                const next = new Set(prev);
                next.delete(data.user_id);
                return next;
              });
              break;
              
            case 'online_users':
              // Full refresh of online users
              setOnlineUsers(new Set(data.users || []));
              break;
              
            case 'heartbeat_ack':
            case 'pong':
              // Expected, ignore
              break;
              
            default:
              break;
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        logger.debug('[Presence] Connection error');
      };

      ws.onclose = (event) => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        
        // Auto-reconnect after 5s (unless clean close)
        if (event.code !== 1000) {
          reconnectRef.current = setTimeout(connect, 5000);
        }
      };
    } catch (e) {
      logger.debug('[Presence] Failed to connect:', e);
    }
  }, [userId]);

  // Request fresh online list periodically (every 60s as backup)
  useEffect(() => {
    if (!userId) return;
    
    const pollInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'get_online' }));
      }
    }, 60000);

    return () => clearInterval(pollInterval);
  }, [userId]);

  useEffect(() => {
    connect();
    
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, [connect]);

  const isOnline = useCallback((targetUserId) => {
    return onlineUsers.has(targetUserId);
  }, [onlineUsers]);

  return { onlineUsers, isOnline };
};

export default usePresence;

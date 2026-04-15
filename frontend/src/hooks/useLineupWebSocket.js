/**
 * useLineupWebSocket - Real-time lineup updates hook
 * 
 * Connects to lineup WebSocket for real-time crew changes:
 * - crew_joined: New crew member joined
 * - crew_left: Crew member dropped out
 * - lineup_locked: Captain locked the lineup
 * - lineup_cancelled: Lineup was cancelled
 * - payment_received: Crew member paid their share
 * - lineup_status_changed: Session opened/closed
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { handleLineupNotification, processLineupWebSocketEvent } from '../services/LineupNotifications';
import logger from '../utils/logger';

const WS_BASE = process.env.REACT_APP_BACKEND_URL?.replace('https://', 'wss://').replace('http://', 'ws://');

export const useLineupWebSocket = (lineupId, userId, onUpdate) => {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    if (!lineupId || !userId || !WS_BASE) return;

    try {
      const wsUrl = `${WS_BASE}/api/ws/lineup/${lineupId}`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        reconnectAttempts.current = 0;
        logger.debug(`[LineupWS] Connected to lineup ${lineupId}`);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleLineupUpdate(message);
        } catch (e) {
          logger.error('[LineupWS] Error parsing message:', e);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        logger.debug(`[LineupWS] Disconnected from lineup ${lineupId}`);
        
        // Attempt reconnection
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current += 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      wsRef.current.onerror = (error) => {
        logger.error('[LineupWS] Error:', error);
      };
    } catch (e) {
      logger.error('[LineupWS] Connection error:', e);
    }
  }, [lineupId, userId]);

  const handleLineupUpdate = useCallback((message) => {
    if (message.type !== 'lineup_update') return;

    const { update_type, ...data } = message.data;

    // Process through the enhanced notification service
    const notificationEvent = processLineupWebSocketEvent(
      { type: mapUpdateTypeToEventType(update_type), data },
      userId
    );
    
    if (notificationEvent) {
      handleLineupNotification(notificationEvent.type, notificationEvent.data, {
        soundEnabled: true,
        pushEnabled: true
      });
    }

    // Call the update callback to refresh lineup data
    if (onUpdate) {
      onUpdate(message.data);
    }
  }, [onUpdate, userId]);

  // Map old update types to new event types
  const mapUpdateTypeToEventType = (updateType) => {
    const mapping = {
      'crew_joined': 'member_joined',
      'crew_left': 'member_left',
      'lineup_locked': 'lineup_status_changed',
      'lineup_cancelled': 'session_cancelled',
      'payment_received': 'payment_received',
      'status_changed': 'lineup_status_changed'
    };
    return mapping[updateType] || updateType;
  };

  // Ping to keep connection alive
  useEffect(() => {
    if (!isConnected || !wsRef.current) return;

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, [isConnected]);

  // Connect/disconnect based on lineupId
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected };
};


/**
 * useUserWebSocket - Personal user notifications hook
 * 
 * Receives personal notifications like:
 * - crew_dropout: A crew member left your lineup
 * - lineup_invite: You've been invited to a lineup
 * - status_changed: Session status changed
 */
export const useUserWebSocket = (userId, onNotification) => {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!userId || !WS_BASE) return;

    try {
      const wsUrl = `${WS_BASE}/api/ws/user/${userId}`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        logger.debug(`[UserWS] Connected for user ${userId}`);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'lineup_notification') {
            const { notification_type, ...data } = message.data;
            
            // Use enhanced notification service
            const notificationEvent = processLineupWebSocketEvent(
              { type: notification_type, data },
              userId
            );
            
            if (notificationEvent) {
              handleLineupNotification(notificationEvent.type, notificationEvent.data, {
                soundEnabled: true,
                pushEnabled: true
              });
            }
            
            if (onNotification) {
              onNotification(message.data);
            }
          }
        } catch (e) {
          logger.error('[UserWS] Error parsing message:', e);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
      };

      // Ping to keep alive
      const pingInterval = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send('ping');
        }
      }, 30000);

      return () => {
        clearInterval(pingInterval);
        if (wsRef.current) {
          wsRef.current.close();
        }
      };
    } catch (e) {
      logger.error('[UserWS] Connection error:', e);
    }
  }, [userId, onNotification]);

  return { isConnected };
};

export default useLineupWebSocket;

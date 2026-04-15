/**
 * useWebSocket - Real-time data sync hook
 * Connects to backend WebSocket endpoints for live updates
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import logger from '../utils/logger';

const WS_BASE = process.env.REACT_APP_BACKEND_URL?.replace('https://', 'wss://').replace('http://', 'ws://') || '';

export const useWebSocket = (room, userId = null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Build WebSocket URL
    let wsUrl = `${WS_BASE}/api/ws/${room}`;
    if (userId && room === 'earnings') {
      wsUrl = `${WS_BASE}/api/ws/earnings/${userId}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.debug(`[WS] Connected to ${room}`);
        setIsConnected(true);
        setError(null);

        // Start ping interval to keep connection alive
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type !== 'pong') {
            setLastMessage(data);
          }
        } catch (e) {
          logger.error('[WS] Failed to parse message:', e);
        }
      };

      ws.onerror = (event) => {
        logger.error(`[WS] Error on ${room}:`, event);
        setError('WebSocket connection error');
      };

      ws.onclose = (event) => {
        logger.debug(`[WS] Disconnected from ${room}:`, event.code);
        setIsConnected(false);
        
        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Auto-reconnect after 5 seconds (unless clean close)
        if (event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            logger.debug(`[WS] Attempting reconnect to ${room}...`);
            connect();
          }, 5000);
        }
      };
    } catch (e) {
      logger.error('[WS] Failed to create WebSocket:', e);
      setError('Failed to connect');
    }
  }, [room, userId]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close(1000);
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback((message) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof message === 'string' ? message : JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    error,
    sendMessage,
    reconnect: connect
  };
};

/**
 * useConditionsSync - Real-time conditions feed
 */
export const useConditionsSync = (onNewCondition) => {
  const { isConnected, lastMessage, error } = useWebSocket('conditions');

  useEffect(() => {
    // Match backend message type: 'new_condition_report'
    if (lastMessage?.type === 'new_condition_report' && onNewCondition) {
      onNewCondition(lastMessage.data);
    }
  }, [lastMessage, onNewCondition]);

  return { isConnected, error };
};

/**
 * useLiveStreamSync - Real-time live stream status
 */
export const useLiveStreamSync = (onLiveUpdate) => {
  const { isConnected, lastMessage, error } = useWebSocket('live');

  useEffect(() => {
    // Match backend message type: 'live_status_change'
    if (lastMessage?.type === 'live_status_change' && onLiveUpdate) {
      onLiveUpdate(lastMessage.data);
    }
  }, [lastMessage, onLiveUpdate]);

  return { isConnected, error };
};

/**
 * useEarningsSync - Real-time earnings updates for photographers
 */
export const useEarningsSync = (userId, onEarningsUpdate) => {
  const { isConnected, lastMessage, error } = useWebSocket('earnings', userId);

  useEffect(() => {
    if (lastMessage?.type === 'earnings_update' && onEarningsUpdate) {
      onEarningsUpdate(lastMessage.data);
    }
  }, [lastMessage, onEarningsUpdate]);

  return { isConnected, error };
};

/**
 * usePhotographerActivitySync - Real-time activity notifications for photographers
 * Receives events when surfers view, favorite, or purchase photos
 */
export const usePhotographerActivitySync = (photographerId, onActivity) => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    if (!photographerId) return;

    const wsUrl = `${WS_BASE}/api/ws/photographer/${photographerId}/activity`;
    
    const connect = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          logger.debug('[WS] Connected to photographer activity');
          setIsConnected(true);
          setError(null);
          
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('ping');
          }, 30000);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type !== 'pong' && data.type !== 'connected' && onActivity) {
              onActivity(data);
            }
          } catch (e) {
            logger.error('[WS] Parse error:', e);
          }
        };

        ws.onerror = () => setError('Connection error');
        
        ws.onclose = (event) => {
          setIsConnected(false);
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          if (event.code !== 1000) {
            reconnectTimeoutRef.current = setTimeout(connect, 5000);
          }
        };
      } catch (e) {
        setError('Failed to connect');
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (wsRef.current) wsRef.current.close(1000);
    };
  }, [photographerId, onActivity]);

  return { isConnected, error };
};

export default useWebSocket;

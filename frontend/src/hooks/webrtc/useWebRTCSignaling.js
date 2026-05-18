/**
 * useWebRTCSignaling WebSocket signaling layer for WebRTC calls.
 *
 * Handles:
 *   - WebSocket connection lifecycle (connect, reconnect, keepalive)
 *   - Sending signaling messages (SDP offers/answers, ICE candidates)
 *   - Dispatching incoming signaling messages to the call handler
 */

import { useRef, useCallback, useEffect } from 'react';
import { BACKEND_URL } from '../../lib/apiClient';
import { logger } from '../../utils/logger';

/**
 * useWebRTCSignaling Manages the signaling WebSocket for WebRTC calls.
 *
 * @param {string} userId - Current user's ID
 * @param {Function} onMessage - Callback for incoming signaling messages
 * @returns {{ sendSignaling, wsRef, connectSignaling }}
 */
export function useWebRTCSignaling(userId, onMessage) {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const keepaliveRef = useRef(null);
  const pendingMessagesRef = useRef([]);
  const onMessageRef = useRef(onMessage);

  // Keep the message handler ref up to date
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

 // WebSocket Connection 
  const connectSignaling = useCallback(() => {
    if (!userId) return;
    
    // Don't reconnect if already open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    
    // Force-close stale connections stuck in CONNECTING state
    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
      try { wsRef.current.close(); } catch (e) { /* ignore */ }
      wsRef.current = null;
    }
    
    // Build WS URL from backend URL
    // NOTE: WebSocket routes are under /api prefix (api_router in __init__.py)
    const wsProtocol = BACKEND_URL.startsWith('https') ? 'wss' : 'ws';
    const wsHost = BACKEND_URL.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}://${wsHost}/api/ws/call/${userId}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.debug('[WebRTC] \u{2705} Signaling WS connected to:', wsUrl);
        // Reset reconnect backoff on success
        reconnectAttemptsRef.current = 0;
        // Flush any pending messages
        if (pendingMessagesRef.current.length > 0) {
          pendingMessagesRef.current.forEach(c => {
            ws.send(JSON.stringify(c));
          });
          pendingMessagesRef.current = [];
        }
        // Start keepalive ping every 20s (Render.com drops idle WS at ~60s)
        if (keepaliveRef.current) clearInterval(keepaliveRef.current);
        keepaliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 20000);
      };

 // Connection timeout if WS hasn't opened in 8s, force close to trigger reconnect
      setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.warn('[WebRTC] Signaling WS connection timeout (8s) \u{2014} forcing close');
          try { ws.close(); } catch (e) { /* ignore */ }
        }
      }, 8000);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch (e) {
          // Ignore pong responses and parse errors for non-JSON
          if (event.data !== '{"type":"pong"}') {
            console.error('[WebRTC] Failed to parse signaling message:', e);
          }
        }
      };

      ws.onclose = () => {
        console.debug('[WebRTC] Signaling WS closed');
        if (keepaliveRef.current) clearInterval(keepaliveRef.current);
 // ALWAYS reconnect the receiver must stay connected to receive incoming calls
        const attempts = reconnectAttemptsRef.current || 0;
 const delay = Math.min(2000 * Math.pow(1.5, attempts), 30000); // 2s 3s 4.5s ... max 30s
        reconnectAttemptsRef.current = attempts + 1;
        console.debug(`[WebRTC] Reconnecting in ${delay}ms (attempt ${attempts + 1})`);
        reconnectTimerRef.current = setTimeout(() => connectSignaling(), delay);
      };

      ws.onerror = (err) => {
        console.error('[WebRTC] Signaling WS error:', err);
      };
    } catch (e) {
      console.error('[WebRTC] Failed to connect signaling:', e);
    }
  }, [userId]);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    connectSignaling();
    return () => {
      // Prevent reconnect on unmount
      clearTimeout(reconnectTimerRef.current);
      clearInterval(keepaliveRef.current);
      reconnectAttemptsRef.current = 999; // prevent further reconnects
      wsRef.current?.close();
    };
  }, [connectSignaling]);

 // Send Signaling Message 
  const sendSignaling = useCallback((message) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      // Queue if WS not ready
      pendingMessagesRef.current.push(message);
    }
  }, []);

  return {
    wsRef,
    sendSignaling,
    connectSignaling,
  };
}

import { useState, useEffect, useRef } from 'react';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { supabaseAdminClient } from '../services/supabaseAdminClient';

export const useEvents = () => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/events');
      if (res.data?.success) {
        setEvents(res.data.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch events:', err);
      setError(err.message || 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();

    // ─── Realtime Subscription Strategy ────────────────────────────────────
    // 1. Try WebSocket first (fast, direct backend event spine stream)
    const wsUrl = `${BACKEND_URL.replace(/^http/, 'ws')}/ws/admin/events`;
    
    const connectWS = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event_id && data.event_type) {
              // Add to the top of the list in real-time
              setEvents((prev) => {
                // Prevent duplicate events
                if (prev.some((e) => e.event_id === data.event_id)) return prev;
                return [data, ...prev];
              });
            }
          } catch (e) {
            // Ignore non-json or ping-pong
          }
        };

        ws.onclose = () => {
          // Retry connection after 5 seconds if closed
          setTimeout(connectWS, 5000);
        };
      } catch (err) {
        console.warn('WS Admin Connection failed, falling back to Supabase', err);
      }
    };

    connectWS();

    // 2. Supabase Realtime Fallback
    const subscription = supabaseAdminClient.subscribeToTable('event_log', (payload) => {
      if (payload.new) {
        const newEvent = {
          event_id: payload.new.event_id,
          event_type: payload.new.event_type,
          timestamp: payload.new.timestamp,
          payload: typeof payload.new.payload === 'string' ? JSON.parse(payload.new.payload) : payload.new.payload,
          user_id: payload.new.user_id,
          source_mcp: payload.new.source_mcp,
          correlation_id: payload.new.correlation_id,
          propagation_latency_ms: payload.new.propagation_latency_ms || 2.5
        };

        setEvents((prev) => {
          if (prev.some((e) => e.event_id === newEvent.event_id)) return prev;
          return [newEvent, ...prev];
        });
      }
    });

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      if (subscription) {
        supabaseAdminClient.unsubscribe(subscription);
      }
    };
  }, []);

  return { events, loading, error, refresh: fetchEvents };
};

export default useEvents;

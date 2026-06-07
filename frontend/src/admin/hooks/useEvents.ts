import { useState, useEffect, useRef } from 'react';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { supabaseAdmin } from '../lib/supabase';

export interface SystemEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  payload: any;
  user_id?: string;
  source_mcp?: string;
  correlation_id?: string;
  propagation_latency_ms?: number;
  source_service?: string;
}

export const useEvents = () => {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/events');
      if (res.data?.success) {
        setEvents(res.data.events || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch events:', err);
      setError(err.message || 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();

    const wsUrl = `${BACKEND_URL.replace(/^http/, 'ws')}/api/ws/admin/events`;
    
    const connectWS = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event_id && data.event_type) {
              setEvents((prev) => {
                if (prev.some((e) => e.event_id === data.event_id)) return prev;
                return [data, ...prev];
              });
            }
          } catch (e) {
            // Ignore ping-pong or invalid JSON
          }
        };

        ws.onclose = () => {
          setTimeout(connectWS, 5000);
        };
      } catch (err) {
        console.warn('WS connection failed, falling back to Supabase', err);
      }
    };

    connectWS();

    const subscription = supabaseAdmin.subscribeTable('event_log', (payload) => {
      if (payload.new) {
        const newEvent: SystemEvent = {
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
        supabaseAdmin.unsubscribeTable(subscription);
      }
    };
  }, []);

  return { events, loading, error, refresh: fetchEvents };
};

export default useEvents;

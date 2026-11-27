import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const emptyCounts = () => ({ official: 0, primary: 0, requests: 0, hidden: 0 });
const initialState = token => ({ token, conversations: [], folderCounts: emptyCounts(), loading: true, error: null });

// Only GET/list state lives here. Message mutations and detail/realtime state stay in their existing owners.
export default function useConversationList({ userId, activeFolder, ownerKey }) {
  const scope = JSON.stringify([userId, ownerKey, activeFolder]);
  const token = useMemo(() => ({ scope }), [scope]);
  const current = useRef(null);
  const request = useRef(null);
  const [state, setState] = useState(() => initialState(token));
  // A new identity/persona/folder must never render the previous scope, even before effects run.
  const visible = state.token === token ? state : initialState(token);

  // Speculative/suspended renders must not invalidate the still-committed inbox.
  // Commit the scope before passive fetch effects; cleanup rejects old work on switch/unmount.
  useLayoutEffect(() => {
    current.current = token;
    return () => {
      current.current = null;
      request.current?.abort();
    };
  }, [token]);

  const setConversations = useCallback(value => {
    if (current.current !== token) return;
    setState(prev => {
      const next = prev.token === token ? prev : initialState(token);
      return { ...next, conversations: typeof value === 'function' ? value(next.conversations) : value };
    });
  }, [token]);
  const setFolderCounts = useCallback(value => {
    if (current.current !== token) return;
    setState(prev => {
      const next = prev.token === token ? prev : initialState(token);
      return { ...next, folderCounts: typeof value === 'function' ? value(next.folderCounts) : value };
    });
  }, [token]);

  const fetchConversations = useCallback(async () => {
    if (!userId || current.current !== token) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const isCurrent = () => current.current === token && request.current === controller && !controller.signal.aborted;
    setState(prev => ({ ...(prev.token === token ? prev : initialState(token)), loading: true }));
    try {
      const path = activeFolder === 'family'
        ? `/messages/conversations/${userId}/family`
        : `/messages/conversations/${userId}?inbox_type=${activeFolder === 'grom_zone' ? 'primary&grom_zone=true' : activeFolder}`;
      const [response, countsResp, familyCountResp] = await Promise.all([
        apiClient.get(path, { signal: controller.signal }),
        apiClient.get(`/messages/unread-counts/${userId}`, { signal: controller.signal }).catch(() => ({ data: {} })),
        apiClient.get(`/messages/conversations/${userId}/family`, { signal: controller.signal }).catch(() => ({ data: [] })),
      ]);
      if (!isCurrent()) return;
      const list = response.data;
      if (!Array.isArray(list) || list.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error('Invalid conversation list response');
      }
      const unread = countsResp.data || {};
      const family = Array.isArray(familyCountResp.data) ? familyCountResp.data : [];
      setState({ token, conversations: list, loading: false, error: null, folderCounts: {
        primary: unread.primary || 0, requests: unread.requests || 0, grom_zone: unread.grom_zone || 0,
        family: family.filter(c => c?.unread_count > 0).length,
        pro_lounge: activeFolder === 'pro_lounge' ? list.filter(c => c.unread_count > 0).length : 0,
        channel: activeFolder === 'channel' ? list.filter(c => c.unread_count > 0).length : 0, hidden: 0,
      } });
    } catch (error) {
      if (!isCurrent()) return;
      logger.error('Failed to fetch conversations:', error);
      const clear = [401, 403, 404].includes(error?.response?.status);
      setState(prev => ({ ...(clear || prev.token !== token ? initialState(token) : prev),
        loading: false, error: 'Could not load conversations. Please try again.',
      }));
    } finally {
      if (isCurrent()) setState(prev => ({ ...prev, loading: false }));
    }
  }, [userId, activeFolder, token]);

  return { ...visible, setConversations, setFolderCounts, fetchConversations };
}

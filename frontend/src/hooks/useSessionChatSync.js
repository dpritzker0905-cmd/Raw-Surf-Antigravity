/**
 * useSessionChatSync.js
 *
 * Lightweight background sync hook for on-demand session chat.
 * Runs OUTSIDE the SessionChatDrawer so unread counts, latest message
 * previews, and notification alerts update even when the drawer is closed.
 *
 * Architecture:
 * - Uses the existing check-thread → conversation poll pattern
 * - Polls every 5s (aligned with dispatch polling cadence)
 * - Fires toast + audio when a new message arrives while the drawer is closed
 * - Exposes { unreadCount, latestMessage, conversationId } for inline UI
 * - Skips polling when the drawer IS open (the drawer handles its own poll)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const POLL_INTERVAL = 5000; // 5 seconds

export const useSessionChatSync = ({
  userId,
  otherUserId,
  otherUserName,
  drawerOpen = false,
  enabled = true,
}) => {
  const [conversationId, setConversationId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestMessage, setLatestMessage] = useState(null);

  // Refs for notification dedup
  const lastSeenMsgIdRef = useRef(null);
  const pollRef = useRef(null);
  const initDoneRef = useRef(false);
  const audioRef = useRef(null);

  // ============ INIT: Find the conversation ============
  const initConversation = useCallback(async () => {
    if (!userId || !otherUserId) return;
    try {
      const res = await apiClient.get(
        `/messages/check-thread/${userId}/${otherUserId}`
      );
      if (res.data.exists && res.data.conversation_id) {
        setConversationId(res.data.conversation_id);
      }
      initDoneRef.current = true;
    } catch (err) {
      logger.debug('[SessionChatSync] Init error:', err);
    }
  }, [userId, otherUserId]);

  useEffect(() => {
    if (enabled && userId && otherUserId) {
      initConversation();
    }
  }, [enabled, userId, otherUserId, initConversation]);

  // ============ BACKGROUND POLL ============
  useEffect(() => {
    // Don't poll if: disabled, no conversation, drawer is open (drawer polls itself),
    // or missing user IDs
    if (!enabled || !conversationId || !userId || drawerOpen) {
      clearInterval(pollRef.current);
      return;
    }

    const pollForNewMessages = async () => {
      // Skip when browser tab is hidden (save bandwidth)
      if (document.visibilityState === 'hidden') return;

      try {
        const res = await apiClient.get(
          `/messages/conversation/${conversationId}`
        );
        const messages = res.data.messages || [];

        // Calculate unread (messages from the other person that haven't been read)
        const unread = messages.filter(
          m => !m.is_read && m.sender_id !== userId
        );
        setUnreadCount(unread.length);

        // Track the absolute latest message (from either side) for inline preview
        const absoluteLatest = messages.length > 0 ? messages[messages.length - 1] : null;
        if (absoluteLatest) {
          setLatestMessage(absoluteLatest);
        }

        // Get latest message from the other user (for notifications only)
        const fromOther = messages.filter(m => m.sender_id !== userId);
        const latestFromOther = fromOther.length > 0 ? fromOther[fromOther.length - 1] : null;

        if (latestFromOther) {
          // Fire notification if this is a NEW message we haven't seen
          if (
            latestFromOther.id !== lastSeenMsgIdRef.current &&
            lastSeenMsgIdRef.current !== null // Don't fire on first load
          ) {
            // Toast notification
            const preview = latestFromOther.message_type === 'voice_note'
              ? '🎤 Voice note'
              : (latestFromOther.content?.slice(0, 60) || '📎 Media');

            toast.info(`${otherUserName || 'Session'}: ${preview}`, {
              id: `session-msg-${latestFromOther.id}`,
              duration: 4000,
              icon: '💬',
            });

            // Audio alert
            try {
              if (!audioRef.current) {
                audioRef.current = new Audio('/sounds/notification.mp3');
                audioRef.current.volume = 0.3;
              }
              audioRef.current.currentTime = 0;
              audioRef.current.play().catch(() => {});
            } catch (_) { /* audio play failures are non-critical */ }
          }

          lastSeenMsgIdRef.current = latestFromOther.id;
        }
      } catch (err) {
        logger.debug('[SessionChatSync] Poll error:', err);
      }
    };

    // Immediate first poll
    pollForNewMessages();

    pollRef.current = setInterval(pollForNewMessages, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [enabled, conversationId, userId, drawerOpen, otherUserName]);

  // When drawer opens + closes, re-check for updates
  useEffect(() => {
    if (!drawerOpen && conversationId && userId) {
      // Drawer just closed — re-sync to pick up any read receipts
      const resync = async () => {
        try {
          const res = await apiClient.get(
            `/messages/conversation/${conversationId}`
          );
          const messages = res.data.messages || [];
          const unread = messages.filter(
            m => !m.is_read && m.sender_id !== userId
          );
          setUnreadCount(unread.length);

          const fromOther = messages.filter(m => m.sender_id !== userId);
          const latest = fromOther.length > 0 ? fromOther[fromOther.length - 1] : null;
          if (latest) {
            setLatestMessage(latest);
            lastSeenMsgIdRef.current = latest.id;
          }
        } catch (_) { /* resync failures are non-critical */ }
      };
      // Small delay so the drawer's final mark-read call completes
      const t = setTimeout(resync, 500);
      return () => clearTimeout(t);
    }
  }, [drawerOpen, conversationId, userId]);

  return {
    unreadCount,
    latestMessage,
    conversationId,
  };
};

export default useSessionChatSync;

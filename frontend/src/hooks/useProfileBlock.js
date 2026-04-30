import { useState } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';

/**
 * Manages block/unblock state and API interactions for a profile.
 * Extracted from Profile.js to reduce god-component complexity.
 *
 * @param {string|null} currentUserId - The authenticated user's ID
 * @param {string|null} profileUserId - The profile being viewed
 * @param {boolean} isOwnProfile - Whether viewing own profile
 * @param {Object} callbacks - Optional callbacks for side-effects
 * @param {Function} callbacks.onBlocked - Called after successfully blocking (to update follow state)
 */
export function useProfileBlock(currentUserId, profileUserId, isOwnProfile, callbacks = {}) {
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockedByThem, setIsBlockedByThem] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [blockNotes, setBlockNotes] = useState('');
  const [blockLoading, setBlockLoading] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const checkBlockStatus = async () => {
    if (!currentUserId || !profileUserId || isOwnProfile) return;
    try {
      const response = await apiClient.get(`/users/${currentUserId}/is-blocked/${profileUserId}`);
      setIsBlocked(response.data.user_blocked_other);
      setIsBlockedByThem(response.data.other_blocked_user);
    } catch (error) {
      logger.error('Error checking block status:', error);
    }
  };

  const handleBlockUser = async (profileName) => {
    if (!currentUserId || !profileUserId) return;

    setBlockLoading(true);
    try {
      await apiClient.post(`/users/block`, {
        blocker_id: currentUserId,
        blocked_id: profileUserId,
        reason: blockReason || null,
        notes: blockNotes || null,
        auto_report: blockReason === 'harassment' || blockReason === 'scam'
      });

      setIsBlocked(true);
      setShowBlockModal(false);
      setBlockReason('');
      setBlockNotes('');
      toast.success(`${profileName || 'User'} has been blocked`);

      // Notify parent that block happened (for follow state cleanup)
      callbacks.onBlocked?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to block user');
    } finally {
      setBlockLoading(false);
    }
  };

  const handleUnblockUser = async (profileName) => {
    if (!currentUserId || !profileUserId) return;

    setBlockLoading(true);
    try {
      await apiClient.post(`/users/unblock`, {
        blocker_id: currentUserId,
        blocked_id: profileUserId
      });

      setIsBlocked(false);
      toast.success(`${profileName || 'User'} has been unblocked`);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to unblock user');
    } finally {
      setBlockLoading(false);
    }
  };

  return {
    isBlocked,
    isBlockedByThem,
    showBlockModal, setShowBlockModal,
    blockReason, setBlockReason,
    blockNotes, setBlockNotes,
    blockLoading,
    showMoreMenu, setShowMoreMenu,
    checkBlockStatus,
    handleBlockUser,
    handleUnblockUser,
  };
}

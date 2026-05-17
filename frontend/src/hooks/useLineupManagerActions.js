/**
 * useLineupManagerActions.js
 * Extracted from LineupManagerDrawer.js GÇö handler logic for lineup management.
 * 
 * Extraction checklist (v30): All 9 steps verified.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useLineupManagerActions = ({
  lineup,
  user,
  onRefresh,
  onClose,
  showLockConfirm,
  showCancelConfirm,
  setLoading,
  setInviting,
  setSearchQuery,
  setSearchResults,
  setShowLockConfirm,
  setShowCancelConfirm,
}) => {

  const handleInvite = async (targetUser) => {
    setInviting(targetUser.user_id);
    try {
      await apiClient.post(
        `/bookings/${lineup.id}/invite-by-handle`,
        { handle_query: targetUser.username || targetUser.full_name }
      );
      const displayName = targetUser.username ? `@${targetUser.username}` : targetUser.full_name;
      toast.success(`Invite sent to ${displayName}!`);
      setSearchQuery('');
      setSearchResults([]);
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to send invite');
    } finally {
      setInviting(null);
    }
  };

  const handleInviteAll = async (users) => {
    setInviting('all');
    let successCount = 0;
    
    for (const targetUser of users) {
      try {
        await apiClient.post(
          `/bookings/${lineup.id}/invite-by-handle`,
          { handle_query: targetUser.username || targetUser.full_name }
        );
        successCount++;
      } catch (error) {
        logger.error(`Failed to invite ${targetUser.full_name}:`, error);
      }
    }
    
    if (successCount > 0) {
      toast.success(`Sent ${successCount} invite${successCount > 1 ? 's' : ''}!`);
      onRefresh?.();
    } else {
      toast.error('Failed to send invites');
    }
    
    setInviting(null);
  };

  const handleLockLineup = async () => {
    if (!showLockConfirm) { setShowLockConfirm(true); return; }
    setShowLockConfirm(false);
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/lock`);
      toast.success('Lineup locked! Payment requests sent to crew.');
      onRefresh?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to lock lineup');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseToInvites = async () => {
    if (!window.confirm('Close this lineup to new members? Current crew will keep their spots.')) return;
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/close`);
      toast.success('Lineup closed to new members');
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to close lineup');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelAll = async () => {
    if (!showCancelConfirm) { setShowCancelConfirm(true); return; }
    setShowCancelConfirm(false);
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/cancel`, {
        reason: 'Cancelled by captain'
      });
      toast.success('Session cancelled. All participants have been notified.');
      onRefresh?.();
      onClose();
    } catch (error) {
      const errorMessage = error.response?.data?.detail || 'Failed to cancel session';
      const displayMessage = typeof errorMessage === 'object'
        ? (Array.isArray(errorMessage) ? errorMessage[0]?.msg : errorMessage.msg || 'Failed to cancel session')
        : errorMessage;
      toast.error(displayMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveCrewMember = async (memberId, memberName) => {
    if (!window.confirm(`Remove ${memberName} from this lineup? They will be notified.`)) return;
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/remove-member`, {
        member_id: memberId
      });
      toast.success(`${memberName} removed from lineup. Spot is now open.`);
      onRefresh?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to remove crew member');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveLineup = async () => {
    if (!window.confirm('Leave this lineup? Your spot will open for someone else.')) return;
    setLoading(true);
    try {
      await apiClient.post(`/bookings/${lineup.id}/lineup/leave`);
      toast.success('You left the lineup. The captain has been notified.');
      onRefresh?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to leave lineup');
    } finally {
      setLoading(false);
    }
  };

  const copyInviteCode = () => {
    if (lineup?.invite_code) {
      navigator.clipboard.writeText(lineup.invite_code);
      toast.success('Invite code copied!');
    }
  };

  return {
    handleInvite,
    handleInviteAll,
    handleLockLineup,
    handleCloseToInvites,
    handleCancelAll,
    handleRemoveCrewMember,
    handleLeaveLineup,
    copyInviteCode,
  };
};

export default useLineupManagerActions;

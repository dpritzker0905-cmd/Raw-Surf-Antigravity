import { useState } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';

/**
 * Manages Instagram-style Notes (24-hour ephemeral status messages).
 * Extracted from Profile.js to reduce god-component complexity.
 *
 * @param {string|null} profileUserId - The profile being viewed
 * @param {string|null} viewerId - The current authenticated user's ID
 */
export function useProfileNotes(profileUserId, viewerId) {
  const [userNote, setUserNote] = useState(null);
  const [isMutualFollower, setIsMutualFollower] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  const fetchUserNote = async () => {
    if (!profileUserId || !viewerId) return;
    try {
      const response = await apiClient.get(`/notes/user/${profileUserId}?viewer_id=${viewerId}`);
      setUserNote(response.data.note);
      setIsMutualFollower(response.data.is_mutual_follower);
    } catch (error) {
      logger.error('Error fetching user note:', error);
      setUserNote(null);
    }
  };

  const handleCreateNote = async () => {
    if (!noteText.trim() || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await apiClient.post(`/notes/create`, { content: noteText.trim() });
      toast.success('Note shared with mutual followers!');
      setShowNoteModal(false);
      setNoteText('');
      fetchUserNote();
    } catch (error) {
      toast.error('Failed to share note');
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleDeleteNote = async () => {
    try {
      await apiClient.delete(`/notes/delete`);
      setUserNote(null);
      setShowNoteModal(false);
      toast.success('Note deleted');
    } catch (error) {
      toast.error('Failed to delete note');
    }
  };

  return {
    userNote,
    isMutualFollower,
    showNoteModal, setShowNoteModal,
    noteText, setNoteText,
    noteSubmitting,
    fetchUserNote,
    handleCreateNote,
    handleDeleteNote,
  };
}

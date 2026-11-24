import { useLayoutEffect, useRef, useState } from 'react';
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
  const [noteReadStatus, setNoteReadStatus] = useState('loading');
  const [userNote, setUserNote] = useState(null);
  const [isMutualFollower, setIsMutualFollower] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  const activeVisit = useRef(null);

  // A return to the same profile is a new visit, even for the same viewer.
  useLayoutEffect(() => {
    activeVisit.current = { latestRead: 0 };
    setNoteReadStatus('loading');
    setUserNote(null);
    setIsMutualFollower(false);
    setShowNoteModal(false);
    setNoteText('');
    setNoteSubmitting(false);
    return () => { activeVisit.current = null; };
  }, [profileUserId, viewerId]);

  const fetchUserNote = async () => {
    const visit = activeVisit.current;
    if (!visit || !profileUserId || !viewerId) return;
    const read = ++visit.latestRead;
    setNoteReadStatus('loading');
    const isCurrent = () => activeVisit.current === visit && read === visit.latestRead;
    try {
      const response = await apiClient.get(`/notes/user/${profileUserId}?viewer_id=${viewerId}`);
      if (!isCurrent()) return;
      const { note, is_mutual_follower: mutual } = response.data ?? {};
      if (typeof mutual !== 'boolean' || (note !== null && typeof note?.content !== 'string')) {
        throw new Error('Invalid profile note response');
      }
      setUserNote(note);
      setIsMutualFollower(mutual);
      setNoteReadStatus('ready');
    } catch (error) {
      if (!isCurrent()) return;
      logger.error('Error fetching user note:', error);
      setNoteReadStatus('error');
      setUserNote(null);
      setIsMutualFollower(false);
    }
  };

  const canCreateNote = Boolean(viewerId) && viewerId === profileUserId &&
    noteReadStatus === 'ready' && userNote === null && isMutualFollower;

  const handleCreateNote = async () => {
    const visit = activeVisit.current;
    if (!visit || !canCreateNote || !noteText.trim() || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await apiClient.post(`/notes/create`, { content: noteText.trim() });
      if (activeVisit.current !== visit) return;
      toast.success('Note shared with mutual followers!');
      setShowNoteModal(false);
      setNoteText('');
      fetchUserNote();
    } catch (error) {
      if (activeVisit.current === visit) toast.error('Failed to share note');
    } finally {
      if (activeVisit.current === visit) setNoteSubmitting(false);
    }
  };

  const handleDeleteNote = async () => {
    const visit = activeVisit.current;
    if (!visit) return;
    try {
      await apiClient.delete(`/notes/delete`);
      if (activeVisit.current !== visit) return;
      visit.latestRead += 1;
      setNoteReadStatus('ready');
      setUserNote(null);
      setShowNoteModal(false);
      toast.success('Note deleted');
    } catch (error) {
      if (activeVisit.current === visit) toast.error('Failed to delete note');
    }
  };

  return {
    userNote, canCreateNote, noteReadStatus,
    isMutualFollower,
    showNoteModal, setShowNoteModal,
    noteText, setNoteText,
    noteSubmitting,
    fetchUserNote,
    handleCreateNote,
    handleDeleteNote,
  };
}

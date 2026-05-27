import { useState, useEffect, useCallback } from 'react';
import apiClient from '../lib/apiClient';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import logger from '../utils/logger';

/**
 * useStoriesActions Extracted handler logic from Stories.js (StoriesBar component)
 * Handles: story fetching, realtime subscription, live stream joining, location, tab management
 */
export default function useStoriesActions({
  user,
  selectedTier,
  onTierChange,
}) {
  const [stories, setStories] = useState({ photographer_stories: [], surfer_stories: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(selectedTier || 'all');
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const [viewerLocation, setViewerLocation] = useState(null);
  const [newStoryNotification, setNewStoryNotification] = useState(null);

  // Live Stream Viewer state
  const [liveStreamInfo, setLiveStreamInfo] = useState(null);
  const [showLiveViewer, setShowLiveViewer] = useState(false);
  const [connectingToStream, setConnectingToStream] = useState(null);

  // Sync with external tier selection
  useEffect(() => {
    if (selectedTier && selectedTier !== activeTab) {
      setActiveTab(selectedTier);
    }
  }, [selectedTier]);

  // Handle tab change and notify parent
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    if (onTierChange) {
      onTierChange(tab);
    }
  }, [onTierChange]);

  const getViewerLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setViewerLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => logger.debug('Location access denied')
      );
    }
  }, []);

  const fetchStories = useCallback(async () => {
    if (!user?.id) return;
    try {
      const params = new URLSearchParams({ viewer_id: user.id });
      if (viewerLocation) {
        params.append('viewer_lat', viewerLocation.lat);
        params.append('viewer_lon', viewerLocation.lon);
      }

      const response = await apiClient.get(`/stories/feed?${params}`);
      setStories(response.data);
    } catch (error) {
      logger.error('Error fetching stories:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id, viewerLocation]);

  // Initial fetch and location
  useEffect(() => {
    if (user?.id) {
      fetchStories();
      getViewerLocation();
    }
  }, [user?.id, fetchStories, getViewerLocation]);

  // Supabase Realtime subscription for new stories
  useEffect(() => {
    if (!user?.id || !supabase) return;

    const channel = supabase
      .channel('stories-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'stories'
        },
        (payload) => {
          logger.debug('[Stories Realtime] New story:', payload.new);

          if (payload.new.author_id === user.id) {
            fetchStories();
            return;
          }

          const isPhotographer = ['Photographer', 'Approved Pro', 'Hobbyist'].includes(payload.new.author_role);
          const icon = isPhotographer ? String.fromCodePoint(0x1F4F8) : String.fromCodePoint(0x1F3C4);

          setNewStoryNotification(payload.new);
          toast(`${icon} New story!`, {
            description: `${payload.new.author_name || 'Someone'} just posted a new story`,
            action: {
              label: 'View',
              onClick: async () => {
                setNewStoryNotification(null);
                try {
                  const streamsRes = await apiClient.get('/livekit/active-streams');
                  const liveStream = streamsRes.data.streams?.find(
                    s => s.broadcaster_id === payload.new.author_id
                  );
                  if (liveStream) {
                    setLiveStreamInfo({
                      id: liveStream.id,
                      room_name: liveStream.room_name,
                      broadcaster_id: liveStream.broadcaster_id,
                      broadcaster_name: liveStream.broadcaster_name || payload.new.author_name,
                      broadcaster_username: liveStream.broadcaster_username,
                      broadcaster_avatar: liveStream.broadcaster_avatar,
                      viewer_count: liveStream.viewer_count,
                      title: liveStream.title
                    });
                    setShowLiveViewer(true);
                    return;
                  }
                } catch {
                  // Fall through to normal refresh
                }
                fetchStories();
              }
            }
          });

          setTimeout(() => {
            fetchStories();
            setNewStoryNotification(null);
          }, 2000);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'stories'
        },
        (payload) => {
          logger.debug('[Stories Realtime] Story deleted:', payload.old);
          fetchStories();
        }
      )
      .subscribe((status) => {
        logger.debug('[Stories Realtime] Subscription status:', status);
      });

    return () => {
      logger.debug('[Stories Realtime] Cleaning up subscription');
      if (supabase) supabase.removeChannel(channel);
    };
  }, [user?.id, fetchStories]);

  // Compute display stories with sort priority
  const getDisplayStories = useCallback(() => {
    let storyList = [];
    if (activeTab === 'photographers') storyList = stories.photographer_stories || [];
    else if (activeTab === 'surfers') storyList = stories.surfer_stories || [];
    else storyList = stories.all || [];

    return [...storyList].sort((a, b) => {
      if (a.is_live && !b.is_live) return -1;
      if (!a.is_live && b.is_live) return 1;
      if (a.has_unviewed && !b.has_unviewed) return -1;
      if (!a.has_unviewed && b.has_unviewed) return 1;
      return 0;
    });
  }, [activeTab, stories]);

  const displayStories = getDisplayStories();

  // Handle story circle click
  const handleStoryCircleClick = useCallback(async (authorGroup) => {
    if (authorGroup.is_live) {
      setConnectingToStream(authorGroup.author_id);

      try {
        const response = await apiClient.get(`/livekit/active-streams`);
        const liveStream = response.data.streams?.find(
          s => s.broadcaster_id === authorGroup.author_id
        );

        if (liveStream) {
          setLiveStreamInfo({
            id: liveStream.id,
            room_name: liveStream.room_name,
            broadcaster_id: liveStream.broadcaster_id,
            broadcaster_name: liveStream.broadcaster_name || authorGroup.author_name,
            broadcaster_username: liveStream.broadcaster_username || authorGroup.author_username,
            broadcaster_avatar: liveStream.broadcaster_avatar || authorGroup.author_avatar,
            viewer_count: liveStream.viewer_count,
            title: liveStream.title
          });
          setShowLiveViewer(true);
        } else {
          toast.error('Stream is no longer live');
          fetchStories();
        }
      } catch (error) {
        logger.error('Failed to get live stream info:', error);
        toast.error('Failed to join stream');
      } finally {
        setConnectingToStream(null);
      }
    } else {
      setSelectedAuthor(authorGroup);
    }
  }, [fetchStories]);

  return {
    stories,
    loading,
    activeTab,
    selectedAuthor,
    setSelectedAuthor,
    viewerLocation,
    newStoryNotification,
    setNewStoryNotification,
    liveStreamInfo,
    setLiveStreamInfo,
    showLiveViewer,
    setShowLiveViewer,
    connectingToStream,
    displayStories,
    handleTabChange,
    handleStoryCircleClick,
    fetchStories,
  };
}

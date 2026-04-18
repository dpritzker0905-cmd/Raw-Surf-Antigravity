import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { X, ChevronLeft, ChevronRight, MapPin, Play, Pause, Camera, Waves, Plus, Loader2, Image, Video, Bell } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import LiveStreamViewer from './LiveStreamViewer';
import { getFullUrl } from '../utils/media';
import logger from '../utils/logger';


// Story ring colors - Ring System
// RED Ring: Active Social 'GO LIVE' broadcasts - Always at front
const LIVE_RING = 'bg-gradient-to-r from-red-500 via-red-600 to-red-500 animate-pulse';
// BLUE Ring: New, unseen Stories/Condition Reports
const NEW_RING = 'bg-gradient-to-r from-cyan-400 via-blue-500 to-cyan-400';
// Standard rings by type
const PHOTOGRAPHER_RING = 'bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500';
const SURFER_RING = 'bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500';
// CLEAR Ring: Viewed stories
const VIEWED_RING = 'bg-zinc-600';

// Get ring color based on story state
const getStoryRingColor = (authorGroup, isViewed = false) => {
  // RED ring for active live broadcasts (always front)
  if (authorGroup.is_live) return LIVE_RING;
  // CLEAR ring for viewed stories
  if (isViewed || !authorGroup.has_unviewed) return VIEWED_RING;
  // BLUE ring for new/unseen stories
  if (authorGroup.has_unviewed) return NEW_RING;
  // Default to type-based ring
  return authorGroup.story_type === 'photographer' ? PHOTOGRAPHER_RING : SURFER_RING;
};

export const StoriesBar = ({ onCreateStory, onTierChange, selectedTier }) => {
  const { user } = useAuth();
  const [stories, setStories] = useState({ photographer_stories: [], surfer_stories: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(selectedTier || 'all'); // 'all', 'photographers', 'surfers'
  const [selectedAuthor, setSelectedAuthor] = useState(null);
  const [viewerLocation, setViewerLocation] = useState(null);
  const [newStoryNotification, setNewStoryNotification] = useState(null);
  const scrollRef = useRef(null);
  
  // Live Stream Viewer state - for joining RED ring broadcasts
  const [liveStreamInfo, setLiveStreamInfo] = useState(null);
  const [showLiveViewer, setShowLiveViewer] = useState(false);
  const [connectingToStream, setConnectingToStream] = useState(null); // Track connecting state for pulse animation

  // Sync with external tier selection
  useEffect(() => {
    if (selectedTier && selectedTier !== activeTab) {
      setActiveTab(selectedTier);
    }
  }, [selectedTier]);

  // Handle tab change and notify parent
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (onTierChange) {
      onTierChange(tab);
    }
  };

  // Initial fetch and location
  useEffect(() => {
    if (user?.id) {
      fetchStories();
      getViewerLocation();
    }
  }, [user?.id]);

  // Supabase Realtime subscription for new stories
  useEffect(() => {
    if (!user?.id) return;

    // Subscribe to INSERT events on the stories table
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
          
          // Don't show notification for own stories
          if (payload.new.author_id === user.id) {
            fetchStories(); // Just refresh silently
            return;
          }

          // Show notification toast for new stories
          const isPhotographer = ['Photographer', 'Approved Pro', 'Hobbyist'].includes(payload.new.author_role);
          const icon = isPhotographer ? '📸' : '🏄';
          
          setNewStoryNotification(payload.new);
          toast(`${icon} New story!`, {
            description: `${payload.new.author_name || 'Someone'} just posted a new story`,
            action: {
              label: 'View',
              onClick: () => {
                fetchStories();
                setNewStoryNotification(null);
              }
            }
          });

          // Auto-refresh after 2 seconds
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
          fetchStories(); // Refresh to remove deleted story
        }
      )
      .subscribe((status) => {
        logger.debug('[Stories Realtime] Subscription status:', status);
      });

    // Cleanup subscription on unmount
    return () => {
      logger.debug('[Stories Realtime] Cleaning up subscription');
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const getViewerLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setViewerLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => logger.debug('Location access denied')
      );
    }
  };

  const fetchStories = async () => {
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
  };

  const getDisplayStories = () => {
    let storyList = [];
    if (activeTab === 'photographers') storyList = stories.photographer_stories || [];
    else if (activeTab === 'surfers') storyList = stories.surfer_stories || [];
    else storyList = stories.all || [];
    
    // Sort stories: RED (is_live) at front, then BLUE (has_unviewed), then CLEAR (viewed)
    return [...storyList].sort((a, b) => {
      // Live broadcasts (RED ring) always first
      if (a.is_live && !b.is_live) return -1;
      if (!a.is_live && b.is_live) return 1;
      // Then unviewed (BLUE ring)
      if (a.has_unviewed && !b.has_unviewed) return -1;
      if (!a.has_unviewed && b.has_unviewed) return 1;
      // Keep original order for same priority
      return 0;
    });
  };

  const displayStories = getDisplayStories();

  const scroll = (direction) => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  /**
   * Handle story circle click - RED rings open live viewer, others open story viewer
   */
  const handleStoryCircleClick = async (authorGroup) => {
    if (authorGroup.is_live) {
      // RED ring - Join live broadcast with connecting pulse
      setConnectingToStream(authorGroup.author_id);
      
      try {
        // Fetch active stream info for this user
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
            broadcaster_avatar: liveStream.broadcaster_avatar || authorGroup.author_avatar,
            viewer_count: liveStream.viewer_count,
            title: liveStream.title
          });
          setShowLiveViewer(true);
        } else {
          toast.error('Stream is no longer live');
          fetchStories(); // Refresh to update status
        }
      } catch (error) {
        logger.error('Failed to get live stream info:', error);
        toast.error('Failed to join stream');
      } finally {
        setConnectingToStream(null);
      }
    } else {
      // Regular story - open story viewer
      setSelectedAuthor(authorGroup);
    }
  };

  if (loading) {
    return (
      <div className="h-24 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <>
      <div className="bg-zinc-900/50 border-b border-zinc-800">
        {/* New Story Notification Badge */}
        {newStoryNotification && (
          <div className="absolute top-2 right-4 z-20 animate-in slide-in-from-top-2 duration-300">
            <button
              onClick={() => {
                fetchStories();
                setNewStoryNotification(null);
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-black text-xs font-bold rounded-full shadow-lg hover:scale-105 transition-transform"
            >
              <Bell className="w-3 h-3 animate-pulse" />
              New Story!
            </button>
          </div>
        )}
        
        {/* Tab Filter */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800/50">
          <button
            onClick={() => handleTabChange('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'all' ? 'bg-white text-black' : 'bg-zinc-800 text-gray-400 hover:bg-zinc-700'
            }`}
          >
            All
          </button>
          <button
            onClick={() => handleTabChange('photographers')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
              activeTab === 'photographers' 
                ? 'bg-gradient-to-r from-yellow-400 to-orange-400 text-black' 
                : 'bg-zinc-800 text-gray-400 hover:bg-zinc-700'
            }`}
          >
            <Camera className="w-3 h-3" />
            Photographers
            {stories.photographer_count > 0 && (
              <span className="ml-1 bg-black/20 px-1.5 rounded-full">{stories.photographer_count}</span>
            )}
          </button>
          <button
            onClick={() => handleTabChange('surfers')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
              activeTab === 'surfers' 
                ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-black' 
                : 'bg-zinc-800 text-gray-400 hover:bg-zinc-700'
            }`}
          >
            <Waves className="w-3 h-3" />
            Surfers
            {stories.surfer_count > 0 && (
              <span className="ml-1 bg-black/20 px-1.5 rounded-full">{stories.surfer_count}</span>
            )}
          </button>
        </div>

        {/* Stories Row */}
        <div className="relative px-4 py-3">
          {/* Scroll Buttons */}
          {displayStories.length > 5 && (
            <>
              <button
                onClick={() => scroll('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/80 p-1 rounded-full hover:bg-black"
              >
                <ChevronLeft className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={() => scroll('right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-black/80 p-1 rounded-full hover:bg-black"
              >
                <ChevronRight className="w-4 h-4 text-white" />
              </button>
            </>
          )}

          <div
            ref={scrollRef}
            className="flex items-start gap-4 overflow-x-auto scrollbar-hide scroll-smooth"
          >
            {/* Create Story Button */}
            <div className="flex-shrink-0 flex flex-col items-center w-16">
              <button
                onClick={onCreateStory}
                className="relative w-16 h-16 rounded-full bg-zinc-800 border-2 border-dashed border-zinc-600 flex items-center justify-center hover:border-yellow-400 transition-colors"
                data-testid="create-story-btn"
              >
                <Plus className="w-6 h-6 text-gray-400" />
              </button>
              <span className="text-[10px] text-gray-400 mt-1 truncate w-full text-center">Your Story</span>
            </div>

            {/* Story Circles */}
            {displayStories.map((authorGroup) => (
              <StoryCircle
                key={authorGroup.author_id}
                authorGroup={authorGroup}
                onClick={() => handleStoryCircleClick(authorGroup)}
                isConnecting={connectingToStream === authorGroup.author_id}
              />
            ))}

            {displayStories.length === 0 && (
              <div className="flex items-center justify-center w-full py-4 text-gray-500 text-sm">
                No stories yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Story Viewer Modal - for regular stories */}
      {selectedAuthor && !selectedAuthor.is_live && (
        <StoryViewer
          authorGroup={selectedAuthor}
          viewerId={user?.id}
          viewerLocation={viewerLocation}
          onClose={() => {
            setSelectedAuthor(null);
            fetchStories(); // Refresh to update viewed status
          }}
          onNavigate={(direction) => {
            const currentIndex = displayStories.findIndex(s => s.author_id === selectedAuthor.author_id);
            const newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
            if (newIndex >= 0 && newIndex < displayStories.length) {
              setSelectedAuthor(displayStories[newIndex]);
            } else {
              setSelectedAuthor(null);
            }
          }}
        />
      )}

      {/* Live Stream Viewer - for RED ring live broadcasts */}
      <LiveStreamViewer
        isOpen={showLiveViewer}
        onClose={() => {
          setShowLiveViewer(false);
          setLiveStreamInfo(null);
          fetchStories(); // Refresh to update live status
        }}
        streamInfo={liveStreamInfo}
      />
    </>
  );
};

const StoryCircle = ({ authorGroup, onClick, isConnecting = false }) => {
  const _isPhotographer = authorGroup.story_type === 'photographer';
  const _hasUnviewed = authorGroup.has_unviewed;
  const _isLive = authorGroup.is_live;
  
  // Ring color based on live status, viewed status, and type
  // Priority: LIVE (RED) > NEW (BLUE) > TYPE-BASED > VIEWED (CLEAR)
  const ringClass = getStoryRingColor(authorGroup);
  
  // Enhanced connecting pulse animation for live streams
  const connectingClass = isConnecting ? 'animate-[pulse_0.4s_ease-in-out_infinite] scale-105' : '';

  return (
    <button
      onClick={onClick}
      disabled={isConnecting}
      className={`flex-shrink-0 flex flex-col items-center w-16 group relative ${connectingClass}`}
      data-testid={`story-circle-${authorGroup.author_id}`}
    >
      {/* Avatar with Ring */}
      <div className={`p-[2px] rounded-full ${ringClass} ${isConnecting ? 'ring-4 ring-red-500/50' : ''}`}>
        <div className="p-[2px] rounded-full bg-black">
          <div className="w-14 h-14 rounded-full overflow-hidden bg-zinc-800">
            {authorGroup.author_avatar ? (
              <img
                src={getFullUrl(authorGroup.author_avatar)}
                alt={authorGroup.author_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-lg font-bold text-gray-400">
                {authorGroup.author_name?.[0] || '?'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Badge - shows "Joining..." when connecting */}
      {authorGroup.is_live && (
        <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-white text-[8px] font-bold px-2 py-0.5 rounded uppercase ${
          isConnecting ? 'bg-red-400 animate-pulse' : 'bg-red-500'
        }`}>
          {isConnecting ? 'Joining...' : 'Live'}
        </div>
      )}

      {/* Name */}
      <span className="text-[10px] text-gray-400 mt-1 truncate w-full text-center group-hover:text-white transition-colors">
        {authorGroup.author_name?.split(' ')[0] || 'User'}
      </span>

      {/* Location (if visible) */}
      {authorGroup.show_location && authorGroup.location_name && (
        <span className="text-[9px] text-yellow-400 truncate w-full text-center flex items-center justify-center gap-0.5">
          <MapPin className="w-2 h-2" />
          {authorGroup.location_name.length > 10 
            ? authorGroup.location_name.substring(0, 10) + '...' 
            : authorGroup.location_name}
        </span>
      )}
    </button>
  );
};

const StoryViewer = ({ authorGroup, viewerId, _viewerLocation, onClose, onNavigate }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [stories, _setStories] = useState(authorGroup.stories);
  const progressInterval = useRef(null);
  const STORY_DURATION = 5000; // 5 seconds per story

  const currentStory = stories[currentIndex];

  useEffect(() => {
    // Mark story as viewed
    if (currentStory && viewerId) {
      apiClient.post(`/stories/${currentStory.id}/view?viewer_id=${viewerId}`).catch(() => {});
    }
  }, [currentStory, viewerId]);

  useEffect(() => {
    if (!paused) {
      startProgress();
    } else {
      clearProgress();
    }

    return () => clearProgress();
  }, [currentIndex, paused]);

  const startProgress = () => {
    clearProgress();
    setProgress(0);
    
    const startTime = Date.now();
    progressInterval.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = (elapsed / STORY_DURATION) * 100;
      
      if (newProgress >= 100) {
        goToNext();
      } else {
        setProgress(newProgress);
      }
    }, 50);
  };

  const clearProgress = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  };

  const goToNext = () => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      onNavigate('next');
    }
  };

  const goToPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else {
      onNavigate('prev');
    }
  };

  const handleTap = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    
    if (x < width / 3) {
      goToPrev();
    } else if (x > (width * 2) / 3) {
      goToNext();
    } else {
      setPaused(!paused);
    }
  };

  if (!currentStory) return null;

  const isPhotographer = authorGroup.story_type === 'photographer';

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-50 p-2 bg-black/50 rounded-full hover:bg-black/80"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {/* Navigation Arrows */}
      <button
        onClick={() => onNavigate('prev')}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2 bg-black/50 rounded-full hover:bg-black/80"
      >
        <ChevronLeft className="w-6 h-6 text-white" />
      </button>
      <button
        onClick={() => onNavigate('next')}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-50 p-2 bg-black/50 rounded-full hover:bg-black/80"
      >
        <ChevronRight className="w-6 h-6 text-white" />
      </button>

      {/* Story Container */}
      <div 
        className="relative w-full max-w-md h-[80vh] bg-zinc-900 rounded-xl overflow-hidden"
        onClick={handleTap}
      >
        {/* Progress Bars */}
        <div className="absolute top-0 left-0 right-0 z-40 flex gap-1 p-2">
          {stories.map((_, idx) => (
            <div key={idx} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all"
                style={{
                  width: idx < currentIndex ? '100%' : idx === currentIndex ? `${progress}%` : '0%'
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-6 left-0 right-0 z-40 flex items-center gap-3 px-4">
          {/* Avatar with ring color based on state */}
          <div className={`p-[2px] rounded-full ${getStoryRingColor(authorGroup)}`}>
            <div className="w-10 h-10 rounded-full overflow-hidden bg-black">
              {authorGroup.author_avatar ? (
                <img src={getFullUrl(authorGroup.author_avatar)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white font-bold">
                  {authorGroup.author_name?.[0]}
                </div>
              )}
            </div>
          </div>

          {/* Author Info */}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-white font-medium">{authorGroup.author_name}</span>
              {isPhotographer && (
                <span className="text-[10px] bg-yellow-400/20 text-yellow-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Camera className="w-3 h-3" />
                  Photographer
                </span>
              )}
              {authorGroup.is_live && (
                <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                  LIVE
                </span>
              )}
            </div>
            {currentStory.show_location && currentStory.location_name && (
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <MapPin className="w-3 h-3" />
                {currentStory.location_name}
              </div>
            )}
          </div>

          {/* Pause/Play */}
          <button
            onClick={(e) => { e.stopPropagation(); setPaused(!paused); }}
            className="p-2 bg-black/50 rounded-full"
          >
            {paused ? <Play className="w-4 h-4 text-white" /> : <Pause className="w-4 h-4 text-white" />}
          </button>
        </div>

        {/* Media */}
        <div className="w-full h-full flex items-center justify-center bg-black">
          {currentStory.media_type === 'video' ? (
            <video
              src={getFullUrl(currentStory.media_url)}
              className="max-w-full max-h-full object-contain"
              autoPlay
              loop
              muted={false}
              playsInline
            />
          ) : (
            <img
              src={getFullUrl(currentStory.media_url)}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>

        {/* Caption */}
        {currentStory.caption && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-white text-sm">{currentStory.caption}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export const CreateStoryModal = ({ isOpen, onClose, onCreated }) => {
  const { user } = useAuth();
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('image');
  const [caption, setCaption] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadMode, setUploadMode] = useState('file'); // 'file' or 'url'
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = React.useRef(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
      toast.error('Please select an image or video file');
      return;
    }

    // Check file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 50MB');
      return;
    }

    setSelectedFile(file);
    setMediaType(isVideo ? 'video' : 'image');
    
    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setMediaUrl(''); // Clear URL mode
  };

  const uploadFile = async () => {
    if (!selectedFile) return null;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('user_id', user.id);

    try {
      const response = await apiClient.post(`/upload/story`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(percent);
        }
      });
      return response.data;
    } catch (error) {
      logger.error('Upload error:', error);
      throw error;
    }
  };

  const handleCreate = async () => {
    setLoading(true);
    setUploadProgress(0);
    
    try {
      let finalMediaUrl = mediaUrl;
      let finalMediaType = mediaType;

      // If file mode, upload first
      if (uploadMode === 'file' && selectedFile) {
        const uploadResult = await uploadFile();
        finalMediaUrl = uploadResult.media_url;
        finalMediaType = uploadResult.media_type;
      }

      if (!finalMediaUrl) {
        toast.error('Please select a file or enter a URL');
        setLoading(false);
        return;
      }

      await apiClient.post(`/stories?author_id=${user.id}`, {
        media_url: finalMediaUrl,
        media_type: finalMediaType,
        caption: caption || null
      });
      
      toast.success('Story posted! 🌊');
      onCreated?.();
      handleClose();
    } catch (error) {
      toast.error('Failed to create story');
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleClose = () => {
    // Clean up preview URL
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setMediaUrl('');
    setSelectedFile(null);
    setPreviewUrl('');
    setCaption('');
    setUploadProgress(0);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Camera className="w-5 h-5 text-yellow-400" />
            Create Story
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* Upload Mode Toggle */}
          <div className="flex gap-2 p-1 bg-zinc-800 rounded-lg">
            <button
              onClick={() => setUploadMode('file')}
              className={`flex-1 py-2 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
                uploadMode === 'file' ? 'bg-yellow-400 text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Plus className="w-4 h-4" />
              Upload File
            </button>
            <button
              onClick={() => setUploadMode('url')}
              className={`flex-1 py-2 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
                uploadMode === 'url' ? 'bg-yellow-400 text-black' : 'text-gray-400 hover:text-white'
              }`}
            >
              Link URL
            </button>
          </div>

          {/* File Upload Mode */}
          {uploadMode === 'file' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              
              {!selectedFile ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full aspect-video rounded-lg border-2 border-dashed border-zinc-600 flex flex-col items-center justify-center gap-3 hover:border-yellow-400 transition-colors bg-zinc-800/50"
                >
                  <div className="w-16 h-16 rounded-full bg-zinc-700 flex items-center justify-center">
                    <Plus className="w-8 h-8 text-gray-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-white font-medium">Tap to select file</p>
                    <p className="text-xs text-gray-500 mt-1">Photos & videos up to 50MB</p>
                  </div>
                </button>
              ) : (
                <div className="relative">
                  <div className="aspect-video rounded-lg overflow-hidden bg-black">
                    {mediaType === 'video' ? (
                      <video src={previewUrl} className="w-full h-full object-cover" controls />
                    ) : (
                      <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <button
                    onClick={() => {
                      URL.revokeObjectURL(previewUrl);
                      setSelectedFile(null);
                      setPreviewUrl('');
                    }}
                    className="absolute top-2 right-2 p-1.5 bg-black/70 rounded-full hover:bg-black"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                  <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                    {mediaType === 'video' ? <Video className="w-4 h-4" /> : <Image className="w-4 h-4" />}
                    <span className="truncate">{selectedFile.name}</span>
                    <span className="text-xs">({(selectedFile.size / (1024 * 1024)).toFixed(1)}MB)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* URL Mode */}
          {uploadMode === 'url' && (
            <>
              {/* Media Type Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setMediaType('image')}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${
                    mediaType === 'image' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-gray-400'
                  }`}
                >
                  <Image className="w-4 h-4" />
                  Photo
                </button>
                <button
                  onClick={() => setMediaType('video')}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${
                    mediaType === 'video' ? 'bg-yellow-400 text-black' : 'bg-zinc-800 text-gray-400'
                  }`}
                >
                  <Video className="w-4 h-4" />
                  Video
                </button>
              </div>

              {/* Media URL Input */}
              <div>
                <label className="text-sm text-gray-400 mb-2 block">Media URL *</label>
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  placeholder={`Enter ${mediaType} URL...`}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-white placeholder-gray-500 focus:border-yellow-400 focus:outline-none"
                />
              </div>

              {/* Preview */}
              {mediaUrl && (
                <div className="aspect-video rounded-lg overflow-hidden bg-black">
                  {mediaType === 'video' ? (
                    <video src={mediaUrl} className="w-full h-full object-cover" controls />
                  ) : (
                    <img src={mediaUrl} alt="Preview" className="w-full h-full object-cover" />
                  )}
                </div>
              )}
            </>
          )}

          {/* Caption */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">Caption (optional)</label>
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption..."
              className="bg-zinc-800 border-zinc-700 text-white"
              rows={2}
            />
          </div>

          {/* Upload Progress */}
          {loading && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="space-y-1">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-yellow-400 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 text-center">Uploading... {uploadProgress}%</p>
            </div>
          )}

          <Button
            onClick={handleCreate}
            disabled={loading || (uploadMode === 'file' ? !selectedFile : !mediaUrl.trim())}
            className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Share Story'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StoriesBar;

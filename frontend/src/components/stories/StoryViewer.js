import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, MapPin, Play, Pause, Camera } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { getStoryRingColor } from './StoryCircle';

export const StoryViewer = ({ authorGroup, viewerId, viewerLocation, onClose, onNavigate }) => {
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
      <button aria-label="Close"
        onClick={onClose}
        className="absolute top-4 right-4 z-50 p-2 bg-black/50 rounded-full hover:bg-black/80"
      ><X className="w-6 h-6 text-white" />
      </button>

      {/* Navigation Arrows */}
      <button aria-label="Previous"
        onClick={() => onNavigate('prev')}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2 bg-black/50 rounded-full hover:bg-black/80"
      >
        <ChevronLeft className="w-6 h-6 text-white" />
      </button>
      <button aria-label="Next"
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
                <img loading="lazy" decoding="async" src={getFullUrl(authorGroup.author_avatar)} alt="" className="w-full h-full object-cover" />
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
          <button aria-label="Play"
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
            <img loading="lazy" decoding="async"
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

export default StoryViewer;

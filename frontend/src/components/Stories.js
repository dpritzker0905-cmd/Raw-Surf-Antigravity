import React, { useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ChevronLeft, ChevronRight, Camera, Waves, Plus, Loader2, Bell } from 'lucide-react';
import LiveStreamViewer from './LiveStreamViewer';
import useStoriesActions from '../hooks/useStoriesActions';
import StoryCircle from './stories/StoryCircle';
import StoryViewer from './stories/StoryViewer';

export const StoriesBar = ({ onCreateStory, onTierChange, selectedTier }) => {
  const { user } = useAuth();
  const scrollRef = useRef(null);

  // ============ HANDLERS EXTRACTED TO hooks/useStoriesActions.js ============
  const {
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
  } = useStoriesActions({
    user,
    selectedTier,
    onTierChange,
  });

  const scroll = (direction) => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
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
            <button aria-label="Notifications"
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
          <button aria-label="Camera"
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
          <button aria-label="Waves"
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
              <button aria-label="Previous"
                onClick={() => scroll('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-black/80 p-1 rounded-full hover:bg-black"
              >
                <ChevronLeft className="w-4 h-4 text-white" />
              </button>
              <button aria-label="Next"
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
              <button aria-label="Add"
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

// Re-export sub-components for backward compatibility
export { default as StoryCircle } from './stories/StoryCircle';
export { default as StoryViewer } from './stories/StoryViewer';
export { default as CreateStoryModal } from './stories/CreateStoryModal';

export default StoriesBar;

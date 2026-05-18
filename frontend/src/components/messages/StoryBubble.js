/**
 * StoryBubble G Instagram-style story/note bubble for the messages page.
 * Shows avatar with gradient ring, note overlay, and time remaining.
 * Extracted from MessagesPage.js for maintainability.
 */
import React from 'react';

const StoryBubble = ({ story, onClick, isOwnNote = false, _showCreateOption = false }) => {
  const hasUnread = story.hasUnread;
  const hasNote = story.noteContent && story.noteContent.length > 0;
  const ringColor = hasNote 
    ? 'from-green-400 via-emerald-500 to-teal-500'
    : story.type === 'photographer' 
      ? 'from-amber-400 via-orange-500 to-pink-500' 
      : 'from-cyan-400 via-blue-500 to-purple-500';
  
  return (
    <button 
      onClick={() => onClick?.(story)}
      className="flex flex-col items-center gap-1 min-w-[72px] relative group pt-3"
      data-testid={`note-bubble-${story.id || 'create'}`}
    >
      {/* Avatar ring with Note bubble ON top-left (Instagram-style) */}
      <div className="relative">
        {/* Note bubble - positioned ON avatar, overlapping top edge */}
        {hasNote && (
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-10 animate-in fade-in zoom-in duration-200">
            <div className="bg-card/95 dark:bg-zinc-900/95 backdrop-blur-sm border border-emerald-400 rounded-full px-2 py-0.5 max-w-[80px] shadow-lg whitespace-nowrap">
              <p className="text-[10px] text-foreground truncate text-center font-medium">{story.noteContent}</p>
            </div>
          </div>
        )}
        
        {/* Add note button - positioned ON avatar top when no note */}
        {isOwnNote && !hasNote && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
            <div className="bg-muted/90 border border-dashed border-muted-foreground rounded-full w-5 h-5 flex items-center justify-center hover:border-emerald-400 transition-colors">
              <span className="text-muted-foreground text-xs leading-none">+</span>
            </div>
          </div>
        )}
        
        <div className={`p-0.5 rounded-full ${hasUnread || hasNote ? `bg-gradient-to-br ${ringColor}` : 'bg-muted'}`}>
          <div className="p-0.5 bg-background rounded-full">
            <div className="w-14 h-14 rounded-full overflow-hidden bg-muted relative">
              {story.avatar ? (
                <img loading="lazy" 
                  src={story.avatar} 
                  alt="" 
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async" 
                  onError={(e) => { 
                    e.target.style.display = 'none'; 
                    e.target.nextSibling && (e.target.nextSibling.style.display = 'flex');
                  }}
                />
              ) : null}
              <div 
                className="w-full h-full flex items-center justify-center text-muted-foreground text-lg absolute inset-0"
                style={{ display: story.avatar ? 'none' : 'flex' }}
              >
                {story.name?.charAt(0) || '?'}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <span className="text-[11px] text-muted-foreground truncate max-w-[64px]">{story.name}</span>
      {story.timeRemaining && hasNote && (
        <span className="text-[10px] text-emerald-500 dark:text-emerald-400 truncate max-w-[64px] -mt-0.5">{story.timeRemaining}</span>
      )}
    </button>
  );
};

export default StoryBubble;

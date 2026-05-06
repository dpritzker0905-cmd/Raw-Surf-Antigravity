import React from 'react';

const ReactionIcon = ({ post, userId, isLiked, isPressing }) => {
  const userReaction = post.reactions?.find(r => r.user_id === userId);
  const hasNonShakaReaction = userReaction && userReaction.emoji !== '🤙';
  
  // Determine if Shaka should be colored (checked) or grayscale (unchecked)
  // Also show colored when pressing (holding down) for visual feedback
  const shakaIsChecked = (isLiked && !hasNonShakaReaction) || isPressing;
  
  const springTransition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  
  // Prevent browser context menu on long-press
  const preventContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
  
  return (
    <div 
      className="relative w-7 h-7 flex items-center justify-center overflow-visible"
      style={{ transition: springTransition }}
      onContextMenu={preventContextMenu}
    >
      {hasNonShakaReaction ? (
        <span 
          key={userReaction.emoji}
          className="text-2xl animate-in zoom-in-75 duration-300 select-none"
          style={{ 
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
            transform: 'scale(1.1)',
            transition: springTransition,
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
          onContextMenu={preventContextMenu}
        >
          {userReaction.emoji}
        </span>
      ) : (
        <img loading="lazy" decoding="async" 
          key={shakaIsChecked ? "shaka-checked" : "shaka-unchecked"}
          src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f919.svg"
          alt="shaka"
          className="animate-in zoom-in-75 duration-300 select-none"
          style={{ 
            width: '28px', 
            height: '28px',
            filter: shakaIsChecked ? 'none' : 'grayscale(100%) brightness(0.8)',
            opacity: shakaIsChecked ? 1 : 0.7,
            transform: isPressing ? 'scale(1.15)' : 'scale(1)',
            transition: springTransition,
            WebkitTouchCallout: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
            pointerEvents: 'none'
          }}
          draggable={false}
          onContextMenu={preventContextMenu}
          onDragStart={(e) => e.preventDefault()}
        />
      )}
    </div>
  );
};

export default ReactionIcon;

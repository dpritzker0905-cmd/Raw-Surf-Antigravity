import React, { useState, useRef, useEffect } from 'react';
import { Smile, X } from 'lucide-react';

/**
 * Smart Emoji Picker for Comments & Captions
 * Features:
 * - Quick-Access Row (8 most frequent surf emojis)
 * - Surf-First Sorting
 * - Mobile: Bottom sheet that slides up from bottom
 * - Desktop: Positioned popover
 */

// Surf-first emoji categories
const QUICK_ACCESS_EMOJIS = ['🤙', '🌊', '🏄', '🔥', '💯', '🙌', '❤️', '👏'];

const EMOJI_CATEGORIES = {
  'Surf & Ocean': ['🌊', '🏄', '🏄‍♂️', '🏄‍♀️', '🤙', '🌴', '☀️', '🐚', '🦈', '🐬', '🐠', '🏝️', '⛱️', '🌅', '🌞', '🦑', '🐙', '🦀', '🐳', '🦭'],
  'Reactions': ['🔥', '💯', '❤️', '👏', '🙌', '😍', '🤩', '😎', '💪', '👊', '✨', '⭐', '🎯', '🏆', '🥇', '💥', '💫', '🚀'],
  'Faces': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '🤥'],
  'Gestures': ['👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤝', '🙏', '💪'],
  'Nature': ['🌸', '🌺', '🌻', '🌼', '🌷', '🌹', '🌱', '🌿', '🍀', '🍃', '🍂', '🍁', '🌾', '🌵', '🎋', '🎍', '🌳', '🌲', '🌴', '🎄'],
  'Weather': ['🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '🌬️', '💨', '🌪️', '🌫️', '🌈', '☀️', '🌙', '⭐', '🌟', '💫'],
};

/**
 * Mobile Bottom Sheet Emoji Picker
 * Slides up from bottom, covers keyboard area
 * 
 * Smart Close Behavior:
 * - Stays open by default for multi-emoji selection (like Instagram/WhatsApp)
 * - Shows visual feedback (pulse) on emoji selection
 * - Closes on: backdrop tap, X button, or swipe down
 * - Optional: Double-tap emoji to insert and close
 */
const MobileEmojiSheet = ({ isOpen, onClose, onSelect }) => {
  const [activeCategory, setActiveCategory] = useState('Surf & Ocean');
  const [lastSelected, setLastSelected] = useState(null);
  const sheetRef = useRef(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  // Close on outside click (backdrop)
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Swipe down to close
  const handleTouchStart = (e) => {
    startY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e) => {
    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;
    
    // Only allow downward swipe on the handle area
    if (diff > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${Math.min(diff, 200)}px)`;
    }
  };

  const handleTouchEnd = () => {
    const diff = currentY.current - startY.current;
    
    if (diff > 100) {
      // Swiped down enough - close
      onClose();
    }
    
    // Reset position
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
  };

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Clear selection highlight after animation
  useEffect(() => {
    if (lastSelected) {
      const timer = setTimeout(() => setLastSelected(null), 300);
      return () => clearTimeout(timer);
    }
  }, [lastSelected]);

  if (!isOpen) return null;

  const handleEmojiClick = (emoji) => {
    // Visual feedback - highlight the selected emoji
    setLastSelected(emoji);
    
    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
    
    // Insert the emoji
    onSelect(emoji);
    
    // Close after selection - user can reopen if they need more
    setTimeout(() => onClose(), 150);
  };

  return (
    <div 
      className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      {/* Bottom Sheet */}
      <div 
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 bg-zinc-900 rounded-t-3xl animate-in slide-in-from-bottom duration-300 max-h-[55vh] flex flex-col transition-transform"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Swipeable Handle bar */}
        <div 
          className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-12 h-1.5 bg-zinc-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-zinc-800">
          <span className="text-white text-lg font-semibold">Emojis</span>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-zinc-700 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Quick Access Row */}
        <div className="px-3 py-3 border-b border-zinc-800 bg-zinc-800/30">
          <div className="flex items-center justify-between">
            {QUICK_ACCESS_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleEmojiClick(emoji)}
                className={`text-2xl p-2 rounded-xl transition-all active:scale-90 ${
                  lastSelected === emoji ? 'bg-yellow-500/30 scale-110' : 'hover:bg-zinc-700'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar border-b border-zinc-800 px-2">
          {Object.keys(EMOJI_CATEGORIES).map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`flex-shrink-0 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                activeCategory === category 
                  ? 'text-yellow-400 border-b-2 border-yellow-400' 
                  : 'text-gray-400'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Emoji Grid - Scrollable */}
        <div className="flex-1 overflow-y-auto p-3 min-h-[180px]">
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_CATEGORIES[activeCategory].map((emoji, idx) => (
              <button
                key={`${emoji}-${idx}`}
                onClick={() => handleEmojiClick(emoji)}
                className={`text-2xl p-2 rounded-xl transition-all active:scale-90 ${
                  lastSelected === emoji ? 'bg-yellow-500/30 scale-110' : 'hover:bg-zinc-700'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Desktop Popover Emoji Picker
 */
const DesktopEmojiPopover = ({ isOpen, onClose, onSelect, position = 'above' }) => {
  const [activeCategory, setActiveCategory] = useState('Surf & Ocean');
  const pickerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleEmojiClick = (emoji) => {
    onSelect(emoji);
  };

  return (
    <div 
      ref={pickerRef}
      className={`absolute ${position === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 w-80 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-white text-sm font-medium">Emojis</span>
        <button onClick={onClose} className="p-1 hover:bg-zinc-700 rounded-full">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Quick Access */}
      <div className="px-2 py-2 border-b border-zinc-800 bg-zinc-800/50">
        <div className="flex items-center justify-between gap-1">
          {QUICK_ACCESS_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleEmojiClick(emoji)}
              className="flex-1 text-xl p-1.5 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Categories */}
      <div className="flex overflow-x-auto hide-scrollbar border-b border-zinc-800">
        {Object.keys(EMOJI_CATEGORIES).map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`flex-shrink-0 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              activeCategory === category 
                ? 'text-yellow-400 border-b-2 border-yellow-400' 
                : 'text-gray-400'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="p-2 max-h-48 overflow-y-auto">
        <div className="grid grid-cols-8 gap-1">
          {EMOJI_CATEGORIES[activeCategory].map((emoji, idx) => (
            <button
              key={`${emoji}-${idx}`}
              onClick={() => handleEmojiClick(emoji)}
              className="text-xl p-1.5 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Main Emoji Picker - Automatically switches between mobile sheet and desktop popover
 */
const EmojiPicker = ({ isOpen, onClose, onSelect, position = 'above' }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Mobile: Use bottom sheet
  if (isMobile) {
    return (
      <MobileEmojiSheet
        isOpen={isOpen}
        onClose={onClose}
        onSelect={onSelect}
      />
    );
  }

  // Desktop: Use popover
  return (
    <DesktopEmojiPopover
      isOpen={isOpen}
      onClose={onClose}
      onSelect={onSelect}
      position={position}
    />
  );
};

/**
 * Comment Input with Emoji Picker
 * Integrated component for Feed posts
 */
export const CommentInputWithEmoji = ({ 
  value, 
  onChange, 
  onSubmit, 
  placeholder = "Add a comment...",
  postId,
  textClass = "text-gray-400",
  borderClass = "border-zinc-800"
}) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef(null);

  const handleEmojiSelect = (emoji) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart || value.length;
      const end = input.selectionEnd || value.length;
      const newValue = value.slice(0, start) + emoji + value.slice(end);
      onChange(newValue);
      
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      onChange(value + emoji);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) {
        onSubmit();
        setShowEmojiPicker(false);
      }
    }
  };

  return (
    <div className={`relative flex items-center gap-2 pt-3 border-t ${borderClass}`}>
      {/* Emoji Button */}
      <button
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        className={`flex-shrink-0 p-1.5 rounded-full transition-colors ${
          showEmojiPicker ? 'bg-yellow-500/20 text-yellow-400' : 'hover:bg-zinc-700 text-gray-400 hover:text-white'
        }`}
        data-testid={`emoji-btn-${postId}`}
      >
        <Smile className="w-5 h-5" />
      </button>

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className={`flex-1 bg-transparent border-none text-sm ${textClass} placeholder-gray-500 focus:outline-none`}
        data-testid={`comment-input-${postId}`}
      />

      {/* Post Button */}
      {value.trim() && (
        <button
          onClick={() => {
            onSubmit();
            setShowEmojiPicker(false);
          }}
          className="text-blue-500 hover:text-blue-400 text-sm font-medium transition-colors"
          data-testid={`comment-submit-${postId}`}
        >
          Post
        </button>
      )}

      {/* Emoji Picker */}
      <EmojiPicker
        isOpen={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onSelect={handleEmojiSelect}
        position="above"
      />
    </div>
  );
};

/**
 * Textarea with Emoji Picker - For captions and longer text
 * Used in Edit Post Modal
 */
export const TextareaWithEmoji = ({ 
  value, 
  onChange, 
  placeholder = "Write something...",
  rows = 3,
  className = "",
  isLight = false
}) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef(null);

  const handleEmojiSelect = (emoji) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart || value.length;
      const end = textarea.selectionEnd || value.length;
      const newValue = value.slice(0, start) + emoji + value.slice(end);
      onChange(newValue);
      
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      onChange(value + emoji);
    }
  };

  const inputBg = isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800 border-zinc-700';
  const textColor = isLight ? 'text-gray-900' : 'text-white';

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`w-full rounded-md border px-3 py-2 pr-10 text-sm resize-none ${inputBg} ${textColor} ${className}`}
        data-testid="textarea-with-emoji"
      />
      
      {/* Emoji Button - Positioned in top right */}
      <button
        type="button"
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        className={`absolute top-2 right-2 p-1.5 rounded-full transition-colors ${
          showEmojiPicker 
            ? 'bg-yellow-500/20 text-yellow-400' 
            : isLight 
              ? 'hover:bg-gray-200 text-gray-400 hover:text-gray-600' 
              : 'hover:bg-zinc-700 text-gray-400 hover:text-white'
        }`}
        data-testid="textarea-emoji-btn"
      >
        <Smile className="w-5 h-5" />
      </button>

      {/* Emoji Picker */}
      <EmojiPicker
        isOpen={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onSelect={handleEmojiSelect}
        position="below"
      />
    </div>
  );
};

export default EmojiPicker;

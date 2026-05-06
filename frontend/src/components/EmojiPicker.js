import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Smile, X, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  QUICK_ACCESS_EMOJIS,
  ALL_EMOJI_CATEGORIES,
  CATEGORY_ICONS,
} from '../constants/emojis';

/**
 * Smart Emoji Picker for Comments & Captions
 *
 * Redesigned following industry best practices (WhatsApp/Telegram/Slack):
 *  - Always shows ALL categories - no confusing More/Less toggle
 *  - Icon-only category tabs (compact, instantly scannable)
 *  - Desktop: scroll-arrow indicators for tab overflow
 *  - Mobile: full-width bottom sheet with swipe-to-close
 *  - Quick-access row at top for high-frequency surf emojis
 *  - Visual + haptic feedback on selection
 */

// Build unified category map with quick-access
const ALL_CATEGORIES = {
  'Quick': QUICK_ACCESS_EMOJIS,
  ...ALL_EMOJI_CATEGORIES,
};
const CATEGORY_NAMES = Object.keys(ALL_CATEGORIES);
const TAB_ICONS = { Quick: '?', ...CATEGORY_ICONS };

// -------------------------------------------------
//  Shared: Icon-based category tab bar with scroll arrows
// -------------------------------------------------
const CategoryTabs = ({ active, onChange, size = 'sm' }) => {
  const tabsRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const update = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    // Initial check + delayed for render
    update();
    const t = setTimeout(update, 100);
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  // Scroll active tab into view
  useEffect(() => {
    if (!tabsRef.current) return;
    const btn = tabsRef.current.querySelector('[data-active="true"]');
    if (btn) btn.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  }, [active]);

  const scroll = (dir) => tabsRef.current?.scrollBy({ left: dir * 120, behavior: 'smooth' });

  const btnSize = size === 'lg' ? 'w-10 h-10 text-xl' : 'w-8 h-8 text-base';

  return (
    <div className="relative border-b border-zinc-800">
      {canScrollLeft && (
        <button
          onClick={() => scroll(-1)}
          className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-transparent"
          aria-label="Scroll left"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
        </button>
      )}

      <div
        ref={tabsRef}
        className="flex overflow-x-auto px-1 py-1.5 gap-0.5 scrollbar-none"
      >
        {CATEGORY_NAMES.map((cat) => (
          <button
            key={cat}
            data-active={active === cat ? 'true' : undefined}
            onClick={() => onChange(cat)}
            className={`flex-shrink-0 ${btnSize} flex items-center justify-center rounded-lg transition-colors ${
              active === cat
                ? 'bg-yellow-500/20 ring-1 ring-yellow-400/40'
                : 'hover:bg-zinc-800'
            }`}
            title={cat}
          >
            {TAB_ICONS[cat] || cat.charAt(0)}
          </button>
        ))}
      </div>

      {canScrollRight && (
        <button
          onClick={() => scroll(1)}
          className="absolute right-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-gradient-to-l from-zinc-900 via-zinc-900/90 to-transparent"
          aria-label="Scroll right"
        >
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        </button>
      )}
    </div>
  );
};

// -------------------------------------------------
//  Mobile Bottom Sheet Emoji Picker
// -------------------------------------------------
const MobileEmojiSheet = ({ isOpen, onClose, onSelect }) => {
  const [activeCategory, setActiveCategory] = useState('Quick');
  const [lastSelected, setLastSelected] = useState(null);
  const sheetRef = useRef(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Swipe-to-close
  const handleTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const handleTouchMove = (e) => {
    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;
    if (diff > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${Math.min(diff, 200)}px)`;
    }
  };
  const handleTouchEnd = () => {
    const diff = currentY.current - startY.current;
    if (diff > 100) onClose();
    if (sheetRef.current) sheetRef.current.style.transform = '';
  };

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    if (lastSelected) {
      const t = setTimeout(() => setLastSelected(null), 300);
      return () => clearTimeout(t);
    }
  }, [lastSelected]);

  if (!isOpen) return null;

  const handleEmojiClick = (emoji) => {
    setLastSelected(emoji);
    if (navigator.vibrate) navigator.vibrate(10);
    onSelect(emoji);
    setTimeout(() => onClose(), 150);
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={sheetRef}
        className="fixed bottom-0 left-0 right-0 bg-zinc-900 rounded-t-3xl animate-in slide-in-from-bottom duration-300 max-h-[55vh] flex flex-col transition-transform"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Handle bar */}
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
          <button onClick={onClose} className="p-2 hover:bg-zinc-700 rounded-full transition-colors" aria-label="Close emoji picker">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Category tabs - icon based */}
        <CategoryTabs active={activeCategory} onChange={setActiveCategory} size="lg" />

        {/* Emoji grid */}
        <div className="flex-1 overflow-y-auto p-3 min-h-[180px]">
          <div className="grid grid-cols-8 gap-1">
            {(ALL_CATEGORIES[activeCategory] || []).map((emoji, idx) => (
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

        {/* Active category label */}
        <div className="px-4 py-1.5 border-t border-zinc-800">
          <span className="text-xs text-gray-500">{activeCategory}</span>
        </div>
      </div>
    </div>
  );
};

// -------------------------------------------------
//  Desktop Popover Emoji Picker
// -------------------------------------------------
const DesktopEmojiPopover = ({ isOpen, onClose, onSelect, position = 'above' }) => {
  const [activeCategory, setActiveCategory] = useState('Quick');
  const pickerRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) onClose();
    };
    if (isOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={pickerRef}
      className={`absolute ${position === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 w-80 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-white text-sm font-medium">Emojis</span>
        <button onClick={onClose} className="p-1 hover:bg-zinc-700 rounded-full" aria-label="Close emoji picker">
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* Category tabs - icon based */}
      <CategoryTabs active={activeCategory} onChange={setActiveCategory} size="sm" />

      {/* Grid */}
      <div className="p-2 max-h-48 overflow-y-auto show-scrollbar">
        <div className="grid grid-cols-8 gap-1">
          {(ALL_CATEGORIES[activeCategory] || []).map((emoji, idx) => (
            <button
              key={`${emoji}-${idx}`}
              onClick={() => onSelect(emoji)}
              className="text-xl p-1.5 hover:bg-zinc-700 rounded-lg transition-colors hover:scale-110 active:scale-95"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Active category label */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-zinc-800">
        <span className="text-[11px] text-gray-500">{activeCategory}</span>
      </div>
    </div>
  );
};

// -------------------------------------------------
//  Main Emoji Picker - auto-switches mobile/desktop
// -------------------------------------------------
const EmojiPicker = ({ isOpen, onClose, onSelect, position = 'above' }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  if (isMobile) {
    return <MobileEmojiSheet isOpen={isOpen} onClose={onClose} onSelect={onSelect} />;
  }
  return <DesktopEmojiPopover isOpen={isOpen} onClose={onClose} onSelect={onSelect} position={position} />;
};

// -------------------------------------------------
//  Comment Input with Emoji Picker
// -------------------------------------------------
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
      <button aria-label="Emoji"
        aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        className={`flex-shrink-0 p-1.5 rounded-full transition-colors ${
          showEmojiPicker ? 'bg-yellow-500/20 text-yellow-400' : 'hover:bg-zinc-700 text-gray-400 hover:text-white'
        }`}
        data-testid={`emoji-btn-${postId}`}
        aria-label="Open emoji picker"
      >
        <Smile className="w-5 h-5" />
      </button>

      {/* Input */}
      <input aria-label="Text input"
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

// -------------------------------------------------
//  Textarea with Emoji Picker - for captions, edit post
// -------------------------------------------------
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
      <textarea aria-label="Text input"
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
        aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        className={`absolute top-2 right-2 p-1.5 rounded-full transition-colors ${
          showEmojiPicker
            ? 'bg-yellow-500/20 text-yellow-400'
            : isLight
              ? 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'
              : 'hover:bg-zinc-700 text-gray-400 hover:text-white'
        }`}
        data-testid="textarea-emoji-btn"
        aria-label="Open emoji picker"
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

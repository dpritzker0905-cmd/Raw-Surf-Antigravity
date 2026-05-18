import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  QUICK_ACCESS_EMOJIS,
  ALL_EMOJI_CATEGORIES,
  CATEGORY_ICONS,
} from '../../constants/emojis';

/**
 * Emoji Picker for Direct Messages (MessagesPage)
 * Redesigned following industry best practices (WhatsApp/Telegram/Slack):
 *
 *  - Always shows ALL categories (no confusing More/Less toggle)
 *  - Icon-only category tabs (compact, scannable)
 *  - Desktop: scroll arrow indicators for tab overflow
 *  - Thin scrollbar on the emoji grid for desktop
 *  - Quick-access row at top for frequently used surf emojis
 *
 * Uses shared emoji data from constants/emojis.js.
 */

// Build a DM-friendly category map: "Recent" quick-access row + all shared categories
const DM_CATEGORIES = {
  'Recent': QUICK_ACCESS_EMOJIS,
  ...ALL_EMOJI_CATEGORIES,
};

const CATEGORY_NAMES = Object.keys(DM_CATEGORIES);

// Icon map with "Recent" added
const TAB_ICONS = { Recent: '\u{1F550}', ...CATEGORY_ICONS };

const EmojiPicker = ({ show, onSelect, onClose }) => {
  const [activeCategory, setActiveCategory] = useState('Recent');
  const tabsRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

 // GG Scroll-indicator state GG
  const updateScrollIndicators = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el || !show) return;
    updateScrollIndicators();
    el.addEventListener('scroll', updateScrollIndicators, { passive: true });
    window.addEventListener('resize', updateScrollIndicators);
    return () => {
      el.removeEventListener('scroll', updateScrollIndicators);
      window.removeEventListener('resize', updateScrollIndicators);
    };
  }, [show, updateScrollIndicators]);

  const scrollTabs = (dir) => {
    const el = tabsRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 120, behavior: 'smooth' });
  };

  // Scroll active tab into view when category changes
  useEffect(() => {
    if (!tabsRef.current) return;
    const activeBtn = tabsRef.current.querySelector('[data-active="true"]');
    if (activeBtn) {
      activeBtn.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    }
  }, [activeCategory]);

  if (!show) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-2 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 animate-in slide-in-from-bottom-2"
      onClick={(e) => e.stopPropagation()}
    >
 {/* GG Category tabs: icon-only, scroll arrows on overflow GG */}
      <div className="relative border-b border-zinc-700">
        {/* Left scroll arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scrollTabs(-1)}
            className="absolute left-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-transparent"
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-gray-400" />
          </button>
        )}

        {/* Tab bar */}
        <div
          ref={tabsRef}
          className="flex overflow-x-auto px-1 py-1.5 gap-0.5 scrollbar-none"
        >
          {CATEGORY_NAMES.map((cat) => (
            <button
              key={cat}
              data-active={activeCategory === cat ? 'true' : undefined}
              onClick={() => setActiveCategory(cat)}
              className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-lg transition-colors ${
                activeCategory === cat
                  ? 'bg-cyan-500/20 ring-1 ring-cyan-500/40'
                  : 'hover:bg-zinc-800'
              }`}
              title={cat}
            >
              {TAB_ICONS[cat] || cat.charAt(0)}
            </button>
          ))}
        </div>

        {/* Right scroll arrow */}
        {canScrollRight && (
          <button
            onClick={() => scrollTabs(1)}
            className="absolute right-0 top-0 bottom-0 z-10 w-7 flex items-center justify-center bg-gradient-to-l from-zinc-900 via-zinc-900/90 to-transparent"
            aria-label="Scroll tabs right"
          >
            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          </button>
        )}
      </div>

 {/* GG Emoji grid GG */}
      <div className="p-2 grid grid-cols-8 gap-1 max-h-48 overflow-y-auto show-scrollbar">
        {(DM_CATEGORIES[activeCategory] || []).map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            onClick={() => onSelect(emoji)}
            className="text-xl p-1.5 hover:bg-zinc-800 rounded-lg transition-colors hover:scale-110 active:scale-95"
          >
            {emoji}
          </button>
        ))}
      </div>

 {/* GG Footer GG */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-700">
        <span className="text-[11px] text-gray-500">{activeCategory}</span>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-white transition-colors">Close</button>
      </div>
    </div>
  );
};

export default EmojiPicker;

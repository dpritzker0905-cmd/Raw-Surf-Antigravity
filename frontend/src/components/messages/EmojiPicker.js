import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  QUICK_ACCESS_EMOJIS,
  EMOJI_CATEGORIES,
  EXTENDED_EMOJI_CATEGORIES,
} from '../../constants/emojis';

/**
 * Emoji Picker for Direct Messages (MessagesPage)
 * Simpler popover variant — preserves existing show/onSelect/onClose interface.
 *
 * Uses shared emoji data from constants/emojis.js.
 * Includes a collapsible "More" toggle to reveal extended categories.
 */

// Build a DM-friendly subset: "Recent" quick-access row + shared primary categories
const DM_BASE_CATEGORIES = {
  'Recent': QUICK_ACCESS_EMOJIS,
  ...EMOJI_CATEGORIES,
};

const EmojiPicker = ({ show, onSelect, onClose }) => {
  const [activeCategory, setActiveCategory] = useState('Recent');
  const [showExtended, setShowExtended] = useState(false);

  // Build the visible category map based on expanded state
  const visibleCategories = showExtended
    ? { ...DM_BASE_CATEGORIES, ...EXTENDED_EMOJI_CATEGORIES }
    : DM_BASE_CATEGORIES;

  // Reset to a valid category when collapsing extended
  const handleToggleExtended = () => {
    if (showExtended && !(activeCategory in DM_BASE_CATEGORIES)) {
      setActiveCategory('Recent');
    }
    setShowExtended(!showExtended);
  };

  if (!show) return null;
  
  return (
    <div 
      className="absolute bottom-full left-0 mb-2 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 animate-in slide-in-from-bottom-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex border-b border-zinc-700 overflow-x-auto px-2 py-1 scrollbar-hide">
        {Object.keys(visibleCategories).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors rounded ${
              activeCategory === cat ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}

        {/* Show More / Show Less toggle */}
        <button
          onClick={handleToggleExtended}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors rounded text-cyan-500/60 hover:text-cyan-400"
          data-testid="dm-emoji-show-more"
        >
          {showExtended ? (
            <>Less <ChevronUp className="w-3 h-3" /></>
          ) : (
            <>More <ChevronDown className="w-3 h-3" /></>
          )}
        </button>
      </div>
      <div className="p-2 grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
        {(visibleCategories[activeCategory] || []).map((emoji, i) => (
          <button
            key={i}
            onClick={() => onSelect(emoji)}
            className="text-xl p-1.5 hover:bg-zinc-800 rounded transition-colors hover:scale-110"
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="flex justify-end px-2 py-1 border-t border-zinc-700">
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">Close</button>
      </div>
    </div>
  );
};

export default EmojiPicker;

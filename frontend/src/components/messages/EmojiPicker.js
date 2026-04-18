import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';

const EMOJI_CATEGORIES = {
  'Recent': ['🤙', '🌊', '❤️', '🔥', '👏', '😂', '🏄', '🏄‍♀️'],
  'Surf': ['🏄', '🏄‍♀️', '🌊', '🏖️', '🐚', '🐬', '🦈', '☀️', '🌅', '🌴', '🐠', '🦑', '🐙', '🦀'],
  'Faces': ['😀', '😂', '🥹', '😍', '🥰', '😘', '😎', '🤩', '😇', '🙂', '😉', '😊', '😋', '🤪', '😜'],
  'Gestures': ['🤙', '👋', '✌️', '👍', '👊', '🤟', '🤘', '👏', '🙌', '🤝', '💪', '🫶', '❤️', '🔥', '💯'],
  'Nature': ['🌞', '🌈', '⭐', '🌙', '☁️', '💨', '🌬️', '🌀', '🌪️', '🌧️', '⚡', '🔆', '🌺', '🌸', '🌻']
};

const EmojiPicker = ({ show, onSelect, onClose }) => {
  const [activeCategory, setActiveCategory] = useState('Recent');
  
  if (!show) return null;
  
  return (
    <div 
      className="absolute bottom-full left-0 mb-2 w-72 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 animate-in slide-in-from-bottom-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex border-b border-zinc-700 overflow-x-auto px-2 py-1 scrollbar-hide">
        {Object.keys(EMOJI_CATEGORIES).map((cat) => (
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
      </div>
      <div className="p-2 grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
        {EMOJI_CATEGORIES[activeCategory].map((emoji, i) => (
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

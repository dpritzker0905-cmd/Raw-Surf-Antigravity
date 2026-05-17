/**
 * ReactionPicker.js - Extracted from Feed.js (v61)
 * Emoji reaction picker overlay and backdrop.
 */
import React from 'react';
import { X } from 'lucide-react';
import { REACTION_EMOJIS } from '../../constants/emojis';

// Reaction Picker Component - Anchored near the Shaka button, not screen center
// Uses a 2-row grid on mobile so all 10 emojis fit without overflow
const ReactionPicker = ({ show, onSelect, onClose, anchor }) => {
  if (!show) return null;

  // Container width: 5 emojis per row at 44px each + 8px gaps + padding
  const EDGE_PAD = 12;
  const PICKER_W = Math.min(window.innerWidth - EDGE_PAD * 2, 300);
  const PICKER_H = 108;       // approx height for 2-row layout
  const MARGIN = 10;

  let left = (anchor?.x ?? window.innerWidth / 2) - PICKER_W / 2;
  let top = (anchor?.y ?? window.innerHeight / 2) - PICKER_H - MARGIN;

  // Clamp horizontally
  left = Math.max(EDGE_PAD, Math.min(left, window.innerWidth - PICKER_W - EDGE_PAD));
  // If goes off top, show below the button
  if (top < EDGE_PAD) {
    top = (anchor?.y ?? window.innerHeight / 2) + MARGIN + 36;
  }

  return (
    <div 
      className="fixed bg-zinc-900/95 backdrop-blur-md border border-zinc-600 rounded-2xl px-3 py-3 shadow-2xl animate-in zoom-in-95 duration-200"
      style={{ 
        zIndex: 99999,
        left: `${left}px`,
        top: `${top}px`,
        width: `${PICKER_W}px`,
        pointerEvents: 'auto'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Close button top-right */}
      <button 
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white rounded-full hover:bg-zinc-700/50"
        style={{ zIndex: 1 }}
      >
        <X className="w-3.5 h-3.5" />
      </button>
      {/* 5-2 grid of emojis */}
      <div className="grid grid-cols-5 gap-1 justify-items-center">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onSelect(emoji); }}
            className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-zinc-700/60 active:scale-90 transition-transform duration-100"
            style={{ fontSize: '24px' }}
            data-testid={`feed-reaction-${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};

// Overlay backdrop for reaction picker - tapping outside closes the menu
const ReactionOverlay = ({ show, onClose }) => {
  if (!show) return null;
  
  return (
    <div 
      className="fixed inset-0 bg-black/30"
      style={{ zIndex: 99998 }}
      onClick={onClose}
    />
  );
};

export { ReactionPicker, ReactionOverlay };

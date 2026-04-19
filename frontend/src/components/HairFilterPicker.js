/**
 * HairFilterPicker — UI for selecting AR hair overlays
 * 
 * Features:
 * - Male/Female category tabs
 * - Grid of hair style thumbnails with emojis and names
 * - "None" option to remove overlay
 * - Theme-aware (light/dark/beach)
 * - Animated selection state
 */

import React, { useState, useMemo } from 'react';
import { X, Scissors, User, Sparkles } from 'lucide-react';
import { HAIR_STYLES } from '../utils/HairFilterEngine';
import { motion, AnimatePresence } from 'framer-motion';

// Category definitions
const CATEGORIES = [
  { id: 'male', label: 'Male', icon: '🏄‍♂️' },
  { id: 'female', label: 'Female', icon: '🏄‍♀️' },
];

/**
 * HairStyleCard — Individual hair style option
 */
const HairStyleCard = ({ style, isSelected, onSelect, colors }) => (
  <motion.button
    whileTap={{ scale: 0.92 }}
    onClick={() => onSelect(style.id)}
    className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all duration-200 ${
      isSelected
        ? 'bg-gradient-to-br from-yellow-500/30 to-amber-500/30 border-2 border-yellow-500 shadow-lg shadow-yellow-500/20'
        : `${colors.buttonBg} border border-transparent hover:border-yellow-500/30`
    }`}
  >
    <div className={`text-2xl ${isSelected ? 'scale-110' : ''} transition-transform`}>
      {style.emoji}
    </div>
    <span className={`text-[10px] font-medium leading-tight text-center ${
      isSelected ? 'text-yellow-400' : colors.primaryText
    }`}>
      {style.name}
    </span>
  </motion.button>
);


/**
 * Main HairFilterPicker Component
 */
export const HairFilterPicker = ({
  isOpen,
  onClose,
  activeStyleId,
  onSelectHair,
  colors,
}) => {
  const [category, setCategory] = useState('male');

  // Filter styles by category
  const filteredStyles = useMemo(() => {
    return Object.values(HAIR_STYLES).filter(s => s.category === category);
  }, [category]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -20, scale: 0.95 }}
      transition={{ type: 'spring', duration: 0.3 }}
      className={`absolute left-3 top-24 w-72 max-h-[60vh] overflow-y-auto p-3 rounded-2xl ${colors.overlayBg} ${colors.border} border z-50`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Scissors className={`w-4 h-4 ${colors.accentText}`} />
          <span className={`text-sm font-semibold ${colors.primaryText}`}>Surfer Hair</span>
        </div>
        <button
          onClick={onClose}
          className={`p-1.5 rounded-full ${colors.buttonBg} transition-colors`}
        >
          <X className={`w-4 h-4 ${colors.secondaryText}`} />
        </button>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1.5 mb-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
              category === cat.id
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40'
                : `${colors.buttonBg} ${colors.secondaryText} border border-transparent`
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </button>
        ))}
      </div>

      {/* "None" option */}
      <button
        onClick={() => onSelectHair(null)}
        className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl mb-2 transition-all ${
          !activeStyleId
            ? 'bg-zinc-500/20 border-2 border-zinc-400'
            : `${colors.buttonBg} border border-transparent hover:border-zinc-500/30`
        }`}
      >
        <div className={`w-8 h-8 rounded-full ${!activeStyleId ? 'bg-zinc-500/30' : 'bg-zinc-700/30'} flex items-center justify-center`}>
          <User className={`w-4 h-4 ${!activeStyleId ? 'text-zinc-300' : colors.secondaryText}`} />
        </div>
        <span className={`text-sm font-medium ${!activeStyleId ? 'text-zinc-300' : colors.secondaryText}`}>
          No Hair Filter
        </span>
      </button>

      {/* Hair Style Grid */}
      <div className="grid grid-cols-3 gap-2">
        <AnimatePresence mode="wait">
          {filteredStyles.map((style) => (
            <HairStyleCard
              key={style.id}
              style={style}
              isSelected={activeStyleId === style.id}
              onSelect={onSelectHair}
              colors={colors}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Active style info */}
      {activeStyleId && HAIR_STYLES[activeStyleId] && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-3 pt-2 border-t ${colors.border} flex items-center gap-2`}
        >
          <Sparkles className="w-3 h-3 text-yellow-400" />
          <span className={`text-xs ${colors.secondaryText}`}>
            Active: <span className="text-yellow-400 font-medium">{HAIR_STYLES[activeStyleId].name}</span>
          </span>
        </motion.div>
      )}
    </motion.div>
  );
};

export default HairFilterPicker;

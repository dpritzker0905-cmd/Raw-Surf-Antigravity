/**
 * surfAlertConstants.js - Shared surf alert configuration constants.
 * Extracted from SurfAlerts.js to reduce component size.
 */
import { Sunrise, Sun, Sunset, ArrowUp, ArrowDown, Minus } from 'lucide-react';

const TIME_WINDOWS = [
  { id: 'dawn', label: 'Dawn Patrol', icon: Sunrise, time: '5am - 8am', color: 'text-orange-400' },
  { id: 'morning', label: 'Morning', icon: Sun, time: '8am - 12pm', color: 'text-yellow-400' },
  { id: 'afternoon', label: 'Afternoon', icon: Sun, time: '12pm - 5pm', color: 'text-amber-400' },
  { id: 'evening', label: 'Evening', icon: Sunset, time: '5pm - 8pm', color: 'text-purple-400' },
];

// Tide state options
const TIDE_STATES = [
  { id: 'low', label: 'Low Tide', icon: ArrowDown, color: 'text-cyan-400' },
  { id: 'mid', label: 'Mid Tide', icon: Minus, color: 'text-blue-400' },
  { id: 'high', label: 'High Tide', icon: ArrowUp, color: 'text-indigo-400' },
  { id: 'rising', label: 'Rising', icon: ArrowUp, color: 'text-emerald-400' },
  { id: 'falling', label: 'Falling', icon: ArrowDown, color: 'text-amber-400' },
];

// Surf condition options
const SURF_CONDITIONS = [
  // Surface conditions
  { id: 'glassy', label: 'Glassy', description: 'Mirror-like surface', category: 'surface', emoji: '\u{1FA9E}' },
  { id: 'clean', label: 'Clean', description: 'Light texture, good shape', category: 'surface', emoji: '\u{2728}' },
  { id: 'choppy', label: 'Choppy', description: 'Bumpy, textured surface', category: 'surface', emoji: '\u{1F4A8}' },
  { id: 'messy', label: 'Messy', description: 'Disorganized waves', category: 'surface', emoji: '\u{1F300}' },
  
  // Wind conditions
  { id: 'offshore', label: 'Offshore Wind', description: 'Wind from land to sea', category: 'wind', emoji: '\u{1F343}' },
  { id: 'onshore', label: 'Onshore Wind', description: 'Wind from sea to land', category: 'wind', emoji: '\u{1F32C}\u{FE0F}' },
  { id: 'cross-shore', label: 'Cross-shore', description: 'Side wind', category: 'wind', emoji: '\u{27A1}\u{FE0F}' },
  { id: 'light-wind', label: 'Light Wind', description: 'Under 10 knots', category: 'wind', emoji: '\u{1F33F}' },
  { id: 'no-wind', label: 'No Wind', description: 'Calm conditions', category: 'wind', emoji: '\u{1F54A}\u{FE0F}' },
  
  // Wave quality
  { id: 'hollow', label: 'Hollow', description: 'Barreling waves', category: 'quality', emoji: '\u{1F30A}' },
  { id: 'steep', label: 'Steep', description: 'Fast, vertical faces', category: 'quality', emoji: '\u{26A1}' },
  { id: 'mellow', label: 'Mellow', description: 'Gentle, forgiving waves', category: 'quality', emoji: '\u{1F60C}' },
  { id: 'powerful', label: 'Powerful', description: 'Strong, heavy waves', category: 'quality', emoji: '\u{1F4AA}' },
  { id: 'peaky', label: 'Peaky', description: 'A-frame peaks', category: 'quality', emoji: '\u{1F3D4}\u{FE0F}' },
  { id: 'walled', label: 'Walled', description: 'Long, unbroken faces', category: 'quality', emoji: '\u{1F9F1}' },
  
  // Crowd conditions
  { id: 'uncrowded', label: 'Uncrowded', description: 'Few surfers out', category: 'crowd', emoji: '\u{1F3D6}\u{FE0F}' },
];

// Calculate distance between two coordinates

export { TIME_WINDOWS, TIDE_STATES, SURF_CONDITIONS };

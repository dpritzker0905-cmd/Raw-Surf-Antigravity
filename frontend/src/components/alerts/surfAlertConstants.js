/**
 * surfAlertConstants.js � Shared surf alert configuration constants.
 * Extracted from SurfAlerts.js to reduce component size.
 */
import { Sunrise, Sun, Sunset, Moon, ArrowUp, ArrowDown, Minus, Waves, Zap, ThumbsUp, AlertTriangle, Activity, Wind } from 'lucide-react';
import React from 'react';

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
  { id: 'glassy', label: 'Glassy', description: 'Mirror-like surface', category: 'surface', emoji: '🌊' },
  { id: 'clean', label: 'Clean', description: 'Light texture, good shape', category: 'surface', emoji: '?' },
  { id: 'choppy', label: 'Choppy', description: 'Bumpy, textured surface', category: 'surface', emoji: '🌊' },
  { id: 'messy', label: 'Messy', description: 'Disorganized waves', category: 'surface', emoji: '🌊' },
  
  // Wind conditions
  { id: 'offshore', label: 'Offshore Wind', description: 'Wind from land to sea', category: 'wind', emoji: '???' },
  { id: 'onshore', label: 'Onshore Wind', description: 'Wind from sea to land', category: 'wind', emoji: '🌊' },
  { id: 'cross-shore', label: 'Cross-shore', description: 'Side wind', category: 'wind', emoji: '🌊' },
  { id: 'light-wind', label: 'Light Wind', description: 'Under 10 knots', category: 'wind', emoji: '🌊' },
  { id: 'no-wind', label: 'No Wind', description: 'Calm conditions', category: 'wind', emoji: '🌊' },
  
  // Wave quality
  { id: 'hollow', label: 'Hollow', description: 'Barreling waves', category: 'quality', emoji: '🌊' },
  { id: 'steep', label: 'Steep', description: 'Fast, vertical faces', category: 'quality', emoji: '🌊' },
  { id: 'mellow', label: 'Mellow', description: 'Gentle, forgiving waves', category: 'quality', emoji: '🌊' },
  { id: 'powerful', label: 'Powerful', description: 'Strong, heavy waves', category: 'quality', emoji: '🌊' },
  { id: 'peaky', label: 'Peaky', description: 'A-frame peaks', category: 'quality', emoji: '🌊' },
  { id: 'walled', label: 'Walled', description: 'Long, unbroken faces', category: 'quality', emoji: '🌊' },
  
  // Crowd conditions
  { id: 'uncrowded', label: 'Uncrowded', description: 'Few surfers out', category: 'crowd', emoji: '???' },
];

// Calculate distance between two coordinates

export { TIME_WINDOWS, TIDE_STATES, SURF_CONDITIONS };

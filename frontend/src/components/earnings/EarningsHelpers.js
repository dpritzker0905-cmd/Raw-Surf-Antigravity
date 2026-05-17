/**
 * EarningsHelpers - Extracted from EarningsDashboard.js
 * Contains helper utilities and presentational sub-components:
 * - getCommissionRate: Commission rate lookup by subscription tier
 * - STREAM_COLORS: Revenue stream color/icon configuration
 * - ProgressRing: SVG ring component for gear fund progress
 * - RevenueBarChart: Horizontal bar chart for revenue by stream
 */
import React from 'react';
import { Camera, Calendar, Image, Users } from 'lucide-react';

// Helper function to get commission rate based on subscription tier
export var getCommissionRate = (subscriptionTier) => {
  // Check localStorage for admin-configured rates first
  const savedRates = localStorage.getItem('admin_commission_rates');
  if (savedRates) {
    try {
      const adminRates = JSON.parse(savedRates);
      const tier = subscriptionTier?.toLowerCase?.() || 'free';
      // Map alternate tier names to standard names
      const tierMap = { 'basic': 'tier_2', 'premium': 'tier_3', 'pro': 'tier_3' };
      const normalizedTier = tierMap[tier] || tier;
      if (adminRates[normalizedTier] !== undefined) {
        return adminRates[normalizedTier] / 100;
      }
    } catch (e) {
      // Fall through to defaults
    }
  }
  
  // Default commission rates by tier (handles multiple naming conventions)
  const COMMISSION_RATES = {
    'free': 0.25,
    'tier_1': 0.25,
    'tier_2': 0.20,
    'basic': 0.20,      // Alias for tier_2
    'tier_3': 0.15,
    'premium': 0.15,    // Alias for tier_3
    'pro': 0.15,        // Alias for tier_3
  };
  
  const tier = subscriptionTier?.toLowerCase?.() || 'free';
  return COMMISSION_RATES[tier] || COMMISSION_RATES.free;
};

// Revenue Stream Colors
export var STREAM_COLORS = {
  live_sessions: { bg: 'from-cyan-500 to-blue-500', text: 'text-cyan-400', icon: Camera },
  request_pro: { bg: 'from-purple-500 to-pink-500', text: 'text-purple-400', icon: Users },
  regular_bookings: { bg: 'from-amber-500 to-orange-500', text: 'text-amber-400', icon: Calendar },
  gallery_sales: { bg: 'from-emerald-500 to-green-500', text: 'text-emerald-400', icon: Image }
};

// Progress Ring Component for Gear Fund
export var ProgressRing = ({ progress, size = 120, strokeWidth = 8, color = 'cyan' }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        <circle
          className="text-zinc-800"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className={`text-${color}-400 transition-all duration-500 ease-out`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{Math.round(progress)}%</span>
        <span className="text-xs text-gray-400">complete</span>
      </div>
    </div>
  );
};

// Revenue Bar Chart Component
export var RevenueBarChart = ({ data, maxValue }) => {
  const streams = ['live_sessions', 'request_pro', 'regular_bookings', 'gallery_sales'];
  const labels = ['Live Sessions', 'Request Pro', 'Bookings', 'Gallery'];
  
  return (
    <div className="space-y-3">
      {streams.map((stream, i) => {
        const value = data[stream] || 0;
        const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
        const StreamIcon = STREAM_COLORS[stream].icon;
        
        return (
          <div key={stream} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <StreamIcon className={`w-4 h-4 ${STREAM_COLORS[stream].text}`} />
                <span className="text-gray-300">{labels[i]}</span>
              </div>
              <span className="text-white font-medium">${value.toFixed(2)}</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className={`h-full bg-gradient-to-r ${STREAM_COLORS[stream].bg} rounded-full transition-all duration-500`}
                style={{ width: `${Math.max(percentage, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

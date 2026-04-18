import React from 'react';
import { Award, Sparkles, Camera, Heart, TrendingUp, Star, Zap } from 'lucide-react';

// Badge configuration
const BADGE_CONFIG = {
  the_patron: {
    icon: Heart,
    label: 'The Patron',
    description: 'Supports the surf community',
    color: 'from-pink-500 to-rose-500',
    textColor: 'text-pink-400'
  },
  the_workhorse: {
    icon: Camera,
    label: 'The Workhorse',
    description: 'Consistent session shooter',
    color: 'from-cyan-500 to-blue-500',
    textColor: 'text-cyan-400'
  },
  the_sharpshooter: {
    icon: TrendingUp,
    label: 'The Sharpshooter',
    description: 'High gallery conversion rate',
    color: 'from-amber-500 to-orange-500',
    textColor: 'text-amber-400'
  },
  the_benefactor: {
    icon: Sparkles,
    label: 'The Benefactor',
    description: 'Major community contributor',
    color: 'from-purple-500 to-violet-500',
    textColor: 'text-purple-400'
  }
};

// Tier configuration
const TIER_CONFIG = {
  bronze: { border: 'border-amber-600', bg: 'bg-amber-600/20', label: 'Bronze' },
  silver: { border: 'border-gray-400', bg: 'bg-gray-400/20', label: 'Silver' },
  gold: { border: 'border-yellow-400', bg: 'bg-yellow-400/20', label: 'Gold' },
  platinum: { border: 'border-cyan-400', bg: 'bg-cyan-400/20', label: 'Platinum' }
};

// XP Display Component
export const XPDisplay = ({ xp = 0, size = 'md', showLabel = true }) => {
  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-lg',
    lg: 'text-2xl'
  };
  
  return (
    <div className="flex items-center gap-1.5">
      <Zap className={`${size === 'sm' ? 'w-3 h-3' : size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'} text-yellow-400`} />
      <span className={`font-bold text-yellow-400 ${sizeClasses[size]}`}>{xp.toLocaleString()}</span>
      {showLabel && <span className={`text-gray-500 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>XP</span>}
    </div>
  );
};

// Single Badge Icon Component
export const BadgeIcon = ({ badgeType, tier = 'bronze', size = 'md', showTooltip = true }) => {
  const config = BADGE_CONFIG[badgeType];
  const tierConfig = TIER_CONFIG[tier];
  
  if (!config) return null;
  
  const Icon = config.icon;
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };
  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };
  
  return (
    <div className="relative group" title={showTooltip ? `${config.label} (${tierConfig.label})` : undefined}>
      <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br ${config.color} p-[2px] shadow-lg`}>
        <div className={`w-full h-full rounded-full bg-zinc-900 flex items-center justify-center border-2 ${tierConfig.border}`}>
          <Icon className={`${iconSizes[size]} text-white`} />
        </div>
      </div>
      {/* Tier indicator */}
      <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${tierConfig.bg} ${tierConfig.border} border flex items-center justify-center`}>
        <span className="text-[8px] font-bold text-white">{tierConfig.label[0]}</span>
      </div>
    </div>
  );
};

// Badge Row Component (shows all earned badges)
export const BadgeRow = ({ badges = [], size = 'sm', maxDisplay = 4 }) => {
  if (!badges || badges.length === 0) return null;
  
  const displayBadges = badges.slice(0, maxDisplay);
  const remaining = badges.length - maxDisplay;
  
  return (
    <div className="flex items-center gap-2">
      {displayBadges.map((badge, i) => (
        <BadgeIcon 
          key={i} 
          badgeType={badge.badge_type} 
          tier={badge.tier} 
          size={size} 
        />
      ))}
      {remaining > 0 && (
        <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs text-gray-400">
          +{remaining}
        </div>
      )}
    </div>
  );
};

// Profile Badge Section (detailed view)
export const ProfileBadgeSection = ({ badges = [], totalXP = 0 }) => {
  if (!badges || badges.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        <Award className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No badges earned yet</p>
        <p className="text-xs">Start participating to earn badges!</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Total XP */}
      <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
        <span className="text-gray-400 text-sm">Total XP</span>
        <XPDisplay xp={totalXP} size="md" />
      </div>
      
      {/* Badge Grid */}
      <div className="grid grid-cols-2 gap-3">
        {badges.map((badge, i) => {
          const config = BADGE_CONFIG[badge.badge_type];
          const tierConfig = TIER_CONFIG[badge.tier];
          
          if (!config) return null;
          const Icon = config.icon;
          
          return (
            <div key={i} className={`p-3 rounded-lg bg-zinc-800/50 border ${tierConfig.border}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${config.color} p-[2px]`}>
                  <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{config.label}</p>
                  <p className="text-gray-500 text-xs">{tierConfig.label}</p>
                </div>
              </div>
              <p className="text-gray-400 text-xs">{config.description}</p>
              {badge.xp_earned > 0 && (
                <div className="mt-2 flex items-center gap-1 text-xs text-yellow-400">
                  <Zap className="w-3 h-3" />
                  <span>{badge.xp_earned} XP earned</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Surfer Rating Badge (shown to photographers during booking)
export const SurferRatingBadge = ({ punctuality, communication, totalSessions = 0 }) => {
  const avgRating = (punctuality + communication) / 2;
  
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-3 h-3 ${star <= avgRating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
          />
        ))}
      </div>
      <span className="text-gray-400 text-xs">({totalSessions} sessions)</span>
    </div>
  );
};

// Achievement Unlocked Toast Component
export const AchievementUnlockedToast = ({ badge }) => {
  const config = BADGE_CONFIG[badge?.badge_type];
  if (!config) return null;
  
  const Icon = config.icon;
  
  return (
    <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-zinc-800 to-zinc-900 rounded-lg border border-yellow-500/50">
      <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${config.color} p-[2px] animate-pulse`}>
        <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center">
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
      <div>
        <p className="text-yellow-400 text-xs font-medium">Achievement Unlocked!</p>
        <p className="text-white font-bold">{config.label}</p>
        <p className="text-gray-400 text-xs">{config.description}</p>
      </div>
    </div>
  );
};

export default {
  XPDisplay,
  BadgeIcon,
  BadgeRow,
  ProfileBadgeSection,
  SurferRatingBadge,
  AchievementUnlockedToast
};

import React, { useState, useEffect } from 'react';
import { Crown, X, Timer } from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import { Badge } from '../ui/badge';


// Surfboard colors for each position
var SURFBOARD_COLORS = [
  { fill: '#FCD34D', stroke: '#F59E0B' }, // Yellow (captain)
  { fill: '#22D3EE', stroke: '#0891B2' }, // Cyan
  { fill: '#F472B6', stroke: '#DB2777' }, // Pink
  { fill: '#A78BFA', stroke: '#7C3AED' }, // Purple
  { fill: '#34D399', stroke: '#059669' }, // Green
  { fill: '#FB923C', stroke: '#EA580C' }, // Orange
  { fill: '#60A5FA', stroke: '#2563EB' }, // Blue
];

var SurferPosition = ({ 
  member, 
  position, 
  isCaptain, 
  isCurrentUser,
  canRemove,
  onRemove,
  _pricePerPerson,
  isLight,
  loading
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const _textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  
  // Countdown timer state for pending invites
  const [timeLeft, setTimeLeft] = useState(null);
  
  useEffect(() => {
    if (!member.expires_at) return;
    
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expiresAt = new Date(member.expires_at).getTime();
      const diff = expiresAt - now;
      
      if (diff <= 0) {
        setTimeLeft({ expired: true });
        return;
      }
      
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      setTimeLeft({ hours, minutes, seconds, expired: false });
    };
    
    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    
    return () => clearInterval(timer);
  }, [member.expires_at]);
  
  // Get surfboard color based on position
  const boardColor = SURFBOARD_COLORS[position % SURFBOARD_COLORS.length];
  
  // Status colors - with pulsing animation for pending
  const getStatusColor = (status) => {
    switch (status) {
      case 'confirmed':
      case 'Paid':
        return { bg: 'bg-green-500', ring: 'ring-green-400', badge: 'In Position', animate: '' };
      case 'pending':
      case 'Pending':
        return { bg: 'bg-yellow-500', ring: 'ring-yellow-400', badge: 'Paddling Out', animate: 'animate-pulse' };
      case 'invited':
        return { bg: 'bg-blue-500', ring: 'ring-blue-400', badge: 'On the Beach', animate: 'animate-pulse' };
      default:
        return { bg: 'bg-gray-500', ring: 'ring-gray-400', badge: status, animate: '' };
    }
  };
  
  const statusInfo = getStatusColor(member.payment_status || member.status);
  const isPending = member.status === 'pending' || member.status === 'invited' || member.payment_status === 'Pending';
  
  // Format countdown display
  const formatCountdown = () => {
    if (!timeLeft || timeLeft.expired) return null;
    if (timeLeft.hours > 0) {
      return `${timeLeft.hours}h ${timeLeft.minutes}m`;
    }
    return `${timeLeft.minutes}m ${timeLeft.seconds}s`;
  };
  
  return (
    <div className={`relative group ${isCaptain ? 'z-20' : 'z-10'}`}>
      {/* Surfboard underneath the avatar */}
      <div className="relative">
        {/* Surfboard SVG */}
        <svg 
          viewBox="0 0 60 100" 
          className="absolute left-1/2 -translate-x-1/2 top-4 w-16 h-24 pointer-events-none"
          style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
        >
          {/* Surfboard shape */}
          <ellipse 
            cx="30" 
            cy="50" 
            rx="14" 
            ry="42" 
            fill={boardColor.fill}
            stroke={boardColor.stroke}
            strokeWidth="2"
          />
          {/* Stringer line */}
          <line 
            x1="30" 
            y1="10" 
            x2="30" 
            y2="90" 
            stroke={boardColor.stroke}
            strokeWidth="1.5"
            opacity="0.6"
          />
          {/* Nose detail */}
          <ellipse 
            cx="30" 
            cy="14" 
            rx="4" 
            ry="3" 
            fill={boardColor.stroke}
            opacity="0.4"
          />
          {/* Fin */}
          <path 
            d="M30 82 L26 92 L30 88 L34 92 Z" 
            fill={boardColor.stroke}
            opacity="0.7"
          />
        </svg>
        
        {/* Surfer Avatar - positioned on top of surfboard */}
        <div className="relative z-10">
          <div className={`w-14 h-14 rounded-full overflow-hidden ring-2 ${statusInfo.ring} ${
            isCaptain ? 'ring-4 ring-yellow-400' : ''
          } transition-all group-hover:scale-105`}>
            {member.avatar_url ? (
              <img loading="lazy" decoding="async" src={getFullUrl(member.avatar_url)} alt={member.name} className="w-full h-full object-cover" />
            ) : (
              <div className={`w-full h-full flex items-center justify-center ${
                isCaptain ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 'bg-gradient-to-br from-cyan-400 to-blue-500'
              }`}>
                <span className="text-white font-bold text-lg">
                  {member.name?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
            )}
          </div>
          
          {/* Captain Crown */}
          {isCaptain && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <Crown className="w-5 h-5 text-yellow-400 drop-shadow-lg" />
            </div>
          )}
          
          {/* Status indicator dot */}
          <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${statusInfo.bg} ${statusInfo.animate} border-2 ${
            isLight ? 'border-white' : 'border-zinc-900'
          }`} />
          
          {/* Remove button - only for captain to remove others */}
          {canRemove && !isCaptain && (
            <button
              onClick={() => onRemove(member.participant_id, member.name)}
              disabled={loading}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
              title="Remove from lineup"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      
      {/* Name & Status Label - pushed down to accommodate surfboard */}
      <div className="text-center mt-10 max-w-[80px]">
        <p className={`text-xs font-medium ${textPrimary} truncate`}>
          {isCurrentUser ? 'You' : member.name?.split(' ')[0]}
        </p>
        <Badge className={`text-[10px] px-1.5 py-0 ${statusInfo.animate} ${
          statusInfo.bg === 'bg-green-500' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
          statusInfo.bg === 'bg-yellow-500' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
          'bg-blue-500/20 text-blue-400 border-blue-500/30'
        }`}>
          {statusInfo.badge}
        </Badge>
        
        {/* Countdown Timer for pending invites */}
        {isPending && timeLeft && !timeLeft.expired && (
          <div className="mt-1 flex items-center justify-center gap-1">
            <Timer className="w-3 h-3 text-orange-400" />
            <span className={`text-[10px] font-mono ${
              timeLeft.hours === 0 && timeLeft.minutes < 30 ? 'text-red-400' : 'text-orange-400'
            }`}>
              {formatCountdown()}
            </span>
          </div>
        )}
        {isPending && timeLeft?.expired && (
          <div className="mt-1 flex items-center justify-center gap-1 text-red-400">
            <span className="text-[10px]">Expired</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Empty Seat Component - Surfboard silhouette waiting to be filled

export default SurferPosition;

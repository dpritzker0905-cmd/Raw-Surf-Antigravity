/**
 * ParticipantCard -- Extracted from PhotographerSessionManager.js (v77)
 * Displays a single session participant with surfboard color, avatar,
 * status badge, countdown timer, and selfie preview modal.
 */
import React, { useState, useEffect } from 'react';
import {
  Camera, Clock, AlertTriangle, Loader2,
  Timer, XCircle, CheckCircle, Mail, UserCircle, X
} from 'lucide-react';
import { getFullUrl } from '../../utils/media';

// Surfboard colors for visual consistency with LineupManagerDrawer
const SURFBOARD_COLORS = [
  { fill: '#22D3EE', stroke: '#0891B2' },
  { fill: '#F472B6', stroke: '#DB2777' },
  { fill: '#A78BFA', stroke: '#7C3AED' },
  { fill: '#34D399', stroke: '#059669' },
  { fill: '#FB923C', stroke: '#EA580C' },
  { fill: '#60A5FA', stroke: '#2563EB' },
  { fill: '#FCD34D', stroke: '#F59E0B' },
];

export { SURFBOARD_COLORS };

const ParticipantCard = ({ 
  participant, 
  position, 
  canRemove, 
  onRemove, 
  isLight,
  loading 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const boardColor = SURFBOARD_COLORS[position % SURFBOARD_COLORS.length];
  
  // Selfie preview state
  const [showSelfie, setShowSelfie] = useState(false);
  
  // Countdown timer state for pending invites
  const [timeLeft, setTimeLeft] = useState(null);
  
  useEffect(() => {
    if (!participant.expires_at) return;
    
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expiresAt = new Date(participant.expires_at).getTime();
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
    const interval = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [participant.expires_at]);
  
  const getStatusInfo = (status, paymentStatus) => {
    if (paymentStatus === 'Paid' || status === 'confirmed') {
      return { color: 'green', label: 'Confirmed', icon: CheckCircle };
    }
    if (paymentStatus === 'Pending' || status === 'pending') {
      return { color: 'yellow', label: 'Pending Payment', icon: Clock };
    }
    if (status === 'invited') {
      return { color: 'blue', label: 'Invited', icon: Mail };
    }
    return { color: 'gray', label: status || 'Unknown', icon: AlertTriangle };
  };
  
  const statusInfo = getStatusInfo(participant.status, participant.payment_status);
  const StatusIcon = statusInfo.icon;
  
  // Format countdown display
  const formatCountdown = () => {
    if (!timeLeft) return null;
    if (timeLeft.expired) return <span className="text-red-400 text-xs">Expired</span>;
    
    if (timeLeft.hours > 0) {
      return `${timeLeft.hours}h ${timeLeft.minutes}m`;
    }
    return `${timeLeft.minutes}m ${timeLeft.seconds}s`;
  };
  
  const hasSelfie = participant.selfie_url || participant.media_url;
  
  return (
    <>
      <div className={`flex items-center gap-3 p-3 rounded-xl ${
        isLight ? 'bg-gray-50 border border-gray-200' : 'bg-zinc-800/50 border border-zinc-700'
      } group transition-all hover:shadow-md ${timeLeft?.expired ? 'opacity-60' : ''}`}>
        {/* Surfboard + Avatar */}
        <div className="relative">
          <svg 
            viewBox="0 0 40 60" 
            className="absolute left-1/2 -translate-x-1/2 top-1 w-10 h-14 pointer-events-none"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
          >
            <ellipse cx="20" cy="30" rx="9" ry="26" fill={boardColor.fill} stroke={boardColor.stroke} strokeWidth="1.5" />
            <line x1="20" y1="6" x2="20" y2="54" stroke={boardColor.stroke} strokeWidth="1" opacity="0.5" />
          </svg>
          
          <div className={`relative z-10 w-10 h-10 rounded-full overflow-hidden ring-2 ${
            statusInfo.color === 'green' ? 'ring-green-400' :
            statusInfo.color === 'yellow' ? 'ring-yellow-400' :
            statusInfo.color === 'blue' ? 'ring-blue-400' : 'ring-gray-400'
          }`}>
            {participant.avatar_url ? (
              <img loading="lazy" decoding="async" src={getFullUrl(participant.avatar_url)} alt={participant.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-400 to-blue-500 text-white font-bold">
                {participant.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
          </div>
          
          {/* Selfie indicator badge */}
          {hasSelfie && (
            <button aria-label="Camera"
              onClick={() => setShowSelfie(true)}
              className="absolute -bottom-1 -right-1 z-20 w-5 h-5 bg-cyan-500 rounded-full flex items-center justify-center shadow-lg hover:bg-cyan-400 transition-colors"
              title="View ID selfie"
            >
              <Camera className="w-3 h-3 text-white" />
            </button>
          )}
        </div>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${textPrimary} truncate`}>{participant.name || 'Unknown Surfer'}</p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <StatusIcon className={`w-3 h-3 text-${statusInfo.color}-400`} />
              <span className={`text-xs text-${statusInfo.color}-400`}>{statusInfo.label}</span>
            </div>
            {/* Countdown Timer for Pending */}
            {timeLeft && !timeLeft.expired && (participant.status === 'pending' || participant.status === 'invited') && (
              <div className="flex items-center gap-1 text-xs text-amber-400">
                <Timer className="w-3 h-3" />
                <span>{formatCountdown()}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Selfie View Button (if available) */}
        {hasSelfie && (
          <button aria-label="User Circle"
            onClick={() => setShowSelfie(true)}
            className={`p-1.5 rounded-lg text-cyan-400 hover:bg-cyan-500/10 transition-colors ${
              isLight ? 'hover:bg-cyan-100' : ''
            }`}
            title="View ID selfie"
          >
            <UserCircle className="w-4 h-4" />
          </button>
        )}
        
        {/* Price */}
        <div className="text-right">
          <p className={`font-bold ${textPrimary}`}>${participant.paid_amount || participant.amount_paid || participant.price || '0'}</p>
          <p className={`text-xs ${textSecondary}`}>
            {participant.payment_status === 'Paid' ? 'Paid' : 'Due'}
          </p>
        </div>
        
        {/* Remove Button */}
        {canRemove && (
          <button aria-label="Loader2"
            onClick={() => onRemove(participant.participant_id || participant.id, participant.name)}
            disabled={loading}
            className="p-2 rounded-full text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
            title="Remove from session"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
          </button>
        )}
      </div>
      
      {/* Selfie Preview Modal */}
      {showSelfie && hasSelfie && (
        <div 
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowSelfie(false)}
        >
          <div 
            className="bg-zinc-900 rounded-2xl max-w-sm w-full overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {participant.avatar_url ? (
                  <img loading="lazy" decoding="async" src={getFullUrl(participant.avatar_url)} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white font-bold">
                    {participant.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div>
                  <p className="font-medium text-white">{participant.name}</p>
                  <p className="text-xs text-gray-400">ID Selfie for recognition</p>
                </div>
              </div>
              <button
                onClick={() => setShowSelfie(false)}
                className="p-2 rounded-full hover:bg-zinc-800 text-gray-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative aspect-[3/4] bg-black">
              <img loading="lazy" decoding="async" 
                src={participant.selfie_url || participant.media_url} 
                alt={`${participant.name}'s ID selfie`}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-4 bg-zinc-800/50 text-center">
              <p className="text-xs text-gray-400">
                Use this photo to help identify {participant.name?.split(' ')[0]} during the session
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ParticipantCard;

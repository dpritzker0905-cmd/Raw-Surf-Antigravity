/**
 * ActiveSessionCard — Shows the current active on-demand session.
 * Displays surfer info, timer, crew, chat preview, and session actions.
 * 
 * Extracted from OnDemandSessionManager.js for maintainability.
 */
import React, { useState, useEffect } from 'react';
import {
  MapPin, Camera, User, Navigation, Check, X,
  Loader2, Square, Eye, MessageCircle, Mic
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';
import { formatDuration } from '../../utils/formatTime';

const getImageUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('/api')) {
    return ```;
  }
  return url;
};
const ActiveSessionCard = ({ 
  session, 
  onMarkArrived, 
  onComplete, 
  onCancel,
  onOpenChat,
  _cardBg,
  textPrimary, 
  textSecondary,
  sectionBg,
  chatUnreadCount = 0,
  chatLatestMessage = null
}) => {
  const [elapsedTime, setElapsedTime] = useState(0);
  
  useEffect(() => {
    if (session.status !== 'arrived') return;
    
    const startTime = session.arrived_at ? new Date(session.arrived_at) : new Date();
    const updateTimer = () => {
      setElapsedTime(Math.floor((Date.now() - startTime.getTime()) / 1000));
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session.status, session.arrived_at]);
  
  const formatTime = formatDuration;
  
  const isEnRoute = session.status === 'en_route';
  const isArrived = session.status === 'arrived';
  
  return (
    <Card className={`overflow-hidden ${isArrived 
      ? 'bg-gradient-to-r from-green-500/20 to-cyan-500/20 border-green-400/50' 
      : 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-400/50'}`}
      data-testid="active-session-card"
    >
      {/* Status Header */}
      <div className={`px-4 py-3 flex items-center justify-between ${isArrived ? 'bg-green-500/30' : 'bg-amber-500/30'}`}>
        <div className="flex items-center gap-2 text-white">
          {isArrived ? (
            <Camera className="w-5 h-5" />
          ) : (
            <Navigation className="w-5 h-5" />
          )}
          <span className="font-bold">{isArrived ? 'In Session' : 'En Route'}</span>
        </div>
        {isArrived && (
          <div className="text-white font-mono text-xl font-bold">
            {formatTime(elapsedTime)}
          </div>
        )}
        {isEnRoute && session.eta_minutes && (
          <div className="text-white font-bold">
            ETA: ~{session.eta_minutes} min
          </div>
        )}
      </div>
      
      <CardContent className="p-4 space-y-4">
        {/* Surfer Info */}
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden bg-zinc-700 flex-shrink-0 ring-2 ring-cyan-400/30">
            {session.requester_selfie ? (
              <img src={getImageUrl(session.requester_selfie)} alt="Surfer" className="w-full h-full object-cover" />
            ) : session.requester_avatar ? (
              <img src={getFullUrl(getImageUrl(session.requester_avatar))} alt="Surfer" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-8 h-8 text-zinc-500" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className={`font-bold text-lg ${textPrimary}`}>{session.requester_name || 'Surfer'}</p>
            {session.requester_username && (
              <button
                onClick={(e) => { e.stopPropagation(); window.open(`/profile/${session.requester_username}`, '_blank'); }}
                className="text-sm text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
              >
                @{session.requester_username}
              </button>
            )}
            <div className="flex items-center gap-2 mt-1">
              <MapPin className="w-4 h-4 text-cyan-400" />
              <span className={`text-sm ${textSecondary}`}>{session.location_name || 'Meeting Point'}</span>
            </div>
          </div>
        </div>
        
        {/* Session Details */}
        <div className={`grid grid-cols-2 gap-3 p-4 rounded-xl ${sectionBg}`}>
          <div>
            <p className={`text-xs ${textSecondary}`}>Duration</p>
            <p className={`font-bold ${textPrimary}`}>{(session.estimated_duration || 1) * 60} min</p>
          </div>
          <div>
            <p className={`text-xs ${textSecondary}`}>Earnings</p>
            <p className="font-bold text-green-400">${((session.hourly_rate || 75) * (session.estimated_duration || 1)).toFixed(0)}</p>
          </div>
        </div>

        {/* Surfer Identification Details */}
        {(session.requester_stance || session.requester_board_description) && (
          <div className={`p-3 rounded-xl bg-cyan-500/10 border border-cyan-400/20`}>
            <p className={`text-[10px] font-semibold ${textSecondary} uppercase tracking-wider mb-2`}>ðŸ„ Surfer Identification</p>
            <div className="flex flex-wrap items-center gap-2">
              {session.requester_stance && (
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">
                  {session.requester_stance === 'goofy' ? 'ðŸ¦¶ Goofy Foot' : 'ðŸ¦¶ Regular'}
                </span>
              )}
              {session.requester_board_description && (
                <span className={`text-xs font-medium ${textPrimary}`}>ðŸ„â€â™‚ï¸ {session.requester_board_description}</span>
              )}
            </div>
          </div>
        )}
        
        {/* Crew Selfies Section - Show all surfers the photographer needs to identify */}
        {session.is_shared && session.crew && session.crew.length > 0 && (
          <div className={`p-4 rounded-xl ${sectionBg}`}>
            <p className={`text-xs font-semibold ${textSecondary} uppercase tracking-wider mb-3`}>
              Crew Members ({session.crew.length + 1} total surfers)
            </p>
            <div className="grid grid-cols-2 gap-3">
              {/* Captain's selfie */}
              <div 
                className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/50 cursor-pointer hover:bg-zinc-700/50"
                onClick={() => session.requester_selfie && window.open(getImageUrl(session.requester_selfie), '_blank')}
              >
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-amber-400/50 flex-shrink-0">
                  {session.requester_selfie ? (
                    <img src={getImageUrl(session.requester_selfie)} alt="" className="w-full h-full object-cover" />
                  ) : session.requester_avatar ? (
                    <img src={getFullUrl(getImageUrl(session.requester_avatar))} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-amber-500/30 flex items-center justify-center">
                      <User className="w-6 h-6 text-amber-400" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{session.requester_name}</p>
                  <p className="text-xs text-amber-400">Captain</p>
                </div>
              </div>
              
              {/* Crew member selfies */}
              {session.crew.filter(m => m.paid).map((member, idx) => (
                <div 
                  key={member.id || idx}
                  className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/50 cursor-pointer hover:bg-zinc-700/50"
                  onClick={() => member.selfie_url && window.open(getImageUrl(member.selfie_url), '_blank')}
                >
                  <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-purple-400/50 flex-shrink-0">
                    {member.selfie_url ? (
                      <img src={getImageUrl(member.selfie_url)} alt="" className="w-full h-full object-cover" />
                    ) : member.avatar_url ? (
                      <img src={getFullUrl(getImageUrl(member.avatar_url))} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-purple-500/30 flex items-center justify-center">
                        <User className="w-6 h-6 text-purple-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{member.name}</p>
                    <p className="text-xs text-purple-400">@{member.username}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Pro Tip */}
        {isEnRoute && session.requester_selfie && (
          <div className={`p-3 rounded-xl bg-cyan-500/10 border border-cyan-400/30`}>
            <p className="text-cyan-400 text-sm font-medium flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Surfer uploaded an ID photo - check above!
            </p>
          </div>
        )}
        
        {/* Inline Message Preview (shows latest surfer message) */}
        {chatLatestMessage && (
          <button
            onClick={onOpenChat}
            className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-all active:scale-[0.99] ${
              chatUnreadCount > 0
                ? 'bg-cyan-500/10 border-cyan-400/40 ring-1 ring-cyan-400/30'
                : 'bg-zinc-800/50 border-zinc-700/50'
            }`}
            data-testid="inline-message-preview"
          >
            <div className="relative flex-shrink-0">
              <MessageCircle className={`w-5 h-5 mt-0.5 ${
                chatUnreadCount > 0 ? 'text-cyan-400' : 'text-zinc-500'
              }`} />
              {chatUnreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center animate-bounce">
                  {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-xs font-semibold ${
                  chatUnreadCount > 0 ? 'text-cyan-400' : 'text-zinc-400'
                }`}>
                  {session.requester_name || 'Surfer'}
                </p>
                <span className="text-[10px] text-zinc-500 flex-shrink-0">
                  {new Date(chatLatestMessage.created_at).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
              <p className={`text-sm truncate ${
                chatUnreadCount > 0 ? 'text-white font-medium' : 'text-zinc-400'
              }`}>
                {chatLatestMessage.message_type === 'voice_note'
                  ? 'ðŸŽ¤ Voice note'
                  : (chatLatestMessage.content || 'ðŸ“Ž Media')}
              </p>
            </div>
          </button>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          {/* Communication Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onOpenChat}
              className="relative flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
              data-testid="photographer-chat-btn"
            >
              <MessageCircle className="w-4 h-4" />
              Chat Surfer
              {chatUnreadCount > 0 && (
                <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold text-white flex items-center justify-center animate-bounce shadow-lg">
                  {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                </span>
              )}
            </button>
            <button
              onClick={onOpenChat}
              className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700"
              data-testid="photographer-voice-btn"
            >
              <Mic className="w-4 h-4" />
              Voice Note
            </button>
          </div>

          {isEnRoute && (
            <Button
              onClick={() => onMarkArrived(session.id)}
              className="w-full py-5 bg-gradient-to-r from-green-400 to-cyan-400 hover:from-green-500 hover:to-cyan-500 text-black font-bold"
              data-testid="mark-arrived-btn"
            >
              <Check className="w-5 h-5 mr-2" />
              I've Arrived - Start Session
            </Button>
          )}
          
          {isArrived && (
            <Button
              onClick={() => onComplete(session.id)}
              className="w-full py-5 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-black font-bold"
              data-testid="complete-session-btn"
            >
              <Square className="w-5 h-5 mr-2" />
              Complete Session
            </Button>
          )}
          
          <Button
            onClick={() => onCancel(session.id)}
            variant="outline"
            className="w-full border-zinc-600 hover:bg-zinc-800"
            data-testid="cancel-session-btn"
          >
            Cancel Session
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ActiveSessionCard;


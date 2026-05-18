/**
 * DispatchSessionHero - Active session hero card with timer, photographer info, and comm buttons
 * Extracted from DispatchLobby.js for modularization (v74)
 */
import React from 'react';
import { Camera, MessageCircle, Mic } from 'lucide-react';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';

const DispatchSessionHero = ({
  sessionActive, sessionElapsed,
  photographerName, photographerAvatarUrl,
  chatUnreadCount, setShowSessionChat,
  isLight, textPrimary,
}) => {
  if (!sessionActive) return null;

  return (
    <div
      className={`relative rounded-3xl overflow-hidden border-2 ${
        isLight
          ? 'bg-gradient-to-br from-green-50 via-emerald-50 to-cyan-50 border-green-300'
          : 'bg-gradient-to-br from-green-900/40 via-emerald-900/30 to-cyan-900/30 border-green-500/40'
      }`}
    >
      {/* Animated top bar */}
      <div className="h-1.5 bg-gradient-to-r from-green-400 via-cyan-400 to-green-400 animate-pulse" />

      <div className="p-5 space-y-4">
        {/* Status + Timer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse shadow-lg shadow-green-400/50" />
            <span className={`font-bold text-sm ${
              isLight ? 'text-green-700' : 'text-green-400'
            }`}>
              Session Active
            </span>
          </div>
          <div className={`font-mono text-2xl font-bold tabular-nums ${
            isLight ? 'text-green-700' : 'text-green-400'
          }`}>
            {Math.floor(sessionElapsed / 3600) > 0 && `${Math.floor(sessionElapsed / 3600)}:`}
            {Math.floor((sessionElapsed % 3600) / 60).toString().padStart(2, '0')}:{(sessionElapsed % 60).toString().padStart(2, '0')}
          </div>
        </div>

        {/* Photographer info row */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl overflow-hidden ring-2 ring-green-400 flex-shrink-0">
            {photographerAvatarUrl ? (
              <img loading="lazy" decoding="async"
                src={getFullUrl(photographerAvatarUrl)}
                alt={photographerName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-green-400 to-cyan-500 flex items-center justify-center">
                <Camera className="w-6 h-6 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-bold ${textPrimary} truncate`}>
              {photographerName}
            </p>
            <p className={`text-sm ${isLight ? 'text-green-600' : 'text-green-400'}`}>
 =+ Shooting your session now
            </p>
          </div>
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs flex-shrink-0">
            <Camera className="w-3 h-3 mr-1" />
            Live
          </Badge>
        </div>

        {/* Communication Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button aria-label="Message"
            onClick={() => setShowSessionChat(true)}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] ${
              isLight
                ? 'bg-cyan-500 hover:bg-cyan-600 text-white'
                : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white'
            }`}
            data-testid="session-chat-btn"
          >
            <MessageCircle className="w-5 h-5" />
            Chat
            {chatUnreadCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
                {chatUnreadCount}
              </span>
            )}
          </button>
          <button aria-label="Microphone"
            onClick={() => setShowSessionChat(true)}
            className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] ${
              isLight
                ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700'
            }`}
            data-testid="session-voice-btn"
          >
            <Mic className="w-5 h-5" />
            Voice Note
          </button>
        </div>

        {/* Session tips */}
        <p className={`text-xs text-center ${
          isLight ? 'text-green-600/70' : 'text-green-400/60'
        }`}>
          Stay nearby -+ your photographer is capturing the action!
        </p>
      </div>
    </div>
  );
};

export default DispatchSessionHero;

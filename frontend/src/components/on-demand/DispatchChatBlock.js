/**
 * DispatchChatBlock - Pre-arrival communication block with inline message preview
 * Extracted from DispatchLobby.js for modularization (v74)
 */
import React from 'react';
import { MessageCircle, Mic } from 'lucide-react';

const DispatchChatBlock = ({
  photographerName, photographerId, chatUnreadCount,
  bgLatestMessage, userId,
  setShowSessionChat, isLight, textPrimary, textSecondary,
}) => {
  if (!photographerId) return null;

  return (
    <div
      className={`rounded-2xl overflow-hidden border-2 ${
        isLight
          ? 'bg-gradient-to-br from-cyan-50 via-blue-50 to-white border-cyan-300'
          : 'bg-gradient-to-br from-cyan-900/30 via-blue-900/20 to-zinc-950 border-cyan-500/40'
      }`}
    >
      {/* Animated top bar */}
      <div className="h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-cyan-400 animate-pulse" />
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className={`w-4 h-4 ${isLight ? 'text-cyan-600' : 'text-cyan-400'}`} />
          <span className={`font-bold text-sm ${textPrimary}`}>Chat with your photographer</span>
        </div>
        <p className={`text-xs ${textSecondary}`}>
          {photographerName} is on the way! Send a message or voice note to help them find you at the beach.
        </p>

        {/* Inline message preview - shows latest photographer message */}
        {bgLatestMessage && (
          <button
            onClick={() => setShowSessionChat(true)}
            className={`w-full flex items-start gap-3 p-2.5 rounded-xl border transition-all active:scale-[0.98] ${
              chatUnreadCount > 0
                ? (isLight ? 'bg-cyan-50 border-cyan-300 ring-1 ring-cyan-200' : 'bg-cyan-500/10 border-cyan-400/40 ring-1 ring-cyan-400/20')
                : (isLight ? 'bg-white/60 border-gray-200' : 'bg-zinc-800/50 border-zinc-700/50')
            }`}
            data-testid="lobby-message-preview"
          >
            <div className="relative flex-shrink-0">
              <MessageCircle className={`w-4 h-4 mt-0.5 ${
                chatUnreadCount > 0 ? (isLight ? 'text-cyan-600' : 'text-cyan-400') : (isLight ? 'text-gray-400' : 'text-zinc-500')
              }`} />
              {chatUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center">
                  {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-xs font-semibold ${
                  chatUnreadCount > 0 ? (isLight ? 'text-cyan-700' : 'text-cyan-400') : (isLight ? 'text-gray-500' : 'text-zinc-400')
                }`}>
                  {bgLatestMessage.sender_id !== userId ? photographerName : 'You'}
                </p>
                <span className={`text-[10px] flex-shrink-0 ${isLight ? 'text-gray-400' : 'text-zinc-500'}`}>
                  {new Date(bgLatestMessage.created_at).toLocaleTimeString([], {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
              <p className={`text-sm truncate ${
                chatUnreadCount > 0 ? (isLight ? 'text-gray-900 font-medium' : 'text-white font-medium') : (isLight ? 'text-gray-500' : 'text-zinc-400')
              }`}>
                {bgLatestMessage.message_type === 'voice_note'
                  ? '=ƒÄÖn+Å Voice note'
                  : (bgLatestMessage.content || '=ƒô+ Media')}
              </p>
            </div>
          </button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button aria-label="Message"
            onClick={() => setShowSessionChat(true)}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] ${
              isLight
                ? 'bg-cyan-500 hover:bg-cyan-600 text-white'
                : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white'
            }`}
            data-testid="pre-session-chat-btn"
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
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] ${
              isLight
                ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                : 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700'
            }`}
            data-testid="pre-session-voice-btn"
          >
            <Mic className="w-5 h-5" />
            Voice Note
          </button>
        </div>
      </div>
    </div>
  );
};

export default DispatchChatBlock;

/**
 * SessionChatDrawer.js
 * 
 * Embedded in-session chat drawer for On-Demand dispatch sessions.
 * Used by BOTH surfers (DispatchLobby) and photographers (OnDemandSessionManager).
 * 
 * Features:
 * - Text messaging with quick replies
 * - Voice note recording (30s max)
 * - Real-time delivery via existing DM/conversation system
 * - Typing indicators
 * - Slide-up mobile drawer, side panel on desktop
 * 
 * Architecture:
 * - Leverages the existing /messages/* DM backend (get_or_create_conversation)
 * - Polls for new messages every 3s (aligns with dispatch polling cadence)
 * - Keyed by dispatch_id + both user IDs for deterministic conversation lookup
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import {
  X, Send, Mic, StopCircle, MessageCircle, ChevronDown,
  Loader2, Check, CheckCheck, Zap
} from 'lucide-react';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import logger from '../utils/logger';

// Quick replies for on-demand session coordination
var SESSION_QUICK_REPLIES = [
  { id: 'omw', text: "On my way! 🏃", icon: '🏃' },
  { id: 'arrived', text: "Just arrived at the spot 📍", icon: '📍' },
  { id: 'parking', text: "Looking for parking 🅿️", icon: '🅿️' },
  { id: 'ready', text: "Ready when you are! 🤙", icon: '🤙' },
  { id: 'where', text: "Where exactly are you?", icon: '📍' },
  { id: 'running_late', text: "Running a few minutes late ?", icon: '?' },
  { id: 'looking', text: "I'm looking for you 👀", icon: '👀' },
  { id: 'found', text: "Found you! Starting session 📸", icon: '📸' },
  { id: 'waves', text: "Waves are looking good! 🌊", icon: '🌊' },
  { id: 'thanks', text: "Thanks for the session! 🤙", icon: '🤙' },
];

var MAX_VOICE_DURATION = 30; // seconds

// ============ MESSAGE BUBBLE ============
var MessageBubble = ({ message, isMine, isLight }) => {
  const bgMine = isLight
    ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
    : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white';
  const bgTheirs = isLight
    ? 'bg-gray-100 text-gray-900'
    : 'bg-zinc-800 text-white';

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Voice note rendering
  if (message.message_type === 'voice_note' && message.media_url) {
    return (
      <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-2`}>
        <div
          className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${isMine ? bgMine : bgTheirs}`}
        >
          <audio
            src={getFullUrl(message.media_url)}
            controls
            className="w-full max-w-[200px]"
            style={{ height: 32 }}
          />
          {message.voice_duration_seconds && (
            <p className={`text-[10px] mt-1 ${isMine ? 'text-white/70' : 'text-gray-400'}`}>
              {Math.floor(message.voice_duration_seconds / 60)}:{(message.voice_duration_seconds % 60).toString().padStart(2, '0')}
            </p>
          )}
          <div className={`flex items-center justify-end gap-1 mt-0.5`}>
            <span className={`text-[10px] ${isMine ? 'text-white/60' : 'text-gray-400'}`}>{time}</span>
            {isMine && (
              message.is_read
                ? <CheckCheck className="w-3 h-3 text-cyan-300" />
                : <Check className="w-3 h-3 text-white/50" />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${isMine ? bgMine : bgTheirs} ${
          isMine ? 'rounded-br-md' : 'rounded-bl-md'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        <div className={`flex items-center justify-end gap-1 mt-0.5`}>
          <span className={`text-[10px] ${isMine ? 'text-white/60' : 'text-gray-400'}`}>{time}</span>
          {isMine && (
            message.is_read
              ? <CheckCheck className="w-3 h-3 text-cyan-300" />
              : <Check className="w-3 h-3 text-white/50" />
          )}
        </div>
      </div>
    </div>
  );
};

// ============ MAIN COMPONENT ============
export var SessionChatDrawer = ({
  isOpen,
  onClose,
  otherUserId,
  otherUserName,
  otherUserAvatar,
  _dispatchId,
  isLight = false,
  onUnreadChange,
}) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [_unreadCount, setUnreadCount] = useState(0);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingIntervalRef = useRef(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  // ============ INITIALIZE CONVERSATION ============
  const initConversation = useCallback(async () => {
    if (!user?.id || !otherUserId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // Check if thread exists
      const checkRes = await apiClient.get(
        `/messages/check-thread/${user.id}/${otherUserId}`
      );
      if (checkRes.data.exists && checkRes.data.conversation_id) {
        setConversationId(checkRes.data.conversation_id);
        // Load messages
        const msgRes = await apiClient.get(
          `/messages/conversation/${checkRes.data.conversation_id}`
        );
        setMessages(msgRes.data.messages || []);
        scrollToBottom();
      } else {
        // No conversation yet - will be created on first message
        setConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      logger.error('[SessionChat] Init error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, otherUserId, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      initConversation();
    }
  }, [isOpen, initConversation]);

  // ============ POLL FOR NEW MESSAGES ============
  useEffect(() => {
    if (!isOpen || !conversationId || !user?.id) return;

    const pollMessages = async () => {
      try {
        const res = await apiClient.get(
          `/messages/conversation/${conversationId}`
        );
        const newMessages = res.data.messages || [];
        setMessages(prev => {
          // Only update if there are new messages
          if (newMessages.length !== prev.length) {
            const newUnread = newMessages.filter(
              m => !m.is_read && m.sender_id !== user.id
            ).length;
            setUnreadCount(newUnread);
            if (onUnreadChange) onUnreadChange(newUnread);
            scrollToBottom();
            return newMessages;
          }
          return prev;
        });
      } catch (err) {
        logger.debug('[SessionChat] Poll error:', err);
      }
    };

    pollRef.current = setInterval(pollMessages, 3000);
    return () => clearInterval(pollRef.current);
  }, [isOpen, conversationId, user?.id, scrollToBottom]);

  // ============ SEND MESSAGE ============
  const sendMessage = async (content = inputValue) => {
    if (!content.trim() || isSending || !user?.id || !otherUserId) return;

    const messageText = content.trim();
    setInputValue('');
    setIsSending(true);
    setShowQuickReplies(false);

    try {
      const res = await apiClient.post(
        `/messages/send?sender_id=${user.id}`,
        {
          recipient_id: otherUserId,
          content: messageText,
          message_type: 'text',
        }
      );

      // If conversation was just created, save the ID
      if (res.data.conversation_id && !conversationId) {
        setConversationId(res.data.conversation_id);
      }

      // Optimistically add the message
      const optimisticMsg = {
        id: res.data.id || Date.now().toString(),
        sender_id: user.id,
        content: messageText,
        message_type: 'text',
        is_read: false,
        created_at: new Date().toISOString(),
        is_mine: true,
      };
      setMessages(prev => [...prev, optimisticMsg]);
      scrollToBottom();
    } catch (err) {
      logger.error('[SessionChat] Send error:', err);
      toast.error('Failed to send message');
      setInputValue(messageText); // Restore input
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // ============ VOICE RECORDING ============
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadVoiceNote(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= MAX_VOICE_DURATION - 1) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      logger.error('[SessionChat] Mic error:', err);
      toast.error('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      setRecordingTime(0);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
      audioChunksRef.current = [];
    }
  };

  const uploadVoiceNote = async (audioBlob) => {
    if (!otherUserId || !user?.id) return;
    setIsUploadingVoice(true);
    try {
      // If no conversation exists yet, create one first with a placeholder
      let cId = conversationId;
      if (!cId) {
        const initRes = await apiClient.post(
          `/messages/send?sender_id=${user.id}`,
          { recipient_id: otherUserId, content: '', message_type: 'text' }
        );
        cId = initRes.data.conversation_id;
        if (cId) setConversationId(cId);
      }

      if (!cId) {
        toast.error('Could not start conversation');
        return;
      }

      // Upload the actual audio file via the voice-note endpoint
      const formData = new FormData();
      formData.append('file', audioBlob, `voice_${Date.now()}.webm`);
      formData.append('duration', recordingTime.toString());
      formData.append('conversation_id', cId);
      formData.append('sender_id', user.id);

      await apiClient.post('/messages/voice-note', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success('Voice note sent!');

      // Refresh messages
      const msgRes = await apiClient.get(
        `/messages/conversation/${cId}`
      );
      setMessages(msgRes.data.messages || []);
      scrollToBottom();
    } catch (err) {
      logger.error('[SessionChat] Voice upload error:', err);
      toast.error('Failed to send voice note');
    } finally {
      setIsUploadingVoice(false);
      setRecordingTime(0);
    }
  };

  // ============ THEME CLASSES ============
  const bgDrawer = isLight ? 'bg-white' : 'bg-zinc-950';
  const bgHeader = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-800';
  const bgInput = isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800 border-zinc-700';
  const bgMessages = isLight ? 'bg-gray-50' : 'bg-zinc-950';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col" data-testid="session-chat-drawer">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer Content - full screen on mobile, side panel on desktop */}
      <div
        className={`relative w-full sm:ml-auto sm:w-[420px] h-full sm:h-full flex flex-col ${bgDrawer} sm:rounded-none shadow-2xl animate-in slide-in-from-bottom sm:slide-in-from-right duration-300`}
      >
        {/* ============ HEADER ============ */}
        <div className={`flex items-center gap-3 px-4 py-3 border-b ${bgHeader} flex-shrink-0`}
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }}
        >
          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-800'
            }`}
          >
            <ChevronDown className={`w-5 h-5 ${textPrimary} sm:hidden`} />
            <X className={`w-5 h-5 ${textPrimary} hidden sm:block`} />
          </button>

          {/* Other user info */}
          <div className="flex items-center gap-3 flex-1">
            <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-cyan-400/50 flex-shrink-0">
              {otherUserAvatar ? (
                <img loading="lazy" decoding="async"
                  src={getFullUrl(otherUserAvatar)}
                  alt={otherUserName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">
                    {(otherUserName || '?')[0]?.toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className={`font-semibold text-sm ${textPrimary} truncate`}>
                {otherUserName || 'Session Chat'}
              </p>
              <p className="text-xs text-cyan-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                In Session
              </p>
            </div>
          </div>

          {/* Session badge */}
          <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[10px] flex-shrink-0">
            <Zap className="w-3 h-3 mr-0.5" />
            Live
          </Badge>
        </div>

        {/* ============ MESSAGES AREA ============ */}
        <div className={`flex-1 overflow-y-auto px-4 py-3 ${bgMessages}`} aria-live="polite" aria-relevant="additions" data-testid="session-chat-messages" data-testid="session-chat-messages">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-cyan-400" />
              </div>
              <p className={`font-semibold ${textPrimary} mb-1`}>Session Chat</p>
              <p className={`text-sm ${textSecondary}`}>
                Coordinate with {otherUserName || 'your partner'} - send a message or quick reply below!
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isMine={msg.is_mine || msg.sender_id === user?.id}
                  isLight={isLight}
                />
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* ============ QUICK REPLIES ============ */}
        {showQuickReplies && (
          <div className={`px-4 py-2 border-t ${isLight ? 'border-gray-200 bg-white' : 'border-zinc-800 bg-zinc-900'}`}>
            <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
              {SESSION_QUICK_REPLIES.map((qr) => (
                <button
                  key={qr.id}
                  onClick={() => sendMessage(qr.text)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 ${
                    isLight
                      ? 'bg-gray-100 hover:bg-cyan-50 text-gray-700 hover:text-cyan-600 border border-gray-200 hover:border-cyan-300'
                      : 'bg-zinc-800 hover:bg-cyan-500/20 text-gray-300 hover:text-cyan-400 border border-zinc-700 hover:border-cyan-500/40'
                  }`}
                >
                  <span>{qr.icon}</span>
                  <span>{qr.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ============ RECORDING INDICATOR ============ */}
        {isRecording && (
          <div className={`px-4 py-3 border-t ${isLight ? 'border-gray-200 bg-red-50' : 'border-zinc-800 bg-red-500/10'} flex items-center gap-3`}>
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className={`text-sm font-medium ${isLight ? 'text-red-600' : 'text-red-400'} tabular-nums flex-1`}>
              Recording... {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
            </span>
            <button
              onClick={cancelRecording}
              className="text-red-400 hover:text-red-300 text-xs"
            >
              Cancel
            </button>
            <button aria-label="Stop Circle"
              onClick={stopRecording}
              className="w-9 h-9 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
            >
              <StopCircle className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* ============ INPUT BAR ============ */}
        {!isRecording && (
          <div className={`px-3 py-2.5 border-t ${isLight ? 'border-gray-200 bg-white' : 'border-zinc-800 bg-zinc-900'} flex items-center gap-2 flex-shrink-0`}
            style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0.625rem))' }}
          >
            {/* Quick reply toggle */}
            <button
              aria-expanded={showQuickReplies} onClick={() => setShowQuickReplies(!showQuickReplies)}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${
                showQuickReplies
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : isLight
                  ? 'hover:bg-gray-100 text-gray-400'
                  : 'hover:bg-zinc-800 text-gray-500'
              }`}
              data-testid="quick-reply-toggle"
            >
              <Zap className="w-4 h-4" />
            </button>

            {/* Text input */}
            <div className={`flex-1 flex items-center rounded-full border ${bgInput} px-3`}>
              <input aria-label="Text input"
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Message..."
                className={`flex-1 bg-transparent py-2 text-sm outline-none ${textPrimary} placeholder-gray-400`}
                disabled={isSending || isUploadingVoice}
                data-testid="session-chat-input"
              />
            </div>

            {/* Send or Mic button */}
            {inputValue.trim() ? (
              <button aria-label="Loader2"
                onClick={() => sendMessage()}
                disabled={isSending}
                className="w-9 h-9 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 flex items-center justify-center text-white transition-all hover:scale-105 active:scale-95 flex-shrink-0"
                data-testid="send-message-btn"
              >
                {isSending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={isUploadingVoice}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                  isLight
                    ? 'hover:bg-gray-100 text-gray-500'
                    : 'hover:bg-zinc-800 text-gray-400'
                }`}
                data-testid="voice-note-btn"
              >
                {isUploadingVoice ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============ FLOATING CHAT BUTTON ============
// Mini FAB to open chat from the session view
export var SessionChatFAB = ({
  unreadCount = 0,
  onClick,
  isLight = false,
}) => {
  return (
    <button aria-label="Message"
      onClick={onClick}
      className={`relative w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95 ${
        isLight
          ? 'bg-gradient-to-r from-cyan-500 to-blue-500'
          : 'bg-gradient-to-r from-cyan-600 to-blue-600'
      }`}
      data-testid="session-chat-fab"
    >
      <MessageCircle className="w-6 h-6 text-white" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center animate-bounce">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  );
};

export default SessionChatDrawer;

/**
 * CrewChat - Real-time messaging for booking coordination
 * Features: Text, Voice (30s max), Images, Quick Actions, Emoji Picker, Reactions
 */
import React, { useState } from 'react';

import { useParams, useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { Button } from './ui/button';

import { Input } from './ui/input';

import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

import {

  ArrowLeft, Send, Mic, MoreVertical,
  MapPin, Users, CheckCheck, Loader2, X, Play, Pause,
  Zap, StopCircle, Smile, Plus, Reply, Download, Paperclip,
  ChevronDown, ChevronUp
} from 'lucide-react';
import {
  REACTION_EMOJIS,
  EMOJI_CATEGORIES,
  EXTENDED_EMOJI_CATEGORIES,
} from '../constants/emojis';


import { BACKEND_URL } from '../lib/apiClient';
import { getFullUrl } from '../utils/media';
import { formatDuration } from '../utils/formatTime';

import useCrewChat from '../hooks/useCrewChat';

// Quick Actions for surf coordination - Expanded with more useful options
const QUICK_ACTIONS = [
  // Status updates
  { id: 'omw', text: 'On my way! Ã°Å¸Ââ€ž', category: 'status', icon: 'Ã°Å¸Å¡â€”' },
  { id: 'late', text: 'Running 5 mins late', category: 'status', icon: 'Ã¢ÂÂ°' },
  { id: 'arrived', text: 'Just arrived at the spot', category: 'status', icon: 'Ã°Å¸â€œÂ' },
  { id: 'parking', text: 'Looking for parking', category: 'status', icon: 'Ã°Å¸â€¦Â¿Ã¯Â¸Â' },
  { id: 'paddling', text: 'Paddling out now!', category: 'status', icon: 'Ã°Å¸ÂÅ ' },
  { id: 'ready', text: 'Ready when you are! Ã°Å¸Â¤â„¢', category: 'status', icon: 'Ã¢Å“â€¦' },

  // Wave conditions
  { id: 'pumping', text: 'Waves are pumping! Ã°Å¸Å’Å ', category: 'conditions', icon: 'Ã°Å¸Å’Å ' },
  { id: 'glassy', text: "It's glassy out here! Ã°Å¸â€Â¥", category: 'conditions', icon: 'Ã¢Å“Â¨' },
  { id: 'choppy', text: 'Getting a bit choppy', category: 'conditions', icon: 'Ã°Å¸â€™Â¨' },
  { id: 'crowded', text: 'Pretty crowded lineup', category: 'conditions', icon: 'Ã°Å¸â€˜Â¥' },
  { id: 'uncrowded', text: 'Lineup is empty! Ã°Å¸Å½â€°', category: 'conditions', icon: 'Ã°Å¸Ââ€“Ã¯Â¸Â' },
  { id: 'perfect', text: 'Conditions are PERFECT', category: 'conditions', icon: 'Ã°Å¸â€™Â¯' },

  // Logistics
  { id: 'gear', text: 'Bringing extra gear', category: 'logistics', icon: 'Ã°Å¸Å½â€™' },
  { id: 'wax', text: 'Got extra wax if needed', category: 'logistics', icon: 'Ã°Å¸Â§Â´' },
  { id: 'drinks', text: 'Bringing drinks/snacks', category: 'logistics', icon: 'Ã°Å¸Â¥Â¤' },
  { id: 'camera', text: 'Camera is ready! Ã°Å¸â€œÂ¸', category: 'logistics', icon: 'Ã°Å¸â€œÂ·' },

  // Vibes
  { id: 'stoked', text: 'So stoked for this session!', category: 'vibes', icon: 'Ã°Å¸Â¤Â©' },
  { id: 'sunset', text: 'Staying for sunset Ã°Å¸Å’â€¦', category: 'vibes', icon: 'Ã°Å¸Å’â€¦' },
  { id: 'thanks', text: 'Thanks for the session! Ã°Å¸Â¤â„¢', category: 'vibes', icon: 'Ã°Å¸â„¢Â' },
  { id: 'again', text: "Let's do this again soon!", category: 'vibes', icon: 'Ã°Å¸â€â€ž' },
];

// Quick Action Categories with colors

export default function CrewChat() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [chatInfo, setChatInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  // Media state
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageCaption, setImageCaption] = useState('');
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [expandedImage, setExpandedImage] = useState(null);
  const [playingVoice, setPlayingVoice] = useState(null);

  // File sharing state
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileCaption, setFileCaption] = useState('');

  // Emoji & Reactions state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState('Surf & Ocean');
  const [showExtendedEmoji, setShowExtendedEmoji] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(null); // message ID or null

  // Mentions & Replies state
  const [replyingTo, setReplyingTo] = useState(null); // message being replied to
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionCursorPos, setMentionCursorPos] = useState(0);

  // ============ HANDLERS EXTRACTED TO hooks/useCrewChat.js ============
  const {
    messagesEndRef, wsRef, inputRef, fileInputRef, audioRef,
    fetchChatInfo, fetchMessages,
    sendMessage, handleReply, cancelReply, sendQuickAction,
    startRecording, stopRecording, cancelRecording, uploadImage,
    handleFileSelect, uploadFile, toggleVoicePlayback,
    handleInputChange, handleKeyDown, handleEmojiSelect,
    handleReaction,
    getFileIcon, formatTime,
  } = useCrewChat({
    user, bookingId, inputValue, setInputValue, isSending, setIsSending,
    setMessages, setChatInfo, setOnlineUsers, setTypingUsers, setIsLoading,
    setIsConnected, setShowQuickActions, setShowMentionPicker, setMentionQuery,
    setMentionResults, setMentionCursorPos, replyingTo, setReplyingTo,
    mentionQuery, mentionCursorPos, isRecording, setIsRecording,
    setRecordingTime, recordingTime, setIsUploadingMedia,
    setSelectedImage, setShowImagePreview, setImageCaption,
    selectedImage, imageCaption, selectedFile, fileCaption,
    setSelectedFile, setShowFilePreview, setFileCaption,
    setShowReactionPicker, playingVoice, setPlayingVoice,
    setShowEmojiPicker, showMentionPicker, mentionResults,
    showReactionPicker,
  });

  // Render message content with clickable @mentions

  if (isLoading && !chatInfo) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col" data-testid="crew-chat-page">
      {/* Hidden audio element */}
      <audio ref={audioRef} hidden />

      {/* Hidden file input - accepts images and documents */}
      <input aria-label="Upload file"
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        onChange={handleFileSelect}
        className="hidden"
        data-testid="crew-chat-file-input"
      />

      {/* File Preview Modal */}
      {showFilePreview && selectedFile && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
          <div className="bg-zinc-900 rounded-xl p-6 max-w-md w-full">
            <div className="text-center mb-4">
              <div className="text-6xl mb-3">{getFileIcon(selectedFile.type)}</div>
              <h3 className="text-white font-medium text-lg truncate">{selectedFile.name}</h3>
              <p className="text-zinc-400 text-sm">{formatFileSize(selectedFile.size)}</p>
            </div>

            <Input aria-label="Add a message (optional)"
              value={fileCaption}
              onChange={(e) => setFileCaption(e.target.value)}
              placeholder="Add a message (optional)"
              className="mb-4 bg-zinc-800 border-zinc-700 text-white"
              data-testid="file-caption-input"
            />

            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1 text-zinc-400"
                onClick={() => {
                  setShowFilePreview(false);
                  setSelectedFile(null);
                  setFileCaption('');
                }}
                disabled={isUploadingMedia}
                data-testid="cancel-file-btn"
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600"
                onClick={uploadFile}
                disabled={isUploadingMedia}
                data-testid="send-file-btn"
              >
                {isUploadingMedia ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send File
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b border-zinc-800">
        <div className="flex items-center gap-3 p-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="text-zinc-400 hover:text-white"
            data-testid="crew-chat-back-btn"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="flex-1">
            <h1 className="text-white font-semibold flex items-center gap-2">
              Crew Chat
              {isConnected ? (
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-red-500" />
              )}
            </h1>
            {chatInfo && (
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {chatInfo.location}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {onlineUsers.length} online
                </span>
              </div>
            )}
          </div>

          <Button variant="ghost" size="icon" className="text-zinc-400" aria-label="More options">
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>

        {/* Online participants strip */}
        <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto">
          {chatInfo?.participants?.map((participant) => (
            <div key={participant.user_id} className="flex flex-col items-center flex-shrink-0">
              <div className="relative">
                <Avatar className="h-10 w-10 border-2 border-zinc-800">
                  <AvatarImage src={getFullUrl(participant.avatar_url)} />
                  <AvatarFallback className="bg-zinc-700 text-white text-xs">
                    {getInitials(participant.full_name)}
                  </AvatarFallback>
                </Avatar>
                {onlineUsers.includes(participant.user_id) && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-zinc-900" />
                )}
              </div>
              <span className="text-xs text-zinc-500 mt-1 truncate max-w-[60px]">
                {participant.full_name?.split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="crew-chat-messages" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500">No messages yet</p>
            <p className="text-zinc-600 text-sm">Start coordinating with your crew!</p>
          </div>
        )}

        {messages.map((msg, index) => {
          const isMe = msg.sender_id === user?.id;
          const isSystem = msg.message_type === 'system';
          const showAvatar = !isMe && (index === 0 || messages[index - 1]?.sender_id !== msg.sender_id);

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="bg-zinc-800/50 px-4 py-2 rounded-full text-xs text-zinc-400">
                  {msg.content}
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              {!isMe && (
                <div className="w-8 flex-shrink-0">
                  {showAvatar && (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={msg.sender_avatar} />
                      <AvatarFallback className="bg-zinc-700 text-white text-xs">
                        {getInitials(msg.sender_name)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
              )}

              <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showAvatar && !isMe && (
                  <div className="flex items-center gap-2 mb-1 ml-1">
                    <span className="text-xs font-medium text-zinc-400">{msg.sender_name}</span>
                    {getRoleBadge(msg.sender_role)}
                  </div>
                )}

                {/* Voice message */}
                {msg.message_type === 'voice' && (
                  <div
                    className={`px-4 py-3 rounded-2xl flex items-center gap-3 ${
                      isMe ? 'bg-cyan-600 rounded-br-md' : 'bg-zinc-800 rounded-bl-md'
                    }`}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-full bg-white/20 hover:bg-white/30"
                      onClick={() => toggleVoicePlayback(msg.id, msg.media_url)}
                    >
                      {playingVoice === msg.id ? (
                        <Pause className="h-5 w-5 text-white" />
                      ) : (
                        <Play className="h-5 w-5 text-white" />
                      )}
                    </Button>
                    <div className="flex-1">
                      <div className="h-1 bg-white/30 rounded-full w-24">
                        <div className={`h-full bg-white rounded-full ${playingVoice === msg.id ? 'animate-pulse' : ''}`} style={{ width: '60%' }} />
                      </div>
                      <span className="text-xs text-white/70 mt-1">
                        {formatDuration(msg.voice_duration_seconds || 0)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Image message */}
                {msg.message_type === 'image' && (
                  <div className={`rounded-2xl overflow-hidden ${isMe ? 'rounded-br-md' : 'rounded-bl-md'}`}>
                    <img loading="lazy" decoding="async"
                                      src={`${BACKEND_URL}${msg.media_url}`}
                      alt="Shared"
                      className="max-w-[250px] max-h-[300px] object-cover cursor-pointer"
                      onClick={() => setExpandedImage(msg.media_url)}
                    />
                    {msg.content && msg.content !== 'Shared a photo' && (
                      <div className={`px-3 py-2 text-sm ${isMe ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-100'}`}>
                        {msg.content}
                      </div>
                    )}
                  </div>
                )}

                {/* Text message */}
                {msg.message_type === 'text' && (
                  <div className="flex flex-col">
                    {/* Reply context bubble */}
                    {msg.reply_to && (
                      <div className={`px-3 py-1.5 mb-1 rounded-t-xl border-l-2 ${
                        isMe
                          ? 'bg-cyan-700/50 border-cyan-400'
                          : 'bg-zinc-700/50 border-zinc-500'
                      }`}>
                        <p className="text-xs text-zinc-400 font-medium">{msg.reply_to.sender_name}</p>
                        <p className="text-xs text-zinc-300 truncate">{msg.reply_to.content}</p>
                      </div>
                    )}
                    <div
                      className={`px-4 py-2 rounded-2xl ${
                        isMe ? 'bg-cyan-600 text-white rounded-br-md' : 'bg-zinc-800 text-zinc-100 rounded-bl-md'
                      } ${msg.reply_to ? 'rounded-t-lg' : ''}`}
                    >
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {renderMessageContent(msg.content, msg.mentions)}
                      </p>
                    </div>
                  </div>
                )}

                {/* File message */}
                {msg.message_type === 'file' && (
                  <a
                                    href={`${BACKEND_URL}${msg.media_url}`}
                    target="_blank" rel="noopener noreferrer"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-colors ${
                      isMe
                        ? 'bg-cyan-600 hover:bg-cyan-700 text-white rounded-br-md'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-bl-md'
                    }`}
                    data-testid={`file-message-${msg.id}`}
                  >
                    <div className="text-3xl">{getFileIcon(msg.file_type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{msg.file_name || 'File'}</p>
                      <p className={`text-xs ${isMe ? 'text-cyan-200' : 'text-zinc-400'}`}>
                        {msg.file_size || 'Download'} Ã¢â‚¬Â¢ Tap to open
                      </p>
                      {msg.content && !msg.content.startsWith('Ã°Å¸â€œÅ½') && (
                        <p className="text-sm mt-1">{msg.content}</p>
                      )}
                    </div>
                    <Download className={`w-5 h-5 flex-shrink-0 ${isMe ? 'text-cyan-200' : 'text-zinc-400'}`} />
                  </a>
                )}

                {/* Reactions display */}
                {msg.reactions && getTotalReactions(msg.reactions) > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                    {Object.entries(msg.reactions).map(([emoji, users]) => (
                      users.length > 0 && (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(msg.id, emoji)}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                            hasUserReacted(msg.reactions, emoji)
                              ? 'bg-cyan-500/30 border border-cyan-500/50'
                              : 'bg-zinc-800 border border-zinc-700 hover:bg-zinc-700'
                          }`}
                        >
                          <span>{emoji}</span>
                          <span className="text-zinc-400">{users.length}</span>
                        </button>
                      )
                    ))}
                  </div>
                )}

                {/* Timestamp and action buttons */}
                <div className={`flex items-center gap-2 mt-1 ${isMe ? 'justify-end' : 'justify-start'} px-1`}>
                  <span className="text-xs text-zinc-600">{formatTime(msg.created_at)}</span>
                  {isMe && <CheckCheck className="h-3 w-3 text-cyan-500" />}

                  {/* Reply button */}
                  <button
                    onClick={() => handleReply(msg)}
                    className="text-zinc-600 hover:text-zinc-400 transition-colors p-1"
                    data-testid={`reply-btn-${msg.id}`}
                  >
                    <Reply className="h-3 w-3" />
                  </button>

                  {/* Add reaction button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}
                      className="text-zinc-600 hover:text-zinc-400 transition-colors p-1"
                      data-testid={`reaction-btn-${msg.id}`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>

                    {/* Reaction picker popup */}
                    {showReactionPicker === msg.id && (
                      <div className={`absolute ${isMe ? 'right-0' : 'left-0'} bottom-full mb-2 bg-zinc-800 border border-zinc-700 rounded-lg p-2 shadow-xl z-20`}>
                        <div className="flex gap-1">
                          {REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => handleReaction(msg.id, emoji)}
                              className={`w-8 h-8 flex items-center justify-center text-lg rounded hover:bg-zinc-700 transition-colors ${
                                hasUserReacted(msg.reactions, emoji) ? 'bg-cyan-500/30' : ''
                              }`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {getTypingNames().length > 0 && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>{getTypingNames().join(', ')} typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions Panel */}
      {showQuickActions && (
        <div className="bg-zinc-900 border-t border-zinc-800 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500 font-medium">Quick Actions</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowQuickActions(false)} aria-label="Close">
              <X className="h-4 w-4 text-zinc-500" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-white text-xs"
                onClick={() => sendQuickAction(action)}
                data-testid={`quick-action-${action.id}`}
              >
                {action.text}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Emoji Picker Panel */}
      {showEmojiPicker && (
        <div className="bg-zinc-900 border-t border-zinc-800 p-3" data-testid="emoji-picker-panel">
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-2 overflow-x-auto hide-scrollbar">
              {Object.keys(showExtendedEmoji ? { ...EMOJI_CATEGORIES, ...EXTENDED_EMOJI_CATEGORIES } : EMOJI_CATEGORIES).map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveEmojiCategory(category)}
                  className={`text-xs px-2 py-1 rounded transition-colors whitespace-nowrap flex-shrink-0 ${
                    activeEmojiCategory === category
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {category}
                </button>
              ))}
              <button
                onClick={() => {
                  if (showExtendedEmoji && !(activeEmojiCategory in EMOJI_CATEGORIES)) {
                    setActiveEmojiCategory('Surf & Ocean');
                  }
                  setShowExtendedEmoji(!showExtendedEmoji);
                }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors whitespace-nowrap flex-shrink-0 text-cyan-500/60 hover:text-cyan-400"
                data-testid="crew-emoji-show-more"
              >
                {showExtendedEmoji ? (
                  <>Less <ChevronUp className="w-3 h-3" /></>
                ) : (
                  <>More <ChevronDown className="w-3 h-3" /></>
                )}
              </button>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={() => setShowEmojiPicker(false)} aria-label="Close">
              <X className="h-4 w-4 text-zinc-500" />
            </Button>
          </div>
          <div className="grid grid-cols-8 gap-1 max-h-32 overflow-y-auto">
            {(showExtendedEmoji ? { ...EMOJI_CATEGORIES, ...EXTENDED_EMOJI_CATEGORIES } : EMOJI_CATEGORIES)[activeEmojiCategory]?.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleEmojiSelect(emoji)}
                className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-zinc-800 transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <div className="bg-red-900/30 border-t border-red-800 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-red-400 font-medium">Recording...</span>
              <span className="text-red-300 text-sm">{formatDuration(recordingTime)}</span>
              <span className="text-red-500/50 text-xs">/ {formatDuration(MAX_VOICE_DURATION)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={cancelRecording} className="text-zinc-400" aria-label="Close">
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" onClick={stopRecording} className="bg-red-600 hover:bg-red-500">
                <StopCircle className="h-4 w-4 mr-1" /> Send
              </Button>
            </div>
          </div>
          <div className="mt-2 h-1 bg-red-900 rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 transition-all duration-1000"
              style={{ width: `${(recordingTime / MAX_VOICE_DURATION) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {showImagePreview && selectedImage && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
          <div className="flex items-center justify-between p-4">
            <Button variant="ghost" onClick={() => { setShowImagePreview(false); setSelectedImage(null); }} aria-label="Close">
              <X className="h-5 w-5 text-white" />
            </Button>
            <span className="text-white font-medium">Send Photo</span>
            <Button
              onClick={uploadImage}
              disabled={isUploadingMedia}
              className="bg-cyan-600 hover:bg-cyan-500"
            >
              {isUploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
            </Button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <img loading="lazy" decoding="async"
              src={URL.createObjectURL(selectedImage)}
              alt="Preview"
              className="max-w-full max-h-[60vh] object-contain rounded-lg"
            />
          </div>
          <div className="p-4">
            <Input aria-label="Add a caption..."
              value={imageCaption}
              onChange={(e) => setImageCaption(e.target.value)}
              placeholder="Add a caption..."
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </div>
        </div>
      )}

      {/* Expanded Image Modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 text-white"
            onClick={() => setExpandedImage(null)}
          >
            <X className="h-6 w-6" />
          </Button>
          <img loading="lazy" decoding="async"
                          src={`${BACKEND_URL}${expandedImage}`}
            alt="Full size"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}

      {/* Input area */}
      {!isRecording && (
        <div className="sticky bottom-0 bg-zinc-900 border-t border-zinc-800 safe-area-pb">
          {/* Reply indicator */}
          {replyingTo && (
            <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/50 border-b border-zinc-700">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Reply className="h-4 w-4 text-cyan-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-cyan-400">Replying to {replyingTo.sender_name}</p>
                  <p className="text-xs text-zinc-400 truncate">{replyingTo.content}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={cancelReply} aria-label="Close">
                <X className="h-4 w-4 text-zinc-500" />
              </Button>
            </div>
          )}

          {/* Mention picker dropdown */}
          {showMentionPicker && mentionResults.length > 0 && (
            <div className="px-4 py-2 bg-zinc-800 border-b border-zinc-700">
              <p className="text-xs text-zinc-500 mb-2">Mention someone</p>
              <div className="flex flex-wrap gap-2">
                {mentionResults.map((mentionUser) => (
                  <button
                    key={mentionUser.user_id}
                    onClick={() => handleMentionSelect(mentionUser)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-full transition-colors"
                  >
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={getFullUrl(mentionUser.avatar_url)} />
                      <AvatarFallback className="bg-zinc-600 text-white text-[10px]">
                        {getInitials(mentionUser.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-white">{mentionUser.full_name}</span>
                    {mentionUser.is_priority && (
                      <span className="text-[10px] text-cyan-400">Crew</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 p-4">
            {/* Quick Actions Toggle */}
            <Button
              variant="ghost"
              size="icon"
              aria-expanded={showQuickActions} onClick={() => setShowQuickActions(!showQuickActions)}
              className={`text-zinc-500 hover:text-white flex-shrink-0 ${showQuickActions ? 'text-cyan-400' : ''}`}
              data-testid="quick-actions-toggle"
            >
              <Zap className="h-5 w-5" />
            </Button>

            {/* File/Image Upload - Combined */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="text-zinc-500 hover:text-white flex-shrink-0"
              title="Share image or file"
              data-testid="file-upload-btn"
            >
              <Paperclip className="h-5 w-5" />
            </Button>

            {/* Voice Recording */}
            <Button
              variant="ghost"
              size="icon"
              onClick={startRecording}
              className="text-zinc-500 hover:text-white flex-shrink-0"
              data-testid="voice-record-btn"
            >
              <Mic className="h-5 w-5" />
            </Button>

            {/* Emoji Picker Toggle */}
            <Button
              variant="ghost"
              size="icon"
              aria-expanded={showEmojiPicker} onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowQuickActions(false); }}
              className={`flex-shrink-0 ${showEmojiPicker ? 'text-yellow-400' : 'text-zinc-500 hover:text-white'}`}
              data-testid="emoji-picker-btn"
            >
              <Smile className="h-5 w-5" />
            </Button>

            <div className="flex-1">
              <Input aria-label="Message your crew..."
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Message your crew..."
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
                data-testid="crew-chat-input"
              />
            </div>

            <Button
              onClick={() => sendMessage()}
              disabled={!inputValue.trim() || isSending}
              className="bg-cyan-600 hover:bg-cyan-500 text-white flex-shrink-0"
              size="icon"
              data-testid="crew-chat-send-btn"
            >
              {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

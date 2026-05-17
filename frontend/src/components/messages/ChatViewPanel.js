/**
 * ChatViewPanel - Extracted from MessagesPage.js
 * Renders the active conversation chat view including header, messages, and input area.
 */
import React from 'react';
import {
  Send, ChevronLeft, MoreHorizontal, X, Mic, Image,
  Video, Phone, Reply, Smile, Pin, BellOff, Mail, Trash2
} from 'lucide-react';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import VoiceRecorder from '../VoiceRecorder';
import WebcamCaptureModal from '../WebcamCaptureModal';
import GifPicker from './GifPicker';
import EmojiPicker from './EmojiPicker';
import MessageBubble from './MessageBubble';
import { getFullUrl, cacheBustUrl } from '../../utils/media';

var ChatViewPanel = ({
  // User
  user,
  // Conversation state
  selectedConversation, conversationDetail,
  // Message state
  newMessage, setNewMessage, sendingMessage,
  replyingTo, setReplyingTo,
  typingUsers,
  // UI state
  showVoiceRecorder, setShowVoiceRecorder,
  showVideoCapture, setShowVideoCapture,
  showEmojiPicker, setShowEmojiPicker,
  showGifPicker, setShowGifPicker,
  // Refs
  messagesEndRef, fileInputRef,
  // Presence
  isOnline,
  // Handlers
  handleBackNavigation,
  handleSendMessage,
  handleSendGif,
  handleInputChange,
  handleReaction,
  handleAcceptRequest, handleDeclineRequest,
  handleTogglePin, handleToggleMute, handleMarkUnread,
  handleDeleteConversation,
  handleMediaUpload, handleEphemeralMediaUpload,
  handleVoiceNoteSent,
  // Navigation
  navigate,
}) => {
  // Cache-bust avatar URL
  const rawChatAvatarUrl = conversationDetail?.other_user_avatar || selectedConversation?.other_user_avatar;
  const chatAvatarUrl = rawChatAvatarUrl ? getFullUrl(rawChatAvatarUrl) : null;
  const chatAvatarWithCacheBust = cacheBustUrl(chatAvatarUrl, conversationDetail?.last_message_at);

  return (
    <div className="flex flex-col h-full bg-background messages-chat-view">
      {/* Chat Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <button aria-label="Previous"
          onClick={handleBackNavigation}
          className="text-muted-foreground hover:text-foreground"
          data-testid="back-button"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <button
          onClick={() => navigate(`/profile/${conversationDetail?.other_user_id || selectedConversation?.other_user_id}`)}
          className="w-10 h-10 rounded-full bg-muted overflow-hidden ring-2 ring-cyan-500/30 hover:ring-cyan-400 hover:scale-105 transition-all flex-shrink-0 relative"
          title="View profile"
        >
          {chatAvatarWithCacheBust ? (
            <img loading="lazy" decoding="async" 
              src={chatAvatarWithCacheBust} 
              className="w-full h-full object-cover" 
              alt=""
              onError={(e) => {
                e.target.style.display = 'none';
                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <span 
            className="w-full h-full flex items-center justify-center text-muted-foreground absolute inset-0"
            style={{ display: chatAvatarWithCacheBust ? 'none' : 'flex' }}
          >
            {(conversationDetail?.other_user_name || selectedConversation?.other_user_name)?.charAt(0)}
          </span>
        </button>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => navigate(`/profile/${conversationDetail?.other_user_id || selectedConversation?.other_user_id}`)}
            className="font-medium text-foreground hover:text-cyan-400 transition-colors text-left block truncate"
          >
            {conversationDetail?.other_user_name || selectedConversation?.other_user_name}
          </button>
          <div className="text-xs mt-0.5">
            {selectedConversation?.is_new_chat ? (
              <span className="text-muted-foreground">Start a conversation</span>
            ) : typingUsers.length > 0 ? (
              <span className="text-cyan-400 animate-pulse">typing...</span>
            ) : isOnline(conversationDetail?.other_user_id || selectedConversation?.other_user_id) ? (
              <span className="text-green-400">&#x25CF; Active now</span>
            ) : (() => {
              // Merge last-active signals from both detail + list responses to avoid stale dates
              const detailActive = conversationDetail?.other_user_last_active;
              const listActive = selectedConversation?.other_user_last_active || selectedConversation?.last_message_at;
              const candidates = [detailActive, listActive]
                .map(t => t ? new Date(t) : null)
                .filter(d => d && !isNaN(d.getTime()));
              const lastActiveDate = candidates.length > 0
                ? new Date(Math.max(...candidates.map(d => d.getTime())))
                : null;
              if (!lastActiveDate) return <span className="text-muted-foreground">Active recently</span>;
              const diff = Math.floor((Date.now() - lastActiveDate.getTime()) / 1000);
              if (diff < 3600) return <span className="text-muted-foreground">Active {Math.floor(diff / 60)}m ago</span>;
              if (diff < 86400) return <span className="text-muted-foreground">Active {Math.floor(diff / 3600)}h ago</span>;
              return <span className="text-muted-foreground">Active {lastActiveDate.toLocaleDateString()}</span>;
            })()}
          </div>
        </div>
        
        {/* Call Buttons */}
        {!selectedConversation?.is_new_chat && !selectedConversation?.is_request && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const callEvent = new CustomEvent('rawsurf:startCall', { 
                  detail: { 
                    targetUserId: selectedConversation?.other_user_id, 
                    callType: 'audio',
                    targetUserName: conversationDetail?.other_user_name || selectedConversation?.other_user_name,
                    targetUserAvatar: chatAvatarUrl,
                  }
                });
                window.dispatchEvent(callEvent);
              }}
              className="text-muted-foreground hover:text-cyan-400 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              title="Audio call"
              data-testid="audio-call-btn"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                const callEvent = new CustomEvent('rawsurf:startCall', { 
                  detail: { 
                    targetUserId: selectedConversation?.other_user_id, 
                    callType: 'video',
                    targetUserName: conversationDetail?.other_user_name || selectedConversation?.other_user_name,
                    targetUserAvatar: chatAvatarUrl,
                  }
                });
                window.dispatchEvent(callEvent);
              }}
              className="text-muted-foreground hover:text-cyan-400 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              title="Video call"
              data-testid="video-call-btn"
            >
              <Video className="w-5 h-5" />
            </button>
          </div>
        )}
        
        {/* Conversation Controls Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="More options" 
              className="text-muted-foreground hover:text-foreground p-2 rounded-lg hover:bg-muted transition-colors"
              data-testid="conversation-menu-btn"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-popover border border-border">
            <DropdownMenuItem 
              onClick={handleMarkUnread}
              className="flex items-center justify-between cursor-pointer hover:bg-accent"
            >
              <span>{conversationDetail?.is_manually_unread ? 'Mark as read' : 'Mark as unread'}</span>
              <Mail className="w-5 h-5" />
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={handleTogglePin}
              className="flex items-center justify-between cursor-pointer hover:bg-accent"
            >
              <span>{conversationDetail?.is_pinned ? 'Unpin' : 'Pin'}</span>
              <Pin className="w-5 h-5" />
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={handleToggleMute}
              className="flex items-center justify-between cursor-pointer hover:bg-accent"
            >
              <span>{conversationDetail?.is_muted ? 'Unmute' : 'Mute'}</span>
              <BellOff className="w-5 h-5" />
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={handleDeleteConversation}
              className="flex items-center justify-between cursor-pointer text-red-500 hover:bg-red-500/10 hover:text-red-600"
            >
              <span>Delete</span>
              <Trash2 className="w-5 h-5" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Request Banner */}
      {conversationDetail?.is_request && (
        <div className="p-4 bg-muted border-b border-border">
          <p className="text-muted-foreground text-sm mb-3">This person isn't in your contacts. Accept to move to your primary inbox.</p>
          <div className="flex gap-2">
            <Button 
              onClick={handleAcceptRequest} 
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold"
              data-testid="accept-request-btn"
            >
              Accept
            </Button>
            <Button 
              onClick={handleDeclineRequest} 
              variant="outline"
              className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10"
              data-testid="decline-request-btn"
            >
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-1 messages-scroll-container">
        {selectedConversation?.is_new_chat ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 rounded-full bg-muted overflow-hidden mb-4">
              {selectedConversation.other_user_avatar ? (
                <img loading="lazy" decoding="async" src={selectedConversation.other_user_avatar} className="w-full h-full object-cover" alt="" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-3xl text-muted-foreground">
                  {selectedConversation.other_user_name?.charAt(0)}
                </span>
              )}
            </div>
            <h3 className="text-foreground font-semibold text-lg">{selectedConversation.other_user_name}</h3>
            <p className="text-muted-foreground text-sm mt-2">Send a message to start the conversation</p>
          </div>
        ) : (
          conversationDetail?.messages?.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onReact={handleReaction}
              onReply={(msg) => setReplyingTo(msg)}
              onNavigateProfile={(userId) => navigate(`/profile/${userId}`)}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Preview */}
      {replyingTo && (
        <div className="px-4 py-2 bg-muted border-t border-border flex items-center gap-2">
          <Reply className="w-4 h-4 text-cyan-400" />
          <span className="flex-1 text-sm text-muted-foreground truncate">Replying to: {replyingTo.content}</span>
          <button onClick={() => setReplyingTo(null)} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Message Input */}
      {(selectedConversation?.is_new_chat || !conversationDetail?.is_request) && (
        <div className="p-4 border-t border-border bg-muted/50 relative flex-shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <WebcamCaptureModal
            isOpen={showVideoCapture}
            onClose={() => setShowVideoCapture(false)}
            onCapture={handleEphemeralMediaUpload}
            maxLength={30}
          />
          <GifPicker
            show={showGifPicker}
            onSelect={(gifUrl) => {
              if (gifUrl) {
                handleSendGif(gifUrl);
                setShowGifPicker(false);
              }
            }}
            onClose={() => setShowGifPicker(false)}
          />
          
          {showVoiceRecorder ? (
            <VoiceRecorder
              conversationId={selectedConversation?.id}
              senderId={user.id}
              onSend={handleVoiceNoteSent}
              onCancel={() => setShowVoiceRecorder(false)}
            />
          ) : (
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-muted-foreground hover:text-cyan-400 transition-colors">
                <Image className="w-5 h-5" />
              </button>
              <input aria-label="Upload file" ref={fileInputRef} type="file" accept="image/*,video/*" onChange={handleMediaUpload} className="hidden" />
              
              <button 
                type="button" 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowGifPicker(prev => !prev);
                }}
                className={`p-2 transition-colors touch-manipulation ${showGifPicker ? 'text-cyan-400' : 'text-muted-foreground hover:text-cyan-400'}`}
                data-testid="gif-button"
              >
                <span className="text-xs font-bold border border-current rounded px-1">GIF</span>
              </button>
              
              <div className="flex-1 relative">
                <input aria-label="Message..."
                  type="text"
                  value={newMessage}
                  onChange={handleInputChange}
                  placeholder="Message..."
                  className="w-full bg-muted rounded-full px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <button aria-label="Emoji"
                  type="button"
                  aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <Smile className="w-5 h-5" />
                </button>
                <EmojiPicker
                  show={showEmojiPicker}
                  onSelect={(emoji) => { setNewMessage(prev => prev + emoji); setShowEmojiPicker(false); }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>

              {newMessage.trim() ? (
                <button aria-label="Send"
                  type="submit"
                  disabled={sendingMessage}
                  className="p-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full text-white disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </button>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setShowVideoCapture(true)} className="p-2 text-muted-foreground hover:text-cyan-400 transition-colors">
                    <Video className="w-5 h-5" />
                  </button>
                  <button type="button" onClick={() => setShowVoiceRecorder(true)} className="p-2 text-muted-foreground hover:text-cyan-400 transition-colors" aria-label="Microphone">
                    <Mic className="w-5 h-5" />
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default ChatViewPanel;

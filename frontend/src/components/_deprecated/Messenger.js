import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { 

const getFullUrl = (url) => { if (!url) return url; if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http')) return url; return `\`+url; };

  Send, 
  ArrowLeft, 
  MoreVertical, 
  Image as ImageIcon, 
  Mic, 
  Smile,
  Reply,
  Check,
  CheckCheck,
  X,
  Search,
  Plus,
  Phone,
  Video
} from 'lucide-react';

const API = process.env.REACT_APP_BACKEND_URL;

// Quick emoji picker
const QUICK_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '🔥', '🎉'];

const Messenger = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null); // message id or 'input'
  const [typingUsers, setTypingUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/messages/conversations/${user.id}`);
      setConversations(response.data.conversations || response.data || []);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  }, [user?.id]);

  // Fetch messages for active conversation
  const fetchMessages = useCallback(async () => {
    if (!activeConversation || !user?.id) return;
    setLoading(true);
    try {
      const response = await apiClient.get(
        `/messages/conversation/${activeConversation.id}?user_id=${user.id}`
      );
      setMessages(response.data.messages || []);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  }, [activeConversation, user?.id]);

  // Poll for typing indicators
  const fetchTypingUsers = useCallback(async () => {
    if (!activeConversation || !user?.id) return;
    try {
      const response = await apiClient.get(
        `/messages/typing/${activeConversation.id}?user_id=${user.id}`
      );
      setTypingUsers(response.data.typing_users || []);
    } catch (error) {
      console.error('Failed to fetch typing:', error);
    }
  }, [activeConversation, user?.id]);

  useEffect(() => {
    if (isOpen) {
      fetchConversations();
    }
  }, [isOpen, fetchConversations]);

  useEffect(() => {
    if (activeConversation) {
      fetchMessages();
      // Poll for new messages and typing every 3 seconds
      const interval = setInterval(() => {
        fetchMessages();
        fetchTypingUsers();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeConversation, fetchMessages, fetchTypingUsers]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send typing indicator
  const sendTypingIndicator = useCallback(async (isTyping) => {
    if (!activeConversation || !user?.id) return;
    try {
      await apiClient.post(
        `/messages/typing/${activeConversation.id}?user_id=${user.id}`,
        { is_typing: isTyping }
      );
    } catch (error) {
      console.error('Failed to send typing indicator:', error);
    }
  }, [activeConversation, user?.id]);

  // Handle input change with typing indicator
  const handleInputChange = (e) => {
    setNewMessage(e.target.value);
    
    // Send typing indicator
    sendTypingIndicator(true);
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Stop typing after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingIndicator(false);
    }, 2000);
  };

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !activeConversation || !user?.id) return;
    
    setSending(true);
    try {
      await apiClient.post(
        `/messages/send/${activeConversation.id}?sender_id=${user.id}`,
        {
          content: newMessage,
          message_type: 'text',
          reply_to_id: replyTo?.id || null
        }
      );
      
      setNewMessage('');
      setReplyTo(null);
      sendTypingIndicator(false);
      fetchMessages();
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Add reaction to message
  const handleAddReaction = async (messageId, emoji) => {
    if (!user?.id) return;
    try {
      await apiClient.post(
        `/messages/react/${messageId}?user_id=${user.id}`,
        { emoji }
      );
      setShowEmojiPicker(null);
      fetchMessages();
    } catch (error) {
      toast.error('Failed to add reaction');
    }
  };

  // Format timestamp
  const formatTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg h-[80vh] p-0 flex flex-col">
        {/* Header with blur effect */}
        <div className="p-4 border-b border-zinc-800 backdrop-blur-xl bg-zinc-900/80 sticky top-0 z-10">
          {activeConversation ? (
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveConversation(null)}
                className="text-white hover:bg-zinc-800 p-1"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                {activeConversation.other_user?.avatar_url ? (
                  <img src={getFullUrl(activeConversation.other_user.avatar_url)} 
                    alt="" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-black font-bold">
                    {activeConversation.other_user?.full_name?.charAt(0) || '?'}
                  </span>
                )}
              </div>
              
              <div className="flex-1">
                <h3 className="font-bold text-white">{activeConversation.other_user?.full_name}</h3>
                {typingUsers.length > 0 && (
                  <p className="text-xs text-cyan-400 animate-pulse">typing...</p>
                )}
              </div>
              
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <Phone className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <Video className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold">Messages</DialogTitle>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                <Plus className="w-5 h-5" />
              </Button>
            </div>
          )}
        </div>

        {/* Content */}
        {!activeConversation ? (
          // Conversations List
          <div className="flex-1 overflow-y-auto">
            {/* Search */}
            <div className="p-3 sticky top-0 bg-zinc-900/80 backdrop-blur-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
            </div>

            {conversations.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p>No conversations yet</p>
                <p className="text-sm mt-2">Start a conversation with a surfer or photographer!</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {conversations
                  .filter(c => 
                    !searchQuery || 
                    c.other_user?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => setActiveConversation(conv)}
                      className="w-full p-4 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors text-left"
                    >
                      <div className="relative">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center justify-center overflow-hidden">
                          {conv.other_user?.avatar_url ? (
                            <img src={getFullUrl(conv.other_user.avatar_url)} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-black font-bold text-lg">
                              {conv.other_user?.full_name?.charAt(0) || '?'}
                            </span>
                          )}
                        </div>
                        {conv.unread_count > 0 && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-xs font-bold">
                            {conv.unread_count}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-white">{conv.other_user?.full_name}</span>
                          <span className="text-xs text-gray-500">
                            {conv.last_message_at ? formatTime(conv.last_message_at) : ''}
                          </span>
                        </div>
                        <p className="text-sm text-gray-400 truncate">{conv.last_message || 'No messages yet'}</p>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        ) : (
          // Messages View
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No messages yet</p>
                  <p className="text-sm mt-2">Say hello! 👋</p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isOwn = msg.sender?.id === user?.id;
                  const showAvatar = !isOwn && (index === 0 || messages[index - 1]?.sender?.id !== msg.sender?.id);
                  
                  return (
                    <div 
                      key={msg.id}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}
                    >
                      {/* Avatar for other user */}
                      {!isOwn && showAvatar && (
                        <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center mr-2 flex-shrink-0">
                          {msg.sender?.avatar_url ? (
                            <img src={getFullUrl(msg.sender.avatar_url)} alt="" className="w-full h-full rounded-full object-cover" />
                          ) : (
                            <span className="text-xs text-gray-400">{msg.sender?.full_name?.charAt(0)}</span>
                          )}
                        </div>
                      )}
                      {!isOwn && !showAvatar && <div className="w-8 mr-2" />}
                      
                      <div className={`max-w-[70%] ${isOwn ? 'order-1' : ''}`}>
                        {/* Reply preview */}
                        {msg.reply_to && (
                          <div className={`mb-1 p-2 rounded-lg text-xs ${isOwn ? 'bg-cyan-900/30 text-cyan-300' : 'bg-zinc-800 text-gray-400'}`}>
                            <span className="font-medium">{msg.reply_to.sender_name}</span>
                            <p className="truncate">{msg.reply_to.content}</p>
                          </div>
                        )}
                        
                        {/* Message bubble */}
                        <div 
                          className={`relative p-3 rounded-2xl ${
                            isOwn 
                              ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-tr-sm' 
                              : 'bg-zinc-800 text-white rounded-tl-sm'
                          }`}
                        >
                          <p className="break-words">{msg.content}</p>
                          
                          {/* Time and read status */}
                          <div className={`flex items-center gap-1 mt-1 text-[10px] ${isOwn ? 'text-white/70 justify-end' : 'text-gray-500'}`}>
                            <span>{formatTime(msg.created_at)}</span>
                            {isOwn && (
                              msg.is_read 
                                ? <CheckCheck className="w-3 h-3" /> 
                                : <Check className="w-3 h-3" />
                            )}
                          </div>
                          
                          {/* Reactions */}
                          {msg.reactions && msg.reactions.length > 0 && (
                            <div className="absolute -bottom-3 left-2 flex -space-x-1">
                              {[...new Set(msg.reactions.map(r => r.emoji))].slice(0, 3).map((emoji, i) => (
                                <span key={i} className="text-sm bg-zinc-700 rounded-full px-1">{emoji}</span>
                              ))}
                              {msg.reactions.length > 3 && (
                                <span className="text-xs bg-zinc-700 rounded-full px-1.5 py-0.5">+{msg.reactions.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                        
                        {/* Action buttons (visible on hover) */}
                        <div className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                          <button 
                            onClick={() => setReplyTo(msg)}
                            className="p-1 text-gray-500 hover:text-white rounded"
                          >
                            <Reply className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                            className="p-1 text-gray-500 hover:text-white rounded"
                          >
                            <Smile className="w-3 h-3" />
                          </button>
                        </div>
                        
                        {/* Emoji picker for this message */}
                        {showEmojiPicker === msg.id && (
                          <div className={`absolute mt-1 p-2 bg-zinc-800 rounded-lg shadow-xl flex gap-1 z-20 ${isOwn ? 'right-0' : 'left-0'}`}>
                            {QUICK_EMOJIS.map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => handleAddReaction(msg.id, emoji)}
                                className="text-lg hover:scale-125 transition-transform p-1"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply preview */}
            {replyTo && (
              <div className="mx-4 mb-2 p-2 bg-zinc-800 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Reply className="w-4 h-4 text-cyan-400" />
                  <div>
                    <p className="text-xs text-cyan-400 font-medium">Replying to {replyTo.sender?.full_name}</p>
                    <p className="text-xs text-gray-400 truncate max-w-[200px]">{replyTo.content}</p>
                  </div>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-gray-500 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Input area */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <ImageIcon className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <Mic className="w-5 h-5" />
                </Button>
                
                <div className="flex-1 relative">
                  <Input
                    ref={inputRef}
                    value={newMessage}
                    onChange={handleInputChange}
                    onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    placeholder="Message..."
                    className="bg-zinc-800 border-zinc-700 text-white pr-10"
                  />
                  <button 
                    onClick={() => setShowEmojiPicker(showEmojiPicker === 'input' ? null : 'input')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  
                  {showEmojiPicker === 'input' && (
                    <div className="absolute bottom-full right-0 mb-2 p-2 bg-zinc-800 rounded-lg shadow-xl flex gap-1 z-20">
                      {QUICK_EMOJIS.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => {
                            setNewMessage(prev => prev + emoji);
                            setShowEmojiPicker(null);
                            inputRef.current?.focus();
                          }}
                          className="text-lg hover:scale-125 transition-transform p-1"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                <Button
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sending}
                  className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-bold p-2"
                >
                  {sending ? (
                    <div className="w-5 h-5 animate-spin rounded-full border-2 border-black border-t-transparent" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Messenger;

import { useRef, useCallback, useEffect } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';
import { formatClockTime } from '../utils/formatTime';

var WS_URL = BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
export var MAX_VOICE_DURATION = 30;

export default function useCrewChat({
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
  showReactionPicker, typingUsers, chatInfo
}) {
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingIntervalRef = useRef(null);
  const audioRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Fetch chat info
  const fetchChatInfo = useCallback(async () => {
    if (!user?.id || !bookingId) return;
    try {
      const response = await apiClient.get(`/crew-chat/${bookingId}/info`);
      const data = response.data;
      setChatInfo(data);
      setOnlineUsers(data.online_users || []);
    } catch (err) {
      logger.error('Error fetching chat info:', err);
      toast.error('Failed to load chat');
    }
  }, [user?.id, bookingId]);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    if (!user?.id || !bookingId) return;
    try {
      setIsLoading(true);
      const response = await apiClient.get(`/crew-chat/${bookingId}/messages?limit=50`);
      const data = response.data;
      setMessages(data.messages || []);
      setOnlineUsers(data.online_users || []);
      scrollToBottom();
    } catch (err) {
      logger.error('Error fetching messages:', err);
      toast.error('Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, bookingId, scrollToBottom]);

  // WebSocket connection
  useEffect(() => {
    if (!user?.id || !bookingId) return;

    const connectWs = () => {
      const ws = new WebSocket(`${WS_URL}/api/ws/crew-chat/${bookingId}/${user.id}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'new_message':
              setMessages(prev => [...prev, data.data]);
              scrollToBottom();
              break;
            case 'user_joined':
              setOnlineUsers(data.data.online_users || []);
              break;
            case 'user_left':
              setOnlineUsers(data.data.online_users || []);
              break;
            case 'typing':
              if (data.data.is_typing) {
                setTypingUsers(prev => prev.includes(data.data.user_id) ? prev : [...prev, data.data.user_id]);
              } else {
                setTypingUsers(prev => prev.filter(id => id !== data.data.user_id));
              }
              break;
            case 'reaction_update':
              // Update message reactions in real-time
              setMessages(prev => prev.map(msg =>
                msg.id === data.data.message_id
                  ? { ...msg, reactions: data.data.reactions }
                  : msg
              ));
              break;
            default:
              break;
          }
        } catch (e) {
          logger.error('[CrewChat] Failed to parse message:', e);
        }
      };

      ws.onerror = () => setIsConnected(false);
      ws.onclose = (event) => {
        setIsConnected(false);
        if (event.code !== 1000) setTimeout(connectWs, 3000);
      };
    };

    connectWs();
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send('ping');
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      if (wsRef.current) wsRef.current.close(1000);
    };
  }, [user?.id, bookingId, scrollToBottom]);

  useEffect(() => {
    fetchChatInfo();
    fetchMessages();
  }, [fetchChatInfo, fetchMessages]);

  // Send text message
  const sendMessage = async (content = inputValue) => {
    if (!content.trim() || isSending) return;

    const messageContent = content.trim();
    setInputValue('');
    setIsSending(true);
    setShowQuickActions(false);
    setShowMentionPicker(false);

    try {
      await apiClient.post(`/crew-chat/${bookingId}/send`, {
        content: messageContent,
        message_type: 'text',
        reply_to_id: replyingTo?.id || null
      });
      setReplyingTo(null); // Clear reply after sending
    } catch (err) {
      logger.error('Error sending message:', err);
      toast.error('Failed to send message');
      setInputValue(messageContent);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  // Reply to message
  const handleReply = (msg) => {
    setReplyingTo(msg);
    inputRef.current?.focus();
  };

  // Cancel reply
  const cancelReply = () => {
    setReplyingTo(null);
  };

  // Mention search
  const searchMentions = async (query) => {
    if (!query || query.length < 1) {
      setMentionResults([]);
      setShowMentionPicker(false);
      return;
    }

    try {
      const response = await apiClient.get(
        `/mentions/search?query=${encodeURIComponent(query)}&context=crew_chat&context_id=${bookingId}`
      );
      setMentionResults(response.data.users || []);
      setShowMentionPicker((response.data.users?.length || 0) > 0);
    } catch (err) {
      logger.error('Error searching mentions:', err);
    }
  };

  // Handle mention selection
  const handleMentionSelect = (selectedUser) => {
    const beforeAt = inputValue.substring(0, mentionCursorPos - mentionQuery.length - 1);
    const afterCursor = inputValue.substring(mentionCursorPos);
    const newValue = `${beforeAt}@[${selectedUser.full_name}](${selectedUser.user_id}) ${afterCursor}`;
    setInputValue(newValue);
    setShowMentionPicker(false);
    setMentionQuery('');
    inputRef.current?.focus();
  };

  // Quick action send
  const sendQuickAction = (action) => {
    sendMessage(action.text);
  };

  // Voice recording
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
      logger.error('Error starting recording:', err);
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
    setIsUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice.webm');
      formData.append('user_id', user.id);
      formData.append('duration', recordingTime);

      await apiClient.post(`/crew-chat/${bookingId}/upload-voice`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Voice note sent!');
    } catch (err) {
      logger.error('Error uploading voice:', err);
      toast.error('Failed to send voice note');
    } finally {
      setIsUploadingMedia(false);
      setRecordingTime(0);
    }
  };

  // Image handling
  const _handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image too large. Max 10MB');
      return;
    }

    setSelectedImage(file);
    setShowImagePreview(true);
    setImageCaption('');
  };

  const uploadImage = async () => {
    if (!selectedImage) return;

    setIsUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedImage);
      formData.append('user_id', user.id);
      formData.append('caption', imageCaption);

      await apiClient.post(`/crew-chat/${bookingId}/upload-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Photo sent!');
      setShowImagePreview(false);
      setSelectedImage(null);
      setImageCaption('');
    } catch (err) {
      logger.error('Error uploading image:', err);
      toast.error('Failed to send photo');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Handle file selection for sharing
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file size (25MB max)
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File too large. Max 25MB');
      return;
    }

    // Check if it's an image - use image preview
    if (file.type.startsWith('image/')) {
      setSelectedImage(file);
      setShowImagePreview(true);
    } else {
      // Show file preview for documents
      setSelectedFile(file);
      setShowFilePreview(true);
    }
    e.target.value = ''; // Reset input
  };

  // Upload file (documents, PDFs, etc.)
  const uploadFile = async () => {
    if (!selectedFile) return;

    setIsUploadingMedia(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('user_id', user.id);
      formData.append('caption', fileCaption);

      const response = await apiClient.post(`/crew-chat/${bookingId}/upload-file`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`File sent: ${response.data.file_name}`);
      setShowFilePreview(false);
      setSelectedFile(null);
      setFileCaption('');
    } catch (err) {
      logger.error('Error uploading file:', err);
      toast.error('Failed to send file');
    } finally {
      setIsUploadingMedia(false);
    }
  };

  // Format file size for display

  // Get file icon based on type
  const getFileIcon = (fileType) => {
    if (fileType?.includes('pdf')) return '📄';
    if (fileType?.includes('word') || fileType?.includes('doc')) return '📝';
    if (fileType?.includes('excel') || fileType?.includes('sheet')) return '📊';
    if (fileType?.includes('powerpoint') || fileType?.includes('presentation')) return '📊';
    if (fileType?.includes('zip') || fileType?.includes('archive')) return '📦';
    if (fileType?.includes('text') || fileType?.includes('csv')) return '📃';
    return '📎';
  };

  // Voice playback
  const toggleVoicePlayback = (messageId, mediaUrl) => {
    if (playingVoice === messageId) {
      audioRef.current?.pause();
      setPlayingVoice(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(`${BACKEND_URL}${mediaUrl}`);
      audioRef.current.onended = () => setPlayingVoice(null);
      audioRef.current.play();
      setPlayingVoice(messageId);
    }
  };

  // Typing indicator with @ mention detection
  const handleInputChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInputValue(value);

    // Detect @ mention
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      const query = atMatch[1];
      setMentionQuery(query);
      setMentionCursorPos(cursorPos);
      searchMentions(query);
    } else {
      setShowMentionPicker(false);
      setMentionQuery('');
    }

    // Typing indicator via WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing', is_typing: true }));
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'typing', is_typing: false }));
        }
      }, 2000);
    }
  };

  const handleKeyDown = (e) => {
    // Handle arrow keys for mention picker navigation
    if (showMentionPicker && mentionResults.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        // Navigation handled by picker component
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (mentionResults.length > 0) {
          e.preventDefault();
          handleMentionSelect(mentionResults[0]);
          return;
        }
      }
      if (e.key === 'Escape') {
        setShowMentionPicker(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Emoji picker handler
  const handleEmojiSelect = (emoji) => {
    setInputValue(prev => prev + emoji);
    inputRef.current?.focus();
  };

  // Reaction handler
  const handleReaction = async (messageId, emoji) => {
    try {
      const response = await apiClient.post(
        `/crew-chat/${bookingId}/messages/${messageId}/react?emoji=${encodeURIComponent(emoji)}`
      );
      const data = response.data;
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, reactions: data.reactions } : msg
      ));
      setShowReactionPicker(null);
    } catch (err) {
      logger.error('Error adding reaction:', err);
      toast.error('Failed to react');
    }
  };

  // Count total reactions

  // Check if user reacted with emoji

  const formatTime = formatClockTime;

  const getTypingNames = () => {
    if (!chatInfo?.participants) return [];
    return typingUsers
      .map(id => chatInfo.participants.find(p => p.user_id === id)?.full_name?.split(' ')[0])
      .filter(Boolean);
  };

  return {
    // Refs
    messagesEndRef, wsRef, inputRef, fileInputRef, audioRef,
    // Fetchers
    fetchChatInfo, fetchMessages,
    // Message handlers
    sendMessage, handleReply, cancelReply, sendQuickAction, handleMentionSelect,
    // Media handlers
    startRecording, stopRecording, cancelRecording, uploadImage,
    handleFileSelect, uploadFile, toggleVoicePlayback,
    // Input handlers
    handleInputChange, handleKeyDown, handleEmojiSelect,
    // Reaction
    handleReaction,
    // Helpers
    getFileIcon, formatTime: formatClockTime, getTypingNames
  };
}

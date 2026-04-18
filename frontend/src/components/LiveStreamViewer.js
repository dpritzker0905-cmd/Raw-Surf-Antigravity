import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, Radio, Users, Heart, MessageCircle, Send, Loader2, WifiOff, 
  ArrowLeft, Share2, UserPlus
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { useAuth } from '../contexts/AuthContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { toast } from 'sonner';

// LiveKit imports
import {
  LiveKitRoom,
  VideoTrack,
  useTracks,
  RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL + '/api';
const CONNECTION_TIMEOUT = 15000;

/**
 * Live Chat Message Component
 */
const ChatMessage = ({ message, isOwn }) => (
  <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
    <Avatar className="w-7 h-7 flex-shrink-0">
      <AvatarImage src={message.avatar_url} />
      <AvatarFallback className="bg-zinc-700 text-xs">
        {message.user_name?.[0] || '?'}
      </AvatarFallback>
    </Avatar>
    <div className={`max-w-[80%] ${isOwn ? 'text-right' : ''}`}>
      <span className="text-xs text-cyan-400 font-medium">{message.user_name}</span>
      <p className="text-sm text-white break-words">{message.text}</p>
    </div>
  </div>
);

/**
 * Live Comments Section
 */
const LiveComments = ({ streamId, userId, userName, userAvatar }) => {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [sending, setSending] = useState(false);
  const commentsEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  useEffect(() => {
    const fetchComments = async () => {
      try {
        const response = await apiClient.get(`/social-live/${streamId}/comments`);
        if (response.data?.comments) {
          setComments(response.data.comments);
        }
      } catch (err) {
        // Silently fail
      }
    };

    fetchComments();
    pollIntervalRef.current = setInterval(fetchComments, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [streamId]);

  const handleSendComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim() || sending) return;

    setSending(true);
    try {
      await apiClient.post(`/social-live/${streamId}/comments`, {
        user_id: userId,
        user_name: userName,
        avatar_url: userAvatar,
        text: newComment.trim()
      });
      
      setComments(prev => [...prev, {
        id: Date.now().toString(),
        user_id: userId,
        user_name: userName,
        avatar_url: userAvatar,
        text: newComment.trim(),
        created_at: new Date().toISOString()
      }]);
      
      setNewComment('');
    } catch (err) {
      toast.error('Failed to send comment');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900/95">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-zinc-400" />
        <span className="text-sm font-medium text-zinc-300">Live Chat</span>
        <span className="text-xs text-zinc-500">({comments.length})</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {comments.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-8">
            <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No comments yet</p>
            <p className="text-xs">Be the first to say something!</p>
          </div>
        ) : (
          comments.map((msg) => (
            <ChatMessage 
              key={msg.id} 
              message={msg} 
              isOwn={msg.user_id === userId}
            />
          ))
        )}
        <div ref={commentsEndRef} />
      </div>

      <form onSubmit={handleSendComment} className="p-3 border-t border-zinc-800">
        <div className="flex gap-2">
          <Input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Say something..."
            className="flex-1 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 h-10"
            maxLength={200}
            disabled={sending}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!newComment.trim() || sending}
            className="bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 h-10 w-10"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

/**
 * Viewer Side-by-Side Content
 */
const ViewerContent = ({ broadcaster, onLeave, viewerCount, onViewProfile, streamId, userId, userName, userAvatar }) => {
  const [isChatOpen, setIsChatOpen] = useState(true);
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });
  
  // Find broadcaster's video track
  const broadcasterTrack = tracks.find(t => !t.participant?.isLocal);

  return (
    <div className="absolute inset-0 flex flex-col sm:flex-row overflow-hidden">
      {/* ── Main Video Section ── */}
      <div className="flex-1 relative bg-black flex flex-col min-w-0">
        <div className="flex-1 relative overflow-hidden flex items-center justify-center">
          {broadcasterTrack ? (
            <VideoTrack 
              trackRef={broadcasterTrack} 
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="text-center">
              <Loader2 className="w-12 h-12 animate-spin text-red-500 mx-auto mb-4" />
              <p className="text-gray-400">Waiting for video...</p>
            </div>
          )}

          {/* Top overlay - Static indicators */}
          <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-red-500">
                {broadcaster?.avatar_url ? (
                  <img src={broadcaster.avatar_url} alt={broadcaster.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-700 flex items-center justify-center text-white font-bold">
                    {broadcaster?.name?.[0] || '?'}
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">{broadcaster?.name || 'Unknown'}</span>
                  <div className="flex items-center gap-1 bg-red-600 px-2 py-0.5 rounded-full animate-pulse">
                    <Radio className="w-3 h-3 text-white" />
                    <span className="text-white text-[10px] font-bold">LIVE</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-gray-400 text-[10px]">
                  <Users className="w-3 h-3" />
                  <span>{viewerCount} watching</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Desktop Toggle Chat */}
              <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                className={`hidden sm:flex p-2 rounded-full bg-black/40 hover:bg-black/60 transition-all ${isChatOpen ? 'bg-red-500/20 text-red-400' : 'text-white'}`}
                title={isChatOpen ? "Hide Chat" : "Show Chat"}
              >
                <MessageCircle className="w-5 h-5" />
              </button>

              <button
                onClick={onLeave}
                className="p-2 bg-black/60 hover:bg-red-600 rounded-full transition-colors"
                title="Exit View"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          {/* Bottom Bar Controls for Viewers */}
          <div className="absolute bottom-4 left-0 right-0 px-6 flex items-center justify-between pointer-events-none z-10">
            <div className="flex items-center gap-4 pointer-events-auto">
              <button className="p-3 bg-black/40 hover:bg-red-500/20 text-white hover:text-red-400 rounded-full transition-all group backdrop-blur-md">
                <Heart className="w-6 h-6 group-active:scale-125 transition-transform" />
              </button>
              <button className="p-3 bg-black/40 hover:bg-blue-500/20 text-white hover:text-blue-400 rounded-full transition-all group backdrop-blur-md">
                <Share2 className="w-6 h-6 group-active:scale-125 transition-transform" />
              </button>
            </div>
            
            <div className="pointer-events-auto">
              <Button
                variant="outline"
                size="sm"
                className="bg-black/40 border-white/20 text-white hover:bg-white/10 backdrop-blur-md px-6 rounded-full"
                onClick={onViewProfile}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Follow
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Desktop Sidebar: Live Chat ── */}
      <AnimatePresence>
        {isChatOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: '350px', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="hidden sm:flex flex-col h-full bg-zinc-900 border-l border-zinc-800 shrink-0"
          >
            <LiveComments
              streamId={streamId}
              userId={userId}
              userName={userName}
              userAvatar={userAvatar}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile-only overlay elements for chat */}
      <div className="sm:hidden absolute bottom-0 left-0 right-0 h-[40%] pointer-events-auto z-20">
        <LiveComments
          streamId={streamId}
          userId={userId}
          userName={userName}
          userAvatar={userAvatar}
        />
      </div>

      <RoomAudioRenderer />
    </div>
  );
};

/**
 * Viewer Controls - Legacy/Proxy wrapper
 */
const ViewerControls = (props) => {
  return <ViewerContent {...props} />;
};

/**
 * Stream Unavailable Fallback
 */
const StreamUnavailable = ({ onBackToFeed, broadcasterName, onRefresh }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
    <div className="text-center p-6 max-w-md">
      <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
        <WifiOff className="w-10 h-10 text-gray-500" />
      </div>
      <h3 className="text-white text-xl font-bold mb-2">Stream Ended</h3>
      <p className="text-gray-400 mb-6">
        {broadcasterName ? `${broadcasterName}'s live stream` : 'This stream'} has ended or is no longer available.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button 
          onClick={onRefresh}
          variant="outline"
          className="border-zinc-700 text-white hover:bg-zinc-800 gap-2"
        >
          <Radio className="w-4 h-4" />
          Try Again
        </Button>
        <Button 
          onClick={onBackToFeed} 
          className="bg-white text-black hover:bg-gray-200 gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Feed
        </Button>
      </div>
    </div>
  </div>
);

/**
 * LiveStreamViewer - Full-screen viewer for watching someone's live stream
 */
const LiveStreamViewer = ({ isOpen, onClose, streamInfo }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [isLoading, setIsLoading] = useState(true);
  const [connectionTimedOut, setConnectionTimedOut] = useState(false);
  const [viewerToken, setViewerToken] = useState(null);
  const [viewerCount, setViewerCount] = useState(streamInfo?.viewer_count || 0);
  const [isConnected, setIsConnected] = useState(false);
  
  const timeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  const hasFetchedTokenRef = useRef(false);

  // Reset state when component mounts/unmounts
  useEffect(() => {
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Fetch viewer token only once when opening
  useEffect(() => {
    if (isOpen && streamInfo?.room_name && user?.id && !hasFetchedTokenRef.current) {
      hasFetchedTokenRef.current = true;
      
      const fetchToken = async () => {
        setIsLoading(true);
        setConnectionTimedOut(false);

        timeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && !isConnected) {
            logger.warn('[LiveStreamViewer] Connection timeout');
            setConnectionTimedOut(true);
            setIsLoading(false);
          }
        }, CONNECTION_TIMEOUT);

        try {
          logger.info('[LiveStreamViewer] Fetching viewer token for room:', streamInfo.room_name);
          
          const response = await axios.get(
            `${API}/livekit/viewer-token/${streamInfo.room_name}?viewer_id=${user.id}&viewer_name=${encodeURIComponent(user.full_name || 'Viewer')}`
          );

          if (!isMountedRef.current) return;

          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }

          logger.info('[LiveStreamViewer] Token received, connecting to:', response.data.server_url);
          
          setViewerToken({
            token: response.data.token,
            server_url: response.data.server_url
          });
          setViewerCount(prev => prev + 1);
          setIsLoading(false);

        } catch (err) {
          if (!isMountedRef.current) return;
          
          logger.error('[LiveStreamViewer] Failed to get viewer token:', err);
          
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          
          if (err.response?.status === 404) {
            toast.info('This stream has ended');
          }
          
          setConnectionTimedOut(true);
          setIsLoading(false);
        }
      };
      
      fetchToken();
    }
    
    // Reset when closing
    if (!isOpen) {
      hasFetchedTokenRef.current = false;
      setViewerToken(null);
      setIsLoading(true);
      setConnectionTimedOut(false);
      setIsConnected(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [isOpen, streamInfo?.room_name, user?.id, user?.full_name, isConnected]);

  const handleRetry = useCallback(() => {
    hasFetchedTokenRef.current = false;
    setViewerToken(null);
    setIsLoading(true);
    setConnectionTimedOut(false);
    setIsConnected(false);
    
    // Trigger re-fetch
    setTimeout(() => {
      if (isOpen && streamInfo?.room_name && user?.id) {
        hasFetchedTokenRef.current = true;
        
        const fetchToken = async () => {
          try {
            const response = await axios.get(
              `${API}/livekit/viewer-token/${streamInfo.room_name}?viewer_id=${user.id}&viewer_name=${encodeURIComponent(user.full_name || 'Viewer')}`
            );
            
            if (isMountedRef.current) {
              setViewerToken({
                token: response.data.token,
                server_url: response.data.server_url
              });
              setIsLoading(false);
            }
          } catch (err) {
            if (isMountedRef.current) {
              setConnectionTimedOut(true);
              setIsLoading(false);
            }
          }
        };
        
        fetchToken();
      }
    }, 100);
  }, [isOpen, streamInfo?.room_name, user?.id, user?.full_name]);

  const handleLeave = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (streamInfo?.id && user?.id) {
      apiClient.post(`/social-live/${streamInfo.id}/leave?viewer_id=${user.id}`).catch(() => {/* fire-and-forget */});
    }
    
    onClose();
  }, [streamInfo, user, onClose]);

  const handleBackToFeed = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    onClose();
  }, [onClose]);

  const handleConnected = useCallback(() => {
    logger.info('[LiveStreamViewer] Connected to LiveKit room!');
    if (isMountedRef.current) {
      setIsConnected(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, []);

  const handleDisconnected = useCallback(() => {
    logger.info('[LiveStreamViewer] Disconnected from room');
    if (isMountedRef.current) {
      toast.info('Stream has ended');
      setConnectionTimedOut(true);
    }
  }, []);

  const handleViewProfile = useCallback(() => {
    if (streamInfo?.broadcaster_id) {
      onClose();
      navigate(`/profile/${streamInfo.broadcaster_id}`);
    }
  }, [streamInfo?.broadcaster_id, navigate, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const broadcaster = {
    id: streamInfo?.broadcaster_id,
    name: streamInfo?.broadcaster_name,
    avatar_url: streamInfo?.broadcaster_avatar
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" data-testid="live-stream-viewer">
      {/* Desktop Backdrop */}
      <div 
        className="fixed inset-0 bg-black/80 backdrop-blur-sm hidden sm:block"
        onClick={handleLeave}
      />
      
      {/* Modal Container: Fullscreen on mobile, centered modal on desktop */}
      <div className="relative w-full h-full sm:w-[1100px] sm:h-[720px] sm:max-h-[90vh] sm:rounded-2xl sm:overflow-hidden bg-black shadow-2xl shadow-black/60">
      {/* Loading state */}
      {isLoading && !connectionTimedOut && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="text-center">
            <div className="relative w-20 h-20 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping" />
              <div className="absolute inset-0 rounded-full border-4 border-red-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-white text-lg">Joining live stream...</p>
            <p className="text-gray-500 text-sm mt-2">{broadcaster?.name}</p>
          </div>
        </div>
      )}

      {/* Stream Unavailable */}
      {connectionTimedOut && (
        <StreamUnavailable 
          onBackToFeed={handleBackToFeed}
          broadcasterName={broadcaster?.name}
          onRefresh={handleRetry}
        />
      )}

      {/* Main Content - LiveKit Room */}
      {viewerToken && !connectionTimedOut && (
        <LiveKitRoom
          token={viewerToken.token}
          serverUrl={viewerToken.server_url}
          video={false}
          audio={true}
          connect={true}
          onConnected={handleConnected}
          onDisconnected={handleDisconnected}
        >
          <ViewerControls
            broadcaster={broadcaster}
            onLeave={handleLeave}
            viewerCount={viewerCount}
            onViewProfile={handleViewProfile}
            streamId={streamInfo?.id}
            userId={user?.id}
            userName={user?.full_name || user?.username}
            userAvatar={user?.avatar_url}
          />
        </LiveKitRoom>
      )}
      </div>
    </div>
  );
};

export default LiveStreamViewer;

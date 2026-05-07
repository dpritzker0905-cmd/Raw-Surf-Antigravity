import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Share2, Link, UserCircle, ChevronDown, Loader2, Check, MessageSquareOff, Copy } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import logger from '../../utils/logger';

const SharePostModal = ({ post, open, onClose, isLight }) => {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [metaStatus, setMetaStatus] = useState(null);
  const [directShareLoading, setDirectShareLoading] = useState(null);
  const [checkingMeta, setCheckingMeta] = useState(true);
  
  // DM Sharing state
  const [showDmPicker, setShowDmPicker] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [dmConversations, setDmConversations] = useState([]);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmSending, setDmSending] = useState(null); // user_id currently sending to
  const [dmSent, setDmSent] = useState(new Set()); // user_ids already sent to
  
  // Emoji constants — using String.fromCodePoint to avoid encoding corruption
  const SHARE_ICONS = {
    wave: String.fromCodePoint(0x1F30A),
    camera: String.fromCodePoint(0x1F4F7),
    link: String.fromCodePoint(0x1F517),
    outbox: String.fromCodePoint(0x1F4E4),
    speech: String.fromCodePoint(0x1F4AC),
    twitter: String.fromCodePoint(0x1D54F),
  };
  
  // Use the API share URL which has proper Open Graph meta tags
  const shareUrl = `${BACKEND_URL}/share/${post?.id}`;
  const postUrl = `${window.location.origin}/post/${post?.id}`;
  
  // Check if on mobile device
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // Check Meta connection status on mount
  useEffect(() => {
    const checkMetaStatus = async () => {
      if (!user?.id) {
        setCheckingMeta(false);
        return;
      }
      try {
        const response = await apiClient.get(`/meta/status`);
        setMetaStatus(response.data);
      } catch (err) {
        // Not connected or error - that's fine
        setMetaStatus(null);
      } finally {
        setCheckingMeta(false);
      }
    };
    
    if (open && user?.id) {
      checkMetaStatus();
    }
  }, [open, user?.id]);

  // Fetch recent conversations for DM sharing
  const fetchDmConversations = async () => {
    if (!user?.id) return;
    setDmLoading(true);
    try {
      const response = await apiClient.get(`/messages/conversations/${user.id}`, {
        params: { inbox_type: 'all' }
      });
      setDmConversations(response.data || []);
    } catch (err) {
      logger.error('Failed to load conversations for DM share:', err);
    } finally {
      setDmLoading(false);
    }
  };

  // Load conversations when DM picker opens
  useEffect(() => {
    if (showDmPicker && user?.id) {
      fetchDmConversations();
    }
  }, [showDmPicker, user?.id]); // fetchDmConversations is stable

  // Reset DM state when modal closes
  useEffect(() => {
    if (!open) {
      setShowDmPicker(false);
      setDmSearch('');
      setDmSent(new Set());
      setDmSending(null);
    }
  }, [open]);

  // Send post as DM
  const handleSendDm = async (recipientId, recipientName) => {
    if (!user?.id || !post?.id || dmSending) return;
    
    setDmSending(recipientId);
    try {
      const postUrl = `${window.location.origin}/post/${post.id}`;
      const shareText = `Check out this post on Raw Surf! ${SHARE_ICONS.wave}\n${postUrl}`;
      
      await apiClient.post('/messages/send', {
        recipient_id: recipientId,
        content: shareText,
        message_type: 'post_share',
        media_url: post.media_url || null
      }, {
        params: { sender_id: user.id }
      });
      
      setDmSent(prev => new Set([...prev, recipientId]));
      toast.success(`Sent to ${recipientName}`);
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'Failed to send';
      toast.error(errorMsg);
    } finally {
      setDmSending(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  // Handle direct posting to Facebook
  const handleDirectShareFacebook = async () => {
    if (!user?.id || !post?.id) return;
    
    setDirectShareLoading('facebook');
    try {
      const response = await apiClient.post(`/meta/share-to-facebook`, {
        post_id: post.id,
        platform: 'facebook'
      });
      
      if (response.data.success) {
        toast.success(response.data.message);
        onClose();
      }
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'Failed to post to Facebook';
      toast.error(errorMsg);
    } finally {
      setDirectShareLoading(null);
    }
  };

  // Handle direct posting to Instagram
  const handleDirectShareInstagram = async () => {
    if (!user?.id || !post?.id) return;
    
    setDirectShareLoading('instagram');
    try {
      const response = await apiClient.post(`/meta/share-to-instagram`, {
        post_id: post.id,
        platform: 'instagram'
      });
      
      if (response.data.success) {
        toast.success(response.data.message);
        onClose();
      }
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'Failed to post to Instagram';
      toast.error(errorMsg);
    } finally {
      setDirectShareLoading(null);
    }
  };

  // Navigate to settings to connect Meta account
  const handleConnectMeta = () => {
    onClose();
    window.location.href = '/settings?tab=connections';
  };

  const handleShare = async (platform) => {
    const shareText = `Check out this surf session on Raw Surf! ${SHARE_ICONS.wave}`;
    
    // Instagram handling - use native share on mobile, copy link on desktop
    if (platform === 'instagram') {
      if (isMobile && navigator.share) {
        try {
          await navigator.share({
            title: 'Surf Session on Raw Surf',
            text: shareText,
            url: shareUrl
          });
          toast.success('Share to Instagram from the menu!');
          onClose();
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
            // User didn't cancel, there was an actual error
            logger.error('Share failed:', err);
          }
        }
      }
      // Desktop or native share failed - copy link with instructions
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(
          isMobile 
            ? 'Link copied! Paste in Instagram Story or DM' 
            : 'Link copied! Open Instagram on your phone to share',
          { duration: 4000 }
        );
      } catch (err) {
        toast.info('Copy the link above to share on Instagram');
      }
      onClose();
      return;
    }
    
    // Native share for "More options"
    if (platform === 'native' && navigator.share) {
      try {
        await navigator.share({
          title: 'Surf Session on Raw Surf',
          text: shareText,
          url: shareUrl
        });
        onClose();
        return;
      } catch (err) {
        // User cancelled or not supported
      }
    }
    
    // Social platform share URLs
    const shareUrls = {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      whatsapp: `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`
    };
    
    if (shareUrls[platform]) {
      window.open(shareUrls[platform], '_blank', 'width=600,height=500,noopener,noreferrer');
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} max-w-sm`} aria-describedby="share-post-description">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            <Share2 className="w-5 h-5" />
            Share Post
          </DialogTitle>
          <DialogDescription id="share-post-description" className="sr-only">
            Share this post via link or social media
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          {/* Direct Share Section - Show when Meta is connected */}
          {!checkingMeta && metaStatus && (metaStatus.facebook_connected || metaStatus.instagram_connected) && (
            <div className={`p-3 rounded-lg ${isLight ? 'bg-gradient-to-r from-blue-50 to-pink-50 border border-blue-100' : 'bg-gradient-to-r from-blue-900/30 to-pink-900/30 border border-blue-800'}`}>
              <p className={`text-xs font-medium mb-2 ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
                {SHARE_ICONS.outbox} Direct Post to Your Feed
              </p>
              <div className="flex gap-2">
                {metaStatus.facebook_connected && (
                  <Button aria-label="Loader2"
                    size="sm"
                    onClick={handleDirectShareFacebook}
                    disabled={directShareLoading === 'facebook'}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="direct-share-facebook-btn"
                  >
                    {directShareLoading === 'facebook' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span className="text-lg mr-1">f</span>
                        Post to Page
                      </>
                    )}
                  </Button>
                )}
                {metaStatus.instagram_connected && (
                  <Button aria-label="Loader2"
                    size="sm"
                    onClick={handleDirectShareInstagram}
                    disabled={directShareLoading === 'instagram'}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                    data-testid="direct-share-instagram-btn"
                  >
                    {directShareLoading === 'instagram' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span className="text-lg mr-1">{SHARE_ICONS.camera}</span>
                        Post to IG
                      </>
                    )}
                  </Button>
                )}
              </div>
              {metaStatus.instagram_username && (
                <p className={`text-xs mt-1.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                  Connected: @{metaStatus.instagram_username}
                </p>
              )}
            </div>
          )}
          
          {/* Connect Meta CTA - Show when not connected */}
          {!checkingMeta && !metaStatus?.facebook_connected && !metaStatus?.instagram_connected && user && (
            <button
              onClick={handleConnectMeta}
              className={`w-full p-3 rounded-lg text-left transition-colors ${isLight ? 'bg-gray-50 hover:bg-gray-100 border border-gray-200' : 'bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700'}`}
              data-testid="connect-meta-cta"
            >
              <p className={`text-sm font-medium ${isLight ? 'text-gray-800' : 'text-white'}`}>
                {SHARE_ICONS.link} Connect Facebook & Instagram
              </p>
              <p className={`text-xs mt-0.5 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                Post directly to your social feeds
              </p>
            </button>
          )}
          
          {/* Divider when direct sharing is available */}
          {!checkingMeta && (metaStatus?.facebook_connected || metaStatus?.instagram_connected) && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className={`w-full border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`} />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className={`px-2 ${isLight ? 'bg-white text-gray-500' : 'bg-zinc-900 text-gray-500'}`}>
                  or share via link
                </span>
              </div>
            </div>
          )}

          {/* Copy Link */}
          <div className={`flex items-center gap-2 p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
            <Input aria-label="Text input"
              value={postUrl}
              readOnly
              className={`flex-1 text-sm ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
            />
            <Button aria-label="Confirm" 
              size="sm" 
              onClick={handleCopyLink}
              className={copied ? 'bg-green-500' : ''}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          
          {/* Share Buttons */}
          <div className="grid grid-cols-4 gap-2">
            <Button
              variant="outline"
              onClick={() => handleShare('twitter')}
              className="flex-col h-auto py-3"
              data-testid="share-twitter-btn"
            >
              <span className="text-2xl">{SHARE_ICONS.twitter}</span>
              <span className="text-xs mt-1">Twitter</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleShare('facebook')}
              className="flex-col h-auto py-3"
              data-testid="share-facebook-link-btn"
            >
              <span className="text-2xl text-blue-600">f</span>
              <span className="text-xs mt-1">Link</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleShare('instagram')}
              className="flex-col h-auto py-3"
              title={isMobile ? "Share via your device's share menu" : "Copy link to share on Instagram"}
              data-testid="share-instagram-link-btn"
            >
              <span className="text-2xl">{SHARE_ICONS.camera}</span>
              <span className="text-xs mt-1">Link</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleShare('whatsapp')}
              className="flex-col h-auto py-3"
              data-testid="share-whatsapp-btn"
            >
              <span className="text-2xl text-green-500">{SHARE_ICONS.speech}</span>
              <span className="text-xs mt-1">WhatsApp</span>
            </Button>
          </div>

          {/* ============ SEND VIA DM ============ */}
          {user && (
            <div className={`rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-zinc-800/50'}`}>
              <button
                onClick={() => setShowDmPicker(!showDmPicker)}
                className={`w-full flex items-center justify-between p-3 text-sm font-medium transition-colors
                  ${isLight ? 'text-gray-800 hover:bg-gray-100' : 'text-white hover:bg-zinc-700/50'}`}
                data-testid="dm-share-toggle"
              >
                <span className="flex items-center gap-2">
                  <MessageSquareOff className="w-4 h-4" style={{ transform: 'scaleX(-1)' }} />
                  Send via DM
                </span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showDmPicker ? 'rotate-180' : ''}`} />
              </button>
              
              {showDmPicker && (
                <div className="px-3 pb-3 space-y-2">
                  {/* Search conversations */}
                  <Input
                    aria-label="Search conversations"
                    placeholder="Search by name..."
                    value={dmSearch}
                    onChange={(e) => setDmSearch(e.target.value)}
                    className={`text-sm ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
                    data-testid="dm-share-search"
                  />
                  
                  {/* Conversation list */}
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {dmLoading ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                      </div>
                    ) : dmConversations
                        .filter(c => !dmSearch || c.other_user_name?.toLowerCase().includes(dmSearch.toLowerCase()))
                        .length === 0 ? (
                      <p className={`text-xs text-center py-3 ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
                        {dmSearch ? 'No conversations found' : 'No recent conversations'}
                      </p>
                    ) : (
                      dmConversations
                        .filter(c => !dmSearch || c.other_user_name?.toLowerCase().includes(dmSearch.toLowerCase()))
                        .slice(0, 15)
                        .map(conv => {
                          const isSent = dmSent.has(conv.other_user_id);
                          const isSending = dmSending === conv.other_user_id;
                          
                          return (
                            <div
                              key={conv.id}
                              className={`flex items-center justify-between p-2 rounded-lg transition-colors
                                ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700/50'}`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {conv.other_user_avatar ? (
                                  <img
                                    src={conv.other_user_avatar}
                                    alt=""
                                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                  />
                                ) : (
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                                    ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`}>
                                    <UserCircle className="w-5 h-5 text-gray-400" />
                                  </div>
                                )}
                                <span className={`text-sm truncate ${isLight ? 'text-gray-800' : 'text-white'}`}>
                                  {conv.other_user_name || 'Unknown'}
                                </span>
                              </div>
                              
                              <Button
                                size="sm"
                                variant={isSent ? 'ghost' : 'default'}
                                disabled={isSending || isSent}
                                onClick={() => handleSendDm(conv.other_user_id, conv.other_user_name)}
                                className={`flex-shrink-0 text-xs px-3 ${isSent
                                  ? 'text-green-500'
                                  : 'bg-blue-500 hover:bg-blue-600 text-white'
                                }`}
                                data-testid={`dm-send-${conv.other_user_id}`}
                              >
                                {isSending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isSent ? (
                                  <><Check className="w-3 h-3 mr-1" /> Sent</>
                                ) : (
                                  'Send'
                                )}
                              </Button>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Native Share (Mobile) */}
          {typeof navigator !== 'undefined' && navigator.share && (
            <Button aria-label="Share"
              variant="outline"
              onClick={() => handleShare('native')}
              className="w-full"
              data-testid="share-native-btn"
            >
              <Share2 className="w-4 h-4 mr-2" />
              More sharing options
            </Button>
          )}
          
          {/* Instagram note for desktop - only show if not connected */}
          {!isMobile && !metaStatus?.instagram_connected && (
            <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} text-center`}>
              {SHARE_ICONS.camera} Instagram doesn't support web sharing. Connect your account above to post directly!
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SharePostModal;

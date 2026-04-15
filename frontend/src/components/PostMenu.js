/**
 * PostMenu - Instagram-style post options menu
 * Different options for own posts vs other users' posts
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  Trash2, Edit2, EyeOff, MessageSquareOff, ExternalLink, Share2, Link, 
  Code, UserCircle, X, Flag, UserMinus, Star, Users, AlertTriangle,
  Loader2, Copy, Check, Waves, ChevronDown, Pin
} from 'lucide-react';
import { Button } from './ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog';
import { 
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from './ui/drawer';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { toast } from 'sonner';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { TextareaWithEmoji } from './EmojiPicker';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Menu item component
 */
const MenuItem = ({ 
  icon: Icon, 
  label, 
  onClick, 
  variant = 'default', 
  loading = false,
  disabled = false,
  isLight 
}) => {
  const variants = {
    default: isLight ? 'text-gray-700 hover:bg-gray-100' : 'text-white hover:bg-zinc-800',
    danger: 'text-red-500 hover:bg-red-500/10',
    warning: 'text-yellow-500 hover:bg-yellow-500/10',
    success: 'text-green-500 hover:bg-green-500/10'
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left ${variants[variant]} transition-colors disabled:opacity-50`}
      data-testid={`menu-item-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <Icon className="w-5 h-5" />
      )}
      <span className="font-medium">{label}</span>
    </button>
  );
};

/**
 * Divider component
 */
const MenuDivider = ({ isLight }) => (
  <div className={`h-px ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} my-1`} />
);

/**
 * Edit Post Modal - Full session metadata editing
 */
const EditPostModal = ({ post, open, onClose, onSave, isLight }) => {
  // Helper to extract date part from ISO datetime string
  const extractDatePart = (dateStr) => {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    // Handle ISO datetime strings like "2026-03-31T12:00:00Z"
    if (typeof dateStr === 'string' && dateStr.includes('T')) {
      return dateStr.split('T')[0];
    }
    return dateStr;
  };

  const [caption, setCaption] = useState(post?.caption || '');
  const [location, setLocation] = useState(post?.location || '');
  const [sessionDate, setSessionDate] = useState(extractDatePart(post?.session_date));
  const [sessionStartTime, setSessionStartTime] = useState(post?.session_start_time || '');
  const [sessionEndTime, setSessionEndTime] = useState(post?.session_end_time || '');
  const [waveHeightFt, setWaveHeightFt] = useState(post?.wave_height_ft?.toString() || '');
  const [wavePeriodSec, setWavePeriodSec] = useState(post?.wave_period_sec?.toString() || '');
  const [waveDirection, setWaveDirection] = useState(post?.wave_direction || '');
  const [windSpeedMph, setWindSpeedMph] = useState(post?.wind_speed_mph?.toString() || '');
  const [windDirection, setWindDirection] = useState(post?.wind_direction || '');
  const [tideStatus, setTideStatus] = useState(post?.tide_status || '');
  const [tideHeightFt, setTideHeightFt] = useState(post?.tide_height_ft?.toString() || '');
  const [loading, setLoading] = useState(false);
  const [showConditions, setShowConditions] = useState(false);

  // Reset state when post changes
  useEffect(() => {
    if (post) {
      setCaption(post.caption || '');
      setLocation(post.location || '');
      setSessionDate(extractDatePart(post.session_date));
      setSessionStartTime(post.session_start_time || '');
      setSessionEndTime(post.session_end_time || '');
      setWaveHeightFt(post.wave_height_ft?.toString() || '');
      setWavePeriodSec(post.wave_period_sec?.toString() || '');
      setWaveDirection(post.wave_direction || '');
      setWindSpeedMph(post.wind_speed_mph?.toString() || '');
      setWindDirection(post.wind_direction || '');
      setTideStatus(post.tide_status || '');
      setTideHeightFt(post.tide_height_ft?.toString() || '');
      // Auto-show conditions if any exist
      setShowConditions(!!(post.wave_height_ft || post.wind_speed_mph || post.tide_status));
    }
  }, [post]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSave({ 
        caption,
        location: location || null,
        session_date: sessionDate || null,
        session_start_time: sessionStartTime || null,
        session_end_time: sessionEndTime || null,
        wave_height_ft: waveHeightFt ? parseFloat(waveHeightFt) : null,
        wave_period_sec: wavePeriodSec ? parseFloat(wavePeriodSec) : null,
        wave_direction: waveDirection || null,
        wind_speed_mph: windSpeedMph ? parseFloat(windSpeedMph) : null,
        wind_direction: windDirection || null,
        tide_status: tideStatus || null,
        tide_height_ft: tideHeightFt ? parseFloat(tideHeightFt) : null
      });
      onClose();
    } catch (error) {
      toast.error('Failed to update post');
    } finally {
      setLoading(false);
    }
  };

  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const tideStatuses = ['Rising', 'Falling', 'High', 'Low'];
  const bgColor = isLight ? 'bg-white' : 'bg-zinc-900';
  const inputBg = isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800 border-zinc-700';
  const textColor = isLight ? 'text-gray-900' : 'text-white';
  const labelColor = isLight ? 'text-gray-700' : 'text-gray-300';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`${bgColor} sm:max-w-lg`} aria-describedby="edit-post-description">
        <DialogHeader className="shrink-0 border-b border-zinc-700 px-4 sm:px-6 pt-4 pb-3">
          <DialogTitle className={textColor}>
            Edit Post
          </DialogTitle>
          <DialogDescription id="edit-post-description" className={isLight ? 'text-gray-500' : 'text-gray-400'}>
            Update your post details and session conditions
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Caption with Emoji Picker */}
          <div>
            <Label className={labelColor}>Caption</Label>
            <div className="mt-1">
              <TextareaWithEmoji
                value={caption}
                onChange={setCaption}
                placeholder="Write a caption..."
                rows={3}
                isLight={isLight}
              />
            </div>
          </div>

          {/* Location & Session Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={labelColor}>Location</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g., Cocoa Beach"
                className={`mt-1 ${inputBg}`}
              />
            </div>
            <div>
              <Label className={labelColor}>Session Date</Label>
              <Input
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className={`mt-1 ${inputBg}`}
              />
            </div>
          </div>

          {/* Session Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={labelColor}>Start Time</Label>
              <Input
                type="time"
                value={sessionStartTime}
                onChange={(e) => setSessionStartTime(e.target.value)}
                className={`mt-1 ${inputBg}`}
              />
            </div>
            <div>
              <Label className={labelColor}>End Time</Label>
              <Input
                type="time"
                value={sessionEndTime}
                onChange={(e) => setSessionEndTime(e.target.value)}
                className={`mt-1 ${inputBg}`}
              />
            </div>
          </div>

          {/* Conditions Toggle */}
          <button
            type="button"
            onClick={() => setShowConditions(!showConditions)}
            className={`w-full flex items-center justify-between p-3 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-zinc-800/50'}`}
          >
            <div className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-cyan-400" />
              <span className={`text-sm font-medium ${textColor}`}>Session Conditions</span>
            </div>
            <ChevronDown className={`w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} transition-transform ${showConditions ? 'rotate-180' : ''}`} />
          </button>

          {showConditions && (
            <div className={`space-y-4 p-4 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-zinc-800/30'}`}>
              {/* Wave Conditions */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className={`${labelColor} text-xs`}>Wave Height (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={waveHeightFt}
                    onChange={(e) => setWaveHeightFt(e.target.value)}
                    placeholder="3.5"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Period (sec)</Label>
                  <Input
                    type="number"
                    step="1"
                    value={wavePeriodSec}
                    onChange={(e) => setWavePeriodSec(e.target.value)}
                    placeholder="8"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Wave Dir</Label>
                  <Select value={waveDirection} onValueChange={setWaveDirection}>
                    <SelectTrigger className={`mt-1 ${inputBg}`}>
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}>
                      {directions.map(d => (
                        <SelectItem key={d} value={d} className={textColor}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Wind Conditions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${labelColor} text-xs`}>Wind Speed (mph)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={windSpeedMph}
                    onChange={(e) => setWindSpeedMph(e.target.value)}
                    placeholder="10"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Wind Dir</Label>
                  <Select value={windDirection} onValueChange={setWindDirection}>
                    <SelectTrigger className={`mt-1 ${inputBg}`}>
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}>
                      {directions.map(d => (
                        <SelectItem key={d} value={d} className={textColor}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tide Conditions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${labelColor} text-xs`}>Tide Status</Label>
                  <Select value={tideStatus} onValueChange={setTideStatus}>
                    <SelectTrigger className={`mt-1 ${inputBg}`}>
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}>
                      {tideStatuses.map(s => (
                        <SelectItem key={s} value={s} className={textColor}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Tide Height (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={tideHeightFt}
                    onChange={(e) => setTideHeightFt(e.target.value)}
                    placeholder="2.5"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={loading}
            className="bg-gradient-to-r from-cyan-500 to-blue-600"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Delete Confirmation Modal
 */
const DeleteConfirmModal = ({ open, onClose, onConfirm, isLight }) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      toast.error('Failed to delete post');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} max-w-sm`} aria-describedby="delete-post-description">
        <DialogHeader>
          <DialogTitle className="text-red-500 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Delete Post?
          </DialogTitle>
          <DialogDescription id="delete-post-description" className={isLight ? 'text-gray-600' : 'text-gray-400'}>
            This action cannot be undone. The post will be permanently deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button 
            variant="destructive"
            onClick={handleConfirm} 
            disabled={loading}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Report Post Modal
 */
const ReportPostModal = ({ post, open, onClose, isLight }) => {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const reportReasons = [
    'Spam or scam',
    'Nudity or sexual content',
    'Hate speech or symbols',
    'Violence or dangerous content',
    'Bullying or harassment',
    'False information',
    'Intellectual property violation',
    'Other'
  ];

  const handleReport = async () => {
    if (!reason) {
      toast.error('Please select a reason');
      return;
    }
    
    setLoading(true);
    try {
      await axios.post(`${API}/posts/${post.id}/report`, {
        reporter_id: user?.id,
        reason,
        description
      });
      toast.success('Report submitted. We\'ll review this post.');
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} max-w-md`} aria-describedby="report-post-description">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            <Flag className="w-5 h-5 text-red-500" />
            Report Post
          </DialogTitle>
          <DialogDescription id="report-post-description" className={isLight ? 'text-gray-600' : 'text-gray-400'}>
            Why are you reporting this post?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 max-h-[400px] overflow-y-auto">
          <div className="space-y-2">
            {reportReasons.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  reason === r
                    ? 'border-red-500 bg-red-500/10 text-red-500'
                    : isLight 
                      ? 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      : 'border-zinc-700 hover:bg-zinc-800 text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          
          {reason === 'Other' && (
            <div>
              <Label className={isLight ? 'text-gray-700' : 'text-gray-300'}>
                Additional details
              </Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe the issue..."
                className={`mt-1 ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800 border-zinc-700'}`}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button 
            variant="destructive"
            onClick={handleReport} 
            disabled={loading || !reason}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Share Post Modal - Enhanced with Direct Meta Sharing
 */
const SharePostModal = ({ post, open, onClose, isLight }) => {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [metaStatus, setMetaStatus] = useState(null);
  const [directShareLoading, setDirectShareLoading] = useState(null);
  const [checkingMeta, setCheckingMeta] = useState(true);
  
  // Use the API share URL which has proper Open Graph meta tags
  const API = process.env.REACT_APP_BACKEND_URL || '';
  const shareUrl = `${API}/share/${post?.id}`;
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
        const response = await axios.get(`${API}/meta/status?user_id=${user.id}`);
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
      const response = await axios.post(`${API}/meta/share-to-facebook?user_id=${user.id}`, {
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
      const response = await axios.post(`${API}/meta/share-to-instagram?user_id=${user.id}`, {
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
    const shareText = `Check out this surf session on Raw Surf! 🏄`;
    
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
                🚀 Direct Post to Your Feed
              </p>
              <div className="flex gap-2">
                {metaStatus.facebook_connected && (
                  <Button
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
                  <Button
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
                        <span className="text-lg mr-1">📸</span>
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
                🔗 Connect Facebook & Instagram
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
            <Input
              value={postUrl}
              readOnly
              className={`flex-1 text-sm ${isLight ? 'bg-white' : 'bg-zinc-900'}`}
            />
            <Button 
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
              <span className="text-2xl">𝕏</span>
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
              <span className="text-2xl">📸</span>
              <span className="text-xs mt-1">Link</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleShare('whatsapp')}
              className="flex-col h-auto py-3"
              data-testid="share-whatsapp-btn"
            >
              <span className="text-2xl text-green-500">💬</span>
              <span className="text-xs mt-1">WhatsApp</span>
            </Button>
          </div>
          
          {/* Native Share (Mobile) */}
          {typeof navigator !== 'undefined' && navigator.share && (
            <Button
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
              💡 Instagram doesn't support web sharing. Connect your account above to post directly!
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Main Post Menu Component
 */
export const PostMenu = ({ 
  post, 
  open, 
  onClose,
  onPostUpdated,
  onPostDeleted,
  onIWasThere,
  isFollowingAuthor = false,
  onFollow,
  onUnfollow
}) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isLight = theme === 'light';
  const isMobile = useMediaQuery('(max-width: 768px)');
  
  // Store the post data locally so it's available even after parent closes
  const [localPost, setLocalPost] = useState(post);
  
  // Update local post when prop changes
  React.useEffect(() => {
    if (post) {
      setLocalPost(post);
    }
  }, [post]);
  
  // Use localPost for all operations to avoid null reference
  const activePost = localPost || post;
  
  // Check if this is user's own post (must be after activePost definition)
  const isOwnPost = activePost?.author_id === user?.id;
  
  // Sub-modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  
  // Loading states
  const [actionLoading, setActionLoading] = useState(null);
  
  // Pinned state
  const [isPinned, setIsPinned] = useState(false);

  // Handle pin/unpin post to profile
  const handlePinPost = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('pin');
    try {
      const response = await axios.post(`${API}/posts/${activePost.id}/pin?user_id=${user.id}`);
      if (response.data.pinned) {
        setIsPinned(true);
        toast.success('Post pinned to profile');
      } else {
        setIsPinned(false);
        toast.success('Post unpinned from profile');
      }
      onClose();
    } catch (error) {
      toast.error('Failed to update pin');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle edit post - now supports all session metadata
  const handleEditPost = async (updates) => {
    if (!activePost?.id || !user?.id) {
      toast.error('Unable to update post');
      return;
    }
    try {
      logger.debug('Updating post:', activePost.id, 'with user:', user.id, 'updates:', updates);
      await axios.patch(`${API}/posts/${activePost.id}?user_id=${user.id}`, updates);
      toast.success('Post updated');
      onPostUpdated?.({ ...activePost, ...updates });
    } catch (error) {
      logger.error('Edit error:', error.response?.data || error);
      toast.error(error.response?.data?.detail || 'Failed to update post');
      throw error; // Re-throw so the modal can handle it
    }
  };

  // Handle delete post
  const handleDeletePost = async () => {
    if (!activePost?.id || !user?.id) {
      toast.error('Unable to delete post');
      return;
    }
    try {
      await axios.delete(`${API}/posts/${activePost.id}?user_id=${user.id}`);
      toast.success('Post deleted');
      onPostDeleted?.(activePost.id);
      onClose();
    } catch (error) {
      logger.error('Delete error:', error.response?.data || error);
      toast.error(error.response?.data?.detail || 'Failed to delete post');
    }
  };

  // Handle toggle like count visibility
  const handleToggleLikeCount = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('like-count');
    try {
      await axios.patch(`${API}/posts/${activePost.id}/settings?user_id=${user.id}`, {
        hide_like_count: !activePost.hide_like_count
      });
      toast.success(activePost.hide_like_count ? 'Like count shown' : 'Like count hidden');
      onPostUpdated?.({ ...activePost, hide_like_count: !activePost.hide_like_count });
      onClose();
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle toggle commenting
  const handleToggleCommenting = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('commenting');
    try {
      await axios.patch(`${API}/posts/${activePost.id}/settings?user_id=${user.id}`, {
        comments_disabled: !activePost.comments_disabled
      });
      toast.success(activePost.comments_disabled ? 'Comments enabled' : 'Comments disabled');
      onPostUpdated?.({ ...activePost, comments_disabled: !activePost.comments_disabled });
      onClose();
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle unfollow
  const handleUnfollow = async () => {
    if (!activePost?.author_id) return;
    setActionLoading('unfollow');
    try {
      await onUnfollow?.(activePost.author_id);
      onClose();
    } catch (error) {
      toast.error('Failed to unfollow');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle add to favorites
  const handleAddToFavorites = async () => {
    if (!activePost?.id || !user?.id) return;
    setActionLoading('favorites');
    try {
      await axios.post(`${API}/users/${user.id}/favorites`, {
        post_id: activePost.id
      });
      toast.success('Added to favorites');
      onClose();
    } catch (error) {
      if (error.response?.status === 409) {
        toast.info('Already in favorites');
      } else {
        toast.error('Failed to add to favorites');
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Handle copy link
  const handleCopyLink = () => {
    if (!activePost?.id) return;
    const postUrl = `${window.location.origin}/post/${activePost.id}`;
    navigator.clipboard.writeText(postUrl);
    toast.success('Link copied to clipboard');
    onClose();
  };

  // Handle go to post
  const handleGoToPost = () => {
    if (!activePost?.id) return;
    navigate(`/post/${activePost.id}`);
    onClose();
  };

  // Handle view profile
  const handleViewProfile = () => {
    if (!activePost?.author_id) return;
    navigate(`/profile/${activePost.author_id}`);
    onClose();
  };

  // Menu content - close menu BEFORE opening sub-modals to avoid overlay stacking
  const MenuContent = () => (
    <div className={`${isLight ? 'divide-gray-200' : 'divide-zinc-700'} divide-y`}>
      {isOwnPost ? (
        // Own post menu options
        <>
          <div>
            <MenuItem 
              icon={Trash2} 
              label="Delete" 
              onClick={() => { onClose(); setTimeout(() => setShowDeleteModal(true), 100); }}
              variant="danger"
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={Edit2} 
              label="Edit" 
              onClick={() => { onClose(); setTimeout(() => setShowEditModal(true), 100); }}
              isLight={isLight}
            />
            <MenuItem 
              icon={Pin} 
              label={isPinned ? "Unpin from profile" : "Pin to profile"} 
              onClick={handlePinPost}
              loading={actionLoading === 'pin'}
              isLight={isLight}
            />
            <MenuItem 
              icon={EyeOff} 
              label={activePost?.hide_like_count ? "Show like count" : "Hide like count to others"} 
              onClick={handleToggleLikeCount}
              loading={actionLoading === 'like-count'}
              isLight={isLight}
            />
            <MenuItem 
              icon={MessageSquareOff} 
              label={activePost?.comments_disabled ? "Turn on commenting" : "Turn off commenting"} 
              onClick={handleToggleCommenting}
              loading={actionLoading === 'commenting'}
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={ExternalLink} 
              label="Go to post" 
              onClick={handleGoToPost}
              isLight={isLight}
            />
            <MenuItem 
              icon={Share2} 
              label="Share to..." 
              onClick={() => { onClose(); setTimeout(() => setShowShareModal(true), 100); }}
              isLight={isLight}
            />
            <MenuItem 
              icon={Link} 
              label="Copy link" 
              onClick={handleCopyLink}
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={UserCircle} 
              label="About this account" 
              onClick={handleViewProfile}
              isLight={isLight}
            />
          </div>
        </>
      ) : (
        // Other user's post menu options
        <>
          <div>
            <MenuItem 
              icon={Flag} 
              label="Report" 
              onClick={() => { onClose(); setTimeout(() => setShowReportModal(true), 100); }}
              variant="danger"
              isLight={isLight}
            />
          </div>
          <div>
            {isFollowingAuthor && (
              <MenuItem 
                icon={UserMinus} 
                label="Unfollow" 
                onClick={handleUnfollow}
                loading={actionLoading === 'unfollow'}
                variant="warning"
                isLight={isLight}
              />
            )}
            <MenuItem 
              icon={Star} 
              label="Add to favorites" 
              onClick={handleAddToFavorites}
              loading={actionLoading === 'favorites'}
              isLight={isLight}
            />
            <MenuItem 
              icon={Users} 
              label="I was there too" 
              onClick={() => { onClose(); onIWasThere?.(); }}
              variant="success"
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={UserCircle} 
              label="About this account" 
              onClick={handleViewProfile}
              isLight={isLight}
            />
            <MenuItem 
              icon={ExternalLink} 
              label="Go to post" 
              onClick={handleGoToPost}
              isLight={isLight}
            />
          </div>
          <div>
            <MenuItem 
              icon={Share2} 
              label="Share to..." 
              onClick={() => { onClose(); setShowShareModal(true); }}
              isLight={isLight}
            />
            <MenuItem 
              icon={Link} 
              label="Copy link" 
              onClick={handleCopyLink}
              isLight={isLight}
            />
          </div>
        </>
      )}
    </div>
  );

  // Render drawer on mobile, dialog on desktop
  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={onClose}>
          <DrawerContent className={isLight ? 'bg-white' : 'bg-zinc-900'} aria-describedby="post-menu-drawer-description">
            <DrawerHeader className="sr-only">
              <DrawerTitle>Post Options</DrawerTitle>
              <p id="post-menu-drawer-description" className="sr-only">Actions for this post</p>
            </DrawerHeader>
            <MenuContent />
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="outline" className="w-full">
                  Cancel
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
        
        {/* Sub-modals */}
        <EditPostModal 
          post={activePost} 
          open={showEditModal} 
          onClose={() => setShowEditModal(false)} 
          onSave={handleEditPost}
          isLight={isLight}
        />
        <DeleteConfirmModal 
          open={showDeleteModal} 
          onClose={() => setShowDeleteModal(false)} 
          onConfirm={handleDeletePost}
          isLight={isLight}
        />
        <ReportPostModal 
          post={activePost}
          open={showReportModal} 
          onClose={() => setShowReportModal(false)}
          isLight={isLight}
        />
        <SharePostModal 
          post={activePost}
          open={showShareModal} 
          onClose={() => setShowShareModal(false)}
          isLight={isLight}
        />
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent 
          className={`${isLight ? 'bg-white' : 'bg-zinc-900'} p-0 max-w-xs overflow-hidden`}
          aria-describedby="post-menu-description"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Post Options</DialogTitle>
            <DialogDescription id="post-menu-description">
              Actions for this post
            </DialogDescription>
          </DialogHeader>
          <MenuContent />
          <div className={`p-2 ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
            <Button 
              variant="ghost" 
              onClick={onClose}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Sub-modals */}
      <EditPostModal 
        post={activePost} 
        open={showEditModal} 
        onClose={() => setShowEditModal(false)} 
        onSave={handleEditPost}
        isLight={isLight}
      />
      <DeleteConfirmModal 
        open={showDeleteModal} 
        onClose={() => setShowDeleteModal(false)} 
        onConfirm={handleDeletePost}
        isLight={isLight}
      />
      <ReportPostModal 
        post={activePost}
        open={showReportModal} 
        onClose={() => setShowReportModal(false)}
        isLight={isLight}
      />
      <SharePostModal 
        post={activePost}
        open={showShareModal} 
        onClose={() => setShowShareModal(false)}
        isLight={isLight}
      />
    </>
  );
};

export { SharePostModal };
export default PostMenu;

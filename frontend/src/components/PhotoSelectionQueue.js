import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Check, Image, Video, AlertCircle, Loader2, X, Gift, Camera, Timer, Zap, Ban } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

const PhotoSelectionQueue = ({ open, onOpenChange, theme = 'dark', onSelectionComplete }) => {
  const { user } = useAuth();
  const isLight = theme === 'light';
  
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-zinc-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';
  const bgCardClass = isLight ? 'bg-gray-100' : 'bg-zinc-800';
  const bgHoverClass = isLight ? 'hover:bg-gray-200' : 'hover:bg-zinc-700';

  // State
  const [quotas, setQuotas] = useState([]);
  const [selectedQuota, setSelectedQuota] = useState(null);
  const [eligibleItems, setEligibleItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  
  // Deadline & Preference State
  const [deadlineInfo, setDeadlineInfo] = useState(null);
  const [updatingPreference, setUpdatingPreference] = useState(false);
  const [countdownText, setCountdownText] = useState('');

  // Live countdown timer
  useEffect(() => {
    if (!deadlineInfo?.time_remaining_seconds || deadlineInfo.is_expired) return;
    
    const updateCountdown = () => {
      const now = new Date();
      const deadline = new Date(deadlineInfo.selection_deadline);
      const diff = deadline - now;
      
      if (diff <= 0) {
        setCountdownText('Expired');
        return;
      }
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      
      if (days > 0) {
        setCountdownText(`${days}d ${hours}h ${minutes}m`);
      } else if (hours > 0) {
        setCountdownText(`${hours}h ${minutes}m ${seconds}s`);
      } else {
        setCountdownText(`${minutes}m ${seconds}s`);
      }
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [deadlineInfo]);

  // Fetch deadline info for a quota
  const fetchDeadlineInfo = async (quotaId) => {
    try {
      const response = await axios.get(`${API}/api/surfer-gallery/selection-queue/${quotaId}/deadline-info`);
      setDeadlineInfo(response.data);
    } catch (err) {
      // Non-critical - just log
    }
  };

  // Update expiry preference
  const updateExpiryPreference = async (autoSelect) => {
    if (!selectedQuota) return;
    
    setUpdatingPreference(true);
    try {
      await axios.patch(`${API}/api/surfer-gallery/selection-queue/${selectedQuota.id}/preference`, {
        auto_select_on_expiry: autoSelect
      });
      
      // Refresh deadline info
      await fetchDeadlineInfo(selectedQuota.id);
      
      toast.success(autoSelect 
        ? 'Will auto-select your best photos if time runs out' 
        : 'Remaining selections will be forfeited if time runs out'
      );
    } catch (err) {
      toast.error('Failed to update preference');
    } finally {
      setUpdatingPreference(false);
    }
  };

  // Fetch all pending selection quotas
  const fetchQuotas = useCallback(async () => {
    if (!user?.id) return;
    
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API}/api/surfer-gallery/selection-queue/${user.id}`);
      setQuotas(response.data.quotas || []);
      
      // Auto-select first quota if only one
      if (response.data.quotas?.length === 1) {
        await fetchQuotaItems(response.data.quotas[0].id);
        setSelectedQuota(response.data.quotas[0]);
      }
    } catch (err) {
      logger.error('Failed to fetch selection quotas:', err);
      setError('Failed to load photo selection queue');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Fetch items for a specific quota
  const fetchQuotaItems = async (quotaId) => {
    try {
      const response = await axios.get(`${API}/api/surfer-gallery/selection-queue/${quotaId}/items`);
      setEligibleItems(response.data.unselected_items || []);
      setSelectedItems(new Set());
      
      // Also fetch deadline info
      await fetchDeadlineInfo(quotaId);
    } catch (err) {
      // Error logged in component
    }
  };

  useEffect(() => {
    if (open && user?.id) {
      fetchQuotas();
    }
  }, [open, user?.id, fetchQuotas]);

  // Toggle item selection
  const toggleItemSelection = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      // Check if we're at the limit
      const quota = selectedQuota;
      const photoItems = eligibleItems.filter(i => i.media_type !== 'video');
      const videoItems = eligibleItems.filter(i => i.media_type === 'video');
      
      const selectedPhotos = [...newSelected].filter(id => 
        photoItems.some(i => i.id === id)
      ).length;
      const selectedVideos = [...newSelected].filter(id => 
        videoItems.some(i => i.id === id)
      ).length;
      
      const item = eligibleItems.find(i => i.id === itemId);
      if (item.media_type === 'video') {
        if (selectedVideos >= quota.videos_allowed - quota.videos_selected) {
          return; // At video limit
        }
      } else {
        if (selectedPhotos >= quota.photos_allowed - quota.photos_selected) {
          return; // At photo limit
        }
      }
      
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  // Submit selections
  const handleSubmitSelections = async () => {
    if (!selectedQuota || selectedItems.size === 0) return;
    
    setSubmitting(true);
    try {
      await axios.post(`${API}/api/surfer-gallery/selection-queue/${selectedQuota.id}/select`, {
        item_ids: Array.from(selectedItems)
      });
      
      // Refresh data
      await fetchQuotas();
      setSelectedItems(new Set());
      
      if (onSelectionComplete) {
        onSelectionComplete();
      }
    } catch (err) {
      logger.error('Failed to submit selections:', err);
      setError(err.response?.data?.detail || 'Failed to save selections');
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate selection counts
  const getSelectionCounts = () => {
    if (!selectedQuota) return { photos: 0, videos: 0, maxPhotos: 0, maxVideos: 0 };
    
    const photoItems = eligibleItems.filter(i => i.media_type !== 'video');
    const videoItems = eligibleItems.filter(i => i.media_type === 'video');
    
    const selectedPhotos = [...selectedItems].filter(id => 
      photoItems.some(i => i.id === id)
    ).length;
    const selectedVideos = [...selectedItems].filter(id => 
      videoItems.some(i => i.id === id)
    ).length;
    
    return {
      photos: selectedPhotos,
      videos: selectedVideos,
      maxPhotos: selectedQuota.photos_allowed - selectedQuota.photos_selected,
      maxVideos: selectedQuota.videos_allowed - selectedQuota.videos_selected
    };
  };

  const counts = getSelectionCounts();

  // Format deadline
  const formatDeadline = (deadline) => {
    if (!deadline) return null;
    const d = new Date(deadline);
    const now = new Date();
    const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) return 'Expired';
    if (diffDays === 1) return '1 day left';
    return `${diffDays} days left`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-3xl w-[95vw] sm:w-full p-0 shadow-2xl overflow-hidden rounded-2xl flex flex-col gap-0`}>
        <div className={`p-6 pb-4 border-b ${isLight ? 'border-gray-100' : 'border-zinc-800/60'}`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2 text-lg md:text-xl`}>
              <Gift className="w-5 h-5 md:w-6 md:h-6 text-green-400" />
              Select Your Included Photos
            </DialogTitle>
            <p className={`text-sm ${textSecondaryClass}`}>
              Your session includes free photos! Choose your favorites from the shots below.
            </p>
          </DialogHeader>
        </div>

        <div className="p-4 md:p-6 overflow-y-auto max-h-[60vh]">

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mb-4" />
            <p className={textPrimaryClass}>{error}</p>
            <Button 
              onClick={fetchQuotas} 
              variant="outline" 
              className="mt-4"
            >
              Try Again
            </Button>
          </div>
        ) : quotas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Check className="w-12 h-12 text-green-400 mb-4" />
            <p className={textPrimaryClass}>No pending selections!</p>
            <p className={`text-sm ${textSecondaryClass} mt-2`}>
              You've completed all your photo selections.
            </p>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            
            {/* Session Selection (if multiple) */}
            {quotas.length > 1 && !selectedQuota && (
              <div className="space-y-3">
                <p className={`text-sm font-medium ${textPrimaryClass}`}>Choose a session:</p>
                {quotas.map(quota => (
                  <button
                    key={quota.id}
                    data-testid={`quota-select-${quota.id}`}
                    onClick={() => {
                      setSelectedQuota(quota);
                      fetchQuotaItems(quota.id);
                    }}
                    className={`
                      w-full p-4 rounded-xl text-left transition-all
                      ${bgCardClass} border ${borderClass} ${bgHoverClass}
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className={`font-medium ${textPrimaryClass}`}>
                          {quota.photographer_name || 'Session'}
                        </p>
                        <p className={`text-sm ${textSecondaryClass}`}>
                          {quota.spot_name} • {quota.session_date ? new Date(quota.session_date).toLocaleDateString() : 'Recent'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-green-400 font-bold">
                          {quota.photos_allowed - quota.photos_selected} photos
                        </p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          {formatDeadline(quota.selection_deadline)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Selected Quota Details */}
            {selectedQuota && (
              <>
                {/* Quota Header */}
                <div className={`p-4 rounded-xl ${isLight ? 'bg-green-50 border border-green-200' : 'bg-green-500/10 border border-green-500/30'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Camera className="w-5 h-5 text-green-400" />
                      <div>
                        <p className={`font-medium ${textPrimaryClass}`}>
                          {selectedQuota.photographer_name}
                        </p>
                        <p className={`text-xs ${textSecondaryClass}`}>
                          {selectedQuota.spot_name}
                        </p>
                      </div>
                    </div>
                    {quotas.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedQuota(null);
                          setEligibleItems([]);
                          setSelectedItems(new Set());
                          setDeadlineInfo(null);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  
                  {/* Selection Progress */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Image className="w-4 h-4 text-cyan-400" />
                      <span className={textPrimaryClass}>
                        <span className="font-bold text-cyan-400">{counts.photos}</span>
                        <span className={textSecondaryClass}> / {counts.maxPhotos} photos</span>
                      </span>
                    </div>
                    {counts.maxVideos > 0 && (
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4 text-purple-400" />
                        <span className={textPrimaryClass}>
                          <span className="font-bold text-purple-400">{counts.videos}</span>
                          <span className={textSecondaryClass}> / {counts.maxVideos} videos</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Deadline Countdown & Expiry Preference */}
                {deadlineInfo && (
                  <div 
                    data-testid="selection-deadline-section"
                    className={`p-4 rounded-xl ${
                      deadlineInfo.is_expired 
                        ? 'bg-red-500/10 border border-red-500/30'
                        : deadlineInfo.time_remaining_seconds < 86400 
                          ? 'bg-yellow-500/10 border border-yellow-500/30'
                          : isLight ? 'bg-blue-50 border border-blue-200' : 'bg-blue-500/10 border border-blue-500/30'
                    }`}
                  >
                    {/* Countdown Timer */}
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          deadlineInfo.is_expired 
                            ? 'bg-red-500/20' 
                            : deadlineInfo.time_remaining_seconds < 86400 
                              ? 'bg-yellow-500/20' 
                              : 'bg-blue-500/20'
                        }`}>
                          <Timer className={`w-5 h-5 ${
                            deadlineInfo.is_expired 
                              ? 'text-red-400' 
                              : deadlineInfo.time_remaining_seconds < 86400 
                                ? 'text-yellow-400' 
                                : 'text-blue-400'
                          }`} />
                        </div>
                        <div>
                          <p className={`text-sm ${textSecondaryClass}`}>Selection Deadline</p>
                          <p className={`text-lg font-bold ${
                            deadlineInfo.is_expired 
                              ? 'text-red-400' 
                              : deadlineInfo.time_remaining_seconds < 86400 
                                ? 'text-yellow-400' 
                                : textPrimaryClass
                          }`} data-testid="countdown-display">
                            {deadlineInfo.is_expired ? 'EXPIRED' : countdownText || formatDeadline(deadlineInfo.selection_deadline)}
                          </p>
                        </div>
                      </div>
                      
                      {/* Remaining picks badge */}
                      <div className="text-right">
                        <p className={`text-xs ${textSecondaryClass}`}>Remaining</p>
                        <p className="text-lg font-bold text-green-400">
                          {deadlineInfo.photos_remaining} picks
                        </p>
                      </div>
                    </div>
                    
                    {/* Expiry Preference Toggle */}
                    {!deadlineInfo.is_expired && deadlineInfo.photos_remaining > 0 && (
                      <div 
                        data-testid="expiry-preference-section"
                        className={`pt-4 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}
                      >
                        <p className={`text-sm font-medium mb-3 ${textPrimaryClass}`}>
                          If time runs out, I want to:
                        </p>
                        
                        <div className="space-y-2">
                          {/* Auto-select option */}
                          <button
                            data-testid="preference-auto-select"
                            onClick={() => updateExpiryPreference(true)}
                            disabled={updatingPreference}
                            className={`
                              w-full p-3 rounded-lg flex items-center gap-3 transition-all
                              ${deadlineInfo.auto_select_on_expiry === true 
                                ? 'bg-cyan-500/20 border-2 border-cyan-500' 
                                : `${bgCardClass} border ${borderClass} ${bgHoverClass}`
                              }
                            `}
                          >
                            <div className={`p-1.5 rounded-full ${deadlineInfo.auto_select_on_expiry === true ? 'bg-cyan-500' : 'bg-zinc-600'}`}>
                              <Zap className="w-4 h-4 text-white" />
                            </div>
                            <div className="text-left flex-1">
                              <p className={`font-medium ${textPrimaryClass}`}>Auto-select best photos</p>
                              <p className={`text-xs ${textSecondaryClass}`}>
                                We'll pick your most-viewed favorites automatically
                              </p>
                            </div>
                            {deadlineInfo.auto_select_on_expiry === true && (
                              <Check className="w-5 h-5 text-cyan-400" />
                            )}
                          </button>
                          
                          {/* Forfeit option */}
                          <button
                            data-testid="preference-forfeit"
                            onClick={() => updateExpiryPreference(false)}
                            disabled={updatingPreference}
                            className={`
                              w-full p-3 rounded-lg flex items-center gap-3 transition-all
                              ${deadlineInfo.auto_select_on_expiry === false 
                                ? 'bg-orange-500/20 border-2 border-orange-500' 
                                : `${bgCardClass} border ${borderClass} ${bgHoverClass}`
                              }
                            `}
                          >
                            <div className={`p-1.5 rounded-full ${deadlineInfo.auto_select_on_expiry === false ? 'bg-orange-500' : 'bg-zinc-600'}`}>
                              <Ban className="w-4 h-4 text-white" />
                            </div>
                            <div className="text-left flex-1">
                              <p className={`font-medium ${textPrimaryClass}`}>Forfeit remaining selections</p>
                              <p className={`text-xs ${textSecondaryClass}`}>
                                I'll select manually or skip the rest
                              </p>
                            </div>
                            {deadlineInfo.auto_select_on_expiry === false && (
                              <Check className="w-5 h-5 text-orange-400" />
                            )}
                          </button>
                        </div>
                        
                        {!deadlineInfo.preference_set && (
                          <p className={`text-xs mt-2 ${textSecondaryClass}`}>
                            <AlertCircle className="w-3 h-3 inline mr-1" />
                            Please choose a preference before your deadline expires
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Photo Grid */}
                <div className="space-y-3">
                  <p className={`text-sm font-medium ${textPrimaryClass}`}>
                    Tap to select ({selectedQuota.total_eligible} available):
                  </p>
                  
                  {eligibleItems.length === 0 ? (
                    <div className="text-center py-8">
                      <p className={textSecondaryClass}>No items available for selection.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {eligibleItems.map(item => {
                        const isSelected = selectedItems.has(item.id);
                        const isVideo = item.media_type === 'video';
                        const isAtLimit = isVideo 
                          ? counts.videos >= counts.maxVideos && !isSelected
                          : counts.photos >= counts.maxPhotos && !isSelected;
                        
                        return (
                          <button
                            key={item.id}
                            data-testid={`selectable-item-${item.id}`}
                            onClick={() => toggleItemSelection(item.id)}
                            disabled={isAtLimit}
                            className={`
                              relative aspect-square rounded-lg overflow-hidden
                              transition-all transform
                              ${isSelected 
                                ? 'ring-4 ring-green-500 scale-95' 
                                : isAtLimit 
                                  ? 'opacity-40 cursor-not-allowed'
                                  : 'hover:scale-95'
                              }
                            `}
                          >
                            <img
                              src={item.thumbnail_url || item.preview_url}
                              alt="Gallery item"
                              className="w-full h-full object-cover"
                            />
                            
                            {/* Video indicator */}
                            {isVideo && (
                              <div className="absolute top-2 left-2 p-1 rounded-full bg-black/60">
                                <Video className="w-3 h-3 text-white" />
                              </div>
                            )}
                            
                            {/* Selection indicator */}
                            {isSelected && (
                              <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center">
                                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                                  <Check className="w-6 h-6 text-white" />
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        </div>

        <div className={`p-4 border-t ${isLight ? 'border-gray-100 bg-gray-50' : 'border-zinc-800/60 bg-zinc-900/50'}`}>
          <DialogFooter className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
              Close
            </Button>
            
            {selectedQuota && selectedItems.size > 0 && (
              <Button
                data-testid="confirm-selection-btn"
                onClick={handleSubmitSelections}
                disabled={submitting}
                className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-emerald-500 text-white"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Confirm Selection ({selectedItems.size})
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PhotoSelectionQueue;

/**
 * SurferGallery - "My Gallery" / "The Locker"
 * Private media collection for surfers with full controls
 * 
 * Features:
 * - Responsive desktop/mobile layout
 * - Favorites system
 * - Search, sort, and filter
 * - Grid/List view modes
 * - Bulk download
 * - Social sharing
 * - Purchase history
 * - Album/folder organization
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Lock, Download, Eye, EyeOff, CheckCircle, XCircle,
  Image as ImageIcon, Video, Sparkles, Filter, Crown, Gift, Heart,
  Search, Grid, List, Share2, Calendar, SortDesc, Camera, MapPin, History, X,
  MoreHorizontal, MessageSquare, Check,
  ChevronLeft, ChevronRight, Loader2, ScanFace
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { toast } from 'sonner';
import axios from 'axios';
import PhotoSelectionQueue from './PhotoSelectionQueue';
import AIProposedMatches from './AIProposedMatches';
import { LockerSelfieModal } from './LockerSelfieModal';
import { BulkPurchaseBar, MultiSelectToggle } from './gallery/BulkPurchaseBar';
import { VisibilityOnboarding } from './gallery/DownloadVisibility';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Gallery Item Card Component - Enhanced with favorites and sharing
 */
const GalleryItemCard = ({ 
  item, 
  onVisibilityToggle, 
  onDownload, 
  onFavoriteToggle,
  onShare,
  onRequestEdit,
  onImageClick,
  onMessage,
  _userId,
  viewMode = 'grid',
  isSelected,
  onSelect
}) => {
  const isPro = item.gallery_tier === 'pro';
  const isAccessible = item.is_paid || ['included', 'gifted'].includes(item.access_type);
  const isFavorite = item.is_favorite;
  
  // List view
  if (viewMode === 'list') {
    return (
      <div 
        className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
          isSelected 
            ? 'bg-cyan-500/10 border-cyan-500/50' 
            : 'bg-card border-border hover:bg-muted/50'
        }`}
        data-testid={`gallery-item-${item.id}`}
      >
        {/* Selection checkbox */}
        <button
          onClick={() => onSelect?.(item.id)}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-600 hover:border-cyan-400'
          }`}
        >
          {isSelected && <Check className="w-3 h-3 text-foreground" />}
        </button>
        
        {/* Thumbnail */}
        <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
          <img 
            src={item.thumbnail_url || item.url} 
            alt=""
            className="w-full h-full object-cover"
          />
          {item.media_type === 'video' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Video className="w-5 h-5 text-foreground" />
            </div>
          )}
        </div>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground truncate">
              {item.title || `Photo ${item.id?.slice(-6)}`}
            </span>
            {isFavorite && <Heart className="w-4 h-4 text-red-400 fill-red-400" />}
            {isPro && <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">PRO</Badge>}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              <Camera className="w-3 h-3" />
              {item.photographer_name || 'Unknown'}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {new Date(item.created_at).toLocaleDateString()}
            </span>
            {item.spot_name && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {item.spot_name}
              </span>
            )}
          </div>
        </div>
        
        {/* Status */}
        <div className="flex items-center gap-2">
          {item.is_public ? (
            <Badge className="bg-green-500/20 text-green-400 text-xs">Public</Badge>
          ) : (
            <Badge className="bg-zinc-700 text-muted-foreground text-xs">Private</Badge>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onFavoriteToggle?.(item.id)}
            className={isFavorite ? 'text-red-400' : 'text-muted-foreground'}
          >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDownload?.(item)}
            disabled={!isAccessible}
            className="text-muted-foreground"
          >
            <Download className="w-4 h-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="text-muted-foreground">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border">
              <DropdownMenuItem onClick={() => onVisibilityToggle?.(item.id, !item.is_public)}>
                {item.is_public ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                Make {item.is_public ? 'Private' : 'Public'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onShare?.(item)}>
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRequestEdit?.(item)}>
                <MessageSquare className="w-4 h-4 mr-2" />
                Request Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }
  
  // Grid view (default)
  return (
    <div 
      className={`group relative rounded-xl overflow-hidden border-2 transition-all ${
        isSelected 
          ? 'border-cyan-500 ring-2 ring-cyan-500/30' 
          : 'border-transparent hover:border-zinc-600'
      }`}
      data-testid={`gallery-item-${item.id}`}
    >
      {/* Selection checkbox */}
      <button
        onClick={() => onSelect?.(item.id)}
        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
          isSelected 
            ? 'bg-cyan-500 border-cyan-500' 
            : 'bg-black/50 border-white/50 opacity-0 group-hover:opacity-100'
        }`}
      >
        {isSelected && <Check className="w-4 h-4 text-foreground" />}
      </button>
      
      {/* Favorite button */}
      <button
        onClick={() => onFavoriteToggle?.(item.id)}
        className={`absolute top-2 right-2 z-10 p-1.5 rounded-full transition-all ${
          isFavorite 
            ? 'bg-red-500/80 text-foreground' 
            : 'bg-black/50 text-foreground opacity-0 group-hover:opacity-100 hover:bg-red-500/80'
        }`}
      >
        <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
      </button>
      
      {/* Image */}
      <div className="aspect-square bg-muted cursor-pointer" onClick={() => onImageClick?.(item)}>
        <img 
          src={item.thumbnail_url || item.url} 
          alt=""
          className={`w-full h-full object-cover transition-all ${
            !isAccessible ? 'blur-sm' : ''
          }`}
        />
        
        {/* Video indicator */}
        {item.media_type === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
              <Video className="w-6 h-6 text-foreground" />
            </div>
          </div>
        )}
        
        {/* Pro tier badge */}
        {isPro && (
          <div className="absolute top-2 left-10 px-2 py-0.5 rounded bg-gradient-to-r from-amber-500 to-yellow-500 text-black text-xs font-bold">
            PRO
          </div>
        )}
        
        {/* Locked overlay */}
        {!isAccessible && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
            <Lock className="w-8 h-8 text-amber-400 mb-2" />
            <span className="text-foreground text-sm font-medium">Purchase to unlock</span>
          </div>
        )}
      </div>
      
      {/* Info overlay on hover */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-foreground text-sm font-medium truncate">
              {item.photographer_name || 'Unknown'}
            </p>
            <p className="text-muted-foreground text-xs">
              {new Date(item.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {/* Quick Message to Photographer */}
            {item.photographer_id && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onMessage?.(item.photographer_id, item.photographer_name)}
                className="text-foreground hover:bg-cyan-500/20 h-8 w-8 p-0"
                title="Message photographer"
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onShare?.(item)}
              className="text-foreground hover:bg-white/20 h-8 w-8 p-0"
            >
              <Share2 className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDownload?.(item)}
              disabled={!isAccessible}
              className="text-foreground hover:bg-white/20 h-8 w-8 p-0"
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
      
      {/* Visibility indicator */}
      <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onVisibilityToggle?.(item.id, !item.is_public)}
          className={`p-1.5 rounded-full ${
            item.is_public ? 'bg-green-500/80' : 'bg-zinc-700/80'
          }`}
        >
          {item.is_public ? <Eye className="w-3 h-3 text-foreground" /> : <EyeOff className="w-3 h-3 text-foreground" />}
        </button>
      </div>
    </div>
  );
};

/**
 * Claim Queue Item Component
 */
const ClaimQueueItem = ({ item, onAction }) => (
  <div className="p-3 bg-muted rounded-xl border border-purple-500/20">
    <div className="flex gap-3">
      <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
        <img 
          src={item.thumbnail_url || item.url} 
          alt=""
          className="w-full h-full object-cover"
        />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Badge className="bg-purple-500/20 text-purple-400 text-xs">
            {Math.round(item.confidence * 100)}% match
          </Badge>
          <span className="text-xs text-muted-foreground">
            by {item.photographer_name}
          </span>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2">
          {item.session_date ? new Date(item.session_date).toLocaleDateString() : 'Recent session'}
          {item.spot_name && ` at ${item.spot_name}`}
        </p>
        <div className="flex gap-2 mt-2">
          <Button
            size="sm"
            onClick={() => onAction(item.id, 'claim')}
            className="bg-green-500 hover:bg-green-600 text-foreground h-7 text-xs"
          >
            <CheckCircle className="w-3 h-3 mr-1" />
            That's me!
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(item.id, 'reject')}
            className="h-7 text-xs border-zinc-600"
          >
            <XCircle className="w-3 h-3 mr-1" />
            Not me
          </Button>
        </div>
      </div>
    </div>
  </div>
);

/**
 * Download Modal Component
 */
const DownloadModal = ({ item, isOpen, onClose, onDownload, onPurchase }) => {
  if (!item) return null;
  
  const tiers = [
    { id: 'web', label: 'Web Quality', desc: '1200px - Social media', price: item.price !== undefined ? item.price : 3.0 },
    { id: 'standard', label: 'Standard', desc: '2400px - Prints up to 8x10', price: item.price !== undefined ? item.price : 5.0 },
    { id: 'high', label: 'High Resolution', desc: 'Full size - Large prints', price: item.price !== undefined ? item.price : 10.0 },
  ];
  
  const isAccessible = item.is_paid || ['included', 'gifted'].includes(item.access_type);
  const isFreeFromSession = item.price === 0.0 && item.price_source === 'included';
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-cyan-400" />
            Download Options
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {tiers.map(tier => (
            <button
              key={tier.id}
              onClick={() => onDownload(item.id, tier.id)}
              disabled={!isAccessible}
              className={`w-full p-3 rounded-lg border text-left transition-all ${
                isAccessible 
                  ? 'border-zinc-700 hover:border-cyan-500/50 hover:bg-cyan-500/10' 
                  : 'border-border opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{tier.label}</p>
                  <p className="text-sm text-muted-foreground">{tier.desc}</p>
                </div>
                {isAccessible ? (
                  <Download className="w-5 h-5 text-cyan-400" />
                ) : (
                  <span className="text-amber-400">${tier.price.toFixed(2)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
        {!isAccessible && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex flex-col gap-3">
            <p className="text-sm text-amber-400">
              {isFreeFromSession 
                ? "This photo is included in your session package! Click below to unlock." 
                : "Purchase this photo to unlock downloads"}
            </p>
            <Button
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-black font-semibold"
              onClick={() => onPurchase(item.id, 'high')} // Defaulting to high quality purchase
            >
               {isFreeFromSession ? "Unlock Included Photo" : `Buy Now ($${tiers[2].price.toFixed(2)})`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/**
 * Share Modal Component
 */
const ShareModal = ({ item, isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  
  if (!item) return null;
  
  const shareUrl = `${window.location.origin}/gallery/item/${item.id}`;
  
  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copied!');
  };
  
  const handleSocialShare = (platform) => {
    const text = `Check out this surf photo!`;
    const urls = {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      instagram: shareUrl, // Instagram doesn't have direct share URL, just copy
    };
    if (platform === 'instagram') {
      handleCopy();
      toast.info('Link copied! Paste in Instagram');
    } else {
      window.open(urls[platform], '_blank', 'width=600,height=400');
    }
    onClose();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-cyan-400" />
            Share Photo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Preview */}
          <div className="aspect-video rounded-lg overflow-hidden bg-muted">
            <img src={item.thumbnail_url || item.url} alt="" className="w-full h-full object-cover" />
          </div>
          
          {/* Copy link */}
          <div className="flex gap-2">
            <Input 
              value={shareUrl} 
              readOnly 
              className="bg-muted border-zinc-700 text-sm"
            />
            <Button onClick={handleCopy} className="bg-cyan-500 hover:bg-cyan-600">
              {copied ? <Check className="w-4 h-4" /> : 'Copy'}
            </Button>
          </div>
          
          {/* Social buttons */}
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              onClick={() => handleSocialShare('twitter')}
              className="flex-1 border-zinc-700"
            >
              𝕏 Twitter
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSocialShare('facebook')}
              className="flex-1 border-zinc-700"
            >
              Facebook
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSocialShare('instagram')}
              className="flex-1 border-zinc-700"
            >
              Instagram
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Request Edit Modal Component
 */
const RequestEditModal = ({ item, isOpen, onClose, onSubmit }) => {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  
  if (!item) return null;
  
  const handleSubmit = async () => {
    if (!message.trim()) {
      toast.error('Please describe your edit request');
      return;
    }
    setLoading(true);
    try {
      await onSubmit(item.id, message);
      toast.success('Edit request sent to photographer');
      setMessage('');
      onClose();
    } catch (error) {
      toast.error('Failed to send request');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-cyan-400" />
            Request Edit
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send a message to <span className="text-foreground">{item.photographer_name}</span> requesting edits to this photo.
          </p>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="E.g., Could you crop tighter on the wave? Or add a slight color boost?"
            className="w-full h-24 p-3 bg-muted border border-zinc-700 rounded-lg text-foreground placeholder:text-muted-foreground resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Common requests: cropping, color correction, remove watermark (for purchased photos)
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-cyan-500 hover:bg-cyan-600">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Purchase History Modal Component
 */
const PurchaseHistoryModal = ({ isOpen, onClose, userId }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (isOpen && userId) {
      fetchHistory();
    }
  }, [isOpen, userId]);
  
  const fetchHistory = async () => {
    try {
      const response = await axios.get(`${API}/surfer-gallery/purchase-history?surfer_id=${userId}`);
      setHistory(response.data.purchases || []);
    } catch (error) {
      logger.error('Failed to fetch purchase history:', error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-cyan-400" />
            Purchase History
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No purchases yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map(purchase => (
                <div key={purchase.id} className="p-3 bg-muted rounded-lg border border-zinc-700">
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded overflow-hidden flex-shrink-0">
                      <img src={purchase.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <span className="font-medium">{purchase.photographer_name}</span>
                        <span className="text-green-400">${purchase.amount}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{purchase.quality_tier} quality</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(purchase.purchased_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Main Surfer Gallery Component
 */
export const SurferGallery = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  
  // State
  const [loading, setLoading] = useState(true);
  const [galleryItems, setGalleryItems] = useState([]);
  const [claimQueue, setClaimQueue] = useState([]);
  const [stats, setStats] = useState({});
  const [activeTab, setActiveTab] = useState('locker');
  const [pendingSelections, setPendingSelections] = useState(0);
  const [showSelectionQueue, setShowSelectionQueue] = useState(false);
  
  // AI Proposed Matches state
  const [aiSessions, setAiSessions] = useState([]);
  const [selectedAiSession, setSelectedAiSession] = useState(null);
  const [showAiMatches, setShowAiMatches] = useState(false);
  
  // Filters and view state
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [viewMode, setViewMode] = useState('grid');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [showVisibilityOnboarding, setShowVisibilityOnboarding] = useState(() => {
    return !localStorage.getItem('surfer_gallery_visibility_seen');
  });
  
  // Modals
  const [downloadModal, setDownloadModal] = useState({ isOpen: false, item: null });
  const [shareModal, setShareModal] = useState({ isOpen: false, item: null });
  const [editModal, setEditModal] = useState({ isOpen: false, item: null });
  const [scanModal, setScanModal] = useState(false);
  const [showPurchaseHistory, setShowPurchaseHistory] = useState(false);
  const [lightboxItem, setLightboxItem] = useState(null); // Phase 2: Lightbox
  
  // Theme
  const isLight = theme === 'light';
  const mainBgClass = isLight ? 'bg-gray-50' : 'bg-zinc-950';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card/50 border-border';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-muted-foreground';
  
  // Fetch gallery data
  useEffect(() => {
    if (user?.id) {
      fetchGallery();
      fetchClaimQueue();
      checkPendingSelections();
      fetchAiSessions();
    }
  }, [user?.id]);
  
  const fetchGallery = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/surfer-gallery?surfer_id=${user.id}`);
      setGalleryItems(response.data.items || []);
      setStats(response.data.stats || {});
    } catch (error) {
      logger.error('Failed to fetch gallery:', error);
      toast.error('Failed to load gallery');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchClaimQueue = async () => {
    try {
      const response = await axios.get(`${API}/surfer-gallery/claim-queue?surfer_id=${user.id}`);
      setClaimQueue(response.data.items || []);
    } catch (error) {
      logger.error('Failed to fetch claim queue:', error);
    }
  };
  
  const fetchAiSessions = async () => {
    try {
      const response = await axios.get(`${API}/surfer-gallery/ai-sessions?surfer_id=${user.id}`);
      setAiSessions(response.data.sessions || []);
    } catch (error) {
      logger.debug('AI sessions not available:', error);
    }
  };
  
  const checkPendingSelections = async () => {
    try {
      const response = await axios.get(`${API}/surfer-gallery/pending-selections?surfer_id=${user.id}`);
      setPendingSelections(response.data.count || 0);
    } catch (error) {
      logger.error('Failed to check pending selections:', error);
    }
  };
  
  // Handlers
  const handleVisibilityToggle = async (itemId, isPublic) => {
    try {
      await axios.put(`${API}/surfer-gallery/${itemId}/visibility`, {
        surfer_id: user.id,
        is_public: isPublic
      });
      setGalleryItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, is_public: isPublic } : item
      ));
      toast.success(`Photo is now ${isPublic ? 'public' : 'private'}`);
    } catch (error) {
      toast.error('Failed to update visibility');
    }
  };
  
  const handleFavoriteToggle = async (itemId) => {
    try {
      const item = galleryItems.find(i => i.id === itemId);
      await axios.put(`${API}/surfer-gallery/${itemId}/favorite`, {
        surfer_id: user.id,
        is_favorite: !item.is_favorite
      });
      setGalleryItems(prev => prev.map(i => 
        i.id === itemId ? { ...i, is_favorite: !i.is_favorite } : i
      ));
    } catch (error) {
      toast.error('Failed to update favorite');
    }
  };
  
  const handleClaimAction = async (queueItemId, action) => {
    try {
      await axios.post(`${API}/surfer-gallery/claim-queue/${queueItemId}/action`, { action });
      setClaimQueue(prev => prev.filter(item => item.id !== queueItemId));
      if (action === 'claim') {
        toast.success('Added to your gallery!');
        fetchGallery();
      } else {
        toast.success('Removed from suggestions');
      }
    } catch (error) {
      toast.error('Failed to process');
    }
  };
  
  const handleDownload = async (itemId, quality) => {
    try {
      const response = await axios.get(`${API}/surfer-gallery/download/${itemId}`, {
        params: { surfer_id: user.id, quality_tier: quality }
      });
      window.open(response.data.download_url, '_blank');
      toast.success(`Downloading ${quality} quality`);
      setDownloadModal({ isOpen: false, item: null });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Download failed');
    }
  };
  
  const handleBulkDownload = async () => {
    if (selectedItems.size === 0) return;
    toast.info(`Preparing ${selectedItems.size} files for download...`);
    // In a real implementation, this would call an API to create a zip
    for (const itemId of selectedItems) {
      await handleDownload(itemId, 'standard');
    }
    setSelectedItems(new Set());
  };
  
  const handleSinglePurchase = async (itemId, quality) => {
    setDownloadModal({ isOpen: false, item: null });
    // Convert to a singular bulk-purchase call targeting the backend Stripe logic
    try {
      const response = await axios.post(`${API}/gallery/bulk-purchase`, {
        item_ids: [itemId],
        quality_tiers: { [itemId]: quality },
        buyer_id: user.id
      });
      
      if (response.data.stripe_checkout_url) {
        window.location.href = response.data.stripe_checkout_url;
      } else {
        toast.success(`Successfully unlocked item!`);
        fetchGallery(); // Refetch locker state
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Checkout failed');
    }
  };
  
  const handleRequestEdit = async (itemId, message) => {
    await axios.post(`${API}/surfer-gallery/${itemId}/request-edit`, {
      surfer_id: user.id,
      message
    });
  };

  // Quick Message to Photographer
  const handleMessagePhotographer = async (photographerId, _photographerName) => {
    try {
      // Start or get existing conversation
      const response = await axios.post(`${API}/messages/start-conversation`, {
        sender_id: user.id,
        recipient_id: photographerId,
        initial_message: null // Just open the conversation
      });
      
      // Navigate to messages with this conversation
      const conversationId = response.data.conversation_id;
      window.location.href = `/messages?conversation=${conversationId}`;
    } catch (error) {
      // If conversation already exists, get it
      try {
        const checkResponse = await axios.get(`${API}/messages/check-thread/${user.id}/${photographerId}`);
        if (checkResponse.data.conversation_id) {
          window.location.href = `/messages?conversation=${checkResponse.data.conversation_id}`;
        }
      } catch {
        toast.error('Failed to start conversation');
      }
    }
  };
  
  const handleSelectItem = (itemId) => {
    // Only allow selection in multi-select mode
    if (!multiSelectMode) return;
    
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };
  
  const handleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(i => i.id)));
    }
  };
  
  // Toggle multi-select mode
  const handleToggleMultiSelect = () => {
    if (multiSelectMode) {
      // Exiting multi-select, clear selections
      setSelectedItems(new Set());
    }
    setMultiSelectMode(!multiSelectMode);
  };
  
  // Handle bulk purchase completion
  const handleBulkPurchaseComplete = (result) => {
    setMultiSelectMode(false);
    setSelectedItems(new Set());
    fetchGallery(); // Refresh to show purchased items
    toast.success(`Successfully purchased ${result.purchase_count} items!`);
  };
  
  // Dismiss visibility onboarding
  const handleDismissVisibilityOnboarding = () => {
    localStorage.setItem('surfer_gallery_visibility_seen', 'true');
    setShowVisibilityOnboarding(false);
  };
  
  // Get selected items data for bulk purchase
  const selectedItemsData = useMemo(() => {
    return galleryItems.filter(item => selectedItems.has(item.id));
  }, [galleryItems, selectedItems]);
  
  // Filter and sort items
  const filteredItems = useMemo(() => {
    let items = [...galleryItems];
    
    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(item => 
        item.photographer_name?.toLowerCase().includes(q) ||
        item.spot_name?.toLowerCase().includes(q) ||
        item.title?.toLowerCase().includes(q)
      );
    }
    
    // Filter
    switch (filter) {
      case 'favorites':
        items = items.filter(i => i.is_favorite);
        break;
      case 'public':
        items = items.filter(i => i.is_public);
        break;
      case 'private':
        items = items.filter(i => !i.is_public);
        break;
      case 'pending':
        items = items.filter(i => !i.is_paid);
        break;
      case 'videos':
        items = items.filter(i => i.media_type === 'video');
        break;
      case 'photos':
        items = items.filter(i => i.media_type !== 'video');
        break;
    }
    
    // Sort
    switch (sortBy) {
      case 'date_asc':
        items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        break;
      case 'date_desc':
        items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
      case 'photographer':
        items.sort((a, b) => (a.photographer_name || '').localeCompare(b.photographer_name || ''));
        break;
      case 'spot':
        items.sort((a, b) => (a.spot_name || '').localeCompare(b.spot_name || ''));
        break;
    }
    
    return items;
  }, [galleryItems, searchQuery, filter, sortBy]);

  // Phase 2: Keyboard navigation for lightbox
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!lightboxItem) return;
      const currentIndex = filteredItems.findIndex(i => i.id === lightboxItem.id);
      
      if (e.key === 'Escape') {
        setLightboxItem(null);
      } else if (e.key === 'ArrowRight' && currentIndex < filteredItems.length - 1) {
        setLightboxItem(filteredItems[currentIndex + 1]);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setLightboxItem(filteredItems[currentIndex - 1]);
      } else if (e.key === 'f' || e.key === 'F') {
        handleFavoriteToggle(lightboxItem.id);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxItem, filteredItems]);
  
  // Grid columns based on view
  const gridCols = viewMode === 'grid' 
    ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' 
    : 'grid-cols-1';
  
  return (
    <div className={`min-h-screen ${mainBgClass} pb-24`}>
      {/* Container for desktop max-width */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className={`text-2xl lg:text-3xl font-bold flex items-center gap-2 ${textPrimaryClass}`}>
              <Lock className="w-6 h-6 lg:w-8 lg:h-8 text-cyan-400" />
              My Gallery
            </h1>
            <p className={`text-sm ${textSecondaryClass} mt-1`}>
              Your private media locker • {stats.total || 0} items
            </p>
          </div>
          
          {/* Quick actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setScanModal(true)}
              className="bg-zinc-800/80 border-cyan-500/50 text-cyan-400 hover:bg-cyan-500 hover:text-black shrink-0"
            >
              <ScanFace className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Find Me</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPurchaseHistory(true)}
              className="border-zinc-700"
            >
              <History className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Purchase History</span>
            </Button>
          </div>
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
          <Card className={`${cardBgClass} border`}>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-cyan-400">{stats.total || 0}</div>
              <div className={`text-xs ${textSecondaryClass}`}>Total</div>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border`}>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.favorites || 0}</div>
              <div className={`text-xs ${textSecondaryClass}`}>Favorites</div>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border`}>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-amber-400">{stats.pro || 0}</div>
              <div className={`text-xs ${textSecondaryClass}`}>Pro Tier</div>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border`}>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{stats.public || 0}</div>
              <div className={`text-xs ${textSecondaryClass}`}>Public</div>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border hidden lg:block`}>
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-purple-400">{stats.pendingPayment || 0}</div>
              <div className={`text-xs ${textSecondaryClass}`}>Pending</div>
            </CardContent>
          </Card>
        </div>
        
        {/* Pending Selections Banner */}
        {pendingSelections > 0 && (
          <button
            data-testid="pending-selections-banner"
            onClick={() => setShowSelectionQueue(true)}
            className="w-full mb-6 p-4 rounded-xl bg-gradient-to-r from-green-500/20 to-emerald-500/20 
                       border border-green-500/30 hover:border-green-500/50 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500/30 flex items-center justify-center">
                  <Gift className="w-5 h-5 text-green-400" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-green-400">
                    {pendingSelections} Session{pendingSelections > 1 ? 's' : ''} with Free Photos!
                  </p>
                  <p className={`text-sm ${textSecondaryClass}`}>
                    Select your favorite shots from your included photos
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-green-400" />
            </div>
          </button>
        )}
        
        {/* AI Match Queue Banner - TICKET-007 */}
        {claimQueue.length > 0 && activeTab !== 'claims' && (
          <button
            data-testid="ai-match-banner"
            onClick={() => setActiveTab('claims')}
            className="w-full mb-6 p-4 rounded-xl bg-gradient-to-r from-purple-500/20 to-cyan-500/20 
                       border border-purple-500/30 hover:border-purple-500/50 transition-all animate-pulse-subtle"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/30 flex items-center justify-center relative">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-cyan-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white">
                    {claimQueue.length}
                  </span>
                </div>
                <div className="text-left">
                  <p className="font-medium text-purple-400">
                    {claimQueue.length} AI-Detected Photo{claimQueue.length > 1 ? 's' : ''} of You!
                  </p>
                  <p className={`text-sm ${textSecondaryClass}`}>
                    Our AI found photos that might be you. Tap to review and claim.
                  </p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-purple-400" />
            </div>
          </button>
        )}
        
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3 bg-muted">
            <TabsTrigger value="locker" className="data-[state=active]:bg-cyan-600">
              <Lock className="w-4 h-4 mr-1.5" />
              The Locker
            </TabsTrigger>
            <TabsTrigger value="ai-matches" className="data-[state=active]:bg-purple-600 relative">
              <Sparkles className="w-4 h-4 mr-1.5" />
              AI Matches
              {aiSessions.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-purple-500 rounded-full text-xs flex items-center justify-center">
                  {aiSessions.reduce((sum, s) => sum + (s.pending_count || 0), 0)}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="claims" className="data-[state=active]:bg-amber-600 relative">
              <Gift className="w-4 h-4 mr-1.5" />
              Review
              {claimQueue.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full text-xs flex items-center justify-center">
                  {claimQueue.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        
        {/* The Locker Tab Content */}
        {activeTab === 'locker' && (
          <>
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by photographer, spot, or title..."
                  className="pl-10 bg-muted border-zinc-700"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              
              {/* Filters */}
              <div className="flex gap-2 flex-wrap">
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-32 bg-muted border-zinc-700">
                    <Filter className="w-4 h-4 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all">All Items</SelectItem>
                    <SelectItem value="favorites">Favorites</SelectItem>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="photos">Photos</SelectItem>
                    <SelectItem value="videos">Videos</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-36 bg-muted border-zinc-700">
                    <SortDesc className="w-4 h-4 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="date_desc">Newest First</SelectItem>
                    <SelectItem value="date_asc">Oldest First</SelectItem>
                    <SelectItem value="photographer">Photographer</SelectItem>
                    <SelectItem value="spot">Spot</SelectItem>
                  </SelectContent>
                </Select>
                
                {/* View mode toggle */}
                <div className="flex border border-zinc-700 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 ${viewMode === 'grid' ? 'bg-cyan-500 text-foreground' : 'bg-muted text-muted-foreground'}`}
                  >
                    <Grid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 ${viewMode === 'list' ? 'bg-cyan-500 text-foreground' : 'bg-muted text-muted-foreground'}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Multi-select toggle for bulk purchase */}
                <MultiSelectToggle
                  isActive={multiSelectMode}
                  onToggle={handleToggleMultiSelect}
                  selectedCount={selectedItems.size}
                />
              </div>
            </div>
            
            {/* Visibility Onboarding (first time) */}
            {showVisibilityOnboarding && (
              <VisibilityOnboarding 
                onDismiss={handleDismissVisibilityOnboarding}
                className="mb-4"
              />
            )}
            
            {/* Bulk actions bar - only in multi-select mode */}
            {multiSelectMode && selectedItems.size > 0 && (
              <div className="flex items-center gap-3 p-3 mb-4 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">
                <span className="text-cyan-400 font-medium">
                  {selectedItems.size} selected
                </span>
                <Button size="sm" onClick={handleBulkDownload} className="bg-cyan-500 hover:bg-cyan-600">
                  <Download className="w-4 h-4 mr-1" />
                  Download All
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelectedItems(new Set())}>
                  Clear Selection
                </Button>
                <Button size="sm" variant="ghost" onClick={handleSelectAll} className="ml-auto">
                  {selectedItems.size === filteredItems.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
            )}
            
            {/* Gallery Grid/List */}
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-16">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                <p className={`${textPrimaryClass} text-lg font-medium`}>
                  {searchQuery || filter !== 'all' ? 'No items match your filters' : 'No items in your gallery yet'}
                </p>
                <p className={`${textSecondaryClass} mt-1`}>
                  {searchQuery || filter !== 'all' 
                    ? 'Try adjusting your search or filters' 
                    : 'Photos from your sessions will appear here'}
                </p>
              </div>
            ) : (
              <div className={`grid ${gridCols} gap-3 lg:gap-4`}>
                {filteredItems.map(item => (
                  <GalleryItemCard
                    key={item.id}
                    item={item}
                    userId={user?.id}
                    viewMode={viewMode}
                    isSelected={selectedItems.has(item.id)}
                    onSelect={handleSelectItem}
                    onVisibilityToggle={handleVisibilityToggle}
                    onFavoriteToggle={handleFavoriteToggle}
                    onDownload={(item) => setDownloadModal({ isOpen: true, item })}
                    onShare={(item) => setShareModal({ isOpen: true, item })}
                    onRequestEdit={(item) => setEditModal({ isOpen: true, item })}
                    onImageClick={(item) => setLightboxItem(item)}
                    onMessage={handleMessagePhotographer}
                  />
                ))}
              </div>
            )}
          </>
        )}
        
        {/* Review & Claim Tab Content */}
        {activeTab === 'claims' && (
          <div className="max-w-2xl">
            {claimQueue.length === 0 ? (
              <div className="text-center py-16">
                <Gift className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                <p className={`${textPrimaryClass} text-lg font-medium`}>No pending suggestions</p>
                <p className={`${textSecondaryClass} mt-1`}>
                  Manual review queue from your sessions
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className={`text-sm ${textSecondaryClass} mb-4`}>
                  {claimQueue.length} item{claimQueue.length !== 1 ? 's' : ''} awaiting your review
                </p>
                {claimQueue.map(item => (
                  <ClaimQueueItem
                    key={item.id}
                    item={item}
                    onAction={handleClaimAction}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* AI Matches Tab Content */}
        {activeTab === 'ai-matches' && (
          <div className="max-w-4xl">
            {aiSessions.length === 0 ? (
              <div className="text-center py-16">
                <Sparkles className="w-16 h-16 mx-auto mb-4 text-purple-400/50" />
                <p className={`${textPrimaryClass} text-lg font-medium`}>No AI Matches Yet</p>
                <p className={`${textSecondaryClass} mt-1`}>
                  When photographers capture you at sessions, AI will automatically match clips to your profile
                </p>
                <div className="mt-6 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg max-w-md mx-auto">
                  <p className="text-sm text-purple-300">
                    <Sparkles className="w-4 h-4 inline mr-1" />
                    AI uses your profile photo, board colors, and wetsuit to identify you in photos
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <p className={`text-sm ${textSecondaryClass}`}>
                    {aiSessions.length} session{aiSessions.length !== 1 ? 's' : ''} with AI-matched clips
                  </p>
                  {!user?.is_ad_supported && (
                    <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white">
                      <Crown className="w-3 h-3 mr-1" />
                      Full Session Insight
                    </Badge>
                  )}
                </div>
                
                {/* Session Cards */}
                <div className="grid gap-4 md:grid-cols-2">
                  {aiSessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => {
                        setSelectedAiSession(session.id);
                        setShowAiMatches(true);
                      }}
                      className={`p-4 rounded-xl border text-left transition-all hover:border-purple-500/50 ${cardBgClass}`}
                      data-testid={`ai-session-${session.id}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Session thumbnail */}
                        <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                          {session.thumbnail_url ? (
                            <img 
                              src={session.thumbnail_url} 
                              alt="" 
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Camera className="w-8 h-8 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        
                        {/* Session info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-4 h-4 text-purple-400" />
                            <span className="font-medium text-foreground truncate">
                              {session.spot_name || 'Session'}
                            </span>
                          </div>
                          <p className={`text-sm ${textSecondaryClass}`}>
                            {session.photographer_name || 'Photographer'}
                          </p>
                          <p className={`text-xs ${textSecondaryClass} mt-1`}>
                            {new Date(session.created_at).toLocaleDateString()}
                          </p>
                          
                          {/* Match count badge */}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge className="bg-purple-500/20 text-purple-400">
                              {session.pending_count || 0} matches
                            </Badge>
                            {session.ai_confidence > 0.8 && (
                              <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
                                High confidence
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Modals */}
      <DownloadModal
        item={downloadModal.item}
        isOpen={downloadModal.isOpen}
        onClose={() => setDownloadModal({ isOpen: false, item: null })}
        onDownload={handleDownload}
        onPurchase={handleSinglePurchase}
      />
      
      <LockerSelfieModal 
        isOpen={scanModal} 
        onClose={() => setScanModal(false)}
        user={user}
        fetchClaimQueue={fetchClaimQueue}
      />
      
      <ShareModal
        item={shareModal.item}
        isOpen={shareModal.isOpen}
        onClose={() => setShareModal({ isOpen: false, item: null })}
      />
      
      <RequestEditModal
        item={editModal.item}
        isOpen={editModal.isOpen}
        onClose={() => setEditModal({ isOpen: false, item: null })}
        onSubmit={handleRequestEdit}
      />
      
      <PurchaseHistoryModal
        isOpen={showPurchaseHistory}
        onClose={() => setShowPurchaseHistory(false)}
        userId={user?.id}
      />
      
      <PhotoSelectionQueue
        open={showSelectionQueue}
        onOpenChange={setShowSelectionQueue}
        theme={theme}
        onSelectionComplete={() => {
          fetchGallery();
          checkPendingSelections();
        }}
      />
      
      {/* AI Proposed Matches Modal */}
      <AIProposedMatches
        sessionId={selectedAiSession}
        open={showAiMatches}
        onOpenChange={(open) => {
          setShowAiMatches(open);
          if (!open) setSelectedAiSession(null);
        }}
        onClaimComplete={() => {
          fetchGallery();
          fetchAiSessions();
        }}
      />
      
      {/* Phase 2: Lightbox Modal */}
      {lightboxItem && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxItem(null)}
        >
          <button
            className="absolute top-4 right-4 text-foreground/70 hover:text-foreground p-2"
            onClick={() => setLightboxItem(null)}
          >
            <X className="w-8 h-8" />
          </button>
          
          {/* Navigation arrows */}
          {filteredItems.findIndex(i => i.id === lightboxItem.id) > 0 && (
            <button
              className="absolute left-4 text-foreground/70 hover:text-foreground p-2"
              onClick={(e) => {
                e.stopPropagation();
                const idx = filteredItems.findIndex(i => i.id === lightboxItem.id);
                setLightboxItem(filteredItems[idx - 1]);
              }}
            >
              <ChevronLeft className="w-10 h-10" />
            </button>
          )}
          {filteredItems.findIndex(i => i.id === lightboxItem.id) < filteredItems.length - 1 && (
            <button
              className="absolute right-4 text-foreground/70 hover:text-foreground p-2"
              onClick={(e) => {
                e.stopPropagation();
                const idx = filteredItems.findIndex(i => i.id === lightboxItem.id);
                setLightboxItem(filteredItems[idx + 1]);
              }}
            >
              <ChevronRight className="w-10 h-10" />
            </button>
          )}
          
          {/* Image */}
          <img
            src={lightboxItem.url || lightboxItem.thumbnail_url}
            alt={lightboxItem.title || 'Gallery item'}
            className="max-w-[90vw] max-h-[85vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          
          {/* Bottom info bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
            <div className="flex items-center justify-between max-w-4xl mx-auto">
              <div>
                <p className="text-foreground font-medium">{lightboxItem.photographer_name || 'Unknown'}</p>
                <p className="text-foreground/60 text-sm">{lightboxItem.spot_name} • {new Date(lightboxItem.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className={`text-foreground ${lightboxItem.is_favorite ? 'text-red-500' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleFavoriteToggle(lightboxItem.id); }}
                >
                  <Heart className={`w-5 h-5 ${lightboxItem.is_favorite ? 'fill-current' : ''}`} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-foreground"
                  onClick={(e) => { e.stopPropagation(); setDownloadModal({ isOpen: true, item: lightboxItem }); setLightboxItem(null); }}
                >
                  <Download className="w-5 h-5" />
                </Button>
              </div>
            </div>
            <p className="text-center text-foreground/40 text-xs mt-2">← → Navigate • F Favorite • Esc Close</p>
          </div>
        </div>
      )}
      
      {/* Bulk Purchase Bar - floating at bottom when items selected */}
      {multiSelectMode && (
        <BulkPurchaseBar
          selectedItems={selectedItemsData}
          onRemoveItem={(itemId) => {
            setSelectedItems(prev => {
              const next = new Set(prev);
              next.delete(itemId);
              return next;
            });
          }}
          onClearAll={() => setSelectedItems(new Set())}
          onPurchase={handleBulkPurchaseComplete}
          userId={user?.id}
        />
      )}
    </div>
  );
};

export default SurferGallery;

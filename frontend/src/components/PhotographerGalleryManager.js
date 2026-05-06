import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { 

  ArrowLeft, Upload, Image as ImageIcon, Video, DollarSign, 
  Settings, Trash2, Eye, Tag, X, Users,
  MapPin, Calendar, Sparkles, UserCheck, Loader2,
  Search, Filter, Check, MoreVertical,
  TrendingUp, ShoppingBag, BarChart3,
  Link2, Send, CheckCircle, AlertCircle, ArrowRight, UserPlus, RefreshCw, Globe, Radio,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {

  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { toast } from 'sonner';
import usePhotographerGalleryActions from '../hooks/usePhotographerGalleryActions';
import { getFullUrl } from '../utils/media';
import { ROLES } from '../constants/roles';



export const PhotographerGalleryManager = () => {
  const { galleryId } = useParams();
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  // ROLE-BASED COMMERCE RESTRICTIONS
  // Grom Parent: NO commerce at all - pure archive/family photos
  // Hobbyist: Can browse/buy but NOT sell
  const isGromParent = user?.role === ROLES.GROM_PARENT || user?.role === 'GROM_PARENT';
  const isHobbyist = user?.role === ROLES.HOBBYIST || user?.role === 'HOBBYIST';
  const canSellPhotos = !isGromParent && !isHobbyist; // Only Pro photographers can sell
  const showPricing = canSellPhotos; // Hide all pricing UI for non-sellers
  
  const [gallery, setGallery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTaggingModal, setShowTaggingModal] = useState(false);
  const [showItemPricingModal, setShowItemPricingModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [aiTagSuggestions, setAiTagSuggestions] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  
  // Phase 1: Search, Filter, Sort, Bulk Selection
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [setBulkMode] = useState(false);
  const [itemCustomPrice, setItemCustomPrice] = useState('');
  const [lightboxItem, setLightboxItem] = useState(null); // Phase 2: Lightbox
  
  // Distribution Panel State
  const [sessionParticipants, setSessionParticipants] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [totalGalleryItems, setTotalGalleryItems] = useState(0);
  const [loadingParticipants, setLoadingParticipants] = useState(false);
  const [distributing, setDistributing] = useState(null); // surfer_id being distributed to
  const [showLinkSessionModal, setShowLinkSessionModal] = useState(false);
  const [recentSessions, setRecentSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showAssignDrawer, setShowAssignDrawer] = useState(false);
  const [assigningItem, setAssigningItem] = useState(null);

  // Phase 3: Sales Intelligence
  const [showSalesDashboard, setShowSalesDashboard] = useState(false);
  const [showClientActivity, setShowClientActivity] = useState(false);
  const [salesData, setSalesData] = useState({ sales: [], stats: {} });
  const [clientsData, setClientsData] = useState({ clients: [], stats: {} });
  const [loadingSales, setLoadingSales] = useState(false);
  const [publishing, setPublishing] = useState(false);
  
  // Push to Spot Hub state
  const [pushingConditions, setPushingConditions] = useState(false);
  const [conditionsStatus, setConditionsStatus] = useState(null);
  
  const [pricing, setPricing] = useState({
    price_web: 3,
    price_standard: 5,
    price_high: 10,
    price_720p: 8,
    price_1080p: 15,
    price_4k: 30
  });
  
  const [editData, setEditData] = useState({
    title: '',
    description: ''
  });

  // Theme classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-gray-400';
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const inputBgClass = isLight ? 'bg-white' : 'bg-zinc-900';

  useEffect(() => {
    if (galleryId) {
      fetchGallery();
    }
  }, [galleryId]);

  // Fetch session participants when gallery loads
  useEffect(() => {
    if (gallery && user?.id) {
      fetchSessionParticipants();
    }
  }, [gallery?.id]);

  // ============ HANDLERS EXTRACTED ============


  const {
    fetchGallery,
    fetchConditionsStatus,
    handlePushToSpotHub,
    fetchSessionParticipants,
    fetchRecentSessions,
    handleLinkSession,
    handleDistributeAll,
    handleDistributeToSurfer,
    handleAssignItemToSurfer,
    fetchSalesData,
    fetchClientActivity,
    handleFileUpload,
    handleSavePricing,
    handleSaveEdit,
    handleDeleteGallery,
    handleSetAsCover,
    handleOpenTagging,
    handleAnalyzePhoto,
    toggleTagSelection,
    handleConfirmTags,
    handleToggleSelect,
    handleSelectAll,
    handleKeyDown,
    handleDeleteItem,
    handleBulkDelete,
    handleSetCustomPrice,
    openItemPricing,
  } = usePhotographerGalleryActions({
    user, gallery, selectedItems, editData, navigate, galleryId, setAiTagSuggestions,
    setAnalyzingPhoto,
    setAssigningItem,
    setBulkMode,
    setClientsData,
    setConditionsStatus,
    setDistributing,
    setEditData,
    setGallery,
    setItemCustomPrice,
    lightboxItem,
    setLightboxItem,
    setLoading,
    setLoadingParticipants,
    setLoadingSales,
    setLoadingSessions,
    setPricing,
    setPushingConditions,
    setRecentSessions,
    setSalesData,
    setSelectedItem,
    setSelectedItems,
    setSelectedTags,
    setSessionInfo,
    setSessionParticipants,
    setShowAssignDrawer,
    setShowEditModal,
    setShowItemPricingModal,
    setShowLinkSessionModal,
    setShowPricingModal,
    setShowTaggingModal,
    setTotalGalleryItems,
    setUploading,
    setItemCustomPrice,
  });

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className={`flex items-center justify-center min-h-screen ${mainBgClass}`}>
        <p className={textSecondaryClass}>Gallery not found</p>
      </div>
    );
  }

  return (
    <div className={`pb-20 min-h-screen ${mainBgClass} transition-colors duration-300`} data-testid="photographer-gallery-manager">
      <div className="max-w-4xl mx-auto p-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button aria-label="Go back"
            variant="ghost"
            onClick={() => navigate('/photographer/sessions')}
            className={textSecondaryClass}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className={`text-2xl font-bold ${textPrimaryClass} font-oswald`} >
              {gallery.title}
            </h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {/* Phase 5: Session type badge */}
              {gallery.session_type && gallery.session_type !== 'manual' && (
                <Badge variant="outline" className={
                  gallery.session_type === 'live' ? 'border-emerald-500/50 text-emerald-400 text-[10px]' :
                  gallery.session_type === 'booking' ? 'border-blue-500/50 text-blue-400 text-[10px]' :
                  gallery.session_type === 'on_demand' ? 'border-orange-500/50 text-orange-400 text-[10px]' :
                  'border-zinc-500/50 text-zinc-400 text-[10px]'
                }>
                  {gallery.session_type === 'live' ? '📸 Live Session' : 
                   gallery.session_type === 'booking' ? '📅 Booking' : 
                   gallery.session_type === 'on_demand' ? '⚡ On-Demand' : gallery.session_type}
                </Badge>
              )}
              {gallery.session_type === 'manual' && (
              <Badge variant="outline" className="border-zinc-600 text-zinc-500 text-[10px]">{String.fromCodePoint(0x270B)} Manual</Badge>
              )}
              {gallery.surf_spot_name && (
                <span className={`text-sm ${textSecondaryClass} flex items-center gap-1`}>
                  <MapPin className="w-3 h-3" /> {gallery.surf_spot_name}
                </span>
              )}
              {gallery.session_date && (
                <span className={`text-sm ${textSecondaryClass} flex items-center gap-1`}>
                  <Calendar className="w-3 h-3" /> {new Date(gallery.session_date).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button aria-label="Settings"
              variant="outline"
              onClick={() => setShowEditModal(true)}
              className={borderClass}
            >
              <Settings className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button
              variant={gallery?.is_public ? 'outline' : 'default'}
              onClick={async () => {
                setPublishing(true);
                try {
                  const willPublish = !gallery?.is_public;
                  await apiClient.post(`/gallery/${galleryId}/publish?photographer_id=${user?.profile_id}`, { is_published: willPublish });
                  setGallery(prev => ({ ...prev, is_public: willPublish, is_featured: willPublish }));
                  toast.success(willPublish ? '📸 Gallery published to your Sessions tab!' : 'Gallery unpublished');
                } catch (err) {
                  toast.error('Failed to publish gallery');
                } finally {
                  setPublishing(false);
                }
              }}
              disabled={publishing}
              className={gallery?.is_public
                ? `${borderClass} text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/10`
                : 'bg-gradient-to-r from-cyan-400 to-blue-500 text-black hover:from-cyan-500 hover:to-blue-600'
              }
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Globe className="w-4 h-4 mr-2" />
              )}
              {gallery?.is_public ? '? Published' : 'Publish Gallery'}
            </Button>
            {showPricing && (
              <Button aria-label="Dollar Sign"
                onClick={() => setShowPricingModal(true)}
                className="bg-gradient-to-r from-green-400 to-emerald-500 text-black"
              >
                <DollarSign className="w-4 h-4 mr-2" />
                Set Pricing
              </Button>
            )}
            {/* Push to Spot Hub ï¿½ requires linked surf spot AND live session */}
            {gallery?.surf_spot_id && (
              <Button
                variant="outline"
                className={`${
                  !gallery?.live_session_id
                    ? `${borderClass} border-zinc-500/30 text-zinc-500 cursor-not-allowed`
                    : conditionsStatus?.has_active_report
                    ? `${borderClass} border-amber-500/50 text-amber-400 hover:bg-amber-500/10`
                    : `${borderClass} border-teal-500/50 text-teal-400 hover:bg-teal-500/10`
                }`}
                onClick={() => {
                  if (!gallery?.live_session_id) {
                    toast.error('Link a live session to this gallery first, then push to Spot Hub.');
                    return;
                  }
                  handlePushToSpotHub();
                }}
                disabled={pushingConditions || (gallery?.item_count || 0) === 0 || !gallery?.live_session_id}
                title={!gallery?.live_session_id ? 'Link a live session first' : ''}
                data-testid="push-to-spot-hub-pgm-btn"
              >
                {pushingConditions ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Radio className="w-4 h-4 mr-2" />
                )}
                {conditionsStatus?.has_active_report ? 'Refresh Spot Hub' : 'Push to Spot Hub'}
              </Button>
            )}
          </div>
        </div>

        {/* Stats - Show limited stats for Grom Parent/Hobbyist */}
        <div className={`grid ${showPricing ? 'grid-cols-4' : 'grid-cols-2'} gap-4 mb-6`}>
          <Card className={cardBgClass}>
            <CardContent className="p-4 text-center">
              <ImageIcon className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
              <p className={`text-xl font-bold ${textPrimaryClass}`}>{gallery.item_count || 0}</p>
              <p className={`text-xs ${textSecondaryClass}`}>Items</p>
            </CardContent>
          </Card>
          <Card className={cardBgClass}>
            <CardContent className="p-4 text-center">
              <Eye className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
              <p className={`text-xl font-bold ${textPrimaryClass}`}>{gallery.view_count || 0}</p>
              <p className={`text-xs ${textSecondaryClass}`}>Views</p>
            </CardContent>
          </Card>
          {showPricing && (
            <>
              <Card className={`${cardBgClass} cursor-pointer hover:ring-2 hover:ring-cyan-500/30 transition-all`} onClick={() => { setShowSalesDashboard(true); fetchSalesData(); }}>
                <CardContent className="p-4 text-center">
                  <ShoppingBag className={`w-5 h-5 mx-auto mb-1 ${textSecondaryClass}`} />
                  <p className={`text-xl font-bold ${textPrimaryClass}`}>{gallery.purchase_count || 0}</p>
                  <p className={`text-xs ${textSecondaryClass}`}>Purchases</p>
                  <p className="text-[10px] text-cyan-400 mt-1">Click for details</p>
                </CardContent>
              </Card>
              <Card className={`${cardBgClass} cursor-pointer hover:ring-2 hover:ring-green-500/30 transition-all`} onClick={() => { setShowClientActivity(true); fetchClientActivity(); }}>
                <CardContent className="p-4 text-center">
                  <TrendingUp className={`w-5 h-5 mx-auto mb-1 text-green-400`} />
                  <p className={`text-xl font-bold text-green-400`}>
                    ${((gallery.purchase_count || 0) * (pricing.price_standard || 5) * 0.8).toFixed(0)}
                  </p>
                  <p className={`text-xs ${textSecondaryClass}`}>Est. Revenue</p>
                  <p className="text-[10px] text-green-400 mt-1">View activity</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* ============ SESSION CONTEXT PANEL ============ */}
        <Card className={`mb-6 ${cardBgClass} overflow-hidden`}>
          <CardContent className="p-0">
            {/* Session Header Banner */}
            {sessionInfo?.is_linked ? (
              <div className="bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border-b border-emerald-500/30 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                    <span className={`font-medium ${textPrimaryClass}`}>
                      {sessionInfo.session_type === 'live' ? 'Live Session' : 
                       sessionInfo.session_type === 'booking' ? 'Booked Session' : 
                       sessionInfo.session_type === 'on_demand' ? 'On-Demand' : 'Session'} Linked
                    </span>
                    <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[10px]">
                      {sessionInfo.session_type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-emerald-400 hover:text-emerald-300 h-7 px-2"
                      onClick={fetchSessionParticipants}
                      disabled={loadingParticipants}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingParticipants ? 'animate-spin' : ''}`} />
                    </Button>
                    {sessionParticipants.length > 0 && totalGalleryItems > 0 && (
                      <Button aria-label="Loader2"
                        size="sm"
                        onClick={handleDistributeAll}
                        disabled={distributing === 'all'}
                        className="bg-gradient-to-r from-emerald-400 to-cyan-500 text-black h-7 px-3 text-xs font-medium"
                      >
                        {distributing === 'all' ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5 mr-1" />
                        )}
                        Distribute All
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gradient-to-r from-amber-500/15 to-orange-500/15 border-b border-amber-500/30 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-400" />
                    <span className={`font-medium ${textPrimaryClass}`}>No Session Linked</span>
                    <span className={`text-xs ${textSecondaryClass}`}>Distribution unavailable</span>
                  </div>
                  <Button aria-label="Link2"
                    size="sm"
                    onClick={() => { setShowLinkSessionModal(true); fetchRecentSessions(); }}
                    className="bg-gradient-to-r from-amber-400 to-orange-500 text-black h-7 px-3 text-xs font-medium"
                  >
                    <Link2 className="w-3.5 h-3.5 mr-1" /> Link Session
                  </Button>
                </div>
              </div>
            )}

            {/* Participant Roster */}
            {loadingParticipants ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
                <span className={`ml-2 text-sm ${textSecondaryClass}`}>Loading participants...</span>
              </div>
            ) : sessionParticipants.length > 0 ? (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-3">
                  <p className={`text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
                    Participants ({sessionParticipants.length})
                  </p>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    {totalGalleryItems} items in gallery
                  </p>
                </div>
                <div className="space-y-2">
                  {sessionParticipants.map((participant) => {
                    const progress = totalGalleryItems > 0 
                      ? Math.round((participant.items_distributed / totalGalleryItems) * 100) 
                      : 0;
                    const isFullyDistributed = participant.items_distributed >= totalGalleryItems && totalGalleryItems > 0;
                    
                    return (
                      <div
                        key={participant.surfer_id}
                        className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                          isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'
                        }`}
                      >
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0 ring-2 ring-offset-1 ring-offset-transparent ring-cyan-500/30">
                          {participant.avatar_url ? (
                            <img loading="lazy" decoding="async"
                              src={getFullUrl(participant.avatar_url)}
                              alt={participant.full_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                          )}
                        </div>

                        {/* Name + Status */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>
                            {participant.full_name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {/* Distribution progress bar */}
                            <div className={`flex-1 h-1.5 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} max-w-[100px]`}>
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  isFullyDistributed ? 'bg-emerald-400' : progress > 0 ? 'bg-cyan-400' : 'bg-zinc-600'
                                }`}
                                style={{ width: `${Math.min(progress, 100)}%` }}
                              />
                            </div>
                            <span className={`text-[10px] ${textSecondaryClass}`}>
                              {participant.items_distributed}/{totalGalleryItems}
                            </span>
                            {isFullyDistributed && (
                              <CheckCircle className="w-3 h-3 text-emerald-400" />
                            )}
                          </div>
                        </div>

                        {/* Action Button */}
                        {!isFullyDistributed ? (
                          <Button aria-label="Loader2"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDistributeToSurfer(participant.surfer_id, participant.full_name)}
                            disabled={distributing === participant.surfer_id || totalGalleryItems === 0}
                            className="h-7 px-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                          >
                            {distributing === participant.surfer_id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <Send className="w-3.5 h-3.5 mr-1" />
                                <span className="text-xs">Push</span>
                              </>
                            )}
                          </Button>
                        ) : (
                          <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[10px] h-7">
                            ? Delivered
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : sessionInfo?.is_linked ? (
              <div className={`text-center py-6 ${textSecondaryClass}`}>
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No participants found for this session</p>
              </div>
            ) : null}
          </CardContent>
        </Card>


        {/* Current Pricing Summary - Only for sellers */}
        {showPricing && (
          <Card className={`mb-6 ${cardBgClass}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className={`text-sm ${textSecondaryClass}`}>Gallery Pricing & Session Settings</CardTitle>
                {gallery?.session_settings && (
                  <Badge variant="outline" className={
                    gallery.session_settings.session_type === 'live' ? 'border-emerald-500/50 text-emerald-400' :
                    gallery.session_settings.session_type === 'booking' ? 'border-blue-500/50 text-blue-400' :
                    gallery.session_settings.session_type === 'on_demand' ? 'border-amber-500/50 text-amber-400' :
                    'border-zinc-500/50 text-zinc-400'
                  }>
                    {gallery.session_settings.session_type === 'live' ? '📸 Live Session' :
                     gallery.session_settings.session_type === 'booking' ? '📅 Booking' :
                     gallery.session_settings.session_type === 'on_demand' ? '⚡ On-Demand' : '✏️ Manual'}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* This Session's Included Content ï¿½ editable */}
              {gallery?.session_settings && (
                <div className="rounded-xl p-4" style={{
                  background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.06))',
                  border: '1px solid rgba(6,182,212,0.2)'
                }}>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className={`text-xs font-bold uppercase tracking-wider ${textSecondaryClass}`}>
                      This Session ï¿½ Included Content
                    </h4>
                    <span className="text-[10px] text-cyan-400/70">
                      {gallery.session_settings.buyin_price > 0 ? `$${gallery.session_settings.buyin_price} buy-in` : 'Free'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Photos Included */}
                    <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <ImageIcon className="w-4 h-4 text-cyan-400" />
                        <span className={`text-xs font-semibold ${textPrimaryClass}`}>Photos Included</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            const val = Math.max(0, (gallery.session_settings?.photos_included || 3) - 1);
                            try {
                              await apiClient.patch(`/galleries/${galleryId}/session-settings?photographer_id=${user?.id}`, { photos_included: val });
                              setGallery(prev => ({...prev, session_settings: {...prev.session_settings, photos_included: val}}));
                              toast.success(`Photos included updated to ${val}`);
                              fetchSessionParticipants();
                            } catch(e) { toast.error('Failed to update'); }
                          }}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                          style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                        >-</button>
                        <span className="text-xl font-bold text-cyan-400 w-8 text-center">{gallery.session_settings?.photos_included ?? 3}</span>
                        <button
                          onClick={async () => {
                            const val = (gallery.session_settings?.photos_included || 3) + 1;
                            try {
                              await apiClient.patch(`/galleries/${galleryId}/session-settings?photographer_id=${user?.id}`, { photos_included: val });
                              setGallery(prev => ({...prev, session_settings: {...prev.session_settings, photos_included: val}}));
                              toast.success(`Photos included updated to ${val}`);
                              fetchSessionParticipants();
                            } catch(e) { toast.error('Failed to update'); }
                          }}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                          style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                        >+</button>
                      </div>
                    </div>
                    {/* Videos Included */}
                    <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <Video className="w-4 h-4 text-purple-400" />
                        <span className={`text-xs font-semibold ${textPrimaryClass}`}>Videos Included</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            const val = Math.max(0, (gallery.session_settings?.videos_included || 0) - 1);
                            try {
                              await apiClient.patch(`/galleries/${galleryId}/session-settings?photographer_id=${user?.id}`, { videos_included: val });
                              setGallery(prev => ({...prev, session_settings: {...prev.session_settings, videos_included: val}}));
                              toast.success(`Videos included updated to ${val}`);
                              fetchSessionParticipants();
                            } catch(e) { toast.error('Failed to update'); }
                          }}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                          style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                        >-</button>
                        <span className="text-xl font-bold text-purple-400 w-8 text-center">{gallery.session_settings?.videos_included ?? 0}</span>
                        <button
                          onClick={async () => {
                            const val = (gallery.session_settings?.videos_included || 0) + 1;
                            try {
                              await apiClient.patch(`/galleries/${galleryId}/session-settings?photographer_id=${user?.id}`, { videos_included: val });
                              setGallery(prev => ({...prev, session_settings: {...prev.session_settings, videos_included: val}}));
                              toast.success(`Videos included updated to ${val}`);
                              fetchSessionParticipants();
                            } catch(e) { toast.error('Failed to update'); }
                          }}
                          className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold text-white hover:bg-white/10 transition-colors"
                          style={{ border: '1px solid rgba(255,255,255,0.15)' }}
                        >+</button>
                      </div>
                    </div>
                  </div>
                  <p className={`text-[10px] mt-2 ${textSecondaryClass}`}>
                    Additional items beyond included count are charged per the pricing tiers below
                  </p>
                </div>
              )}

              {/* Per-Service Pricing Tiers */}
              {gallery?.photographer_pricing && (
                <div className="space-y-3">
                  {/* Live Session Pricing */}
                  <PricingTierRow
                    label="Live Session"
                    emoji={String.fromCodePoint(0x1F4F8)}
                    color="emerald"
                    photosIncluded={gallery.photographer_pricing.live_session?.photos_included}
                    videosIncluded={gallery.photographer_pricing.live_session?.videos_included}
                    buyinPrice={gallery.photographer_pricing.live_session?.buyin_price}
                    photo={gallery.photographer_pricing.live_session?.photo}
                    video={gallery.photographer_pricing.live_session?.video}
                    textSecondaryClass={textSecondaryClass}
                    textPrimaryClass={textPrimaryClass}
                    isActive={gallery.session_settings?.session_type === 'live'}
                  />
                  {/* Booking Pricing */}
                  <PricingTierRow
                    label="Booking"
                    emoji={String.fromCodePoint(0x1F4C5)}
                    color="blue"
                    photosIncluded={gallery.photographer_pricing.booking?.photos_included}
                    videosIncluded={gallery.photographer_pricing.booking?.videos_included}
                    buyinPrice={gallery.photographer_pricing.booking?.hourly_rate}
                    buyinLabel="/hr"
                    photo={gallery.photographer_pricing.booking?.photo}
                    video={gallery.photographer_pricing.booking?.video}
                    textSecondaryClass={textSecondaryClass}
                    textPrimaryClass={textPrimaryClass}
                    isActive={gallery.session_settings?.session_type === 'booking'}
                  />
                  {/* On-Demand Pricing */}
                  <PricingTierRow
                    label="On-Demand"
                    emoji={String.fromCodePoint(0x26A1)}
                    color="amber"
                    photosIncluded={gallery.photographer_pricing.on_demand?.photos_included}
                    videosIncluded={gallery.photographer_pricing.on_demand?.videos_included}
                    photo={gallery.photographer_pricing.on_demand?.photo}
                    video={gallery.photographer_pricing.on_demand?.video}
                    textSecondaryClass={textSecondaryClass}
                    textPrimaryClass={textPrimaryClass}
                    isActive={gallery.session_settings?.session_type === 'on_demand'}
                  />
                </div>
              )}

              {/* Fallback: Gallery-level pricing if no photographer_pricing */}
              {!gallery?.photographer_pricing && (
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">Photo</Badge>
                    <span className={textSecondaryClass}>Web: ${pricing.price_web}</span>
                    <span className={textSecondaryClass}>HD: ${pricing.price_standard}</span>
                    <span className={textSecondaryClass}>4K: ${pricing.price_high}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-purple-500/50 text-purple-400">Video</Badge>
                    <span className={textSecondaryClass}>720p: ${pricing.price_720p}</span>
                    <span className={textSecondaryClass}>1080p: ${pricing.price_1080p}</span>
                    <span className={textSecondaryClass}>4K: ${pricing.price_4k}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Upload Section */}
        <Card className={`mb-6 ${cardBgClass}`}>
          <CardContent className="p-6">
            <label className="block cursor-pointer">
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
              <div className={`border-2 border-dashed rounded-lg p-8 text-center hover:bg-opacity-50 transition-colors ${
                isLight ? 'border-gray-300 hover:bg-gray-50' : 'border-zinc-700 hover:bg-zinc-800/50'
              }`}>
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
                    <p className={textPrimaryClass}>Uploading...</p>
                  </>
                ) : (
                  <>
                    <Upload className={`w-12 h-12 mx-auto mb-4 ${textSecondaryClass}`} />
                    <p className={textPrimaryClass}>Click or drag files to upload</p>
                    <p className={`text-sm ${textSecondaryClass} mt-1`}>
                      Support photos and videos from your session
                    </p>
                  </>
                )}
              </div>
            </label>
          </CardContent>
        </Card>

        {/* Phase 1: Search, Filter, Sort Bar */}
        <div className={`flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800/50'}`}>
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${textSecondaryClass}`} />
            <Input aria-label="Search by title..."
              placeholder="Search by title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-9 ${inputBgClass} ${textPrimaryClass}`}
            />
          </div>
          
          {/* Filter */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className={`w-[130px] ${inputBgClass} ${textPrimaryClass}`}>
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="photos">Photos Only</SelectItem>
              <SelectItem value="videos">Videos Only</SelectItem>
              <SelectItem value="tagged">Tagged</SelectItem>
              <SelectItem value="untagged">Untagged</SelectItem>
              <SelectItem value="distributed">? Distributed</SelectItem>
              <SelectItem value="undistributed">? Undistributed</SelectItem>
                <SelectItem value="ai_pending">{String.fromCodePoint(0x1F916)} AI Pending</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Sort */}
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className={`w-[140px] ${inputBgClass} ${textPrimaryClass}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="purchases">Most Purchased</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Bulk Mode Toggle */}
          <Button aria-label="Confirm"
            variant={bulkMode ? "default" : "outline"}
            size="sm"
            onClick={() => { setBulkMode(!bulkMode); setSelectedItems(new Set()); }}
            className={bulkMode ? 'bg-cyan-500 text-black' : borderClass}
          >
            <Check className="w-4 h-4 mr-1" />
            {bulkMode ? 'Done' : 'Select'}
          </Button>
        </div>

        {/* Bulk Actions Bar */}
        {bulkMode && selectedItems.size > 0 && (
          <div className={`flex items-center gap-3 mb-4 p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30`}>
            <span className="text-cyan-400 font-medium">{selectedItems.size} selected</span>
            <Button size="sm" variant="ghost" onClick={handleSelectAll} className="text-cyan-400">
              {selectedItems.size === filteredItems.length ? 'Deselect All' : 'Select All'}
            </Button>
            <div className="flex-1" />
            <Button aria-label="Delete" size="sm" variant="destructive" onClick={handleBulkDelete}>
              <Trash2 className="w-4 h-4 mr-1" /> Delete Selected
            </Button>
          </div>
        )}

        {/* Gallery Items Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredItems.map((item) => (
            <Card key={item.id} className={`overflow-hidden ${cardBgClass} group ${bulkMode && selectedItems.has(item.id) ? 'ring-2 ring-cyan-500' : ''}`}>
              <div className="aspect-square relative">
                {/* Bulk selection checkbox */}
                {bulkMode && (
                  <button aria-label="Confirm"
                    onClick={() => handleToggleSelect(item.id)}
                    className={`absolute top-2 left-2 z-10 w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
                      selectedItems.has(item.id) 
                        ? 'bg-cyan-500 border-cyan-500' 
                        : 'bg-black/50 border-white/50 hover:border-cyan-400'
                    }`}
                  >
                    {selectedItems.has(item.id) && <Check className="w-4 h-4 text-black" />}
                  </button>
                )}
                
                {item.media_type === 'video' ? (
                  <img loading="lazy" decoding="async"
                    src={item.thumbnail_url || item.preview_url}
                    alt={item.title || 'Video thumbnail'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'flex'); }}
                  />
                ) : (
                  <img loading="lazy" decoding="async" 
                    src={item.preview_url || item.thumbnail_url} 
                    alt={item.title || 'Gallery item'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
                <Badge className="absolute top-2 right-2 bg-black/70">
                  {item.media_type === 'video' ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                </Badge>

                {/* Phase 4: Distribution status badge */}
                {(() => {
                  const dc = item.distributed_count || 0;
                  const ac = item.ai_suggested_count || 0;
                  const cc = item.confirmed_count || 0;
                  const totalP = sessionParticipants.length || 1;
                  if (dc > 0 && dc >= totalP) {
                    // Green: Distributed to all participants
                    return (
                      <Badge className="absolute top-2 left-2 bg-emerald-500/90 text-black text-[9px] gap-0.5 px-1.5">
                        <CheckCircle className="w-2.5 h-2.5" /> All ({dc})
                      </Badge>
                    );
                  } else if (dc > 0) {
                    // Amber: Partial distribution
                    return (
                      <Badge className="absolute top-2 left-2 bg-amber-500/90 text-black text-[9px] gap-0.5 px-1.5">
                        <Users className="w-2.5 h-2.5" /> {dc}/{totalP}
                      </Badge>
                    );
                  } else if (ac > 0 && cc === 0) {
                    // Purple: AI suggested but not confirmed
                    return (
                      <Badge className="absolute top-2 left-2 bg-purple-500/90 text-white text-[9px] gap-0.5 px-1.5">
                        <Sparkles className="w-2.5 h-2.5" /> AI
                      </Badge>
                    );
                  }
                  return null;
                })()}
                
                {/* Custom price badge */}
                {item.custom_price && (
                  <Badge className="absolute bottom-2 left-2 bg-green-500/90 text-black">
                    ${item.custom_price}
                  </Badge>
                )}

                {/* Cover image indicator */}
                {gallery?.cover_image_url && (item.preview_url === gallery.cover_image_url || item.thumbnail_url === gallery.cover_image_url) && (
                  <Badge className="absolute bottom-2 right-2 bg-cyan-500/90 text-black text-[9px] gap-0.5 px-1.5">
                    <ImageIcon className="w-2.5 h-2.5" /> Cover
                  </Badge>
                )}
                
                {/* Hover overlay with actions */}
                {!bulkMode && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button aria-label="View"
                      size="sm"
                      onClick={() => setLightboxItem(item)}
                      variant="outline"
                      className="border-white/50 text-white hover:bg-white/20"
                    >
                      <Eye className="w-4 h-4 mr-1" /> View
                    </Button>
                    <Button aria-label="Sparkles"
                      size="sm"
                      onClick={() => handleOpenTagging(item)}
                      className="bg-gradient-to-r from-purple-400 to-pink-500 text-black"
                    >
                      <Sparkles className="w-4 h-4 mr-1" />
                      AI Tag
                    </Button>
                  </div>
                )}
              </div>
              <CardContent className="p-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${textSecondaryClass}`}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                  {/* Item actions dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-6 px-2" aria-label="More options">
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Phase 3: Unified "Tag & Assign" replaces separate AI Tag + Assign options */}
                      <DropdownMenuItem onClick={() => handleOpenTagging(item)}>
                        <Sparkles className="w-4 h-4 mr-2" /> Tag & Assign
                      </DropdownMenuItem>
                      {showPricing && (
                        <DropdownMenuItem onClick={() => openItemPricing(item)}>
                          <DollarSign className="w-4 h-4 mr-2" /> Set Custom Price
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleSetAsCover(item)}>
                        <ImageIcon className="w-4 h-4 mr-2" /> Set as Cover
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-red-500 focus:text-red-500"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {filteredItems.length === 0 && (
            <div className={`col-span-full text-center py-12 ${textSecondaryClass}`}>
              <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>{gallery.items?.length ? 'No items match your filters' : 'No items yet. Upload photos and videos from your session!'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Item Custom Pricing Modal */}
      <Dialog open={showItemPricingModal} onOpenChange={setShowItemPricingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Set Custom Price</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className={`text-sm ${textSecondaryClass}`}>
              Override the gallery price for this specific item. Leave empty to use gallery default.
            </p>
            <div className="flex items-center gap-2">
              <DollarSign className={`w-5 h-5 ${textSecondaryClass}`} />
              <Input aria-label="Custom price (credits)"
                type="number"
                placeholder="Custom price (credits)"
                value={itemCustomPrice}
                onChange={(e) => setItemCustomPrice(e.target.value)}
                className={`${inputBgClass} ${textPrimaryClass}`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowItemPricingModal(false)}>Cancel</Button>
            <Button onClick={handleSetCustomPrice} className="bg-green-500 text-black">
              Save Price
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pricing Modal */}
      <Dialog open={showPricingModal} onOpenChange={setShowPricingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Gallery Pricing</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className={`text-sm ${textSecondaryClass}`}>
              Set prices for this gallery. These prices apply to all items in this gallery.
            </p>
            
            {/* Photo Pricing */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <ImageIcon className="w-4 h-4" /> Photo Pricing (Credits)
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className={textSecondaryClass}>Web</Label>
                  <Input
                    type="number"
                    value={pricing.price_web}
                    onChange={(e) => setPricing({ ...pricing, price_web: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>HD</Label>
                  <Input
                    type="number"
                    value={pricing.price_standard}
                    onChange={(e) => setPricing({ ...pricing, price_standard: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>4K</Label>
                  <Input
                    type="number"
                    value={pricing.price_high}
                    onChange={(e) => setPricing({ ...pricing, price_high: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
              </div>
            </div>
            
            {/* Video Pricing */}
            <div className={`p-4 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
              <h4 className={`font-medium ${textPrimaryClass} mb-3 flex items-center gap-2`}>
                <Video className="w-4 h-4" /> Video Pricing (Credits)
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className={textSecondaryClass}>720p</Label>
                  <Input
                    type="number"
                    value={pricing.price_720p}
                    onChange={(e) => setPricing({ ...pricing, price_720p: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>1080p</Label>
                  <Input
                    type="number"
                    value={pricing.price_1080p}
                    onChange={(e) => setPricing({ ...pricing, price_1080p: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
                <div>
                  <Label className={textSecondaryClass}>4K</Label>
                  <Input
                    type="number"
                    value={pricing.price_4k}
                    onChange={(e) => setPricing({ ...pricing, price_4k: parseFloat(e.target.value) || 0 })}
                    className={`${inputBgClass} ${textPrimaryClass}`}
                  />
                </div>
              </div>
            </div>
            
            <div className={`p-3 rounded-lg ${isLight ? 'bg-green-50' : 'bg-green-500/10'}`}>
              <p className={`text-sm ${textSecondaryClass}`}>
                <strong className="text-green-400">Platform fee:</strong> 20% of each sale. You receive 80%.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPricingModal(false)}>Cancel</Button>
            <Button onClick={handleSavePricing} className="bg-gradient-to-r from-green-400 to-emerald-500 text-black">
              Save Pricing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Gallery Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={textPrimaryClass}>Edit Gallery</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className={textSecondaryClass}>Title</Label>
              <Input
                value={editData.title}
                onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                className={`${inputBgClass} ${textPrimaryClass}`}
              />
            </div>
            <div>
              <Label className={textSecondaryClass}>Description</Label>
              <Textarea
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                className={`${inputBgClass} ${textPrimaryClass}`}
                rows={4}
              />
            </div>
            
            <div className="pt-4 border-t border-zinc-700">
              <Button aria-label="Delete"
                variant="destructive"
                onClick={handleDeleteGallery}
                className="w-full"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Gallery
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ PHASE 3: UNIFIED TAG & ASSIGN MODAL ============ */}
      <Dialog open={showTaggingModal} onOpenChange={setShowTaggingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-2xl max-h-[90vh] overflow-y-auto`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Sparkles className="w-5 h-5 text-purple-400" />
              Tag & Assign to Surfer
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-5">
            {/* Preview Image */}
            {selectedItem && (
              <div className="flex justify-center">
                <img loading="lazy" decoding="async" 
                  src={getFullUrl(selectedItem.preview_url)} 
                  alt="Photo to tag" 
                  className="max-h-48 rounded-lg object-contain"
                />
              </div>
            )}

            {/* --- AI Analysis Section --- */}
            <div className={`rounded-xl p-4 ${isLight ? 'bg-purple-50 border border-purple-200' : 'bg-purple-500/10 border border-purple-500/20'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <h4 className={`font-semibold text-sm ${textPrimaryClass}`}>AI Recognition</h4>
                {!analyzingPhoto && aiTagSuggestions.length === 0 && (
                  <Button aria-label="Sparkles"
                    size="sm"
                    onClick={handleAnalyzePhoto}
                    disabled={selectedItem?.media_type === 'video'}
                    className="ml-auto bg-gradient-to-r from-purple-400 to-pink-500 text-black h-7 px-3 text-xs"
                  >
                    <Sparkles className="w-3 h-3 mr-1" /> Scan Photo
                  </Button>
                )}
              </div>

              {analyzingPhoto && (
                <div className="text-center py-4">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-purple-400" />
                  <p className={`text-xs ${textSecondaryClass}`}>Analyzing photo with AI...</p>
                </div>
              )}

              {aiTagSuggestions.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {aiTagSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.profile_id}
                      onClick={() => toggleTagSelection(suggestion.profile_id)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${
                        selectedTags.includes(suggestion.profile_id)
                          ? 'bg-purple-500/25 ring-2 ring-purple-500/50'
                          : isLight ? 'bg-white hover:bg-purple-50' : 'bg-zinc-800/70 hover:bg-zinc-700'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                        {suggestion.avatar_url ? (
                          <img loading="lazy" decoding="async" src={getFullUrl(suggestion.avatar_url)} alt={suggestion.name} className="w-full h-full object-cover" />
                        ) : (
                          <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${textPrimaryClass}`}>{suggestion.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Badge variant="outline" className={
                            `text-[9px] ${
                              suggestion.confidence === 'high' ? 'border-green-500/50 text-green-400' :
                              suggestion.confidence === 'medium' ? 'border-yellow-500/50 text-yellow-400' :
                              'border-gray-500/50 text-gray-400'
                            }`
                          }>
                            {suggestion.confidence}
                          </Badge>
                          {suggestion.reasoning && (
                            <span className={`text-[10px] ${textSecondaryClass} truncate`}>{suggestion.reasoning}</span>
                          )}
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                        selectedTags.includes(suggestion.profile_id)
                          ? 'bg-purple-500 border-purple-500'
                          : isLight ? 'border-gray-300' : 'border-zinc-600'
                      }`}>
                        {selectedTags.includes(suggestion.profile_id) && <Check className="w-3.5 h-3.5 text-white" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!analyzingPhoto && aiTagSuggestions.length === 0 && (
                <p className={`text-xs ${textSecondaryClass} text-center`}>
                  {selectedItem?.media_type === 'video' ? 'AI analysis unavailable for video' : 'Click "Scan Photo" to find matching surfers'}
                </p>
              )}
            </div>

            {/* --- Manual Assignment Section (Session Participants) --- */}
            <div className={`rounded-xl p-4 ${isLight ? 'bg-cyan-50 border border-cyan-200' : 'bg-cyan-500/10 border border-cyan-500/20'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-cyan-400" />
                <h4 className={`font-semibold text-sm ${textPrimaryClass}`}>Session Participants</h4>
                <span className={`text-[10px] ${textSecondaryClass} ml-auto`}>{sessionParticipants.length} surfers</span>
              </div>

              {sessionParticipants.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {sessionParticipants.map((participant) => {
                    const isAiMatch = aiTagSuggestions.some(s => s.profile_id === participant.surfer_id);
                    return (
                      <div
                        key={participant.surfer_id}
                        onClick={() => toggleTagSelection(participant.surfer_id)}
                        className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${
                          selectedTags.includes(participant.surfer_id)
                            ? 'bg-cyan-500/25 ring-2 ring-cyan-500/50'
                            : isLight ? 'bg-white hover:bg-cyan-50' : 'bg-zinc-800/70 hover:bg-zinc-700'
                        }`}
                      >
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                          {participant.avatar_url ? (
                            <img loading="lazy" decoding="async" src={getFullUrl(participant.avatar_url)} alt={participant.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-sm font-medium ${textPrimaryClass}`}>{participant.full_name}</p>
                            {isAiMatch && (
                              <Badge className="bg-purple-500/20 text-purple-400 text-[8px] px-1 py-0">AI ?</Badge>
                            )}
                          </div>
                          <p className={`text-[10px] ${textSecondaryClass}`}>
                            {participant.items_distributed || 0} items in locker
                            {participant.status && ` ï¿½ ${participant.status}`}
                          </p>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                          selectedTags.includes(participant.surfer_id)
                            ? 'bg-cyan-500 border-cyan-500'
                            : isLight ? 'border-gray-300' : 'border-zinc-600'
                        }`}>
                          {selectedTags.includes(participant.surfer_id) && <Check className="w-3.5 h-3.5 text-white" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-3">
                  <p className={`text-xs ${textSecondaryClass}`}>
                    No session participants. <button onClick={() => { setShowTaggingModal(false); setShowLinkSessionModal(true); fetchRecentSessions(); }} className="text-cyan-400 underline">Link a session</button> first.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowTaggingModal(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                // Phase 3: Combined Tag + Assign flow
                if (selectedTags.length === 0) {
                  toast.warning('Select at least one surfer');
                  return;
                }
                try {
                  // 1. Confirm AI tags (if any AI suggestions were selected)
                  const aiIds = aiTagSuggestions.map(s => s.profile_id);
                  const selectedAiTags = selectedTags.filter(id => aiIds.includes(id));
                  if (selectedAiTags.length > 0) {
                    await apiClient.post(`/ai/confirm-tags?photographer_id=${user?.id}`, {
                      gallery_item_id: selectedItem.id,
                      surfer_ids: selectedAiTags
                    });
                  }
                  // 2. Assign item to each selected surfer's locker (silent mode for batch)
                  for (const surferId of selectedTags) {
                    try {
                      await handleAssignItemToSurfer(selectedItem.id, surferId, true);
                    } catch (e) {
                      // Silently skip duplicates (idempotent endpoint)
                    }
                  }
                  toast.success(`Tagged & assigned to ${selectedTags.length} surfer(s)!`);
                  setShowTaggingModal(false);
                  setSelectedItem(null);
                  setSelectedTags([]);
                  setAiTagSuggestions([]);
                  fetchGallery();
                  fetchSessionParticipants();
                } catch (error) {
                  toast.error('Failed to complete tag & assign');
                }
              }}
              disabled={selectedTags.length === 0}
              className="bg-gradient-to-r from-purple-400 via-cyan-500 to-emerald-500 text-black font-medium"
            >
              <Send className="w-4 h-4 mr-2" />
              Tag & Assign ({selectedTags.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 2: Lightbox Modal */}
      {lightboxItem && (
        <div 
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxItem(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white p-2"
            onClick={() => setLightboxItem(null)}
          >
            <X className="w-8 h-8" />
          </button>
          
          {/* Navigation arrows */}
          {filteredItems.findIndex(i => i.id === lightboxItem.id) > 0 && (
            <button aria-label="Go back"
              className="absolute left-4 text-white/70 hover:text-white p-2"
              onClick={(e) => {
                e.stopPropagation();
                const idx = filteredItems.findIndex(i => i.id === lightboxItem.id);
                setLightboxItem(filteredItems[idx - 1]);
              }}
            >
              <ArrowLeft className="w-10 h-10" />
            </button>
          )}
          {filteredItems.findIndex(i => i.id === lightboxItem.id) < filteredItems.length - 1 && (
            <button aria-label="Go back"
              className="absolute right-4 text-white/70 hover:text-white p-2"
              onClick={(e) => {
                e.stopPropagation();
                const idx = filteredItems.findIndex(i => i.id === lightboxItem.id);
                setLightboxItem(filteredItems[idx + 1]);
              }}
            >
              <ArrowLeft className="w-10 h-10 rotate-180" />
            </button>
          )}
          
          {/* Image */}
          <img loading="lazy" decoding="async"
            src={lightboxItem.preview_url || lightboxItem.original_url}
            alt={lightboxItem.title || 'Gallery item'}
            className="max-w-[90vw] max-h-[85vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          
          {/* Bottom info bar */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
            <div className="flex items-center justify-between max-w-4xl mx-auto">
              <div>
                <p className="text-white font-medium">{lightboxItem.title || 'Untitled'}</p>
                <p className="text-white/60 text-sm">{new Date(lightboxItem.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <Button aria-label="Sparkles"
                  size="sm"
                  variant="ghost"
                  className="text-white"
                  onClick={(e) => { e.stopPropagation(); handleOpenTagging(lightboxItem); setLightboxItem(null); }}
                >
                  <Sparkles className="w-5 h-5 mr-1" /> AI Tag
                </Button>
              </div>
            </div>
            <p className="text-center text-white/40 text-xs mt-2">? ? Navigate ï¿½ Esc Close</p>
          </div>
        </div>
      )}

      {/* Phase 3: Sales Dashboard Modal */}
      <Dialog open={showSalesDashboard} onOpenChange={setShowSalesDashboard}>
        <DialogContent className={`max-w-3xl max-h-[80vh] overflow-y-auto ${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${textPrimaryClass}`}>
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              Sales Dashboard
            </DialogTitle>
          </DialogHeader>
          
          {loadingSales ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Stats Summary */}
              <div className="grid grid-cols-3 gap-4">
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">${salesData.stats?.total_revenue?.toFixed(2) || '0.00'}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Revenue</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className={`text-2xl font-bold ${textPrimaryClass}`}>{salesData.stats?.total_purchases || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Sales</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className={`text-2xl font-bold text-amber-400`}>${salesData.stats?.avg_sale?.toFixed(2) || '0.00'}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Avg Sale</p>
                  </CardContent>
                </Card>
              </div>
              
              {/* Sales List */}
              <div>
                <h4 className={`text-sm font-medium mb-3 ${textSecondaryClass}`}>Recent Sales</h4>
                {salesData.sales?.length > 0 ? (
                  <div className="space-y-2">
                    {salesData.sales.map(sale => (
                      <div key={sale.id} className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
                        <img loading="lazy" decoding="async" src={sale.item_thumbnail} alt="" className="w-12 h-12 rounded object-cover" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>{sale.item_title || 'Untitled'}</p>
                          <div className="flex items-center gap-2 text-xs">
                            <img loading="lazy" decoding="async" src={sale.buyer_avatar || '/default-avatar.png'} alt="" className="w-4 h-4 rounded-full" />
                            <span className={textSecondaryClass}>{sale.buyer_name}</span>
                            <Badge variant="outline" className="text-[10px]">{sale.quality_tier}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-green-400 font-medium">${sale.amount?.toFixed(2)}</p>
                          <p className={`text-[10px] ${textSecondaryClass}`}>
                            {sale.purchased_at ? new Date(sale.purchased_at).toLocaleDateString() : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-8 ${textSecondaryClass}`}>
                    <ShoppingBag className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No sales yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Phase 3: Client Activity Modal */}
      <Dialog open={showClientActivity} onOpenChange={setShowClientActivity}>
        <DialogContent className={`max-w-2xl max-h-[80vh] overflow-y-auto ${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass}`}>
          <DialogHeader>
            <DialogTitle className={`flex items-center gap-2 ${textPrimaryClass}`}>
              <Users className="w-5 h-5 text-green-400" />
              Client Activity
            </DialogTitle>
          </DialogHeader>
          
          {loadingSales ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-green-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Activity Stats */}
              <div className="grid grid-cols-3 gap-4">
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className={`text-2xl font-bold ${textPrimaryClass}`}>{clientsData.stats?.unique_viewers || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Unique Viewers</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-400">{clientsData.stats?.total_favorites || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Total Favorites</p>
                  </CardContent>
                </Card>
                <Card className={cardBgClass}>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-green-400">{clientsData.stats?.total_purchases || 0}</p>
                    <p className={`text-xs ${textSecondaryClass}`}>Purchases</p>
                  </CardContent>
                </Card>
              </div>
              
              {/* Clients List */}
              <div>
                <h4 className={`text-sm font-medium mb-3 ${textSecondaryClass}`}>Recent Clients</h4>
                {clientsData.clients?.length > 0 ? (
                  <div className="space-y-2">
                    {clientsData.clients.map(client => (
                      <div key={client.id} className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-zinc-800/50'}`}>
                        <img loading="lazy" decoding="async" src={client.avatar || '/default-avatar.png'} alt="" className="w-10 h-10 rounded-full object-cover" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${textPrimaryClass}`}>{client.name}</p>
                          <p className={`text-xs ${textSecondaryClass}`}>
                            {client.last_activity ? `Last active: ${new Date(client.last_activity).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="text-center">
                            <p className={textPrimaryClass}>{client.items_count}</p>
                            <p className={`text-[10px] ${textSecondaryClass}`}>Items</p>
                          </div>
                          <div className="text-center">
                            <p className="text-red-400">{client.favorites_count}</p>
                            <p className={`text-[10px] ${textSecondaryClass}`}>Favs</p>
                          </div>
                          <div className="text-center">
                            <p className="text-green-400">{client.purchased_count}</p>
                            <p className={`text-[10px] ${textSecondaryClass}`}>Bought</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={`text-center py-8 ${textSecondaryClass}`}>
                    <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No client activity yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* ============ LINK SESSION MODAL ============ */}
      <Dialog open={showLinkSessionModal} onOpenChange={setShowLinkSessionModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-lg`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Link2 className="w-5 h-5 text-amber-400" />
              Link Gallery to Session
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className={`text-sm ${textSecondaryClass}`}>
              Select a recent session to link to this gallery. This enables automatic distribution of photos to surfers who participated.
            </p>
            
            {loadingSessions ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              </div>
            ) : recentSessions.length > 0 ? (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {recentSessions.map((session) => (
                  <div
                    key={`${session.session_type || 'live'}-${session.id}`}
                    onClick={() => session.is_available && handleLinkSession(session)}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-colors cursor-pointer ${
                      session.is_available
                        ? isLight ? 'bg-gray-50 hover:bg-gray-100 hover:ring-2 hover:ring-amber-500/30' : 'bg-zinc-800 hover:bg-zinc-700 hover:ring-2 hover:ring-amber-500/30'
                        : isLight ? 'bg-gray-100 opacity-50 cursor-not-allowed' : 'bg-zinc-800/30 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      !session.is_available ? 'bg-zinc-700' :
                      session.session_type === 'booking' ? 'bg-blue-500/20' :
                      session.session_type === 'on_demand' ? 'bg-orange-500/20' :
                      'bg-amber-500/20'
                    }`}>
                      <MapPin className={`w-5 h-5 ${
                        !session.is_available ? 'text-zinc-500' :
                        session.session_type === 'booking' ? 'text-blue-400' :
                        session.session_type === 'on_demand' ? 'text-orange-400' :
                        'text-amber-400'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>
                        {session.location_name || 'Unknown Location'}
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        <Calendar className="w-3 h-3" />
                        <span className={textSecondaryClass}>
                          {session.started_at ? new Date(session.started_at).toLocaleDateString('en-US', { 
                            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
                          }) : 'Unknown date'}
                        </span>
                        {session.session_type && (
                          <Badge variant="outline" className={`text-[9px] px-1 py-0 ${
                            session.session_type === 'live' ? 'border-emerald-500/50 text-emerald-400' :
                            session.session_type === 'booking' ? 'border-blue-500/50 text-blue-400' :
                            'border-orange-500/50 text-orange-400'
                          }`}>
                            {session.session_type === 'live' ? '📸 Live' :
                             session.session_type === 'booking' ? '📅 Booking' :
                             '⚡ On-Demand'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1">
                        <Users className="w-3 h-3 text-cyan-400" />
                        <span className={`text-xs ${textPrimaryClass}`}>{session.participant_count}</span>
                      </div>
                      {session.is_available ? (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-400 text-[10px] mt-1">
                          Available
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-zinc-600 text-zinc-500 text-[10px] mt-1">
                          Linked
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${textSecondaryClass}`}>
                <Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No recent sessions found</p>
                <p className="text-xs mt-1">Start a live session or create a booking first</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLinkSessionModal(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ ASSIGN DRAWER (Individual Item ? Surfer) ============ */}
      <Dialog open={showAssignDrawer} onOpenChange={setShowAssignDrawer}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-md`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <UserPlus className="w-5 h-5 text-purple-400" />
              Assign to Surfer
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {assigningItem && (
              <div className="flex justify-center mb-4">
                <img loading="lazy" decoding="async" 
                  src={getFullUrl(assigningItem.preview_url)} 
                  alt="Item to assign" 
                  className="max-h-32 rounded-lg object-contain"
                />
              </div>
            )}
            
            <p className={`text-sm ${textSecondaryClass}`}>
              Select a session participant to assign this photo to their Locker:
            </p>
            
            {sessionParticipants.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {sessionParticipants.map((participant) => (
                  <div
                    key={participant.surfer_id}
                    onClick={() => assigningItem && handleAssignItemToSurfer(assigningItem.id, participant.surfer_id)}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                      isLight ? 'bg-gray-50 hover:bg-purple-50 hover:ring-2 hover:ring-purple-500/30' : 'bg-zinc-800 hover:bg-zinc-700 hover:ring-2 hover:ring-purple-500/30'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0">
                      {participant.avatar_url ? (
                        <img loading="lazy" decoding="async" src={getFullUrl(participant.avatar_url)} alt={participant.full_name} className="w-full h-full object-cover" />
                      ) : (
                        <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${textPrimaryClass}`}>{participant.full_name}</p>
                      <p className={`text-xs ${textSecondaryClass}`}>{participant.items_distributed} items in locker</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-purple-400" />
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-6 ${textSecondaryClass}`}>
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No session participants available</p>
                <p className="text-xs mt-1">Link this gallery to a session first</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAssignDrawer(false); setAssigningItem(null); }}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// -- Pricing Tier Row (for per-service pricing display) --
const PricingTierRow = ({
  label, emoji, color, photosIncluded, videosIncluded,
  buyinPrice, buyinLabel, photo, video,
  textSecondaryClass, textPrimaryClass, isActive
}) => {
  const colorMap = {
    emerald: { border: 'rgba(16,185,129,0.25)', bg: 'rgba(16,185,129,0.06)', text: '#10b981' },
    blue:    { border: 'rgba(59,130,246,0.25)', bg: 'rgba(59,130,246,0.06)', text: '#3b82f6' },
    amber:   { border: 'rgba(245,158,11,0.25)', bg: 'rgba(245,158,11,0.06)', text: '#f59e0b' }
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <div className="rounded-lg p-3" style={{
      background: isActive ? c.bg : 'rgba(255,255,255,0.02)',
      border: `1px solid ${isActive ? c.border : 'rgba(255,255,255,0.06)'}`,
      opacity: isActive ? 1 : 0.7
    }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">{emoji}</span>
          <span className={`text-xs font-semibold ${textPrimaryClass}`}>{label}</span>
          {isActive && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: c.border, color: c.text }}>
              ACTIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          {buyinPrice > 0 && (
            <span className={textSecondaryClass}>${buyinPrice}{buyinLabel || ' buy-in'}</span>
          )}
          <span style={{ color: '#06b6d4' }}>{String.fromCodePoint(0x1F4F7)} {photosIncluded || 0} incl</span>
          <span style={{ color: '#8b5cf6' }}>{String.fromCodePoint(0x1F3AC)} {videosIncluded || 0} incl</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
        <span className={textSecondaryClass}>
          <span className="text-cyan-400/60">Photo:</span>{' '}
          Web ${photo?.web || 'ï¿½'} ï¿½ HD ${photo?.standard || 'ï¿½'} ï¿½ 4K ${photo?.high || 'ï¿½'}
        </span>
        <span className={textSecondaryClass}>
          <span className="text-purple-400/60">Video:</span>{' '}
          720p ${video?.['720p'] || 'ï¿½'} ï¿½ 1080p ${video?.['1080p'] || 'ï¿½'} ï¿½ 4K ${video?.['4k'] || 'ï¿½'}
        </span>
      </div>
    </div>
  );
};

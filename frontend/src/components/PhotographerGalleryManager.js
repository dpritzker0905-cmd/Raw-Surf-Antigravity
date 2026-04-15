import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import logger from '../utils/logger';
import { 
  ArrowLeft, Upload, Image as ImageIcon, Video, DollarSign, 
  Settings, Trash2, Eye, Tag, Save, Plus, X, Users,
  MapPin, Calendar, Sparkles, UserCheck, Loader2,
  Search, Filter, Check, MoreVertical, ChevronDown,
  TrendingUp, Clock, Heart, ShoppingBag, BarChart3
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const PhotographerGalleryManager = () => {
  const { galleryId } = useParams();
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  // ROLE-BASED COMMERCE RESTRICTIONS
  // Grom Parent: NO commerce at all - pure archive/family photos
  // Hobbyist: Can browse/buy but NOT sell
  const isGromParent = user?.role === 'Grom Parent' || user?.role === 'GROM_PARENT';
  const isHobbyist = user?.role === 'Hobbyist' || user?.role === 'HOBBYIST';
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
  const [bulkMode, setBulkMode] = useState(false);
  const [itemCustomPrice, setItemCustomPrice] = useState('');
  const [lightboxItem, setLightboxItem] = useState(null); // Phase 2: Lightbox
  
  // Phase 3: Sales Intelligence
  const [showSalesDashboard, setShowSalesDashboard] = useState(false);
  const [showClientActivity, setShowClientActivity] = useState(false);
  const [salesData, setSalesData] = useState({ sales: [], stats: {} });
  const [clientsData, setClientsData] = useState({ clients: [], stats: {} });
  const [loadingSales, setLoadingSales] = useState(false);
  
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

  const fetchGallery = async () => {
    try {
      const res = await axios.get(`${API}/galleries/${galleryId}?viewer_id=${user?.id}`);
      setGallery(res.data);
      setPricing({
        price_web: res.data.pricing?.photo?.web || 3,
        price_standard: res.data.pricing?.photo?.standard || 5,
        price_high: res.data.pricing?.photo?.high || 10,
        price_720p: res.data.pricing?.video?.['720p'] || 8,
        price_1080p: res.data.pricing?.video?.['1080p'] || 15,
        price_4k: res.data.pricing?.video?.['4k'] || 30
      });
      setEditData({
        title: res.data.title || '',
        description: res.data.description || ''
      });
    } catch (error) {
      toast.error('Failed to load gallery');
      navigate('/photographer/sessions');
    } finally {
      setLoading(false);
    }
  };

  // Phase 3: Fetch sales data
  const fetchSalesData = async () => {
    setLoadingSales(true);
    try {
      const res = await axios.get(`${API}/galleries/${galleryId}/sales-dashboard?photographer_id=${user?.id}`);
      setSalesData(res.data);
    } catch (error) {
      logger.error('Failed to load sales data:', error);
    } finally {
      setLoadingSales(false);
    }
  };

  // Phase 3: Fetch client activity
  const fetchClientActivity = async () => {
    setLoadingSales(true);
    try {
      const res = await axios.get(`${API}/galleries/${galleryId}/client-activity?photographer_id=${user?.id}`);
      setClientsData(res.data);
    } catch (error) {
      logger.error('Failed to load client activity:', error);
    } finally {
      setLoadingSales(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploading(true);
    let successCount = 0;

    for (const file of files) {
      try {
        // Create FormData for file upload
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', user?.id);  // Backend expects user_id
        formData.append('add_watermark_preview', 'true');

        // Upload to server using the correct photographer-gallery endpoint
        const uploadRes = await axios.post(`${API}/upload/photographer-gallery`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        if (uploadRes.data) {
          // Add item to gallery
          await axios.post(`${API}/galleries/${galleryId}/items?photographer_id=${user?.id}`, {
            original_url: uploadRes.data.original_url,
            preview_url: uploadRes.data.preview_url,
            thumbnail_url: uploadRes.data.thumbnail_url,
            media_type: file.type.startsWith('video') ? 'video' : 'image'
          });
          successCount++;
        }
      } catch (error) {
        logger.error(`Failed to upload ${file.name}:`, error);
        toast.error(`Failed to upload ${file.name}: ${error.response?.data?.detail || error.message}`);
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file(s) successfully`);
      fetchGallery();
    }
  };

  const handleSavePricing = async () => {
    try {
      await axios.put(`${API}/galleries/${galleryId}?photographer_id=${user?.id}`, {
        ...pricing
      });
      toast.success('Pricing updated');
      setShowPricingModal(false);
      fetchGallery();
    } catch (error) {
      toast.error('Failed to update pricing');
    }
  };

  const handleSaveEdit = async () => {
    try {
      await axios.put(`${API}/galleries/${galleryId}?photographer_id=${user?.id}`, editData);
      toast.success('Gallery updated');
      setShowEditModal(false);
      fetchGallery();
    } catch (error) {
      toast.error('Failed to update gallery');
    }
  };

  const handleDeleteGallery = async () => {
    if (!window.confirm('Are you sure you want to delete this gallery? This cannot be undone.')) {
      return;
    }
    try {
      await axios.delete(`${API}/galleries/${galleryId}?photographer_id=${user?.id}`);
      toast.success('Gallery deleted');
      navigate('/photographer/sessions');
    } catch (error) {
      toast.error('Failed to delete gallery');
    }
  };

  // AI Tagging Functions
  const handleOpenTagging = async (item) => {
    setSelectedItem(item);
    setSelectedTags([]);
    setAiTagSuggestions([]);
    setShowTaggingModal(true);
  };

  const handleAnalyzePhoto = async () => {
    if (!selectedItem) return;
    
    setAnalyzingPhoto(true);
    try {
      const response = await axios.post(`${API}/ai/suggest-tags`, {
        image_url: selectedItem.preview_url,
        gallery_item_id: selectedItem.id
      });
      
      if (response.data.success) {
        setAiTagSuggestions(response.data.suggested_tags || []);
        if (response.data.suggested_tags?.length === 0) {
          toast.info(`Detected ${response.data.people_detected || 0} people but no registered surfers matched`);
        } else {
          toast.success(`Found ${response.data.suggested_tags.length} potential tag suggestions`);
        }
      }
    } catch (error) {
      toast.error('Failed to analyze photo');
    } finally {
      setAnalyzingPhoto(false);
    }
  };

  const toggleTagSelection = (profileId) => {
    setSelectedTags(prev => 
      prev.includes(profileId) 
        ? prev.filter(id => id !== profileId)
        : [...prev, profileId]
    );
  };

  const handleConfirmTags = async () => {
    if (selectedTags.length === 0) {
      toast.warning('No tags selected');
      return;
    }
    
    try {
      await axios.post(`${API}/ai/confirm-tags?photographer_id=${user?.id}`, {
        gallery_item_id: selectedItem.id,
        surfer_ids: selectedTags
      });
      
      toast.success(`Tagged ${selectedTags.length} surfer(s)! They'll be notified.`);
      setShowTaggingModal(false);
      setSelectedItem(null);
      setSelectedTags([]);
      setAiTagSuggestions([]);
    } catch (error) {
      toast.error('Failed to save tags');
    }
  };

  // Phase 1: Filter and sort items
  const filteredItems = React.useMemo(() => {
    if (!gallery?.items) return [];
    
    let items = [...gallery.items];
    
    // Filter by type
    if (filterType === 'photos') items = items.filter(i => i.media_type === 'image');
    else if (filterType === 'videos') items = items.filter(i => i.media_type === 'video');
    else if (filterType === 'tagged') items = items.filter(i => i.tagged_surfer_ids);
    else if (filterType === 'untagged') items = items.filter(i => !i.tagged_surfer_ids);
    
    // Search by title
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => 
        (i.title || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
      );
    }
    
    // Sort
    if (sortBy === 'newest') items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else if (sortBy === 'oldest') items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sortBy === 'purchases') items.sort((a, b) => (b.purchase_count || 0) - (a.purchase_count || 0));
    
    return items;
  }, [gallery?.items, filterType, searchQuery, sortBy]);

  // Phase 1: Bulk selection handlers
  const handleToggleSelect = (itemId) => {
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

  // Phase 2: Keyboard navigation for lightbox
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (!lightboxItem) return;
      const currentIndex = filteredItems.findIndex(i => i.id === lightboxItem.id);
      
      if (e.key === 'Escape') {
        setLightboxItem(null);
      } else if (e.key === 'ArrowRight' && currentIndex < filteredItems.length - 1) {
        setLightboxItem(filteredItems[currentIndex + 1]);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setLightboxItem(filteredItems[currentIndex - 1]);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxItem, filteredItems]);

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Delete this item? This cannot be undone.')) return;
    try {
      await axios.delete(`${API}/galleries/${galleryId}/items/${itemId}?photographer_id=${user?.id}`);
      toast.success('Item deleted');
      fetchGallery();
    } catch (error) {
      toast.error('Failed to delete item');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    if (!window.confirm(`Delete ${selectedItems.size} items? This cannot be undone.`)) return;
    
    try {
      for (const itemId of selectedItems) {
        await axios.delete(`${API}/galleries/${galleryId}/items/${itemId}?photographer_id=${user?.id}`);
      }
      toast.success(`Deleted ${selectedItems.size} items`);
      setSelectedItems(new Set());
      setBulkMode(false);
      fetchGallery();
    } catch (error) {
      toast.error('Failed to delete some items');
    }
  };

  const handleSetCustomPrice = async () => {
    if (!selectedItem || !itemCustomPrice) return;
    try {
      await axios.patch(`${API}/gallery/item/${selectedItem.id}/custom-price?photographer_id=${user?.id}`, {
        custom_price: parseFloat(itemCustomPrice)
      });
      toast.success('Custom price set');
      setShowItemPricingModal(false);
      setSelectedItem(null);
      setItemCustomPrice('');
      fetchGallery();
    } catch (error) {
      toast.error('Failed to set price');
    }
  };

  const openItemPricing = (item) => {
    setSelectedItem(item);
    setItemCustomPrice(item.custom_price || '');
    setShowItemPricingModal(true);
  };

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
          <Button
            variant="ghost"
            onClick={() => navigate('/photographer/sessions')}
            className={textSecondaryClass}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className={`text-2xl font-bold ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }}>
              {gallery.title}
            </h1>
            <div className="flex items-center gap-3 mt-1">
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
            <Button
              variant="outline"
              onClick={() => setShowEditModal(true)}
              className={borderClass}
            >
              <Settings className="w-4 h-4 mr-2" />
              Edit
            </Button>
            {showPricing && (
              <Button
                onClick={() => setShowPricingModal(true)}
                className="bg-gradient-to-r from-green-400 to-emerald-500 text-black"
              >
                <DollarSign className="w-4 h-4 mr-2" />
                Set Pricing
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

        {/* Current Pricing Summary - Only for sellers */}
        {showPricing && (
          <Card className={`mb-6 ${cardBgClass}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-sm ${textSecondaryClass}`}>Current Pricing</CardTitle>
            </CardHeader>
            <CardContent>
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
            <Input
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
          <Button
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
            <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
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
                  <button
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
                  <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                    <Video className="w-12 h-12 text-zinc-600" />
                  </div>
                ) : (
                  <img 
                    src={item.preview_url || item.thumbnail_url} 
                    alt={item.title || 'Gallery item'}
                    className="w-full h-full object-cover"
                  />
                )}
                <Badge className="absolute top-2 right-2 bg-black/70">
                  {item.media_type === 'video' ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
                </Badge>
                
                {/* Custom price badge */}
                {item.custom_price && (
                  <Badge className="absolute bottom-2 left-2 bg-green-500/90 text-black">
                    ${item.custom_price}
                  </Badge>
                )}
                
                {/* Hover overlay with actions */}
                {!bulkMode && item.media_type !== 'video' && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => setLightboxItem(item)}
                      variant="outline"
                      className="border-white/50 text-white hover:bg-white/20"
                    >
                      <Eye className="w-4 h-4 mr-1" /> View
                    </Button>
                    <Button
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
                      <Button size="sm" variant="ghost" className="h-6 px-2">
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {item.media_type !== 'video' && (
                        <DropdownMenuItem onClick={() => handleOpenTagging(item)}>
                          <Tag className="w-4 h-4 mr-2" /> AI Tag Surfers
                        </DropdownMenuItem>
                      )}
                      {showPricing && (
                        <DropdownMenuItem onClick={() => openItemPricing(item)}>
                          <DollarSign className="w-4 h-4 mr-2" /> Set Custom Price
                        </DropdownMenuItem>
                      )}
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
              <Input
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
              <Button
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

      {/* AI Tagging Modal */}
      <Dialog open={showTaggingModal} onOpenChange={setShowTaggingModal}>
        <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} max-w-2xl`}>
          <DialogHeader>
            <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
              <Sparkles className="w-5 h-5 text-purple-400" />
              AI Surfer Tagging
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Preview Image */}
            {selectedItem && (
              <div className="flex justify-center">
                <img 
                  src={selectedItem.preview_url} 
                  alt="Photo to tag" 
                  className="max-h-64 rounded-lg object-contain"
                />
              </div>
            )}
            
            {/* Analyze Button */}
            {aiTagSuggestions.length === 0 && !analyzingPhoto && (
              <div className="text-center">
                <p className={`text-sm ${textSecondaryClass} mb-4`}>
                  Use AI to detect surfers in this photo and suggest tags from registered users.
                </p>
                <Button
                  onClick={handleAnalyzePhoto}
                  className="bg-gradient-to-r from-purple-400 to-pink-500 text-black"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Analyze Photo with AI
                </Button>
              </div>
            )}
            
            {/* Loading State */}
            {analyzingPhoto && (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-purple-400" />
                <p className={textPrimaryClass}>Analyzing photo with AI...</p>
                <p className={`text-sm ${textSecondaryClass}`}>This may take a moment</p>
              </div>
            )}
            
            {/* Tag Suggestions */}
            {aiTagSuggestions.length > 0 && (
              <div>
                <h4 className={`font-medium ${textPrimaryClass} mb-3`}>Suggested Tags</h4>
                <p className={`text-sm ${textSecondaryClass} mb-3`}>
                  Select surfers to tag in this photo. They'll receive a notification.
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {aiTagSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.profile_id}
                      onClick={() => toggleTagSelection(suggestion.profile_id)}
                      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedTags.includes(suggestion.profile_id)
                          ? 'bg-purple-500/20 border border-purple-500/50'
                          : isLight ? 'bg-gray-100 hover:bg-gray-200' : 'bg-zinc-800 hover:bg-zinc-700'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-700">
                        {suggestion.avatar_url ? (
                          <img src={suggestion.avatar_url} alt={suggestion.name} className="w-full h-full object-cover" />
                        ) : (
                          <Users className="w-5 h-5 m-auto mt-2.5 text-zinc-500" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className={textPrimaryClass}>{suggestion.name}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={
                            suggestion.confidence === 'high' ? 'border-green-500/50 text-green-400' :
                            suggestion.confidence === 'medium' ? 'border-yellow-500/50 text-yellow-400' :
                            'border-gray-500/50 text-gray-400'
                          }>
                            {suggestion.confidence} confidence
                          </Badge>
                        </div>
                        {suggestion.reasoning && (
                          <p className={`text-xs ${textSecondaryClass} mt-1`}>{suggestion.reasoning}</p>
                        )}
                      </div>
                      {selectedTags.includes(suggestion.profile_id) && (
                        <UserCheck className="w-5 h-5 text-purple-400" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* No Matches Message */}
            {!analyzingPhoto && aiTagSuggestions.length === 0 && selectedItem && (
              <div className={`text-center py-4 ${textSecondaryClass}`}>
                <p className="text-sm">Click "Analyze Photo" to get AI-powered tag suggestions.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTaggingModal(false)}>Cancel</Button>
            {aiTagSuggestions.length > 0 && (
              <Button
                onClick={handleConfirmTags}
                disabled={selectedTags.length === 0}
                className="bg-gradient-to-r from-purple-400 to-pink-500 text-black"
              >
                <Tag className="w-4 h-4 mr-2" />
                Tag {selectedTags.length} Surfer{selectedTags.length !== 1 ? 's' : ''}
              </Button>
            )}
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
            <button
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
            <button
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
          <img
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white"
                  onClick={(e) => { e.stopPropagation(); handleOpenTagging(lightboxItem); setLightboxItem(null); }}
                >
                  <Sparkles className="w-5 h-5 mr-1" /> AI Tag
                </Button>
              </div>
            </div>
            <p className="text-center text-white/40 text-xs mt-2">← → Navigate • Esc Close</p>
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
                        <img src={sale.item_thumbnail} alt="" className="w-12 h-12 rounded object-cover" />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>{sale.item_title || 'Untitled'}</p>
                          <div className="flex items-center gap-2 text-xs">
                            <img src={sale.buyer_avatar || '/default-avatar.png'} alt="" className="w-4 h-4 rounded-full" />
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
                        <img src={client.avatar || '/default-avatar.png'} alt="" className="w-10 h-10 rounded-full object-cover" />
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
    </div>
  );
};

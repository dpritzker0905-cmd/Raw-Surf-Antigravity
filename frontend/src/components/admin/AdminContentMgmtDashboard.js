import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient, { BACKEND_URL } from '../../lib/apiClient';
import { Image, Key, Star, Newspaper, Search,
  Loader2, Plus, Edit2, Globe,
  ChevronLeft, ChevronRight
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';


/**
 * Admin Content Management Dashboard
 * - Featured content curation
 * - Banner management
 * - SEO settings for spots
 * - API key management
 * - Scheduled reports
 * - Changelog
 */
export const AdminContentMgmtDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('featured');
  const [loading, setLoading] = useState(true);
  
  // Featured Content
  const [featuredContent, setFeaturedContent] = useState([]);
  const [showFeaturedForm, setShowFeaturedForm] = useState(false);
  const [featuredForm, setFeaturedForm] = useState({
    content_type: 'post', content_id: '', display_position: 'homepage', priority: 1
  });
  
  // Banners
  const [banners, setBanners] = useState([]);
  const [showBannerForm, setShowBannerForm] = useState(false);
  const [bannerForm, setBannerForm] = useState({
    title: '', image_url: '', link_url: '', position: 'top', target_audience: 'all'
  });
  
  // SEO
  const [seoSpots, setSeoSpots] = useState([]);
  const [seoTotal, setSeoTotal] = useState(0);
  const [seoPage, setSeoPage] = useState(0);
  const [seoSearch, setSeoSearch] = useState('');
  const [selectedSeoSpot, setSelectedSeoSpot] = useState(null);
  const [seoForm, setSeoForm] = useState({ meta_title: '', meta_description: '', slug: '' });
  const SEO_PAGE_SIZE = 15;
  
  // API Keys
  const [apiKeys, setApiKeys] = useState([]);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [apiKeyForm, setApiKeyForm] = useState({ name: '', permissions: 'read', rate_limit: 1000 });
  
  // Changelog
  const [changelog, setChangelog] = useState([]);
  const [showChangelogForm, setShowChangelogForm] = useState(false);
  const [changelogForm, setChangelogForm] = useState({
    version: '', title: '', description: '', change_type: 'feature'
  });

  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';

  useEffect(() => {
    if (user?.id) {
      fetchDataForTab();
    }
  }, [user?.id, activeTab, seoPage, seoSearch]);

  const fetchDataForTab = async () => {
    setLoading(true);
    try {
      if (activeTab === 'featured') {
        const response = await apiClient.get(`/admin/content/featured?admin_id=${user.id}`);
        setFeaturedContent(response.data.items || []);
      } else if (activeTab === 'banners') {
        const response = await apiClient.get(`/admin/content/banners?admin_id=${user.id}`);
        setBanners(response.data.banners || []);
      } else if (activeTab === 'seo') {
        const response = await apiClient.get(`/admin/content/seo/spots?admin_id=${user.id}&limit=${SEO_PAGE_SIZE}&offset=${seoPage * SEO_PAGE_SIZE}${seoSearch ? `&search=${encodeURIComponent(seoSearch)}` : ''}`);
        setSeoSpots(response.data.spots || []);
        setSeoTotal(response.data.total || 0);
      } else if (activeTab === 'api-keys') {
        const response = await apiClient.get(`/admin/tools/api-keys?admin_id=${user.id}`);
        setApiKeys(response.data.api_keys || []);
      } else if (activeTab === 'changelog') {
        const response = await apiClient.get(`/admin/tools/changelog?admin_id=${user.id}`);
        setChangelog(response.data.entries || []);
      }
    } catch (error) {
      logger.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Featured Content handlers
  const handleCreateFeatured = async () => {
    if (!featuredForm.content_id) {
      toast.error('Please provide content ID');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/content/featured?admin_id=${user.id}`, featuredForm);
      toast.success('Featured content added');
      setShowFeaturedForm(false);
      setFeaturedForm({ content_type: 'post', content_id: '', display_position: 'homepage', priority: 1 });
      fetchDataForTab();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to add featured content');
    } finally {
      setActionLoading(false);
    }
  };

  // Banner handlers
  const handleCreateBanner = async () => {
    if (!bannerForm.title || !bannerForm.image_url) {
      toast.error('Please fill required fields');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/content/banners?admin_id=${user.id}`, bannerForm);
      toast.success('Banner created');
      setShowBannerForm(false);
      setBannerForm({ title: '', image_url: '', link_url: '', position: 'top', target_audience: 'all' });
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to create banner');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleBanner = async (bannerId) => {
    try {
      await apiClient.put(`/admin/content/banners/${bannerId}/toggle?admin_id=${user.id}`);
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to toggle banner');
    }
  };

  // SEO handlers
  const handleUpdateSeo = async () => {
    if (!selectedSeoSpot) return;
    setActionLoading(true);
    try {
      await apiClient.put(`/admin/content/seo/spots/${selectedSeoSpot.id}?admin_id=${user.id}`, seoForm);
      toast.success('SEO updated');
      setSelectedSeoSpot(null);
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to update SEO');
    } finally {
      setActionLoading(false);
    }
  };

  // API Key handlers
  const handleCreateApiKey = async () => {
    if (!apiKeyForm.name) {
      toast.error('Please provide a name');
      return;
    }
    setActionLoading(true);
    try {
      const response = await apiClient.post(`/admin/tools/api-keys?admin_id=${user.id}`, apiKeyForm);
      toast.success('API key created');
      // Show the key once
      navigator.clipboard.writeText(response.data.key);
      toast.info('Key copied to clipboard');
      setShowApiKeyForm(false);
      setApiKeyForm({ name: '', permissions: 'read', rate_limit: 1000 });
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to create API key');
    } finally {
      setActionLoading(false);
    }
  };

  // Changelog handlers
  const handleCreateChangelog = async () => {
    if (!changelogForm.version || !changelogForm.title) {
      toast.error('Please fill required fields');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/tools/changelog?admin_id=${user.id}`, changelogForm);
      toast.success('Changelog entry created');
      setShowChangelogForm(false);
      setChangelogForm({ version: '', title: '', description: '', change_type: 'feature' });
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to create changelog');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePublishChangelog = async (entryId) => {
    try {
      await apiClient.put(`/admin/tools/changelog/${entryId}/publish?admin_id=${user.id}`);
      toast.success('Published');
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to publish');
    }
  };

  const getChangeTypeColor = (type) => {
    switch (type) {
      case 'feature': return 'bg-green-500/20 text-green-400';
      case 'improvement': return 'bg-blue-500/20 text-blue-400';
      case 'bugfix': return 'bg-yellow-500/20 text-yellow-400';
      case 'breaking': return 'bg-red-500/20 text-red-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-content-mgmt-dashboard">
      {/* Tab Navigation */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          { id: 'featured', label: 'Featured', icon: Star },
          { id: 'banners', label: 'Banners', icon: Image },
          { id: 'seo', label: 'SEO', icon: Globe },
          { id: 'api-keys', label: 'API Keys', icon: Key },
          { id: 'changelog', label: 'Changelog', icon: Newspaper }
        ].map(tab => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'bg-cyan-500 hover:bg-cyan-600' : ''}
          >
            <tab.icon className="w-4 h-4 mr-1" />
            {tab.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <>
          {/* FEATURED TAB */}
          {activeTab === 'featured' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>Featured Content</CardTitle>
                <Button size="sm" onClick={() => setShowFeaturedForm(true)} className="bg-yellow-500 hover:bg-yellow-600">
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </CardHeader>
              <CardContent>
                {featuredContent.length === 0 ? (
                  <div className="text-center py-8">
                    <Star className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">No featured content</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {featuredContent.map(item => (
                      <div key={item.id} className="p-3 bg-zinc-800/50 rounded-lg flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-[10px]">{item.content_type}</Badge>
                            <Badge className="text-[10px] bg-zinc-700">{item.display_position}</Badge>
                          </div>
                          <p className={`text-sm ${textClass}`}>ID: {item.content_id}</p>
                          <p className="text-xs text-gray-500">Priority: {item.priority}</p>
                        </div>
                        <Switch checked={item.is_active} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* BANNERS TAB */}
          {activeTab === 'banners' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>Promotional Banners</CardTitle>
                <Button size="sm" onClick={() => setShowBannerForm(true)} className="bg-purple-500 hover:bg-purple-600">
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </CardHeader>
              <CardContent>
                {banners.length === 0 ? (
                  <div className="text-center py-8">
                    <Image className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">No banners</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {banners.map(banner => (
                      <div key={banner.id} className="p-3 bg-zinc-800/50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex gap-3">
                            {banner.image_url && (
                              <img src={getFullUrl(banner.image_url)} alt={banner.title} className="w-20 h-12 object-cover rounded" />
                            )}
                            <div>
                              <p className={`font-medium ${textClass}`}>{banner.title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-[10px]">{banner.position}</Badge>
                                <Badge className="text-[10px] bg-zinc-700">{banner.target_audience}</Badge>
                              </div>
                            </div>
                          </div>
                          <Switch checked={banner.is_active} onCheckedChange={() => handleToggleBanner(banner.id)} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* SEO TAB */}
          {activeTab === 'seo' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <CardTitle className={`text-sm ${textClass}`}>Spot SEO Settings ({seoTotal} spots)</CardTitle>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      value={seoSearch}
                      onChange={(e) => { setSeoSearch(e.target.value); setSeoPage(0); }}
                      placeholder="Search spots..."
                      className="pl-9 bg-zinc-800 border-zinc-700"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {seoSpots.length === 0 ? (
                  <div className="text-center py-8">
                    <Globe className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">{seoSearch ? 'No spots match your search' : 'No spots to configure'}</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {seoSpots.map(spot => (
                        <div key={spot.id} className="p-3 bg-zinc-800/50 rounded-lg flex items-center justify-between">
                          <div>
                            <p className={`font-medium ${textClass}`}>{spot.name}</p>
                            <p className="text-xs text-gray-500">{spot.region}, {spot.country}</p>
                            {spot.seo_score !== undefined && (
                              <Badge className={`text-[10px] mt-1 ${
                                spot.seo_score >= 80 ? 'bg-green-500/20 text-green-400' :
                                spot.seo_score >= 50 ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-red-500/20 text-red-400'
                              }`}>SEO: {spot.seo_score}</Badge>
                            )}
                          </div>
                          <Button size="sm" variant="outline" onClick={() => {
                            setSelectedSeoSpot(spot);
                            setSeoForm({
                              meta_title: spot.meta_title || '',
                              meta_description: spot.meta_description || '',
                              slug: spot.slug || ''
                            });
                          }}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    {/* Pagination */}
                    {seoTotal > SEO_PAGE_SIZE && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-800">
                        <p className="text-xs text-gray-500">
                          Showing {seoPage * SEO_PAGE_SIZE + 1}-{Math.min((seoPage + 1) * SEO_PAGE_SIZE, seoTotal)} of {seoTotal}
                        </p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={seoPage === 0}
                            onClick={() => setSeoPage(p => Math.max(0, p - 1))}
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={(seoPage + 1) * SEO_PAGE_SIZE >= seoTotal}
                            onClick={() => setSeoPage(p => p + 1)}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* API KEYS TAB */}
          {activeTab === 'api-keys' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>API Keys</CardTitle>
                <Button size="sm" onClick={() => setShowApiKeyForm(true)} className="bg-green-500 hover:bg-green-600">
                  <Plus className="w-4 h-4 mr-1" /> Generate
                </Button>
              </CardHeader>
              <CardContent>
                {apiKeys.length === 0 ? (
                  <div className="text-center py-8">
                    <Key className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">No API keys</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {apiKeys.map(key => (
                      <div key={key.id} className="p-3 bg-zinc-800/50 rounded-lg flex items-center justify-between">
                        <div>
                          <p className={`font-medium ${textClass}`}>{key.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <code className="text-xs text-gray-500 bg-zinc-900 px-2 py-0.5 rounded">{key.key_prefix}...</code>
                            <Badge variant="outline" className="text-[10px]">{key.permissions}</Badge>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Calls: {key.total_calls} • Limit: {key.rate_limit}/day
                          </p>
                        </div>
                        <Switch checked={key.is_active} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* CHANGELOG TAB */}
          {activeTab === 'changelog' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>Changelog</CardTitle>
                <Button size="sm" onClick={() => setShowChangelogForm(true)} className="bg-blue-500 hover:bg-blue-600">
                  <Plus className="w-4 h-4 mr-1" /> Add Entry
                </Button>
              </CardHeader>
              <CardContent>
                {changelog.length === 0 ? (
                  <div className="text-center py-8">
                    <Newspaper className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">No changelog entries</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {changelog.map(entry => (
                      <div key={entry.id} className="p-3 bg-zinc-800/50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className="text-[10px] bg-zinc-700">v{entry.version}</Badge>
                              <Badge className={`text-[10px] ${getChangeTypeColor(entry.change_type)}`}>
                                {entry.change_type}
                              </Badge>
                              {!entry.is_published && (
                                <Badge className="text-[10px] bg-yellow-500/20 text-yellow-400">Draft</Badge>
                              )}
                            </div>
                            <p className={`font-medium ${textClass}`}>{entry.title}</p>
                            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{entry.description}</p>
                          </div>
                          {!entry.is_published && (
                            <Button size="sm" variant="outline" onClick={() => handlePublishChangelog(entry.id)}>
                              Publish
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Featured Form Modal */}
      <Dialog open={showFeaturedForm} onOpenChange={setShowFeaturedForm}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Add Featured Content</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Content Type</label>
              <Select value={featuredForm.content_type} onValueChange={(v) => setFeaturedForm({...featuredForm, content_type: v})}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="post">Post</SelectItem>
                  <SelectItem value="spot">Spot</SelectItem>
                  <SelectItem value="photographer">Photographer</SelectItem>
                  <SelectItem value="gallery">Gallery Item</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Content ID</label>
              <Input value={featuredForm.content_id} onChange={(e) => setFeaturedForm({...featuredForm, content_id: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" placeholder="UUID of the content" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">Position</label>
                <Select value={featuredForm.display_position} onValueChange={(v) => setFeaturedForm({...featuredForm, display_position: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="homepage">Homepage</SelectItem>
                    <SelectItem value="explore">Explore</SelectItem>
                    <SelectItem value="sidebar">Sidebar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Priority</label>
                <Input type="number" value={featuredForm.priority} onChange={(e) => setFeaturedForm({...featuredForm, priority: parseInt(e.target.value) || 1})} className="bg-zinc-800 border-zinc-700 mt-1" min={1} max={100} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFeaturedForm(false)}>Cancel</Button>
            <Button onClick={handleCreateFeatured} disabled={actionLoading} className="bg-yellow-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Banner Form Modal */}
      <Dialog open={showBannerForm} onOpenChange={setShowBannerForm}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Create Banner</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Title</label>
              <Input value={bannerForm.title} onChange={(e) => setBannerForm({...bannerForm, title: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Image URL</label>
              <Input value={bannerForm.image_url} onChange={(e) => setBannerForm({...bannerForm, image_url: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" placeholder="https://..." />
            </div>
            <div>
              <label className="text-xs text-gray-500">Link URL (optional)</label>
              <Input value={bannerForm.link_url} onChange={(e) => setBannerForm({...bannerForm, link_url: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">Position</label>
                <Select value={bannerForm.position} onValueChange={(v) => setBannerForm({...bannerForm, position: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top">Top</SelectItem>
                    <SelectItem value="sidebar">Sidebar</SelectItem>
                    <SelectItem value="bottom">Bottom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Audience</label>
                <Select value={bannerForm.target_audience} onValueChange={(v) => setBannerForm({...bannerForm, target_audience: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    <SelectItem value="free">Free Users</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBannerForm(false)}>Cancel</Button>
            <Button onClick={handleCreateBanner} disabled={actionLoading} className="bg-purple-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SEO Edit Modal */}
      <Dialog open={!!selectedSeoSpot} onOpenChange={() => setSelectedSeoSpot(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Edit SEO - {selectedSeoSpot?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Meta Title</label>
              <Input value={seoForm.meta_title} onChange={(e) => setSeoForm({...seoForm, meta_title: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" placeholder="Max 60 characters" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Meta Description</label>
              <Textarea value={seoForm.meta_description} onChange={(e) => setSeoForm({...seoForm, meta_description: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" rows={3} placeholder="Max 160 characters" />
            </div>
            <div>
              <label className="text-xs text-gray-500">URL Slug</label>
              <Input value={seoForm.slug} onChange={(e) => setSeoForm({...seoForm, slug: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" placeholder="pipeline-banzai" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedSeoSpot(null)}>Cancel</Button>
            <Button onClick={handleUpdateSeo} disabled={actionLoading} className="bg-green-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API Key Form Modal */}
      <Dialog open={showApiKeyForm} onOpenChange={setShowApiKeyForm}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Name</label>
              <Input value={apiKeyForm.name} onChange={(e) => setApiKeyForm({...apiKeyForm, name: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" placeholder="My App" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">Permissions</label>
                <Select value={apiKeyForm.permissions} onValueChange={(v) => setApiKeyForm({...apiKeyForm, permissions: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="read">Read Only</SelectItem>
                    <SelectItem value="write">Read/Write</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Rate Limit (calls/day)</label>
                <Input type="number" value={apiKeyForm.rate_limit} onChange={(e) => setApiKeyForm({...apiKeyForm, rate_limit: parseInt(e.target.value) || 1000})} className="bg-zinc-800 border-zinc-700 mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApiKeyForm(false)}>Cancel</Button>
            <Button onClick={handleCreateApiKey} disabled={actionLoading} className="bg-green-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Changelog Form Modal */}
      <Dialog open={showChangelogForm} onOpenChange={setShowChangelogForm}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Add Changelog Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">Version</label>
                <Input value={changelogForm.version} onChange={(e) => setChangelogForm({...changelogForm, version: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" placeholder="1.2.0" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Type</label>
                <Select value={changelogForm.change_type} onValueChange={(v) => setChangelogForm({...changelogForm, change_type: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feature">Feature</SelectItem>
                    <SelectItem value="improvement">Improvement</SelectItem>
                    <SelectItem value="bugfix">Bug Fix</SelectItem>
                    <SelectItem value="breaking">Breaking Change</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500">Title</label>
              <Input value={changelogForm.title} onChange={(e) => setChangelogForm({...changelogForm, title: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Description</label>
              <Textarea value={changelogForm.description} onChange={(e) => setChangelogForm({...changelogForm, description: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangelogForm(false)}>Cancel</Button>
            <Button onClick={handleCreateChangelog} disabled={actionLoading} className="bg-blue-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminContentMgmtDashboard;

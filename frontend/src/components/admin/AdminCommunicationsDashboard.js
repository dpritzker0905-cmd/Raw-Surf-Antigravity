import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import axios from 'axios';
import {
  Megaphone, Mail, Send, Bell, Users, Clock, Search,
  Loader2, Plus, RefreshCw, Check, X, Edit2, Copy, Trash2
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

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Admin Communications Dashboard
 * - Announcements management
 * - Message templates
 * - Bulk email/notification campaigns
 */
export const AdminCommunicationsDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('announcements');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  
  // Announcements
  const [announcements, setAnnouncements] = useState([]);
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({
    title: '', content: '', type: 'info', target_audience: 'all', priority: 1
  });
  
  // Templates
  const [templates, setTemplates] = useState([]);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: '', subject: '', body: '', template_type: 'email', category: 'general'
  });
  
  // Campaigns
  const [campaigns, setCampaigns] = useState([]);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    name: '', subject: '', body: '', channel: 'email', target_audience: 'all', template_id: ''
  });

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';

  useEffect(() => {
    if (user?.id) {
      fetchStats();
      fetchDataForTab();
    }
  }, [user?.id, activeTab]);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/admin/communication/stats?admin_id=${user.id}&days=30`);
      setStats(response.data);
    } catch (error) {
      logger.error('Failed to load stats:', error);
    }
  };

  const fetchDataForTab = async () => {
    setLoading(true);
    try {
      if (activeTab === 'announcements') {
        const response = await axios.get(`${API}/admin/announcements?admin_id=${user.id}`);
        setAnnouncements(response.data.announcements || []);
      } else if (activeTab === 'templates') {
        const response = await axios.get(`${API}/admin/message-templates?admin_id=${user.id}`);
        setTemplates(response.data.templates || []);
      } else if (activeTab === 'campaigns') {
        const response = await axios.get(`${API}/admin/bulk-campaigns?admin_id=${user.id}`);
        setCampaigns(response.data.campaigns || []);
      }
    } catch (error) {
      logger.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Announcements handlers
  const handleCreateAnnouncement = async () => {
    if (!announcementForm.title || !announcementForm.content) {
      toast.error('Please fill required fields');
      return;
    }
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/announcements?admin_id=${user.id}`, announcementForm);
      toast.success('Announcement created');
      setShowAnnouncementForm(false);
      setAnnouncementForm({ title: '', content: '', type: 'info', target_audience: 'all', priority: 1 });
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to create announcement');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleAnnouncement = async (id) => {
    try {
      await axios.put(`${API}/admin/announcements/${id}/toggle?admin_id=${user.id}`);
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to toggle announcement');
    }
  };

  // Template handlers
  const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.body) {
      toast.error('Please fill required fields');
      return;
    }
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/message-templates?admin_id=${user.id}`, templateForm);
      toast.success('Template created');
      setShowTemplateForm(false);
      setTemplateForm({ name: '', subject: '', body: '', template_type: 'email', category: 'general' });
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to create template');
    } finally {
      setActionLoading(false);
    }
  };

  // Campaign handlers
  const handleCreateCampaign = async () => {
    if (!campaignForm.name || !campaignForm.subject) {
      toast.error('Please fill required fields');
      return;
    }
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/bulk-campaigns?admin_id=${user.id}`, campaignForm);
      toast.success('Campaign created');
      setShowCampaignForm(false);
      setCampaignForm({ name: '', subject: '', body: '', channel: 'email', target_audience: 'all', template_id: '' });
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to create campaign');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendCampaign = async (campaignId) => {
    if (!confirm('Send this campaign to all target users?')) return;
    setActionLoading(true);
    try {
      const response = await axios.post(`${API}/admin/bulk-campaigns/${campaignId}/send?admin_id=${user.id}`);
      toast.success(`Sent to ${response.data.total_sent} users`);
      fetchDataForTab();
      fetchStats();
    } catch (error) {
      toast.error('Failed to send campaign');
    } finally {
      setActionLoading(false);
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'info': return 'bg-blue-500/20 text-blue-400';
      case 'warning': return 'bg-yellow-500/20 text-yellow-400';
      case 'success': return 'bg-green-500/20 text-green-400';
      case 'urgent': return 'bg-red-500/20 text-red-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  // Filtered data based on search
  const filteredAnnouncements = useMemo(() => {
    if (!searchQuery) return announcements;
    const q = searchQuery.toLowerCase();
    return announcements.filter(a => 
      a.title?.toLowerCase().includes(q) || 
      a.content?.toLowerCase().includes(q)
    );
  }, [announcements, searchQuery]);

  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return templates;
    const q = searchQuery.toLowerCase();
    return templates.filter(t => 
      t.name?.toLowerCase().includes(q) || 
      t.subject?.toLowerCase().includes(q)
    );
  }, [templates, searchQuery]);

  const filteredCampaigns = useMemo(() => {
    if (!searchQuery) return campaigns;
    const q = searchQuery.toLowerCase();
    return campaigns.filter(c => 
      c.name?.toLowerCase().includes(q) || 
      c.subject?.toLowerCase().includes(q)
    );
  }, [campaigns, searchQuery]);

  return (
    <div className="space-y-4" data-testid="admin-communications-dashboard">
      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className={`${cardBgClass} border-blue-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Active Announcements</p>
              <p className="text-2xl font-bold text-blue-400">{stats.active_announcements}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-green-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Emails Sent (30d)</p>
              <p className="text-2xl font-bold text-green-400">{stats.emails_sent}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-purple-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Avg Open Rate</p>
              <p className="text-2xl font-bold text-purple-400">{stats.avg_open_rate}%</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-cyan-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Templates</p>
              <p className="text-2xl font-bold text-cyan-400">{stats.total_templates}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex flex-col sm:flex-row gap-2 justify-between">
        <div className="flex gap-2">
          {[
            { id: 'announcements', label: 'Announcements', icon: Megaphone },
            { id: 'templates', label: 'Templates', icon: Mail },
            { id: 'campaigns', label: 'Campaigns', icon: Send }
          ].map(tab => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setActiveTab(tab.id); setSearchQuery(''); }}
              className={activeTab === tab.id ? 'bg-cyan-500 hover:bg-cyan-600' : ''}
            >
              <tab.icon className="w-4 h-4 mr-1" />
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className="pl-9 bg-zinc-800 border-zinc-700"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <>
          {/* ANNOUNCEMENTS TAB */}
          {activeTab === 'announcements' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>System Announcements ({filteredAnnouncements.length})</CardTitle>
                <Button size="sm" onClick={() => setShowAnnouncementForm(true)} className="bg-blue-500 hover:bg-blue-600">
                  <Plus className="w-4 h-4 mr-1" /> New
                </Button>
              </CardHeader>
              <CardContent>
                {filteredAnnouncements.length === 0 ? (
                  <div className="text-center py-8">
                    <Megaphone className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">{searchQuery ? 'No matches found' : 'No announcements'}</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {filteredAnnouncements.map(ann => (
                      <div key={ann.id} className="p-3 bg-zinc-800/50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={`text-[10px] ${getTypeColor(ann.type)}`}>{ann.type}</Badge>
                              <Badge variant="outline" className="text-[10px]">{ann.target_audience}</Badge>
                            </div>
                            <h4 className={`font-medium ${textClass}`}>{ann.title}</h4>
                            <p className="text-sm text-gray-400 mt-1 line-clamp-2">{ann.content}</p>
                          </div>
                          <Switch checked={ann.is_active} onCheckedChange={() => handleToggleAnnouncement(ann.id)} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* TEMPLATES TAB */}
          {activeTab === 'templates' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>Message Templates ({filteredTemplates.length})</CardTitle>
                <Button size="sm" onClick={() => setShowTemplateForm(true)} className="bg-purple-500 hover:bg-purple-600">
                  <Plus className="w-4 h-4 mr-1" /> New
                </Button>
              </CardHeader>
              <CardContent>
                {filteredTemplates.length === 0 ? (
                  <div className="text-center py-8">
                    <Mail className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">{searchQuery ? 'No matches found' : 'No templates'}</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {filteredTemplates.map(tpl => (
                      <div key={tpl.id} className="p-3 bg-zinc-800/50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px]">{tpl.template_type}</Badge>
                              <Badge className="text-[10px] bg-zinc-700">{tpl.category}</Badge>
                            </div>
                            <h4 className={`font-medium ${textClass}`}>{tpl.name}</h4>
                            {tpl.subject && <p className="text-xs text-gray-500">{tpl.subject}</p>}
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(tpl.body); toast.success('Copied!'); }}>
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* CAMPAIGNS TAB */}
          {activeTab === 'campaigns' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>Bulk Campaigns ({filteredCampaigns.length})</CardTitle>
                <Button size="sm" onClick={() => setShowCampaignForm(true)} className="bg-green-500 hover:bg-green-600">
                  <Plus className="w-4 h-4 mr-1" /> New
                </Button>
              </CardHeader>
              <CardContent>
                {filteredCampaigns.length === 0 ? (
                  <div className="text-center py-8">
                    <Send className="w-10 h-10 mx-auto text-gray-500 mb-2" />
                    <p className="text-gray-500">{searchQuery ? 'No matches found' : 'No campaigns'}</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {filteredCampaigns.map(camp => (
                      <div key={camp.id} className="p-3 bg-zinc-800/50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={`text-[10px] ${
                                camp.status === 'sent' ? 'bg-green-500/20 text-green-400' :
                                camp.status === 'draft' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-gray-500/20 text-gray-400'
                              }`}>{camp.status}</Badge>
                              <Badge variant="outline" className="text-[10px]">{camp.channel}</Badge>
                            </div>
                            <h4 className={`font-medium ${textClass}`}>{camp.name}</h4>
                            <p className="text-xs text-gray-500 mt-1">{camp.subject}</p>
                            {camp.total_sent > 0 && (
                              <p className="text-xs text-gray-400 mt-1">
                                Sent: {camp.total_sent} • Open: {camp.total_opened} ({camp.open_rate}%)
                              </p>
                            )}
                          </div>
                          {camp.status === 'draft' && (
                            <Button size="sm" onClick={() => handleSendCampaign(camp.id)} disabled={actionLoading} className="bg-green-500 hover:bg-green-600">
                              <Send className="w-4 h-4 mr-1" /> Send
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

      {/* Announcement Form Modal */}
      <Dialog open={showAnnouncementForm} onOpenChange={setShowAnnouncementForm}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Create Announcement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Title</label>
              <Input value={announcementForm.title} onChange={(e) => setAnnouncementForm({...announcementForm, title: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Content</label>
              <Textarea value={announcementForm.content} onChange={(e) => setAnnouncementForm({...announcementForm, content: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">Type</label>
                <Select value={announcementForm.type} onValueChange={(v) => setAnnouncementForm({...announcementForm, type: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Audience</label>
                <Select value={announcementForm.target_audience} onValueChange={(v) => setAnnouncementForm({...announcementForm, target_audience: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    <SelectItem value="photographers">Photographers</SelectItem>
                    <SelectItem value="surfers">Surfers</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAnnouncementForm(false)}>Cancel</Button>
            <Button onClick={handleCreateAnnouncement} disabled={actionLoading} className="bg-blue-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Form Modal */}
      <Dialog open={showTemplateForm} onOpenChange={setShowTemplateForm}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Create Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Name</label>
              <Input value={templateForm.name} onChange={(e) => setTemplateForm({...templateForm, name: e.target.value})} placeholder="Welcome Email" className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Subject</label>
              <Input value={templateForm.subject} onChange={(e) => setTemplateForm({...templateForm, subject: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Body</label>
              <Textarea value={templateForm.body} onChange={(e) => setTemplateForm({...templateForm, body: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" rows={4} placeholder="Use {{name}}, {{email}} for placeholders" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">Type</label>
                <Select value={templateForm.template_type} onValueChange={(v) => setTemplateForm({...templateForm, template_type: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="push">Push Notification</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Category</label>
                <Select value={templateForm.category} onValueChange={(v) => setTemplateForm({...templateForm, category: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="transactional">Transactional</SelectItem>
                    <SelectItem value="support">Support</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateForm(false)}>Cancel</Button>
            <Button onClick={handleCreateTemplate} disabled={actionLoading} className="bg-purple-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Campaign Form Modal */}
      <Dialog open={showCampaignForm} onOpenChange={setShowCampaignForm}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500">Campaign Name</label>
              <Input value={campaignForm.name} onChange={(e) => setCampaignForm({...campaignForm, name: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Subject</label>
              <Input value={campaignForm.subject} onChange={(e) => setCampaignForm({...campaignForm, subject: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Body</label>
              <Textarea value={campaignForm.body} onChange={(e) => setCampaignForm({...campaignForm, body: e.target.value})} className="bg-zinc-800 border-zinc-700 mt-1" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500">Channel</label>
                <Select value={campaignForm.channel} onValueChange={(v) => setCampaignForm({...campaignForm, channel: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="push">Push</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Audience</label>
                <Select value={campaignForm.target_audience} onValueChange={(v) => setCampaignForm({...campaignForm, target_audience: v})}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    <SelectItem value="active">Active Users</SelectItem>
                    <SelectItem value="photographers">Photographers</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCampaignForm(false)}>Cancel</Button>
            <Button onClick={handleCreateCampaign} disabled={actionLoading} className="bg-green-500">
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminCommunicationsDashboard;

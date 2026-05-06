import React, { useState, useEffect, useRef, useCallback } from 'react';

import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { usePersona, ALL_PERSONAS, getExpandedRoleInfo } from '../contexts/PersonaContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import {

  Shield, Zap, Users, DollarSign, Search, Ban, CheckCircle, 
  Loader2, ChevronDown, ChevronLeft, ChevronRight, Eye, Trash2, UserX, UserCheck, 
  Crown, Trophy, Radio, MapPin, Camera, Play, Square, Image, Video, 
  Upload, X, Check, User, FileText, ArrowLeft, Settings, Activity,
  Megaphone, History, RefreshCw, TrendingUp, PieChart, BarChart3, Wallet, AlertCircle, Edit, BarChart2,
  Headphones, Server, Flag, Mail, Layout, Lock, KeyRound, Scale
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';

import { Button } from './ui/button';

import { Input } from './ui/input';

import { Textarea } from './ui/textarea';

import { Badge } from './ui/badge';

import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from './ui/dialog';

import { toast } from 'sonner';

import { AdminCompetitionVerification } from './AdminCompetitionVerification';

import { AdminPricingEditor } from './admin/AdminPricingEditor';

import { AdminPrecisionQueue } from './admin/AdminPrecisionQueue';

import { AdminSpotEditor } from './admin/AdminSpotEditor';

import { AdminUnifiedAnalytics } from './admin/AdminUnifiedAnalytics';

import { AdminModerationDashboard } from './admin/AdminModerationDashboard';

import { AdminP1Dashboard } from './admin/AdminP1Dashboard';

import { AdminSupportDashboard } from './admin/AdminSupportDashboard';

import { AdminSystemDashboard } from './admin/AdminSystemDashboard';

import { AdminFinanceDashboard } from './admin/AdminFinanceDashboard';

import { AdminContentModDashboard } from './admin/AdminContentModDashboard';

import { AdminCommunicationsDashboard } from './admin/AdminCommunicationsDashboard';

import { AdminContentMgmtDashboard } from './admin/AdminContentMgmtDashboard';

import logger from '../utils/logger';
import useAdminConsoleActions from '../hooks/useAdminConsoleActions';
import { AdControlsPanel } from './admin/AdControlsPanel';
import { AdminSpotsPanel } from './admin/AdminSpotsPanel';
import { getFullUrl } from '../utils/media';
import AdminOverviewTab from './admin/AdminOverviewTab';
import { AdminComplianceDashboard } from './admin/AdminComplianceDashboard';




/**
 * Unified Admin Console - Combines Admin Dashboard + God Mode
 * Single entry point for all admin functionality
 */
const UnifiedAdminConsole = () => {
  const { user } = useAuth();
  const _userId = user?.id;
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { 
    activePersona, 
    setPersona, 
    exitPersonaMode, 
    isGodMode, 
    enableGodMode 
  } = usePersona();

  // Tab state
  const [activeTab, setActiveTab] = useState('overview');
  
  // Data states
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [userToSuspend, setUserToSuspend] = useState(null);
  
  // Live Session Override states
  const [simulatePhotographers, setSimulatePhotographers] = useState([]);
  const [surfSpots, setSurfSpots] = useState([]);
  const [loadingPhotographers, setLoadingPhotographers] = useState(false);
  const [selectedPhotographer, setSelectedPhotographer] = useState('');
  const [selectedSpot, setSelectedSpot] = useState('');
  const [photographerSearch, setPhotographerSearch] = useState('');
  const [spotSearch, setSpotSearch] = useState('');
  const [sessionPrice, setSessionPrice] = useState('25');
  const [spotNotes, setSpotNotes] = useState('');
  const [conditionMedia, setConditionMedia] = useState(null);
  const [conditionMediaType, setConditionMediaType] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);
  const [forceStartLoading, setForceStartLoading] = useState(false);
  const [forceEndLoading, setForceEndLoading] = useState(null);
  const [_seedingSpots, _setSeedingSpots] = useState(false);
  const fileInputRef = useRef(null);

  // Site Access Control states
  const [siteSettings, setSiteSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Theme classes
  const isLight = theme === 'light';
  const bgClass = isLight ? 'bg-gray-50' : 'bg-background';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  // Redirect non-admins
  useEffect(() => {
    if (user && !user.is_admin) {
      toast.error('Admin access required');
      navigate('/settings');
    }
  }, [user, navigate]);

  // Auto-enable God Mode when accessing this page
  useEffect(() => {
    if (user?.is_admin && !isGodMode) {
      enableGodMode();
    }
  }, [user, isGodMode, enableGodMode]);

  // Fetch admin data
  const fetchData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const handle401 = (label) => (err) => {
        if (err?.response?.status === 401) {
          logger.warn(`[Admin] ${label}: 401 - token may be expired`);
        }
        return { data: null };
      };
      const [statsRes, usersRes, logsRes, settingsRes] = await Promise.all([
        apiClient.get(`/admin/stats`).catch(handle401('stats')),
        apiClient.get(`/admin/users?limit=50`).catch(handle401('users')),
        apiClient.get(`/admin/logs?limit=50`).catch(handle401('logs')),
        apiClient.get(`/admin/platform-settings`).catch(handle401('settings'))
      ]);
      
      // If ALL admin calls returned null, the token is likely expired
      if (!statsRes.data && !usersRes.data && !logsRes.data && !settingsRes.data) {
        toast.error('Admin session may have expired - try logging out and back in.', { duration: 5000 });
      }
      
      setStats(statsRes.data);
      setUsers(usersRes.data?.users || []);
      setLogs(logsRes.data || []);
      setSiteSettings(settingsRes.data || { access_code_enabled: false, access_code: '' });
    } catch (error) {
      logger.error('Admin data error:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Fetch session simulation data
  const fetchSessionData = useCallback(async () => {
    if (!user?.is_admin) return;
    setLoadingPhotographers(true);
    try {
      const [photosRes, spotsRes, sessionsRes] = await Promise.all([
        apiClient.get(`/admin/photographers`).catch(() => ({ data: [] })),
        apiClient.get(`/surf-spots`).catch(() => ({ data: [] })),
        apiClient.get(`/admin/active-sessions`).catch(() => ({ data: [] }))
      ]);
      setSimulatePhotographers(photosRes.data || []);
      setSurfSpots(spotsRes.data || []);
      setActiveSessions(sessionsRes.data || []);
    } catch (error) {
      logger.error('Failed to fetch simulation data:', error);
    } finally {
      setLoadingPhotographers(false);
    }
  }, [user?.is_admin]);

  useEffect(() => {
    if (user?.id) {
      fetchData();
      fetchSessionData();
    }
  }, [user?.id, fetchData, fetchSessionData]);

  // User management handlers
  const handleSearch = async () => {
    try {
      const response = await apiClient.get(
        `/admin/users?search=${searchQuery}&limit=50`
      );
      setUsers(response.data.users);
    } catch (error) {
      toast.error('Search failed');
    }
  };

  const handleSuspend = async () => {
    if (!userToSuspend || !suspendReason) return;
    try {
      await apiClient.post(
        `/admin/users/${userToSuspend.id}/suspend`,
        { reason: suspendReason }
      );
      toast.success(`${userToSuspend.email} suspended`);
      setShowSuspendModal(false);
      setSuspendReason('');
      setUserToSuspend(null);
      fetchData();
    } catch (error) {
      toast.error('Failed to suspend user');
    }
  };

  const handleUnsuspend = async (targetUser) => {
    try {
      await apiClient.post(
        `/admin/users/${targetUser.id}/unsuspend`
      );
      toast.success(`${targetUser.email} unsuspended`);
      fetchData();
    } catch (error) {
      toast.error('Failed to unsuspend user');
    }
  };

  const handleVerify = async (targetUser) => {
    try {
      await apiClient.patch(
        `/admin/users/${targetUser.id}`,
        { is_verified: !targetUser.is_verified }
      );
      toast.success(`Verification ${targetUser.is_verified ? 'removed' : 'added'}`);
      fetchData();
    } catch (error) {
      toast.error('Failed to update verification');
    }
  };

  const handleToggleAdmin = async (targetUser) => {
    try {
      if (targetUser.is_admin) {
        await apiClient.post(`/admin/revoke-admin/${targetUser.id}`);
      } else {
        await apiClient.post(`/admin/make-admin/${targetUser.id}`);
      }
      toast.success('Admin status updated');
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update admin status');
    }
  };

  // Site Access Control handler
  const updateSiteSettings = async (updates) => {
    setSavingSettings(true);
    try {
      await apiClient.put(`/admin/platform-settings`, updates);
      setSiteSettings(prev => ({ ...prev, ...updates }));
      toast.success('Settings saved');
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  // Session simulation handlers
  const handleMediaSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    
    if (!isVideo && !isImage) {
      toast.error('Please select an image or video file');
      return;
    }
    
    setConditionMediaType(isVideo ? 'video' : 'photo');
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setMediaPreview(e.target.result);
      setConditionMedia(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const clearMedia = () => {
    setConditionMedia(null);
    setConditionMediaType(null);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleForceStart = async () => {
    if (!selectedPhotographer || !selectedSpot) {
      toast.error('Please select both a photographer and a surf spot');
      return;
    }
    
    setForceStartLoading(true);
    try {
      const response = await apiClient.post(`/admin/force-start-session`, {
        photographer_id: selectedPhotographer,
        spot_id: selectedSpot,
        session_price: parseFloat(sessionPrice) || 25,
        condition_media: conditionMedia,
        condition_media_type: conditionMediaType,
        spot_notes: spotNotes
      });
      
      toast.success(response.data.message, {
        icon: <Radio className="w-4 h-4 text-red-500 animate-pulse" />
      });
      
      // Refresh data and reset form
      fetchSessionData();
      setSelectedPhotographer('');
      setSelectedSpot('');
      setSpotNotes('');
      clearMedia();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to force start session');
    } finally {
      setForceStartLoading(false);
    }
  };

  const handleForceEnd = async (photographerId) => {
    setForceEndLoading(photographerId);
    try {
      const response = await apiClient.post(`/admin/force-end-session/${photographerId}`);
      toast.success(response.data.message);
      fetchSessionData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to force end session');
    } finally {
      setForceEndLoading(null);
    }
  };

  // Persona handlers
  const handleSelectPersona = (persona) => {
    setPersona(persona.id);
    toast.success(`Now viewing as: ${persona.label}`, {
      icon: <Zap className="w-4 h-4 text-yellow-400" />
    });
  };

  const handleExitGodMode = () => {
    exitPersonaMode();
    toast.success('Exited God Mode - back to your real role');
  };

  // Filter functions
  const filteredPhotographers = simulatePhotographers.filter(p => 
    p.full_name?.toLowerCase().includes(photographerSearch.toLowerCase()) ||
    p.email?.toLowerCase().includes(photographerSearch.toLowerCase())
  );

  const filteredSpots = surfSpots.filter(s =>
    s.name?.toLowerCase().includes(spotSearch.toLowerCase()) ||
    s.region?.toLowerCase().includes(spotSearch.toLowerCase())
  );

  if (!user?.is_admin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center p-4">
        <Shield className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-foreground mb-2">Access Denied</h2>
        <p className="text-muted-foreground">You need admin privileges to access this page.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'access', label: 'Access Control', icon: Lock },
    { id: 'compliance', label: 'Compliance', icon: Scale },
    { id: 'moderation', label: 'Moderation', icon: Shield },
    { id: 'content-mod', label: 'Content Queue', icon: Flag },
    { id: 'verification', label: 'Verification', icon: UserCheck },
    { id: 'analytics', label: 'Analytics', icon: BarChart2 },
    { id: 'support', label: 'Support', icon: Headphones },
    { id: 'communications', label: 'Comms', icon: Mail },
    { id: 'system', label: 'System', icon: Server },
    { id: 'finance', label: 'Finance', icon: Wallet },
    { id: 'content-mgmt', label: 'Content', icon: Layout },
    { id: 'persona', label: 'Persona', icon: Zap },
    { id: 'sessions', label: 'Live Sessions', icon: Radio },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'spots', label: 'Spots', icon: MapPin },
    { id: 'map-editor', label: 'Map Editor', icon: Edit },
    { id: 'queue', label: 'Queue', icon: AlertCircle },
    { id: 'pricing', label: 'Pricing', icon: DollarSign },
    { id: 'ads', label: 'Ads', icon: Megaphone },
    { id: 'competition', label: 'Competition', icon: Trophy },
    { id: 'logs', label: 'Logs', icon: History },
  ];

  return (
    <div className={`min-h-screen ${bgClass} pb-20`} data-testid="unified-admin-console">
      {/* Header */}
      <div className={`sticky top-0 z-[1100] ${isLight ? 'bg-white/90 border-b border-gray-200' : 'bg-black/90 border-b border-border'} backdrop-blur-lg`}>
        <div className="flex items-center justify-between p-4">
          <button aria-label="Go back" 
            onClick={() => navigate(-1)}
            className={`flex items-center gap-2 ${isLight ? 'text-gray-500 hover:text-black' : 'text-muted-foreground hover:text-foreground'} transition-colors`}
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
          <h1 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-500" />
            Admin Console
          </h1>
          <div className="flex items-center gap-2">
            <Button aria-label="Refresh"
              variant="ghost"
              size="sm"
              onClick={() => { fetchData(); fetchSessionData(); }}
              className={`${isLight ? 'text-gray-500 hover:text-black hover:bg-gray-100' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Current Persona Banner */}
        {activePersona && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-yellow-400">
                  Viewing as: <span className="font-bold">{getExpandedRoleInfo(activePersona)?.label || activePersona}</span>
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleExitGodMode}
                className="text-red-400 hover:bg-red-500/10 h-6 px-2"
              >
                <X className="w-3 h-3 mr-1" />
                Exit
              </Button>
            </div>
          </div>
        )}
        
        {/* Tabs - Horizontally scrollable with scroll buttons */}
        <div className="relative group border-b border-transparent">
          {/* Left scroll button */}
          <button 
            onClick={() => {
              const container = document.getElementById('admin-tabs-container');
              if (container) container.scrollBy({ left: -200, behavior: 'smooth' });
            }}
            className={`absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r ${isLight ? 'from-white via-white/80' : 'from-black via-black/80'} to-transparent z-20 flex items-center justify-start pl-1 opacity-70 hover:opacity-100 transition-opacity`}
            aria-label="Scroll left"
          >
            <ChevronLeft className={`w-5 h-5 ${isLight ? 'text-black' : 'text-foreground'}`} />
          </button>
          
          {/* Right scroll button */}
          <button 
            onClick={() => {
              const container = document.getElementById('admin-tabs-container');
              if (container) container.scrollBy({ left: 200, behavior: 'smooth' });
            }}
            className={`absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l ${isLight ? 'from-white via-white/80' : 'from-black via-black/80'} to-transparent z-20 flex items-center justify-end pr-1 opacity-70 hover:opacity-100 transition-opacity`}
            aria-label="Scroll right"
          >
            <ChevronRight className={`w-5 h-5 ${isLight ? 'text-black' : 'text-foreground'}`} />
          </button>
          
          <div 
            id="admin-tabs-container"
            className="flex overflow-x-auto px-12 pb-2 gap-1 scroll-smooth scrollbar-none"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                    isActive
                      ? 'bg-red-500 text-white'
                      : isLight 
                        ? 'bg-gray-100 text-gray-500 hover:text-black hover:bg-gray-200' 
                        : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                data-testid={`admin-tab-${tab.id}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-4">
        {/* Overview Tab */}
        {activeTab === 'overview' && stats && (
          <AdminOverviewTab
            stats={stats}
            cardBgClass={cardBgClass}
            textClass={textClass}
            textSecondary={textSecondary}
            isLight={isLight}
          />
        )}

        {/* Access Control Tab - Site Access Code */}
        {activeTab === 'access' && (
          <Card className={cardBgClass}>
            <CardHeader>
              <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                <Lock className="w-4 h-4 text-cyan-400" />
                Site Access Control
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Require access code to view the site during private beta
              </p>
            </CardHeader>
            <CardContent>
              {!siteSettings ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Enable/Disable Toggle */}
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div>
                      <p className="text-foreground font-medium">Access Code Required</p>
                      <p className="text-muted-foreground text-sm">
                        {siteSettings.access_code_enabled 
                          ? 'Visitors must enter code to access the site' 
                          : 'Site is publicly accessible'}
                      </p>
                    </div>
                    <button
                      onClick={() => updateSiteSettings({ access_code_enabled: !siteSettings.access_code_enabled })}
                      disabled={savingSettings}
                      className={`relative w-14 h-8 rounded-full transition-colors ${
                        siteSettings.access_code_enabled ? 'bg-cyan-500' : 'bg-muted'
                      }`}
                      data-testid="access-code-toggle"
                    >
                      <span className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-transform ${
                        siteSettings.access_code_enabled ? 'left-7' : 'left-1'
                      }`} />
                    </button>
                  </div>
                  
                  {/* Access Code Input */}
                  {siteSettings.access_code_enabled && (
                    <div className="p-4 bg-muted/50 rounded-lg">
                      <label className="block text-foreground font-medium mb-2">Access Code</label>
                      <div className="flex gap-2">
                        <Input
                          value={siteSettings.access_code || ''}
                          onChange={(e) => setSiteSettings(prev => ({ ...prev, access_code: e.target.value.toUpperCase() }))}
                          placeholder="Enter access code"
                          className="bg-input border-input text-foreground uppercase tracking-widest font-mono"
                          data-testid="access-code-input"
                        />
                        <Button aria-label="Loader2"
                          onClick={() => updateSiteSettings({ access_code: siteSettings.access_code })}
                          disabled={savingSettings}
                          className="bg-cyan-500 hover:bg-cyan-600"
                          data-testid="save-access-code-btn"
                        >
                          {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                        </Button>
                      </div>
                      <p className="text-yellow-400 text-xs mt-2">
                        {String.fromCodePoint(0x26A0, 0xFE0F)} Changing the code will require ALL users to re-enter the new code
                      </p>
                    </div>
                  )}
                  
                  {/* Status Indicator */}
                  <div className={`p-4 rounded-lg border ${
                    siteSettings.access_code_enabled 
                      ? 'bg-yellow-500/10 border-yellow-500/30' 
                      : 'bg-green-500/10 border-green-500/30'
                  }`}>
                    <p className={`text-sm font-medium ${
                      siteSettings.access_code_enabled ? 'text-yellow-400' : 'text-green-400'
                    }`}>
                      {siteSettings.access_code_enabled 
                        ? `${String.fromCodePoint(0x1F512)} Site is protected - Current code: ${siteSettings.access_code || 'Not set'}` 
                        : `${String.fromCodePoint(0x1F513)} Site is public - Anyone can access`}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Compliance Tab - ToS Violations, Appeals, Fraud */}
        {activeTab === 'compliance' && (
          <AdminComplianceDashboard
            cardBgClass={cardBgClass}
            textClass={textClass}
            textSecondary={textSecondary}
            isLight={isLight}
          />
        )}

        {/* Moderation Tab - Disputes, Reports, Holds, Audit */}
        {activeTab === 'moderation' && (
          <AdminModerationDashboard />
        )}

        {/* Verification Tab - P1 Features: Identity Verification, Impersonation, Fraud, Journey */}
        {activeTab === 'verification' && (
          <AdminP1Dashboard />
        )}

        {/* Analytics Tab - Unified: Metrics, Funnel, Cohorts, A/B Tests, Growth Tools */}
        {activeTab === 'analytics' && (
          <AdminUnifiedAnalytics />
        )}

        {/* Support Tab - Ticketing System */}
        {activeTab === 'support' && (
          <AdminSupportDashboard />
        )}

        {/* Communications Tab - Announcements, Templates, Campaigns */}
        {activeTab === 'communications' && (
          <AdminCommunicationsDashboard />
        )}

        {/* System Tab - Health Monitoring */}
        {activeTab === 'system' && (
          <AdminSystemDashboard />
        )}

        {/* Finance Tab - Refunds, Payouts, Failed Payments */}
        {activeTab === 'finance' && (
          <AdminFinanceDashboard />
        )}

        {/* Content Moderation Tab - Flagged Content Queue */}
        {activeTab === 'content-mod' && (
          <AdminContentModDashboard />
        )}

        {/* Content Management Tab - Featured, Banners, SEO, API Keys */}
        {activeTab === 'content-mgmt' && (
          <AdminContentMgmtDashboard />
        )}

        {/* Persona Tab */}
        {activeTab === 'persona' && (
          <div className="space-y-4">
            <p className={`text-sm ${textSecondary} text-center`}>
              Select a persona to test how different users experience the app
            </p>
            
            <div className="grid grid-cols-1 gap-2">
              {ALL_PERSONAS.map((persona) => {
                const isActive = activePersona === persona.id;
                const roleInfo = getExpandedRoleInfo(persona.id);
                const colorClass = `text-${roleInfo?.color || 'cyan'}-400`;
                
                return (
                  <button
                    key={persona.id}
                    onClick={() => handleSelectPersona(persona)}
                    className={`p-3 rounded-xl border-2 transition-all duration-200 ${
                      isActive 
                        ? 'border-yellow-400 bg-yellow-400/10' 
                        : `${cardBgClass} hover:border-zinc-500`
                    }`}
                    data-testid={`persona-${persona.id.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10 border-2 border-current">
                        <AvatarFallback className={`bg-muted ${colorClass}`}>
                          {persona.label.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${textClass}`}>{persona.label}</span>
                          {isActive && (
                            <span className="px-2 py-0.5 bg-yellow-400 text-black text-xs font-bold rounded-full">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <p className={`text-xs ${textSecondary}`}>
                          {roleInfo?.category || 'User'} - {roleInfo?.description || 'Test this role'}
                        </p>
                      </div>
                      {isActive && <Check className="w-5 h-5 text-yellow-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Sessions Tab */}
        {activeTab === 'sessions' && (
          <div className="space-y-4">
            {loadingPhotographers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                <span className={`ml-2 text-sm ${textSecondary}`}>Loading data...</span>
              </div>
            ) : (
              <>
                {/* Force Start Section */}
                <Card className={`${cardBgClass} border-green-500/30`}>
                  <CardHeader>
                    <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                      <Play className="w-4 h-4 text-green-500" />
                      Force Start Session
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Photographer Selector */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Photographer</label>
                      <Input
                        placeholder="Search photographers..."
                        value={photographerSearch}
                        onChange={(e) => setPhotographerSearch(e.target.value)}
                        className="mb-2 bg-card border-input h-9 text-sm"
                      />
                      <select
                        value={selectedPhotographer}
                        onChange={(e) => setSelectedPhotographer(e.target.value)}
                        className="w-full h-10 px-3 rounded-md bg-card border border-input text-foreground text-sm"
                      >
                        <option value="">Select photographer...</option>
                        {filteredPhotographers.map((p) => (
                          <option key={p.id} value={p.id} disabled={p.is_shooting}>
                            {p.full_name} {p.is_shooting ? '(LIVE)' : ''} - {p.role}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Location Selector */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Surf Spot</label>
                      <Input
                        placeholder="Search spots..."
                        value={spotSearch}
                        onChange={(e) => setSpotSearch(e.target.value)}
                        className="mb-2 bg-card border-input h-9 text-sm"
                      />
                      <select
                        value={selectedSpot}
                        onChange={(e) => setSelectedSpot(e.target.value)}
                        className="w-full h-10 px-3 rounded-md bg-card border border-input text-foreground text-sm"
                      >
                        <option value="">Select surf spot...</option>
                        {filteredSpots.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} - {s.region}
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {/* Session Price */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Buy-in Price ($)</label>
                      <Input
                        type="number"
                        value={sessionPrice}
                        onChange={(e) => setSessionPrice(e.target.value)}
                        className="bg-card border-input h-9 text-sm w-24"
                        min="0"
                      />
                    </div>
                    
                    {/* Media Upload */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Conditions Media</label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        onChange={handleMediaSelect}
                        className="hidden"
                      />
                      {mediaPreview ? (
                        <div className="relative">
                          {conditionMediaType === 'video' ? (
                            <video src={mediaPreview} className="w-full h-24 object-cover rounded-lg" controls />
                          ) : (
                            <img loading="lazy" decoding="async" src={mediaPreview} alt="Conditions" className="w-full h-24 object-cover rounded-lg" />
                          )}
                          <button aria-label="Close"
                            onClick={clearMedia}
                            className="absolute top-1 right-1 p-1 bg-black/60 rounded-full"
                          ><X className="w-4 h-4 text-foreground" />
                          </button>
                        </div>
                      ) : (
                        <Button aria-label="Upload"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full border-dashed border-input h-16"
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Photo/Video
                        </Button>
                      )}
                    </div>
                    
                    {/* Notes */}
                    <div>
                      <label className={`text-xs ${textSecondary} mb-1 block`}>Spot Notes</label>
                      <Textarea
                        placeholder="e.g., 3-4ft, glassy..."
                        value={spotNotes}
                        onChange={(e) => setSpotNotes(e.target.value)}
                        className="bg-card border-input text-sm h-14 resize-none"
                      />
                    </div>
                    
                    <Button aria-label="Loader2"
                      onClick={handleForceStart}
                      disabled={forceStartLoading || !selectedPhotographer || !selectedSpot}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
                    >
                      {forceStartLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Play className="w-4 h-4 mr-2" />
                      )}
                      Force Start Session
                    </Button>
                  </CardContent>
                </Card>
                
                {/* Active Sessions */}
                <Card className={`${cardBgClass} border-red-500/30`}>
                  <CardHeader>
                    <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                      <Square className="w-4 h-4 text-red-500" />
                      Active Sessions ({activeSessions.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {activeSessions.length === 0 ? (
                      <p className={`text-sm ${textSecondary} text-center py-4`}>
                        No active sessions
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {activeSessions.map((session) => (
                          <div 
                            key={session.id}
                            className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 flex items-center gap-3"
                          >
                            <Avatar className="w-10 h-10">
                              <AvatarImage src={session.photographer_avatar} />
                              <AvatarFallback className="bg-input">
                                <Camera className="w-4 h-4" />
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className={`font-medium text-sm ${textClass} truncate flex items-center gap-2`}>
                                {session.photographer_name}
                                <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded animate-pulse">
                                  LIVE
                                </span>
                              </p>
                              <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
                                <MapPin className="w-3 h-3" />
                                {session.spot_name}
                              </p>
                            </div>
                            <Button aria-label="Loader2"
                              size="sm"
                              variant="destructive"
                              onClick={() => handleForceEnd(session.photographer_id)}
                              disabled={forceEndLoading === session.photographer_id}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              {forceEndLoading === session.photographer_id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <Square className="w-3 h-3 mr-1" />
                                  End
                                </>
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <UsersTabContent 
            users={users}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            handleSearch={handleSearch}
            setSelectedUser={setSelectedUser}
            handleVerify={handleVerify}
            handleUnsuspend={handleUnsuspend}
            setUserToSuspend={setUserToSuspend}
            setShowSuspendModal={setShowSuspendModal}
            cardBgClass={cardBgClass}
            textClass={textClass}
            textSecondary={textSecondary}
            adminId={user.id}
            onUserUpdate={fetchData}
          />
        )}

        {/* Pricing Tab */}
        {activeTab === 'pricing' && <AdminPricingEditor />}

        {/* Spots Tab - Global Spot Manager */}
        {activeTab === 'spots' && <AdminSpotsPanel userId={user?.id} />}

        {/* Map Editor Tab - Visual Pin Editor */}
        {activeTab === 'map-editor' && <AdminSpotEditor />}

        {/* Queue Tab - Precision Queue & Photographer Suggestions */}
        {activeTab === 'queue' && <AdminPrecisionQueue />}

        {/* Ads Tab */}
        {activeTab === 'ads' && <AdControlsPanel user={user} />}

        {/* Competition Tab */}
        {activeTab === 'competition' && <AdminCompetitionVerification />}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <Card className={cardBgClass}>
            <CardHeader>
              <CardTitle className={`${textClass} text-sm`}>Admin Action Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-foreground text-sm">
                        <span className="text-yellow-400">{log.admin_name || 'Unknown'}</span>
                        {' '}{log.action?.replace(/_/g, ' ')}{' '}
                        <span className="text-gray-500">({log.target_type})</span>
                      </p>
                    </div>
                    <span className="text-gray-500 text-xs">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                    </span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">No admin logs yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onToggleAdmin={handleToggleAdmin}
        />
      )}

      {/* Suspend Modal */}
      <Dialog open={showSuspendModal} onOpenChange={setShowSuspendModal}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <Ban className="w-5 h-5" />
              Suspend User
            </DialogTitle>
          </DialogHeader>
          <div className="modal-body px-4 sm:px-6 space-y-4 py-4">
            <p className="text-muted-foreground">
              Suspending <span className="text-foreground">{userToSuspend?.email}</span>
            </p>
            <Textarea aria-label="Reason for suspension..."
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension..."
              className="bg-muted border-border text-foreground"
              rows={3}
            />
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowSuspendModal(false)}
                className="flex-1 border-border text-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSuspend}
                disabled={!suspendReason}
                className="flex-1 bg-red-500 hover:bg-red-600"
              >
                Suspend User
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Stat Card Component

// Extracted admin tab panel components
import { StatCard, UserDetailModal, DropdownBadge, UsersTabContent, AnalyticsTabContent } from './admin/AdminTabPanels';


export default UnifiedAdminConsole;

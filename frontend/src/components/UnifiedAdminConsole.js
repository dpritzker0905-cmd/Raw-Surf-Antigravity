import React, { useState, useEffect, useRef, useCallback } from 'react';

import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';

import { usePersona, getExpandedRoleInfo } from '../contexts/PersonaContext';

import { useTheme } from '../contexts/ThemeContext';

import apiClient from '../lib/apiClient';

import {

  Shield, Zap, Users, DollarSign, Ban, 
  Loader2, ChevronLeft, ChevronRight, UserCheck, Trophy, Radio, MapPin, X, ArrowLeft, Activity,
  Megaphone, History, RefreshCw, Wallet, AlertCircle, Edit, BarChart2,
  Headphones, Server, Flag, Mail, Layout, Lock, Scale
} from 'lucide-react';

import { Button } from './ui/button';
import { getThemeTokens } from '../utils/themeTokens';


import { Textarea } from './ui/textarea';



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
import { AdControlsPanel } from './admin/AdControlsPanel';
import { AdminSpotsPanel } from './admin/AdminSpotsPanel';
import AdminOverviewTab from './admin/AdminOverviewTab';
import { AdminComplianceDashboard } from './admin/AdminComplianceDashboard';
import { AdminAccessControlPanel } from './admin/AdminAccessControlPanel';
import { AdminPersonaPanel } from './admin/AdminPersonaPanel';
import { AdminSessionsPanel } from './admin/AdminSessionsPanel';
import { AdminLogsPanel } from './admin/AdminLogsPanel';




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

  // Site Access Control states
  const [siteSettings, setSiteSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Theme classes
  const t = getThemeTokens(theme);
  const isLight = theme === 'light';
  const bgClass = t.pageBg;
  const cardBgClass = t.cardBgBorder;
  const textClass = t.textPrimary;
  const textSecondary = t.textSecondary;

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

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
  }, [user?.id, fetchData]);

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
    <div className={`min-h-screen ${bgClass} ${t.textPrimary} pb-20`} data-testid="unified-admin-console">
      {/* Header */}
      <div className={`sticky top-0 z-[1100] ${
        theme === 'beach'
          ? 'bg-amber-50/95 border-b border-amber-200'
          : isLight ? 'bg-white/90 border-b border-gray-200' : 'bg-black/90 border-b border-border'
      } backdrop-blur-lg`}>
        <div className="flex items-center justify-between p-4">
          <button aria-label="Go back" 
            onClick={() => navigate(-1)}
            className={`flex items-center gap-2 ${
              theme === 'beach'
                ? 'text-amber-800 hover:text-amber-950'
                : isLight ? 'text-gray-500 hover:text-black' : 'text-muted-foreground hover:text-foreground'
            } transition-colors`}
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
              onClick={() => { fetchData(); }}
              className={`${
                theme === 'beach'
                  ? 'text-amber-700 hover:text-amber-900 hover:bg-amber-200/50'
                  : isLight ? 'text-gray-500 hover:text-black hover:bg-gray-100' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
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
            className={`absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r ${
              theme === 'beach' ? 'from-amber-50 via-amber-50/80' : isLight ? 'from-white via-white/80' : 'from-black via-black/80'
            } to-transparent z-20 flex items-center justify-start pl-1 opacity-70 hover:opacity-100 transition-opacity`}
            aria-label="Scroll left"
          >
            <ChevronLeft className={`w-5 h-5 ${theme === 'beach' ? 'text-amber-900' : isLight ? 'text-black' : 'text-foreground'}`} />
          </button>
          
          {/* Right scroll button */}
          <button 
            onClick={() => {
              const container = document.getElementById('admin-tabs-container');
              if (container) container.scrollBy({ left: 200, behavior: 'smooth' });
            }}
            className={`absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l ${
              theme === 'beach' ? 'from-amber-50 via-amber-50/80' : isLight ? 'from-white via-white/80' : 'from-black via-black/80'
            } to-transparent z-20 flex items-center justify-end pr-1 opacity-70 hover:opacity-100 transition-opacity`}
            aria-label="Scroll right"
          >
            <ChevronRight className={`w-5 h-5 ${theme === 'beach' ? 'text-amber-900' : isLight ? 'text-black' : 'text-foreground'}`} />
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-200 border flex-shrink-0 ${
                    isActive
                      ? theme === 'beach'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/10'
                        : isLight
                          ? 'bg-gray-900 text-white border-gray-900 shadow-md shadow-gray-900/10'
                          : 'bg-cyan-500 text-slate-950 border-cyan-500 font-extrabold shadow-lg shadow-cyan-500/20'
                      : theme === 'beach'
                        ? 'bg-amber-100/50 text-amber-900 border-amber-200/60 hover:bg-amber-200/60 hover:text-amber-950'
                        : isLight 
                          ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 hover:text-black' 
                          : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:bg-zinc-800/50 hover:text-zinc-100'
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
          <AdminAccessControlPanel
            siteSettings={siteSettings}
            setSiteSettings={setSiteSettings}
            savingSettings={savingSettings}
            updateSiteSettings={updateSiteSettings}
            cardBgClass={cardBgClass}
            textClass={textClass}
          />
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
          <AdminPersonaPanel
            activePersona={activePersona}
            handleSelectPersona={handleSelectPersona}
            cardBgClass={cardBgClass}
            textClass={textClass}
            textSecondary={textSecondary}
          />
        )}

        {activeTab === 'sessions' && (
          <AdminSessionsPanel
            cardBgClass={cardBgClass}
            textClass={textClass}
            textSecondary={textSecondary}
          />
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
          <AdminLogsPanel
            logs={logs}
            cardBgClass={cardBgClass}
            textClass={textClass}
          />
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
import { UserDetailModal, UsersTabContent } from './admin/AdminTabPanels';


export default UnifiedAdminConsole;

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { LogOut, User, Bell, Shield, Camera, DollarSign, CalendarCheck, ChevronRight, ChevronDown, Users, Eye, EyeOff, MapPin, Loader2, MessageSquare, Heart, UserPlus, Mail, Volume2, VolumeX, Sun, Moon, Waves, Check, Zap, CreditCard, Megaphone, Activity, WifiOff, Download, Trash2, HardDrive, Clock, FileText, Scale, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';

import { toast } from 'sonner';
import apiClient from '../lib/apiClient';
import { AccountBillingHub } from './settings/AccountBillingHub';
import { AdCenterPanel } from './settings/AdCenterPanel';
import useOfflineMode from '../hooks/useOfflineMode';
import logger from '../utils/logger';
import { ROLES } from '../constants/roles';
import { CURRENT_TOS_VERSION } from '../constants/tos';
import { getPreferencesByPath, updatePreferenceByPath } from '../services/notificationService';

import { SurfModeCard } from './settings/SurfModeCard';
import { GromParentCard } from './settings/GromParentCard';
import { UsernameCard } from './settings/UsernameCard';
import { MetaConnectionsCard } from './settings/MetaConnectionsCard';
import { PasswordSecurityCard } from './settings/PasswordSecurityCard';
import DeleteAccountSection from './settings/DeleteAccountSection';




export const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const { getEffectiveRole, _activePersona } = usePersona();
  const navigate = useNavigate();
  
  // Offline mode hook
  const { 
    isOnline, 
    spotsCached, 
    nearbyCached,
    isDownloading, 
    autoSyncEnabled,
    downloadSpotsForOffline, 
    syncNearbySpots,
    toggleAutoSync,
    clearOfflineCache, 
    getCacheSize, 
    formatCacheTime 
  } = useOfflineMode();
  
  // Theme drawer open state (mobile only)
  const [themeDrawerOpen, setThemeDrawerOpen] = useState(false);
  
  // Privacy settings state
  const [privacy, setPrivacy] = useState({
    map_visibility: 'friends',
    is_ghost_mode: false,
    allow_proximity_pings: true,
    show_online_status: true,
    show_last_seen: true,
    is_private: false,
    accepting_lineup_invites: true
  });
  const [privacyLoading, setPrivacyLoading] = useState(false);
  
  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState({
    push_messages: true,
    push_reactions: true,
    push_follows: true,
    push_mentions: true,
    push_dispatch: true,
    push_bookings: true,
    push_payments: true,
    push_marketing: false,
    email_digest: true,
    email_bookings: true,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    // New: Sound & Haptics
    sound_enabled: true,
    vibration_enabled: true,
    // New: Digest Mode
    digest_enabled: false,
    digest_frequency: 'daily'
  });
  const [notifLoading, setNotifLoading] = useState(false);
  
  // Friends state
  const [_friends, setFriends] = useState([]);
  const [_pendingRequests, setPendingRequests] = useState([]);
  const [_friendsLoading, setFriendsLoading] = useState(false);
  
  // Collapsible sections state for settings page
  const [expandedSections, setExpandedSections] = useState({
    account: true,         // Account - expanded by default
    billing: false,        // Account & Billing
    adCenter: false,       // Ad Center
    offline: false,        // Offline Mode
    socialConnections: false, // Social Connections
    security: false,       // Password & Security
    privacy: false,        // Privacy & Safety
    notifications: false,  // Notifications
    friends: false,        // Friends
    legal: false           // Legal / Terms of Service
  });
  
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // ToS / Legal state
  const [tosStatus, setTosStatus] = useState({ loading: true, acknowledged: false, acknowledged_at: null });
  const [showTosFullText, setShowTosFullText] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [acceptanceHistory, setAcceptanceHistory] = useState({ loading: true, data: [] });
  const [tosContent, setTosContent] = useState({ sections: [], version: '', effective_date: '' });
  const [privacyContent, setPrivacyContent] = useState({ sections: [], effective_date: '' });

  // Fetch ToS acceptance status + full acceptance history + content from DB
  useEffect(() => {
    if (user?.id) {
      apiClient.get(`/compliance/tos-status/${user.id}?current_version=${CURRENT_TOS_VERSION}`)
        .then(res => setTosStatus({ loading: false, acknowledged: res.data.acknowledged, acknowledged_at: res.data.acknowledged_at }))
        .catch(() => setTosStatus({ loading: false, acknowledged: false, acknowledged_at: null }));
      
      apiClient.get(`/compliance/acceptance-history/${user.id}`)
        .then(res => setAcceptanceHistory({ loading: false, data: res.data.history || [] }))
        .catch(() => setAcceptanceHistory({ loading: false, data: [] }));
    }

    // Fetch content (no auth required)
    apiClient.get('/compliance/tos-content/current?doc_type=tos')
      .then(res => setTosContent(res.data))
      .catch(() => {});
    apiClient.get('/compliance/tos-content/current?doc_type=privacy')
      .then(res => setPrivacyContent(res.data))
      .catch(() => {});
  }, [user?.id]);

  // Violation history state
  const [violationHistory, setViolationHistory] = useState({ loading: true, data: null });
  const [showViolations, setShowViolations] = useState(false);

  useEffect(() => {
    if (user?.id) {
      apiClient.get(`/compliance/violations/user/${user.id}`)
        .then(res => setViolationHistory({ loading: false, data: res.data }))
        .catch(() => setViolationHistory({ loading: false, data: null }));
    }
  }, [user?.id]);
  
  // Fetch privacy settings
  useEffect(() => {
    if (user?.id) {
      fetchPrivacySettings();
      fetchNotificationPrefs();
      fetchFriends();
    }
  }, [user?.id]);
  
  const fetchPrivacySettings = async () => {
    try {
      const response = await apiClient.get(`/friends/privacy/${user.id}`);
      setPrivacy(response.data);
    } catch (error) {
      logger.error('Failed to fetch privacy settings:', error);
    }
  };
  
  const fetchNotificationPrefs = async () => {
    try {
      const response = await getPreferencesByPath(user.id);
      setNotifPrefs(response.data);
    } catch (error) {
      logger.error('Failed to fetch notification preferences:', error);
    }
  };
  
  const updateNotifPref = async (key, value) => {
    setNotifLoading(true);
    try {
      await updatePreferenceByPath(user.id, key, value);
      setNotifPrefs(prev => ({ ...prev, [key]: value }));
      toast.success('Notification setting updated');
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setNotifLoading(false);
    }
  };
  
  const updatePrivacySetting = async (key, value) => {
    setPrivacyLoading(true);
    try {
      await apiClient.put(`/friends/privacy/${user.id}`, { [key]: value });
      setPrivacy(prev => ({ ...prev, [key]: value }));
      toast.success('Privacy setting updated');
    } catch (error) {
      toast.error('Failed to update setting');
    } finally {
      setPrivacyLoading(false);
    }
  };
  
  const fetchFriends = async () => {
    setFriendsLoading(true);
    try {
      const [friendsRes, pendingRes] = await Promise.all([
        apiClient.get(`/friends/list/${user.id}`),
        apiClient.get(`/friends/pending/${user.id}`)
      ]);
      setFriends(friendsRes.data.friends || []);
      setPendingRequests(pendingRes.data.pending_requests || []);
    } catch (error) {
      logger.error('Failed to fetch friends:', error);
    } finally {
      setFriendsLoading(false);
    }
  };
  
  const _handleAcceptFriend = async (requestId) => {
    try {
      await apiClient.post(`/friends/accept/${requestId}`);
      toast.success('Friend request accepted!');
      fetchFriends();
    } catch (error) {
      toast.error('Failed to accept request');
    }
  };
  
  const _handleDeclineFriend = async (requestId) => {
    try {
      await apiClient.post(`/friends/decline/${requestId}`);
      toast.success('Friend request declined');
      fetchFriends();
    } catch (error) {
      toast.error('Failed to decline request');
    }
  };
  
  const _handleRemoveFriend = async (friendshipId) => {
    try {
      await apiClient.delete(`/friends/${friendshipId}`);
      toast.success('Friend removed');
      fetchFriends();
    } catch (error) {
      toast.error('Failed to remove friend');
    }
  };

  // CRITICAL: Use getEffectiveRole() for God Mode sync
  // This ensures Settings menu re-renders when persona is swapped
  const effectiveRole = getEffectiveRole(user?.role);
  
  // Role categorization based on EFFECTIVE role (not raw user.role)
  const photographerRoles = ['Grom Parent', 'Hobbyist', 'Photographer', 'Approved Pro'];
  const surferRoles = ['Grom', 'Surfer', 'Comp Surfer', 'Pro'];
  const businessRoles = ['Shop', 'Surf School', 'Shaper', 'Resort'];
  
  const isPhotographer = photographerRoles.includes(effectiveRole);
  const isSurfer = surferRoles.includes(effectiveRole);
  const isGrom = effectiveRole === ROLES.GROM;
  const isBusiness = businessRoles.includes(effectiveRole);
  
  // GROM PARENT: true for dedicated Grom Parent role OR the opt-in flag (surfer who is also a parent)
  const isGromParent = effectiveRole === ROLES.GROM_PARENT || user?.is_grom_parent === true;
  // Can access commerce features (NOT Grom Parent - personal capture only)
  const _canAccessCommerce = isPhotographer && !isGromParent;
  // Can access live shooting settings (NOT Grom Parent)
  const _canAccessLiveShooting = isPhotographer && !isGromParent;

  const handleLogout = () => {
    logout();
    navigate('/auth');
    toast.success('Logged out successfully');
  };

  // Use semantic Tailwind classes that reference CSS variables
  const mainBgClass = 'bg-background';
  const cardBgClass = 'bg-card border-border';
  const textPrimaryClass = 'text-foreground';
  const textSecondaryClass = 'text-muted-foreground';
  const borderClass = 'border-border';

  // Settings menu item component
  const SettingsMenuItem = ({ icon: Icon, label, description, onClick, color = 'text-muted-foreground' }) => (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-lg transition-colors hover:bg-muted"
    >
      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="flex-1 text-left">
        <p className={textPrimaryClass}>{label}</p>
        {description && <p className={`text-xs ${textSecondaryClass}`}>{description}</p>}
      </div>
      <ChevronRight className={`w-5 h-5 ${textSecondaryClass}`} />
    </button>
  );

  return (
    <div className={`pb-20 ${mainBgClass} min-h-screen transition-colors duration-300`} data-testid="settings-page">
      <div className="max-w-md mx-auto p-4">
        <h1 className={`text-3xl font-bold mb-6 ${textPrimaryClass}`} style={{ fontFamily: 'Oswald' }} data-testid="settings-title">
          Settings
        </h1>

        {/* Photographer Tools - MOVED TO PHOTO HUB (Tab 2) */}
        {/* All photographer-specific tools are now accessible via the Photo Hub drawer */}
        {/* This includes: My Gallery, Bookings Manager, Live Sessions, Earnings, On-Demand Settings */}

        {/* Surfer/Grom Tools - Shows for ALL surfer roles based on effectiveRole */}
        {isSurfer && (
          <Card className={`${cardBgClass} mb-4 transition-colors duration-300`}>
            <CardHeader>
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Waves className="w-5 h-5 text-cyan-400" />
                {isGrom ? 'Grom' : 'Surfer'} Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <SettingsMenuItem
                icon={Image}
                label="My Photos"
                description="Photos you've purchased or been tagged in"
                onClick={() => navigate('/gallery')}
                color="text-yellow-400"
              />
              <SettingsMenuItem
                icon={Wallet}
                label="My Wallet"
                description="Credits, purchases, transactions"
                onClick={() => navigate('/wallet')}
                color="text-green-400"
              />
            </CardContent>
          </Card>
        )}

        {/* Surf Mode â€” Competitive/Pro progression for non-Grom surfers */}
        {isSurfer && !isGrom && (
          <SurfModeCard
            textPrimaryClass={textPrimaryClass}
            textSecondaryClass={textSecondaryClass}
            cardBgClass={cardBgClass}
          />
        )}

        {/* Grom Parent â€” AND-able toggle for surfers who are also parents */}
        {isSurfer && !isGrom && (
          <GromParentCard
            textPrimaryClass={textPrimaryClass}
            textSecondaryClass={textSecondaryClass}
            cardBgClass={cardBgClass}
          />
        )}

        {/* Business Tools */}
        {isBusiness && (
          <Card className={`${cardBgClass} mb-4 transition-colors duration-300`}>
            <CardHeader>
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <DollarSign className="w-5 h-5 text-green-400" />
                Business Tools
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <SettingsMenuItem
                icon={Image}
                label="My Listings"
                description="Manage your products and services"
                onClick={() => navigate('/gallery')}
                color="text-yellow-400"
              />
              <SettingsMenuItem
                icon={Wallet}
                label="Business Wallet"
                description="Revenue, payouts, analytics"
                onClick={() => navigate('/wallet')}
                color="text-green-400"
              />
            </CardContent>
          </Card>
        )}

        {/* Account Section */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="account-settings-card">
          <CardHeader className="cursor-pointer" onClick={() => toggleSection('account')}>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <User className="w-5 h-5" />
                Account
              </CardTitle>
              <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.account ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          {expandedSections.account && (
            <CardContent className="space-y-3">
              <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
                <span className={textSecondaryClass}>Email</span>
                <span className={`${textSecondaryClass} text-sm`}>{user?.email}</span>
              </div>
              <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
                <span className={textSecondaryClass}>Role</span>
                <span className="text-yellow-500 text-sm">{user?.role}</span>
              </div>
              <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
                <span className={textSecondaryClass}>Subscription</span>
                <span className="text-emerald-500 text-sm">{user?.subscription_tier || 'Free'}</span>
              </div>
              
              {/* Username Management */}
              <UsernameCard
                userId={user?.id}
                textPrimaryClass={textPrimaryClass}
                textSecondaryClass={textSecondaryClass}
                borderClass={borderClass}
                cardBgClass={cardBgClass}
              />
            </CardContent>
          )}
        </Card>

        {/* Password & Security */}
        <PasswordSecurityCard
          textPrimaryClass={textPrimaryClass}
          textSecondaryClass={textSecondaryClass}
          borderClass={borderClass}
          cardBgClass={cardBgClass}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
        />

        {/* Account & Billing Hub - NEW */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="account-billing-card">
          <CardHeader className="cursor-pointer" onClick={() => toggleSection('billing')}>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <CreditCard className="w-5 h-5 text-green-400" />
                Account & Billing
              </CardTitle>
              <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.billing ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          {expandedSections.billing && (
            <CardContent>
              <AccountBillingHub />
            </CardContent>
          )}
        </Card>

        {/* Ad Center - Self-Serve Advertising */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="ad-center-card">
          <CardHeader className="cursor-pointer" onClick={() => toggleSection('adCenter')}>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Megaphone className="w-5 h-5 text-purple-400" />
                Ad Center
              </CardTitle>
              <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.adCenter ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          {expandedSections.adCenter && (
            <CardContent>
              <AdCenterPanel />
            </CardContent>
          )}
        </Card>

        {/* Offline Mode - Spot Data Caching */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="offline-mode-card">
          <CardHeader className="cursor-pointer" onClick={() => toggleSection('offline')}>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <WifiOff className="w-5 h-5 text-blue-400" />
                Offline Mode
                {!isOnline && (
                  <span className="ml-2 px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded-full">
                    Offline
                  </span>
                )}
              </CardTitle>
              <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.offline ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          {expandedSections.offline && (
            <CardContent className="space-y-4">
            {/* Connection Status */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-orange-400" />
                )}
                <span className={textPrimaryClass}>Connection Status</span>
              </div>
              <span className={`text-sm ${isOnline ? 'text-green-400' : 'text-orange-400'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            {/* Auto-Sync Toggle */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                <div>
                  <span className={textPrimaryClass}>Auto-Sync Nearby Spots</span>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    Automatically cache spots based on your location
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const result = toggleAutoSync(!autoSyncEnabled);
                  toast.success(result.enabled ? 'Auto-sync enabled' : 'Auto-sync disabled');
                }}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  autoSyncEnabled ? 'bg-emerald-500' : 'bg-zinc-600'
                }`}
                data-testid="auto-sync-toggle"
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoSyncEnabled ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>

            {/* Cache Status */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Spot Data Cache</span>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    {spotsCached || nearbyCached 
                      ? `${getCacheSize()} MB â€¢ Updated ${formatCacheTime()}` 
                      : 'Not cached'}
                  </p>
                </div>
              </div>
              <span className={`text-sm ${spotsCached || nearbyCached ? 'text-green-400' : 'text-muted-foreground'}`}>
                {nearbyCached ? 'Nearby Cached' : spotsCached ? 'All Cached' : 'Not Available'}
              </span>
            </div>

            {/* Sync Nearby Button */}
            <Button
              onClick={async () => {
                const result = await syncNearbySpots();
                if (result.success) {
                  toast.success(`Cached ${result.count} nearby spots`);
                } else {
                  toast.error('Failed to sync nearby spots');
                }
              }}
              disabled={isDownloading || !isOnline}
              variant="outline"
              className={`w-full ${borderClass} text-emerald-400 hover:bg-emerald-500/10`}
              data-testid="sync-nearby-btn"
            >
              <MapPin className="w-4 h-4 mr-2" />
              Sync Nearby Spots (100km)
            </Button>

            {/* Download All Button */}
            <div className="space-y-2">
              <Button
                onClick={async () => {
                  const result = await downloadSpotsForOffline();
                  if (result.success) {
                    toast.success(result.message);
                  } else {
                    toast.error(result.message);
                  }
                }}
                disabled={isDownloading || !isOnline}
                className="w-full bg-blue-500 hover:bg-blue-600 text-foreground"
                data-testid="download-offline-btn"
              >
                {isDownloading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    {spotsCached ? 'Update All Spots' : 'Download All Spots'}
                  </>
                )}
              </Button>
              <p className={`text-xs ${textSecondaryClass} text-center`}>
                Download all 1,447 surf spots for full offline access
              </p>
            </div>

            {/* Clear Cache */}
            {(spotsCached || nearbyCached) && (
              <Button
                onClick={() => {
                  clearOfflineCache();
                  toast.success('Offline cache cleared');
                }}
                variant="outline"
                className={`w-full ${borderClass} text-red-400 hover:bg-red-500/10`}
                data-testid="clear-cache-btn"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Offline Data
              </Button>
            )}
          </CardContent>
          )}
        </Card>

        {/* Social Connections - Facebook/Instagram */}
        <MetaConnectionsCard 
          userId={user?.id}
          textPrimaryClass={textPrimaryClass}
          textSecondaryClass={textSecondaryClass}
          borderClass={borderClass}
          cardBgClass={cardBgClass}
        />

        {/* Privacy & Safety Section */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="privacy-settings-card">
          <CardHeader className="cursor-pointer" onClick={() => toggleSection('privacy')}>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Shield className="w-5 h-5 text-cyan-400" />
                Privacy & Safety
              </CardTitle>
              <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.privacy ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          {expandedSections.privacy && (
            <CardContent className="space-y-4">
            {/* Map Visibility */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Map Visibility</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Who can see you on the map</p>
                </div>
              </div>
              <select
                value={privacy.map_visibility}
                onChange={(e) => updatePrivacySetting('map_visibility', e.target.value)}
                disabled={privacyLoading}
                className="px-3 py-1 rounded-lg text-sm bg-muted text-foreground"
              >
                <option value="public">Everyone</option>
                <option value="friends">Friends Only</option>
                <option value="none">Hidden</option>
              </select>
            </div>
            
            {/* Ghost Mode */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                {privacy.is_ghost_mode ? (
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Eye className="w-4 h-4 text-muted-foreground" />
                )}
                <div>
                  <span className={textPrimaryClass}>Ghost Mode</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Completely hide from all maps</p>
                </div>
              </div>
              <button
                onClick={() => updatePrivacySetting('is_ghost_mode', !privacy.is_ghost_mode)}
                disabled={privacyLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  privacy.is_ghost_mode ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  privacy.is_ghost_mode ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Proximity Pings */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Proximity Pings</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Let friends ping your location</p>
                </div>
              </div>
              <button
                onClick={() => updatePrivacySetting('allow_proximity_pings', !privacy.allow_proximity_pings)}
                disabled={privacyLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  privacy.allow_proximity_pings ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  privacy.allow_proximity_pings ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Show Online Status */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Show Online Status</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Let others see when you're online</p>
                </div>
              </div>
              <button
                onClick={() => updatePrivacySetting('show_online_status', !privacy.show_online_status)}
                disabled={privacyLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  privacy.show_online_status ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  privacy.show_online_status ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Private Account Toggle */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                {privacy.is_private ? (
                  <EyeOff className="w-4 h-4 text-orange-400" />
                ) : (
                  <Eye className="w-4 h-4 text-green-400" />
                )}
                <div>
                  <span className={textPrimaryClass}>Private Account</span>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    {privacy.is_private 
                      ? 'Only approved followers can see your posts' 
                      : 'Your posts are visible to everyone'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${privacy.is_private ? 'text-orange-400' : 'text-green-400'}`}>
                  {privacy.is_private ? 'Private' : 'Public'}
                </span>
                <button
                  onClick={() => updatePrivacySetting('is_private', !privacy.is_private)}
                  disabled={privacyLoading}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    privacy.is_private ? 'bg-orange-400' : 'bg-green-500'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    privacy.is_private ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            </div>
            
            {/* Accept Lineup Invites */}
            <div className={`flex items-center justify-between py-2`}>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Accept Lineup Invites</span>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    Allow nearby surfers to invite you to lineups
                  </p>
                </div>
              </div>
              <button
                onClick={() => updatePrivacySetting('accepting_lineup_invites', !privacy.accepting_lineup_invites)}
                disabled={privacyLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  privacy.accepting_lineup_invites ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  privacy.accepting_lineup_invites ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
          </CardContent>
          )}
        </Card>

        {/* Notification Preferences Section */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="notification-settings-card">
          <CardHeader className="cursor-pointer" onClick={() => toggleSection('notifications')}>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Bell className="w-5 h-5 text-yellow-400" />
                Notifications
              </CardTitle>
              <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.notifications ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          {expandedSections.notifications && (
            <CardContent className="space-y-4">
            {/* Push Notifications Header */}
            <div className="flex items-center gap-2 mb-2">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <span className={`text-sm font-medium ${textSecondaryClass}`}>Push Notifications</span>
            </div>
            
            {/* Messages */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Messages</span>
                  <p className={`text-xs ${textSecondaryClass}`}>New messages from other users</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('push_messages', !notifPrefs.push_messages)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.push_messages ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-push-messages"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.push_messages ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Reactions */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Reactions</span>
                  <p className={`text-xs ${textSecondaryClass}`}>When someone reacts to your posts</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('push_reactions', !notifPrefs.push_reactions)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.push_reactions ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-push-reactions"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.push_reactions ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* New Followers */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>New Followers</span>
                  <p className={`text-xs ${textSecondaryClass}`}>When someone follows you</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('push_follows', !notifPrefs.push_follows)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.push_follows ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-push-follows"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.push_follows ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Dispatch Alerts (for photographers) */}
            {isPhotographer && (
              <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <span className={textPrimaryClass}>Photo Requests</span>
                    <p className={`text-xs ${textSecondaryClass}`}>Dispatch alerts from surfers</p>
                  </div>
                </div>
                <button
                  onClick={() => updateNotifPref('push_dispatch', !notifPrefs.push_dispatch)}
                  disabled={notifLoading}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    notifPrefs.push_dispatch ? 'bg-cyan-400' : 'bg-zinc-600'
                  }`}
                  data-testid="toggle-push-dispatch"
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    notifPrefs.push_dispatch ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            )}
            
            {/* Bookings */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Bookings</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Session confirmations & updates</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('push_bookings', !notifPrefs.push_bookings)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.push_bookings ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-push-bookings"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.push_bookings ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Payments - NOT shown to Grom Parents (no commerce) */}
            {!isGromParent && (
              <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <span className={textPrimaryClass}>Payments</span>
                    <p className={`text-xs ${textSecondaryClass}`}>Tips, purchases & payouts</p>
                  </div>
                </div>
                <button
                  onClick={() => updateNotifPref('push_payments', !notifPrefs.push_payments)}
                  disabled={notifLoading}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    notifPrefs.push_payments ? 'bg-cyan-400' : 'bg-zinc-600'
                  }`}
                  data-testid="toggle-push-payments"
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    notifPrefs.push_payments ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            )}
            
            {/* Email Preferences Header */}
            <div className="flex items-center gap-2 mt-4 mb-2">
              <Mail className="w-4 h-4 text-cyan-400" />
              <span className={`text-sm font-medium ${textSecondaryClass}`}>Email Notifications</span>
            </div>
            
            {/* Weekly Digest */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Weekly Digest</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Summary of activity & highlights</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('email_digest', !notifPrefs.email_digest)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.email_digest ? 'bg-cyan-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-email-digest"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.email_digest ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Quiet Hours */}
            <div className="mt-4">
              <div className={`flex items-center justify-between py-2`}>
                <div className="flex items-center gap-2">
                  <VolumeX className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <span className={textPrimaryClass}>Quiet Hours</span>
                    <p className={`text-xs ${textSecondaryClass}`}>Pause push notifications</p>
                  </div>
                </div>
                <button
                  onClick={() => updateNotifPref('quiet_hours_enabled', !notifPrefs.quiet_hours_enabled)}
                  disabled={notifLoading}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    notifPrefs.quiet_hours_enabled ? 'bg-cyan-400' : 'bg-zinc-600'
                  }`}
                  data-testid="toggle-quiet-hours"
                >
                  <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                    notifPrefs.quiet_hours_enabled ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              {notifPrefs.quiet_hours_enabled && (
                <div className={`flex items-center gap-2 mt-2 pl-6 ${textSecondaryClass}`}>
                  <input
                    type="time"
                    value={notifPrefs.quiet_hours_start}
                    onChange={(e) => updateNotifPref('quiet_hours_start', e.target.value)}
                    className="px-2 py-1 rounded text-sm bg-muted text-foreground"
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={notifPrefs.quiet_hours_end}
                    onChange={(e) => updateNotifPref('quiet_hours_end', e.target.value)}
                    className="px-2 py-1 rounded text-sm bg-muted text-foreground"
                  />
                </div>
              )}
            </div>
            
            {/* Sound & Haptics Section */}
            <div className="flex items-center gap-2 mt-4 mb-2">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <span className={`text-sm font-medium ${textSecondaryClass}`}>Sound & Haptics</span>
            </div>
            
            {/* Notification Sounds */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Notification Sounds</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Play sounds for notifications</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('sound_enabled', !notifPrefs.sound_enabled)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.sound_enabled ? 'bg-emerald-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-sound-enabled"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.sound_enabled ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Vibration */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Vibration</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Vibrate for notifications</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('vibration_enabled', !notifPrefs.vibration_enabled)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.vibration_enabled ? 'bg-emerald-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-vibration-enabled"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.vibration_enabled ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Digest Mode Section */}
            <div className="flex items-center gap-2 mt-4 mb-2">
              <Clock className="w-4 h-4 text-orange-400" />
              <span className={`text-sm font-medium ${textSecondaryClass}`}>Digest Mode</span>
            </div>
            
            {/* Digest Toggle */}
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <div>
                  <span className={textPrimaryClass}>Batch Notifications</span>
                  <p className={`text-xs ${textSecondaryClass}`}>Group notifications and deliver periodically</p>
                </div>
              </div>
              <button
                onClick={() => updateNotifPref('digest_enabled', !notifPrefs.digest_enabled)}
                disabled={notifLoading}
                className={`w-12 h-6 rounded-full transition-colors ${
                  notifPrefs.digest_enabled ? 'bg-orange-400' : 'bg-zinc-600'
                }`}
                data-testid="toggle-digest-enabled"
              >
                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                  notifPrefs.digest_enabled ? 'translate-x-6' : 'translate-x-0.5'
                }`} />
              </button>
            </div>
            
            {/* Digest Frequency */}
            {notifPrefs.digest_enabled && (
              <div className={`py-2 pl-6`}>
                <p className={`text-sm mb-2 ${textSecondaryClass}`}>Delivery Frequency</p>
                <div className="flex gap-2">
                  {['hourly', 'daily', 'weekly'].map((freq) => (
                    <button
                      key={freq}
                      onClick={() => updateNotifPref('digest_frequency', freq)}
                      className={`flex-1 py-2 rounded-lg text-sm capitalize transition-colors ${
                        notifPrefs.digest_frequency === freq
                          ? 'bg-orange-400 text-black'
                          : 'bg-muted hover:bg-muted/80 text-foreground'
                      }`}
                      data-testid={`digest-${freq}`}
                    >
                      {freq}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
          )}
        </Card>


        {/* Legal / Terms of Service */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="legal-settings-card">
          <CardHeader className="cursor-pointer" onClick={() => toggleSection('legal')}>
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Scale className="w-5 h-5 text-cyan-400" />
                Legal
              </CardTitle>
              <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.legal ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
          {expandedSections.legal && (
            <CardContent className="space-y-4">
              {/* ToS Acceptance Status */}
              <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <span className={textPrimaryClass}>Terms of Service</span>
                    <p className={`text-xs ${textSecondaryClass}`}>Version {CURRENT_TOS_VERSION}</p>
                  </div>
                </div>
                <div className="text-right">
                  {tosStatus.loading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : tosStatus.acknowledged ? (
                    <div className="flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs text-emerald-400">Accepted</span>
                    </div>
                  ) : (
                    <span className="text-xs text-orange-400">Not accepted</span>
                  )}
                </div>
              </div>

              {/* Accepted Date */}
              {tosStatus.acknowledged && tosStatus.acknowledged_at && (
                <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className={textPrimaryClass}>Accepted On</span>
                  </div>
                  <span className={`text-sm ${textSecondaryClass}`}>
                    {new Date(tosStatus.acknowledged_at).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric'
                    })}
                  </span>
                </div>
              )}

              {/* View Full Terms Button */}
              <Button
                onClick={() => setShowTosFullText(!showTosFullText)}
                variant="outline"
                className={`w-full ${borderClass} text-cyan-400 hover:bg-cyan-500/10`}
                data-testid="view-tos-button"
              >
                <FileText className="w-4 h-4 mr-2" />
                {showTosFullText ? 'Hide Terms' : 'View Full Terms of Service'}
              </Button>

              {/* Full ToS Text (Expandable) */}
              {showTosFullText && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground space-y-3 max-h-[50vh] overflow-y-auto" data-testid="tos-full-text">
                  <p className={`text-xs ${textSecondaryClass} uppercase tracking-wider`}>Version {tosContent.version || CURRENT_TOS_VERSION} • Effective {tosContent.effective_date || 'May 2026'}</p>
                  {(tosContent.sections || []).map((section, idx) => (
                    <React.Fragment key={idx}>
                      <h4 className={`${textPrimaryClass} font-semibold`}>{section.title}</h4>
                      <p>{section.body}</p>
                    </React.Fragment>
                  ))}
                  {(!tosContent.sections || tosContent.sections.length === 0) && (
                    <p className={`${textSecondaryClass}`}>Loading terms...</p>
                  )}
                </div>
              )}

              {/* Privacy Policy */}
              <Button
                onClick={() => setShowPrivacyPolicy(!showPrivacyPolicy)}
                variant="outline"
                className={`w-full ${borderClass} text-cyan-400 hover:bg-cyan-500/10`}
                data-testid="view-privacy-button"
              >
                <Shield className="w-4 h-4 mr-2" />
                {showPrivacyPolicy ? 'Hide Privacy Policy' : 'View Privacy Policy'}
              </Button>

              {showPrivacyPolicy && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground space-y-3 max-h-[50vh] overflow-y-auto" data-testid="privacy-full-text">
                  <p className={`text-xs ${textSecondaryClass} uppercase tracking-wider`}>Privacy Policy • Effective {privacyContent.effective_date || 'May 2026'}</p>
                  {(privacyContent.sections || []).map((section, idx) => (
                    <React.Fragment key={idx}>
                      <h4 className={`${textPrimaryClass} font-semibold`}>{section.title}</h4>
                      <p>{section.body}</p>
                    </React.Fragment>
                  ))}
                  {(!privacyContent.sections || privacyContent.sections.length === 0) && (
                    <p className={`${textSecondaryClass}`}>Loading privacy policy...</p>
                  )}
                </div>
              )}

              {/* Acceptance History */}
              <div className={`py-2 border-b ${borderClass}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className={`${textPrimaryClass} text-sm font-medium`}>Acceptance History</span>
                </div>
                {acceptanceHistory.loading ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                ) : acceptanceHistory.data.length === 0 ? (
                  <p className={`text-xs ${textSecondaryClass} py-2`}>No acceptance records found.</p>
                ) : (
                  <div className="space-y-2">
                    {acceptanceHistory.data.map((record, idx) => (
                      <div key={idx} className="p-3 rounded-lg border border-border bg-muted/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-emerald-400" />
                            <span className={`text-sm font-medium ${textPrimaryClass}`}>
                              Version {record.version}
                            </span>
                            {idx === 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Latest</span>
                            )}
                          </div>
                        </div>
                        <div className={`mt-1.5 text-xs ${textSecondaryClass} space-y-0.5`}>
                          {record.accepted_at && (
                            <p>Accepted: {new Date(record.accepted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                          )}
                          {record.ip_address && <p>IP: {record.ip_address}</p>}
                          {record.user_agent && (
                            <p>Device: {record.user_agent.length > 60 ? record.user_agent.substring(0, 60) + '…' : record.user_agent}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Violation History */}
              <div className={`py-2 border-b ${borderClass}`}>
                <button
                  onClick={() => setShowViolations(!showViolations)}
                  className="w-full flex items-center justify-between"
                  data-testid="violation-history-toggle"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                    <div className="text-left">
                      <span className={textPrimaryClass}>Violation History</span>
                      <p className={`text-xs ${textSecondaryClass}`}>
                        {violationHistory.loading
                          ? 'Loading...'
                          : violationHistory.data?.violations?.length
                          ? `${violationHistory.data.violations.length} record${violationHistory.data.violations.length !== 1 ? 's' : ''} • ${violationHistory.data.total_strikes || 0} strike${(violationHistory.data.total_strikes || 0) !== 1 ? 's' : ''}`
                          : 'No violations — clean record ✅'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 ${textSecondaryClass} transition-transform ${showViolations ? 'rotate-180' : ''}`} />
                </button>

                {showViolations && violationHistory.data && (
                  <div className="mt-3 space-y-2">
                    {violationHistory.data.violations?.length === 0 ? (
                      <div className="py-4 text-center">
                        <Check className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                        <p className={`text-sm ${textSecondaryClass}`}>No violations on your account</p>
                      </div>
                    ) : (
                      violationHistory.data.violations.map(v => (
                        <div key={v.id} className={`p-3 rounded-lg border border-border bg-muted/20`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium ${textPrimaryClass}`}>{v.title}</p>
                              <p className={`text-xs ${textSecondaryClass} mt-0.5`}>
                                {v.violation_type?.replace(/_/g, ' ')} • {v.severity} • {new Date(v.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex-shrink-0">
                              {v.appeal_status === 'pending' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Under Review</span>
                              )}
                              {v.appeal_status === 'approved' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Overturned</span>
                              )}
                              {v.appeal_status === 'denied' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">Denied</span>
                              )}
                              {v.status === 'active' && !v.is_appealed && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400">Active</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Data Deletion Request */}
              <DeleteAccountSection />
            </CardContent>
          )}
        </Card>

        {/* About Section */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="app-info-card">
          <CardHeader>
            <CardTitle className={textPrimaryClass}>About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-sm ${textSecondaryClass}`}>
              Raw Surf OS v1.0
            </p>
            <p className={`text-sm ${textSecondaryClass} opacity-70 mt-2`}>
              The Social Marketplace for Surfers
            </p>
          </CardContent>
        </Card>

        {/* Theme Section - Mobile Only (md:hidden) */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300 md:hidden`} data-testid="theme-settings-mobile">
          <CardHeader>
            <button 
              onClick={() => setThemeDrawerOpen(!themeDrawerOpen)}
              className="w-full flex items-center justify-between"
            >
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                {theme === 'light' ? <Sun className="w-5 h-5 text-yellow-400" /> : 
                 theme === 'beach' ? <Waves className="w-5 h-5 text-cyan-400" /> : 
                 <Moon className="w-5 h-5 text-blue-400" />}
                Theme
              </CardTitle>
              {themeDrawerOpen ? (
                <ChevronDown className={`w-5 h-5 ${textSecondaryClass}`} />
              ) : (
                <ChevronRight className={`w-5 h-5 ${textSecondaryClass}`} />
              )}
            </button>
          </CardHeader>
          
          {/* Expandable Theme Options */}
          {themeDrawerOpen && (
            <CardContent className="space-y-2 pt-0">
              {[
                { value: 'light', label: 'Light Mode', icon: Sun, gradient: 'from-yellow-100 to-orange-100' },
                { value: 'dark', label: 'Dark Mode', icon: Moon, gradient: 'from-zinc-700 to-zinc-900' },
                { value: 'beach', label: 'Beach Mode', icon: Waves, gradient: 'from-cyan-400 to-blue-500' },
              ].map((t) => {
                const Icon = t.icon;
                const isSelected = theme === t.value;
                
                return (
                  <button
                    key={t.value}
                    onClick={() => {
                      toggleTheme(t.value);
                      toast.success(`Switched to ${t.label}`);
                    }}
                    className={`w-full p-3 rounded-xl border-2 transition-all duration-200 flex items-center gap-3 ${
                      isSelected
                        ? 'border-cyan-400 bg-cyan-400/10'
                        : 'border-border hover:border-muted-foreground'
                    }`}
                    data-testid={`mobile-theme-${t.value}`}
                  >
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${t.gradient} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${t.value === 'dark' ? 'text-foreground' : 'text-black/70'}`} />
                    </div>
                    <span className={`flex-1 text-left font-medium ${textPrimaryClass}`}>{t.label}</span>
                    {isSelected && (
                      <span className="px-2 py-0.5 bg-cyan-400 text-black text-xs font-bold rounded-full flex items-center gap-1">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </CardContent>
          )}
        </Card>

        {/* Admin Notice - Resend Domain Verification */}
        {user?.is_admin && (
          <Card className="mb-4 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30">
            <CardHeader>
              <CardTitle className={textPrimaryClass}>Admin Notice</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-sm ${textSecondaryClass}`}>
                <strong className="text-yellow-400">Resend Domain Verification Required:</strong> Password reset emails currently only work for the admin email. To enable emails for all users:
              </p>
              <ol className={`text-sm ${textSecondaryClass} mt-2 list-decimal list-inside space-y-1`}>
                <li>Go to <a href="https://resend.com/domains" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">resend.com/domains</a></li>
                <li>Add your custom domain</li>
                <li>Add the DNS records to your domain provider</li>
                <li>Update the FROM email in <code className="text-cyan-400">/app/backend/routes/password_reset.py</code></li>
              </ol>
            </CardContent>
          </Card>
        )}

        {/* Admin Console - Admin Only (Unified Entry Point) */}
        {user?.is_admin && (
          <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="admin-console-card">
            <CardHeader>
              <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
                <Shield className="w-5 h-5 text-red-500" />
                Admin Console
                <span className="ml-auto px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">ADMIN</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className={`text-sm ${textSecondaryClass}`}>
                Full platform control: user management, personas, pricing, live sessions, and more
              </p>
              <Button 
                onClick={() => navigate('/admin')}
                className="w-full bg-gradient-to-r from-red-500 via-orange-500 to-yellow-400 hover:from-red-600 hover:via-orange-600 hover:to-yellow-500 text-black font-bold"
                data-testid="admin-console-button"
              >
                <Shield className="w-4 h-4 mr-2" />
                Open Admin Console
                <Zap className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Logout Button */}
        <Button
          onClick={handleLogout}
          variant="outline"
          className="w-full h-12 border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          data-testid="logout-button"
        >
          <LogOut className="w-5 h-5 mr-2" />
          Log Out
        </Button>
      </div>
    </div>
  );
};

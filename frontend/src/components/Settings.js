import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { LogOut, User, Bell, Shield, DollarSign, ChevronRight, ChevronDown, MapPin, Loader2, Sun, Moon, Waves, Check, Zap, CreditCard, Megaphone, WifiOff, Download, Trash2, HardDrive, Image, Wallet } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';

import { toast } from 'sonner';
import useSettingsActions from '../hooks/useSettingsActions';
import apiClient from '../lib/apiClient';
import { AccountBillingHub } from './settings/AccountBillingHub';
import { AdCenterPanel } from './settings/AdCenterPanel';
import useOfflineMode from '../hooks/useOfflineMode';
import { ROLES } from '../constants/roles';

import { SurfModeCard } from './settings/SurfModeCard';
import { GromParentCard } from './settings/GromParentCard';
import { UsernameCard } from './settings/UsernameCard';
import { MetaConnectionsCard } from './settings/MetaConnectionsCard';
import { PasswordSecurityCard } from './settings/PasswordSecurityCard';
import { PrivacySection } from './settings/PrivacySection';
import { NotificationSection } from './settings/NotificationSection';
import { LegalSection } from './settings/LegalSection';




export var Settings = () => {
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
  
  // ============ HANDLERS EXTRACTED ============

  // Legal state now managed in LegalSection component

  const {
    toggleSection,
    fetchPrivacySettings,
    fetchNotificationPrefs,
    updateNotifPref,
    updatePrivacySetting,
    fetchFriends,
    handleLogout,
  } = useSettingsActions({
    user, navigate, logout,
    setExpandedSections,
    setFriends,
    setFriendsLoading,
    setNotifLoading,
    setNotifPrefs,
    setPendingRequests,
    setPrivacy,
    setPrivacyLoading,
  });
  
  // Fetch privacy settings
  useEffect(() => {
    if (user?.id) {
      fetchPrivacySettings();
      fetchNotificationPrefs();
      fetchFriends();
    }
  }, [user?.id]);
  
  
  
  
  
  
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


  // Use semantic Tailwind classes that reference CSS variables
  const mainBgClass = 'bg-background';
  const cardBgClass = 'bg-card border-border';
  const textPrimaryClass = 'text-foreground';
  const textSecondaryClass = 'text-muted-foreground';
  const borderClass = 'border-border';

  // Settings menu item component
  const SettingsMenuItem = ({ icon: Icon, label, description, onClick, color = 'text-muted-foreground' }) => (
    <button aria-label="div"
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
        <h1 className={`text-3xl font-bold mb-6 ${textPrimaryClass} font-oswald`}  data-testid="settings-title">
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

        {/* Surf Mode — Competitive/Pro progression for non-Grom surfers */}
        {isSurfer && !isGrom && (
          <SurfModeCard
            textPrimaryClass={textPrimaryClass}
            textSecondaryClass={textSecondaryClass}
            cardBgClass={cardBgClass}
          />
        )}

        {/* Grom Parent — AND-able toggle for surfers who are also parents */}
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
                      ? `${getCacheSize()} MB • Updated ${formatCacheTime()}` 
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
              <Button aria-label="Delete"
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
              <PrivacySection
                privacy={privacy}
                privacyLoading={privacyLoading}
                updatePrivacySetting={updatePrivacySetting}
                textPrimaryClass={textPrimaryClass}
                textSecondaryClass={textSecondaryClass}
                borderClass={borderClass}
              />
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
              <NotificationSection
                notifPrefs={notifPrefs}
                notifLoading={notifLoading}
                updateNotifPref={updateNotifPref}
                isPhotographer={isPhotographer}
                isGromParent={isGromParent}
                textPrimaryClass={textPrimaryClass}
                textSecondaryClass={textSecondaryClass}
                borderClass={borderClass}
              />
            </CardContent>
          )}
        </Card>

        {/* Legal / Terms of Service — Self-contained component */}
        <LegalSection
          userId={user?.id}
          textPrimaryClass={textPrimaryClass}
          textSecondaryClass={textSecondaryClass}
          borderClass={borderClass}
          cardBgClass={cardBgClass}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
        />



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

        {/* Theme Section - Appearance */}
        <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="theme-settings-card">
          <CardHeader>
            <button aria-label="Sun" 
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
              <Button aria-label="Shield" 
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
        <Button aria-label="Log Out"
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

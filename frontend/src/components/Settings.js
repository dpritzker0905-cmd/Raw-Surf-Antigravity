import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { LogOut, User, Bell, Shield, Camera, DollarSign, Image, CalendarCheck, Wallet, ChevronRight, ChevronDown, Users, Eye, EyeOff, MapPin, Loader2, MessageSquare, Heart, UserPlus, Mail, Volume2, VolumeX, Sun, Moon, Waves, Check, Zap, CreditCard, Megaphone, Activity, WifiOff, Download, Trash2, HardDrive, Link2, ExternalLink, AtSign, Clock, AlertCircle, Trophy, Star, Send } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import axios from 'axios';
import { AccountBillingHub } from './settings/AccountBillingHub';
import { AdCenterPanel } from './settings/AdCenterPanel';
import useOfflineMode from '../hooks/useOfflineMode';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * SurfModeCard — Lets non-Grom surfers set their surf mode (Casual / Competitive / Pro).
 * Competitive = behavioral label only. Pro = triggers WSL verification flow (existing backend route).
 * Legend = admin-assigned via elite_tier; shown read-only.
 */
const SurfModeCard = ({ textPrimaryClass, textSecondaryClass, cardBgClass }) => {
  const { user, updateUser } = useAuth();
  const [surfMode, setSurfMode] = useState(user?.surf_mode || 'casual');
  const [saving, setSaving] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState(null); // null, 'pending', 'approved', 'rejected'
  const [loadingVerif, setLoadingVerif] = useState(true);
  const [wslForm, setWslForm] = useState({ wsl_athlete_id: '', wsl_profile_url: '', competition_history_urls: '', additional_notes: '' });
  const [submittingWsl, setSubmittingWsl] = useState(false);
  const [proSectionOpen, setProSectionOpen] = useState(false);

  const isLegend = user?.elite_tier === 'legend';
  const isVerifiedPro = user?.role === 'Pro' && user?.elite_tier === 'pro_elite';

  useEffect(() => {
    if (user?.id) fetchVerificationStatus();
  }, [user?.id]);

  const fetchVerificationStatus = async () => {
    try {
      const res = await axios.get(`${API}/api/verification/my-requests?user_id=${user.id}`);
      const proReq = (res.data || []).find(r => r.verification_type === 'pro_surfer');
      if (proReq) setVerificationStatus(proReq.status);
    } catch (e) {
      // Non-blocking
    } finally {
      setLoadingVerif(false);
    }
  };

  const handleModeSelect = async (mode) => {
    if (mode === surfMode) return;
    setSurfMode(mode);
    setSaving(true);
    try {
      await axios.patch(`${API}/api/profiles/${user.id}`, { surf_mode: mode });
      if (updateUser) updateUser({ ...user, surf_mode: mode });
      toast.success(`Surf Mode set to ${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
    } catch (e) {
      toast.error('Failed to update surf mode');
      setSurfMode(user?.surf_mode || 'casual');
    } finally {
      setSaving(false);
    }
  };

  const handleWslSubmit = async () => {
    if (!wslForm.wsl_athlete_id.trim() || !wslForm.wsl_profile_url.trim()) {
      toast.error('WSL Athlete ID and Profile URL are required');
      return;
    }
    setSubmittingWsl(true);
    try {
      const urls = wslForm.competition_history_urls
        ? wslForm.competition_history_urls.split(',').map(u => u.trim()).filter(Boolean)
        : [];
      await axios.post(`${API}/api/verification/pro-surfer/submit`, {
        user_id: user.id,
        wsl_athlete_id: wslForm.wsl_athlete_id.trim(),
        wsl_profile_url: wslForm.wsl_profile_url.trim(),
        competition_history_urls: urls,
        additional_notes: wslForm.additional_notes.trim() || undefined,
      });
      setVerificationStatus('pending');
      setProSectionOpen(false);
      toast.success('Verification submitted! Our team will review within 24-48 hours.');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Submission failed');
    } finally {
      setSubmittingWsl(false);
    }
  };

  // Only 2 selectable modes — Pro is not a surf mode you pick, it's verified status
  const modes = [
    { id: 'casual',      label: 'Casual',      icon: '🌊' },
    { id: 'competitive', label: 'Competitive', icon: '🏆' },
  ];

  // Pro section header label based on current state
  const proSectionLabel = loadingVerif ? 'Apply for Pro Verification'
    : isVerifiedPro ? '⭐ Verified Pro'
    : isLegend ? '🎖️ Legend'
    : verificationStatus === 'pending' || verificationStatus === 'under_review' ? '⏳ Verification Pending'
    : verificationStatus === 'rejected' ? '❌ Reapply for Pro Verification'
    : 'Apply for Pro Verification';

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`}>
      <CardHeader>
        <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
          <Trophy className="w-5 h-5 text-yellow-400" />
          Surf Mode
          {isLegend && (
            <span className="ml-auto px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded-full border border-amber-500/30">
              🎖️ Legend
            </span>
          )}
          {isVerifiedPro && !isLegend && (
            <span className="ml-auto px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
              ✅ Verified Pro
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Legend read-only display */}
        {isLegend ? (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
            <p className="text-amber-400 font-semibold">🎖️ Legend</p>
            <p className={`text-xs ${textSecondaryClass} mt-1`}>
              This status was personally assigned by Raw Surf — reserved for icons of the sport.
            </p>
          </div>
        ) : (
          /* 2-pill toggle: Casual / Competitive */
          <div className="flex gap-2">
            {modes.map(m => (
              <button
                key={m.id}
                id={`surf-mode-${m.id}`}
                onClick={() => handleModeSelect(m.id)}
                disabled={saving}
                className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all text-sm font-medium ${
                  surfMode === m.id || (surfMode === 'pro' && m.id === 'competitive')
                    ? 'border-yellow-400 bg-yellow-400/10 text-yellow-400'
                    : 'border-border bg-muted/40 text-muted-foreground hover:border-zinc-500'
                }`}
              >
                <span className="text-lg">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Contextual sub-panel for Casual */}
        {!isLegend && (surfMode === 'casual') && (
          <p className={`text-xs ${textSecondaryClass}`}>
            Standard surfer profile — book sessions, collect photos, track your journey.
          </p>
        )}

        {/* Contextual sub-panel for Competitive */}
        {!isLegend && (surfMode === 'competitive' || surfMode === 'pro') && (
          <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <p className="text-purple-400 text-sm font-semibold flex items-center gap-1"><Trophy className="w-4 h-4" /> Competitive Mode Active</p>
            <ul className={`text-xs ${textSecondaryClass} mt-2 space-y-1 list-none`}>
              <li>✓ Appears on contest boards &amp; community rankings</li>
              <li>✓ Stoked dashboard activated</li>
              <li>✓ Visible to photographers as a competitive athlete</li>
            </ul>
          </div>
        )}

        {/* ── Pro Verification — collapsible section, not a selectable pill ── */}
        {!isLegend && (
          <div className="rounded-xl border border-border overflow-hidden mt-3">
            <button
              id="pro-verification-toggle"
              onClick={() => setProSectionOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted transition-colors text-sm font-medium text-left"
            >
              <span className={isVerifiedPro ? 'text-emerald-600 dark:text-emerald-400' : verificationStatus === 'pending' || verificationStatus === 'under_review' ? 'text-yellow-600 dark:text-yellow-400' : textPrimaryClass}>
                {proSectionLabel}
              </span>
              <ChevronDown className={`w-4 h-4 ${textSecondaryClass} transition-transform duration-200 ${proSectionOpen ? 'rotate-180' : ''}`} />
            </button>

            {proSectionOpen && (
              <div className="p-4 space-y-3 border-t border-border bg-background/50">
                {loadingVerif ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-yellow-400" />
                  </div>
                ) : isVerifiedPro ? (
                  <div className="text-center py-2">
                    <p className="text-emerald-400 font-semibold">✅ WSL Verified Pro</p>
                    <p className={`text-xs ${textSecondaryClass} mt-1`}>Your pro status is confirmed. Welcome to The Peak.</p>
                  </div>
                ) : verificationStatus === 'pending' || verificationStatus === 'under_review' ? (
                  <div className="text-center py-2">
                    <p className="text-yellow-400 font-semibold">⏳ Verification Under Review</p>
                    <p className={`text-xs ${textSecondaryClass} mt-1`}>Our team is reviewing your credentials. You'll hear back within 24–48 hours.</p>
                  </div>
                ) : (
                  <>
                    {verificationStatus === 'rejected' && (
                      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                        <p className="text-red-400 text-sm font-semibold">❌ Previous request was not approved</p>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>You may reapply with updated credentials below.</p>
                      </div>
                    )}
                    <WslVerificationForm
                      wslForm={wslForm}
                      setWslForm={setWslForm}
                      onSubmit={handleWslSubmit}
                      submitting={submittingWsl}
                      textSecondaryClass={textSecondaryClass}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        )}

      </CardContent>
    </Card>
  );
};


/** Inline WSL verification form sub-component */
const WslVerificationForm = ({ wslForm, setWslForm, onSubmit, submitting, textSecondaryClass }) => (
  <div className="space-y-3 p-3 rounded-xl bg-muted/30 border border-border">
    <p className="text-yellow-600 dark:text-yellow-400 text-sm font-semibold flex items-center gap-1"><Star className="w-4 h-4" /> Apply for Pro Verification</p>
    <p className={`text-xs ${textSecondaryClass}`}>Submit your WSL credentials for review. Approval grants Verified Pro status.</p>
    <Input
      id="wsl-athlete-id"
      placeholder="WSL Athlete ID (e.g. 12345)"
      value={wslForm.wsl_athlete_id}
      onChange={e => setWslForm(f => ({ ...f, wsl_athlete_id: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Input
      id="wsl-profile-url"
      placeholder="WSL Profile URL (https://...)"
      value={wslForm.wsl_profile_url}
      onChange={e => setWslForm(f => ({ ...f, wsl_profile_url: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Input
      id="wsl-competition-urls"
      placeholder="Competition result URLs (comma-separated, optional)"
      value={wslForm.competition_history_urls}
      onChange={e => setWslForm(f => ({ ...f, competition_history_urls: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Input
      id="wsl-notes"
      placeholder="Additional notes (optional)"
      value={wslForm.additional_notes}
      onChange={e => setWslForm(f => ({ ...f, additional_notes: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Button
      id="submit-pro-verification"
      onClick={onSubmit}
      disabled={submitting}
      className="w-full bg-gradient-to-r from-yellow-500 to-amber-500 text-black font-bold hover:from-yellow-400 hover:to-amber-400"
    >
      {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
      Submit for Review
    </Button>
  </div>
);

/**
 * GromParentCard — Lets any non-Grom surfer opt in to Grom Parent mode.
 * Being a Grom Parent is an AND: a Competitive Surfer can ALSO be a Grom Parent.
 * Enabling it gives access to GromHQ, parental controls, and Grom gallery management.
 */
const GromParentCard = ({ textPrimaryClass, textSecondaryClass, cardBgClass }) => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [toggling, setToggling] = useState(false);
  // Dedicated Grom Parent accounts have is_grom_parent true by default in login response
  const isDedicatedGromParent = user?.role === 'Grom Parent';
  const isEnabled = isDedicatedGromParent || user?.is_grom_parent === true;

  const handleToggle = async () => {
    if (isDedicatedGromParent) return; // Can't toggle off a dedicated account
    setToggling(true);
    const newVal = !user?.is_grom_parent;
    try {
      await axios.patch(`${API}/api/profiles/${user.id}`, { is_grom_parent: newVal });
      updateUser({ ...user, is_grom_parent: newVal });
      if (newVal) {
        toast.success('Grom Parent mode enabled — access GromHQ to link your child\'s account');
      } else {
        toast.success('Grom Parent mode disabled');
      }
    } catch (e) {
      toast.error('Failed to update Grom Parent setting');
    } finally {
      setToggling(false);
    }
  };

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`}>
      <CardHeader>
        <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
          <Users className="w-5 h-5 text-pink-400" />
          Grom Parent
          {isEnabled && (
            <span className="ml-auto px-2 py-0.5 bg-pink-500/20 text-pink-400 text-xs rounded-full border border-pink-500/30">
              Active
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isDedicatedGromParent ? (
          <p className={`text-xs ${textSecondaryClass}`}>
            Your account is a dedicated Grom Parent account. Head to GromHQ to manage your child's profile, parental controls, and linked sessions.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${textPrimaryClass}`}>Enable Grom Parent Mode</p>
              <p className={`text-xs ${textSecondaryClass} mt-0.5`}>
                Adds GromHQ access to link and manage your child's Grom account alongside your surfer identity.
              </p>
            </div>
            <button
              id="grom-parent-toggle"
              onClick={handleToggle}
              disabled={toggling}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                isEnabled ? 'bg-pink-500' : 'bg-zinc-600'
              }`}
            >
              <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                isEnabled ? 'left-5' : 'left-0.5'
              }`} />
            </button>
          </div>
        )}
        {isEnabled && (
          <button
            id="goto-gromhq"
            onClick={() => navigate('/grom-hq')}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 text-sm font-medium hover:bg-pink-500/20 transition-colors"
          >
            <span>Open GromHQ</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </CardContent>
    </Card>
  );
};

const UsernameCard = ({ userId, _textPrimaryClass, textSecondaryClass, borderClass, cardBgClass }) => {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (userId) fetchStatus();
  }, [userId]);

  const fetchStatus = async () => {
    try {
      const response = await axios.get(`${API}/api/username/status?user_id=${userId}`);
      setStatus(response.data);
      setNewUsername(response.data.username || '');
    } catch (error) {
      logger.error('Failed to fetch username status:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkAvailability = async (username) => {
    if (!username || username.length < 3) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    try {
      const response = await axios.get(`${API}/api/username/check/${username}?user_id=${userId}`);
      setAvailability(response.data);
    } catch (error) {
      setAvailability({ available: false, reason: 'Unable to check' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (editing && newUsername && newUsername !== status?.username) {
        checkAvailability(newUsername);
      }
    }, 400);
    return () => clearTimeout(debounce);
  }, [newUsername, editing, status?.username]);

  const handleSave = async () => {
    if (!availability?.available && newUsername !== status?.username) {
      toast.error('Username not available');
      return;
    }
    
    setSaving(true);
    try {
      if (status?.has_username) {
        await axios.put(`${API}/api/username/change?user_id=${userId}`, { new_username: newUsername });
      } else {
        await axios.post(`${API}/api/username/set?user_id=${userId}`, { username: newUsername });
      }
      toast.success(`Username updated to @${newUsername}`);
      setEditing(false);
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to update username');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current username display */}
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2">
          <AtSign className="w-4 h-4 text-cyan-400" />
          <span className={textSecondaryClass}>Username</span>
        </div>
        {status?.username ? (
          <span className="text-cyan-400 font-medium">@{status.username}</span>
        ) : (
          <Badge className="bg-yellow-500/20 text-yellow-400">Not Set</Badge>
        )}
      </div>

      {/* Edit mode */}
      {editing ? (
        <div className="space-y-3">
          <div className="relative">
            <span className={`absolute left-3 top-1/2 -translate-y-1/2 ${textSecondaryClass}`}>@</span>
            <Input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              className={`pl-8 ${cardBgClass} ${borderClass}`}
              placeholder="username"
              maxLength={30}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {checking ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : availability?.available ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : availability && !availability.available && newUsername !== status?.username ? (
                <AlertCircle className="w-4 h-4 text-red-500" />
              ) : null}
            </div>
          </div>
          
          {availability && !availability.available && newUsername !== status?.username && (
            <p className="text-sm text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {availability.reason}
            </p>
          )}
          
          <div className="flex gap-2">
            <Button
              onClick={handleSave}
              disabled={saving || (!availability?.available && newUsername !== status?.username)}
              className="flex-1 bg-cyan-500 hover:bg-cyan-600"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save
            </Button>
            <Button variant="outline" onClick={() => { setEditing(false); setNewUsername(status?.username || ''); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Setup or Change button */}
          {!status?.username ? (
            <Button
              onClick={() => navigate('/setup-username')}
              className="w-full bg-cyan-500 hover:bg-cyan-600"
            >
              <AtSign className="w-4 h-4 mr-2" />
              Set Up Username
            </Button>
          ) : status?.can_change ? (
            <Button
              variant="outline"
              onClick={() => setEditing(true)}
              className="w-full"
            >
              Change Username
            </Button>
          ) : (
            <div className={`p-3 rounded-lg ${cardBgClass} ${borderClass}`}>
              <div className="flex items-center gap-2 text-sm text-yellow-400">
                <Clock className="w-4 h-4" />
                <span>Can change in {status.days_until_change} days</span>
              </div>
              <p className={`text-xs mt-1 ${textSecondaryClass}`}>
                Usernames can be changed once every 60 days
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Meta Connections Card - Connect Facebook/Instagram for direct posting
 */
const MetaConnectionsCard = ({ userId, textPrimaryClass, textSecondaryClass, borderClass, cardBgClass }) => {
  const [searchParams] = useSearchParams();
  const [metaStatus, setMetaStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (userId) {
      fetchMetaStatus();
    }
  }, [userId]);

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    if (code && state) {
      handleOAuthCallback(code, state);
    }
  }, [searchParams]);

  const fetchMetaStatus = async () => {
    try {
      const response = await axios.get(`${API}/api/meta/status?user_id=${userId}`);
      setMetaStatus(response.data);
    } catch (err) {
      setMetaStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthCallback = async (code, state) => {
    setConnecting(true);
    try {
      const response = await axios.get(`${API}/api/meta/callback`, {
        params: { code, state, redirect_uri: `${window.location.origin}/settings` }
      });
      
      if (response.data.success) {
        toast.success('Meta accounts connected successfully!');
        fetchMetaStatus();
        // Clear URL params
        window.history.replaceState({}, '', '/settings');
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to connect Meta accounts');
    } finally {
      setConnecting(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const response = await axios.get(`${API}/api/meta/oauth-url`, {
        params: { 
          user_id: userId,
          redirect_uri: `${window.location.origin}/settings`
        }
      });
      
      // Redirect to Meta OAuth
      window.location.href = response.data.oauth_url;
    } catch (err) {
      toast.error('Failed to start Meta connection');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await axios.delete(`${API}/api/meta/disconnect?user_id=${userId}`);
      setMetaStatus(null);
      toast.success('Meta accounts disconnected');
    } catch (err) {
      toast.error('Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const isConnected = metaStatus?.facebook_connected || metaStatus?.instagram_connected;

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="meta-connections-card">
      <CardHeader>
        <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
          <Link2 className="w-5 h-5 text-blue-400" />
          Social Connections
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          </div>
        ) : isConnected ? (
          <>
            {/* Connected Status */}
            <div className={`p-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-pink-500/10 border border-blue-500/30`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${textPrimaryClass}`}>Meta Accounts</span>
                <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full">
                  Connected
                </span>
              </div>
              
              {/* Facebook Page */}
              {metaStatus.facebook_connected && (
                <div className={`flex items-center gap-2 py-1.5 ${textSecondaryClass} text-sm`}>
                  <span className="text-blue-500 text-lg">f</span>
                  <span>Facebook Page: {metaStatus.facebook_name || 'Connected'}</span>
                </div>
              )}
              
              {/* Instagram */}
              {metaStatus.instagram_connected && (
                <div className={`flex items-center gap-2 py-1.5 ${textSecondaryClass} text-sm`}>
                  <span className="text-pink-500 text-lg">📸</span>
                  <span>Instagram: @{metaStatus.instagram_username || 'Connected'}</span>
                </div>
              )}
            </div>

            <p className={`text-xs ${textSecondaryClass}`}>
              You can now share surf sessions directly to your Facebook Page and Instagram feed from any post's share menu.
            </p>

            <Button
              onClick={handleDisconnect}
              disabled={disconnecting}
              variant="outline"
              className={`w-full ${borderClass} text-red-400 hover:bg-red-500/10`}
              data-testid="disconnect-meta-btn"
            >
              {disconnecting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Disconnect Meta Accounts
            </Button>
          </>
        ) : (
          <>
            {/* Not Connected */}
            <div className={`text-center py-4`}>
              <div className="flex items-center justify-center gap-4 mb-3">
                <span className="text-3xl text-blue-500">f</span>
                <span className={`text-lg ${textSecondaryClass}`}>+</span>
                <span className="text-3xl">📸</span>
              </div>
              <p className={`text-sm ${textPrimaryClass} font-medium mb-1`}>
                Connect Facebook & Instagram
              </p>
              <p className={`text-xs ${textSecondaryClass} mb-4`}>
                Share your surf sessions directly to your social feeds
              </p>
            </div>

            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-foreground"
              data-testid="connect-meta-btn"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Connecting...
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Connect with Meta
                </>
              )}
            </Button>

            <p className={`text-xs ${textSecondaryClass} text-center`}>
              Requires a Facebook Page and/or Instagram Business account
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
};

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
    privacy: false,        // Privacy & Safety
    notifications: false,  // Notifications
    friends: false         // Friends
  });
  
  // Toggle section expand/collapse
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  
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
      const response = await axios.get(`${API}/api/friends/privacy/${user.id}`);
      setPrivacy(response.data);
    } catch (error) {
      logger.error('Failed to fetch privacy settings:', error);
    }
  };
  
  const fetchNotificationPrefs = async () => {
    try {
      const response = await axios.get(`${API}/api/notifications/preferences/${user.id}`);
      setNotifPrefs(response.data);
    } catch (error) {
      logger.error('Failed to fetch notification preferences:', error);
    }
  };
  
  const updateNotifPref = async (key, value) => {
    setNotifLoading(true);
    try {
      await axios.put(`${API}/api/notifications/preferences/${user.id}`, { [key]: value });
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
      await axios.put(`${API}/api/friends/privacy/${user.id}`, { [key]: value });
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
        axios.get(`${API}/api/friends/list/${user.id}`),
        axios.get(`${API}/api/friends/pending/${user.id}`)
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
      await axios.post(`${API}/api/friends/accept/${requestId}?user_id=${user.id}`);
      toast.success('Friend request accepted!');
      fetchFriends();
    } catch (error) {
      toast.error('Failed to accept request');
    }
  };
  
  const _handleDeclineFriend = async (requestId) => {
    try {
      await axios.post(`${API}/api/friends/decline/${requestId}?user_id=${user.id}`);
      toast.success('Friend request declined');
      fetchFriends();
    } catch (error) {
      toast.error('Failed to decline request');
    }
  };
  
  const _handleRemoveFriend = async (friendshipId) => {
    try {
      await axios.delete(`${API}/api/friends/${friendshipId}?user_id=${user.id}`);
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
  const isGrom = effectiveRole === 'Grom';
  const isBusiness = businessRoles.includes(effectiveRole);
  
  // GROM PARENT: true for dedicated Grom Parent role OR the opt-in flag (surfer who is also a parent)
  const isGromParent = effectiveRole === 'Grom Parent' || user?.is_grom_parent === true;
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
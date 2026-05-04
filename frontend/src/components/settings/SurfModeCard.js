import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Loader2, ChevronDown, Trophy, Star, Send } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { ROLES } from '../../constants/roles';

/**
 * SurfModeCard — Lets non-Grom surfers set their surf mode (Casual / Competitive / Pro).
 * Competitive = behavioral label only. Pro = triggers WSL verification flow (existing backend route).
 * Legend = admin-assigned via elite_tier; shown read-only.
 */
export const SurfModeCard = ({ textPrimaryClass, textSecondaryClass, cardBgClass }) => {
  const { user, updateUser } = useAuth();
  const [surfMode, setSurfMode] = useState(user?.surf_mode || 'casual');
  const [saving, setSaving] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState(null); // null, 'pending', 'approved', 'rejected'
  const [loadingVerif, setLoadingVerif] = useState(true);
  const [wslForm, setWslForm] = useState({ wsl_athlete_id: '', wsl_profile_url: '', competition_history_urls: '', additional_notes: '' });
  const [submittingWsl, setSubmittingWsl] = useState(false);
  const [proSectionOpen, setProSectionOpen] = useState(false);

  const isLegend = user?.elite_tier === 'legend';
  const isVerifiedPro = user?.role === ROLES.PRO && user?.elite_tier === 'pro_elite';

  useEffect(() => {
    if (user?.id) fetchVerificationStatus();
  }, [user?.id]);

  const fetchVerificationStatus = async () => {
    try {
      const res = await apiClient.get(`/verification/my-requests`);
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
      await apiClient.patch(`/profiles/${user.id}`, { surf_mode: mode });
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
      await apiClient.post(`/verification/pro-surfer/submit`, {
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
    { id: 'casual',      label: 'Casual',      icon: '??' },
    { id: 'competitive', label: 'Competitive', icon: '??' },
  ];

  // Pro section header label based on current state
  const proSectionLabel = loadingVerif ? 'Apply for Pro Verification'
    : isVerifiedPro ? '? Verified Pro'
    : isLegend ? '??? Legend'
    : verificationStatus === 'pending' || verificationStatus === 'under_review' ? '? Verification Pending'
    : verificationStatus === 'rejected' ? '? Reapply for Pro Verification'
    : 'Apply for Pro Verification';

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`}>
      <CardHeader>
        <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
          <Trophy className="w-5 h-5 text-yellow-400" />
          Surf Mode
          {isLegend && (
            <span className="ml-auto px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded-full border border-amber-500/30">
              ??? Legend
            </span>
          )}
          {isVerifiedPro && !isLegend && (
            <span className="ml-auto px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded-full border border-emerald-500/30">
              ? Verified Pro
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Legend read-only display */}
        {isLegend ? (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
            <p className="text-amber-400 font-semibold">??? Legend</p>
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
              <li>? Appears on contest boards &amp; community rankings</li>
              <li>? Stoked dashboard activated</li>
              <li>? Visible to photographers as a competitive athlete</li>
            </ul>
          </div>
        )}

        {/* -- Pro Verification — collapsible section, not a selectable pill -- */}
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
                    <p className="text-emerald-400 font-semibold">? WSL Verified Pro</p>
                    <p className={`text-xs ${textSecondaryClass} mt-1`}>Your pro status is confirmed. Welcome to The Peak.</p>
                  </div>
                ) : verificationStatus === 'pending' || verificationStatus === 'under_review' ? (
                  <div className="text-center py-2">
                    <p className="text-yellow-400 font-semibold">? Verification Under Review</p>
                    <p className={`text-xs ${textSecondaryClass} mt-1`}>Our team is reviewing your credentials. You'll hear back within 24–48 hours.</p>
                  </div>
                ) : (
                  <>
                    {verificationStatus === 'rejected' && (
                      <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                        <p className="text-red-400 text-sm font-semibold">? Previous request was not approved</p>
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
    <Input aria-label="WSL Athlete ID (e.g. 12345)"
      id="wsl-athlete-id"
      placeholder="WSL Athlete ID (e.g. 12345)"
      value={wslForm.wsl_athlete_id}
      onChange={e => setWslForm(f => ({ ...f, wsl_athlete_id: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Input aria-label="WSL Profile URL (https://...)"
      id="wsl-profile-url"
      placeholder="WSL Profile URL (https://...)"
      value={wslForm.wsl_profile_url}
      onChange={e => setWslForm(f => ({ ...f, wsl_profile_url: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Input aria-label="Competition result URLs (comma-separated, optional)"
      id="wsl-competition-urls"
      placeholder="Competition result URLs (comma-separated, optional)"
      value={wslForm.competition_history_urls}
      onChange={e => setWslForm(f => ({ ...f, competition_history_urls: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Input aria-label="Additional notes (optional)"
      id="wsl-notes"
      placeholder="Additional notes (optional)"
      value={wslForm.additional_notes}
      onChange={e => setWslForm(f => ({ ...f, additional_notes: e.target.value }))}
      className="bg-zinc-800 border-zinc-600 text-white text-sm h-9"
    />
    <Button aria-label="Loader2"
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

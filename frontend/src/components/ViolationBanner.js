/**
 * ViolationBanner.js - User-facing violation awareness notification.
 *
 * Displays active ToS violations, strike count, suspension status,
 * and provides an inline appeal submission form.
 *
 * UX Pattern: Fixed-position floating notification in the bottom-right
 * corner (desktop) or bottom-center (mobile). Does NOT overlay page
 * content or interfere with navigation/admin workflows.
 *
 * Hidden on: /admin routes, /auth routes.
 * Dismissal: Session-dismissable; reappears on next page load.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useLocation } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import {
  AlertTriangle, Shield, ChevronDown, ChevronUp, Send,
  Loader2, X, Clock, Ban, Scale, FileText
} from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import useActiveSession from '../hooks/useActiveSession';

// --- Severity config ----------------------------------------------------------
const SEVERITY_CONFIG = {
  minor:    { color: 'blue',   label: 'Minor' },
  moderate: { color: 'yellow', label: 'Moderate' },
  severe:   { color: 'orange', label: 'Severe' },
  critical: { color: 'red',    label: 'Critical' },
};

const ViolationBanner = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const { activeSession } = useActiveSession();
  const location = useLocation();
  const isLight = theme === 'light';

  const [violations, setViolations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [appealingId, setAppealingId] = useState(null);
  const [appealText, setAppealText] = useState('');
  const [appealSubmitting, setAppealSubmitting] = useState(false);

  const fetchViolations = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await apiClient.get(`/compliance/violations/user/${user.id}`);
      const data = res.data;
      const activeViolations = (data.violations || []).filter(v => v.status !== 'overturned');
      if (activeViolations.length > 0 || data.is_suspended || data.is_banned) {
        setViolations({ ...data, violations: activeViolations });
      } else {
        setViolations(null);
      }
    } catch {
      setViolations(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchViolations();
  }, [fetchViolations]);

  const handleSubmitAppeal = async (violationId) => {
    if (!appealText.trim()) {
      toast.error('Please explain why you believe this violation should be reconsidered');
      return;
    }
    setAppealSubmitting(true);
    try {
      await apiClient.post(`/compliance/violations/${violationId}/appeal`, {
        appeal_text: appealText.trim()
      });
      toast.success('Appeal submitted - we\'ll review it shortly');
      setAppealingId(null);
      setAppealText('');
      fetchViolations();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to submit appeal');
    } finally {
      setAppealSubmitting(false);
    }
  };

  // --- Don't render conditions ------------------------------------------------
  // Hide on admin pages (admins manage violations from the dashboard, not a banner)
  const isAdminPage = location.pathname.startsWith('/admin');
  const isAuthPage = location.pathname.startsWith('/auth') || location.pathname === '/';

  if (loading || !violations || dismissed || isAdminPage || isAuthPage) return null;

  const { total_strikes, is_suspended, is_banned, suspension_until } = violations;
  const activeViolations = violations.violations || [];

  const isCritical = is_banned || is_suspended;

  // --- Collapsed pill (always visible) ----------------------------------------
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`fixed z-[200] transition-all animate-in slide-in-from-bottom-4 duration-300
          ${activeSession ? 'bottom-[160px]' : 'bottom-24'} md:bottom-6 right-4 md:right-6
          flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg
          ${isCritical
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600'}
          text-white cursor-pointer group`}
        data-testid="violation-banner"
      >
        {is_banned ? (
          <Ban className="w-4 h-4" />
        ) : is_suspended ? (
          <Shield className="w-4 h-4" />
        ) : (
          <AlertTriangle className="w-4 h-4 animate-pulse" />
        )}
        <span className="text-sm font-semibold whitespace-nowrap">
          {is_banned
            ? 'Account Banned'
            : is_suspended
            ? 'Account Suspended'
            : `${activeViolations.length} Violation${activeViolations.length !== 1 ? 's' : ''}`}
        </span>
        {total_strikes > 0 && (
          <span className="px-1.5 py-0.5 bg-white/20 rounded-full text-xs font-bold">
            {total_strikes}
          </span>
        )}
        <ChevronUp className="w-3.5 h-3.5 text-white/70 group-hover:text-white transition-colors" />
      </button>
    );
  }

  // --- Expanded panel (floating card) -----------------------------------------
  return (
    <div
      className={`fixed z-[200] animate-in slide-in-from-bottom-4 duration-300
        ${activeSession ? 'bottom-[160px]' : 'bottom-24'} md:bottom-6 right-4 md:right-6
        w-[calc(100vw-2rem)] md:w-[420px] max-h-[70vh]
        rounded-2xl shadow-2xl overflow-hidden
        ${isLight ? 'bg-white border border-gray-200' : 'bg-zinc-900 border border-zinc-700'}
      `}
      data-testid="violation-banner-expanded"
    >
      {/* Header bar */}
      <div
        className={`px-4 py-3 flex items-center justify-between cursor-pointer
          ${isCritical
            ? 'bg-red-600'
            : 'bg-gradient-to-r from-yellow-500 to-orange-500'}`}
        onClick={() => setExpanded(false)}
      >
        <div className="flex items-center gap-2 text-white min-w-0">
          {is_banned ? <Ban className="w-4 h-4 flex-shrink-0" /> :
           is_suspended ? <Shield className="w-4 h-4 flex-shrink-0" /> :
           <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {is_banned ? 'Account Permanently Banned'
                : is_suspended ? 'Account Suspended'
                : `${activeViolations.length} Active Violation${activeViolations.length !== 1 ? 's' : ''}`}
            </p>
            <p className="text-xs text-white/70 truncate">
              {is_banned ? 'Contact support to appeal'
                : is_suspended && suspension_until
                ? `Until ${new Date(suspension_until).toLocaleDateString()}`
                : `${total_strikes} strike${total_strikes !== 1 ? 's' : ''} on your account`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ChevronDown className="w-4 h-4 text-white/70" />
          <button
            onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
            className="p-1 rounded-full hover:bg-white/20 text-white/60 hover:text-white transition-colors"
            data-testid="violation-banner-dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="overflow-y-auto max-h-[calc(70vh-56px)] p-3 space-y-3">
        {/* Info callout */}
        <div className={`p-2.5 rounded-lg text-xs flex items-start gap-2
          ${isLight ? 'bg-blue-50 text-blue-700' : 'bg-blue-950/30 text-blue-300'}`}>
          <Scale className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <p>You may appeal any violation you believe was issued in error. Appeals are typically reviewed within 24-48 hours.</p>
        </div>

        {/* Violation list */}
        {activeViolations.map(v => {
          const sev = SEVERITY_CONFIG[v.severity] || SEVERITY_CONFIG.minor;
          const canAppeal = !v.is_appealed;
          const isPending = v.appeal_status === 'pending';
          const isDenied = v.appeal_status === 'denied';

          return (
            <div
              key={v.id}
              className={`rounded-xl border p-3 ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700'}`}
              data-testid={`violation-item-${v.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                      {v.title}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium bg-${sev.color}-500/20 text-${sev.color}-400`}>
                      {sev.label}
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                    {v.violation_type?.replace(/_/g, ' ')} - {new Date(v.created_at).toLocaleDateString()}
                  </p>
                  {v.description && (
                    <p className={`text-xs mt-1.5 ${isLight ? 'text-gray-600' : 'text-gray-300'}`}>
                      {v.description}
                    </p>
                  )}
                </div>

                <div className="flex-shrink-0">
                  {isPending && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">
                      <Clock className="w-3 h-3" /> Under Review
                    </span>
                  )}
                  {isDenied && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                      Denied
                    </span>
                  )}
                  {v.appeal_status === 'approved' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                      Overturned
                    </span>
                  )}
                </div>
              </div>

              {/* Appeal form */}
              {canAppeal && (
                <>
                  {appealingId === v.id ? (
                    <div className="mt-3 space-y-2 pt-2 border-t border-border">
                      <Textarea aria-label="I believe this was a mistake because..."
                        placeholder="I believe this was a mistake because..."
                        value={appealText}
                        onChange={(e) => setAppealText(e.target.value)}
                        className={`text-sm h-20 ${isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-700'}`}
                        data-testid={`appeal-text-${v.id}`}
                      />
                      <div className="flex gap-2">
                        <Button aria-label="Loader2"
                          size="sm"
                          onClick={() => handleSubmitAppeal(v.id)}
                          disabled={appealSubmitting || !appealText.trim()}
                          className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs"
                          data-testid={`appeal-submit-${v.id}`}
                        >
                          {appealSubmitting
                            ? <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Submitting...</>
                            : <><Send className="w-3 h-3 mr-1" /> Submit Appeal</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setAppealingId(null); setAppealText(''); }}
                          className="border-border text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button aria-label="File Text"
                      size="sm"
                      variant="outline"
                      className={`mt-2 text-xs ${isLight ? 'text-blue-600 border-blue-300 hover:bg-blue-50' : 'text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/10'}`}
                      onClick={() => setAppealingId(v.id)}
                      data-testid={`appeal-btn-${v.id}`}
                    >
                      <FileText className="w-3 h-3 mr-1" /> Appeal This Violation
                    </Button>
                  )}
                </>
              )}

              {isPending && (
                <p className={`text-xs mt-2 ${isLight ? 'text-yellow-600' : 'text-yellow-400/80'}`}>
                  ? Your appeal is under review. You'll be notified of the decision.
                </p>
              )}
            </div>
          );
        })}

        {/* Strike system */}
        <div className={`p-2.5 rounded-lg text-xs ${isLight ? 'bg-gray-100 text-gray-500' : 'bg-zinc-800/30 text-gray-500'}`}>
          <p className="font-medium mb-1">Strike System</p>
          <div className="grid grid-cols-2 gap-1">
            <span>1 strike ? Warning</span>
            <span>2 ? 7-day suspension</span>
            <span>3 ? 30-day suspension</span>
            <span>4+ ? Permanent ban</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViolationBanner;

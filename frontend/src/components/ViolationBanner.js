/**
 * ViolationBanner.js — User-facing violation awareness banner.
 *
 * Displays active ToS violations, strike count, suspension status,
 * and provides an inline appeal submission form.
 *
 * Placement: Rendered inside AppLayout, below the top nav.
 * Visibility: Only shows when the user has active (non-overturned) violations.
 * Dismissal: Can be collapsed for the session; re-appears on next page load
 *            if violations are still active.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import apiClient from '../lib/apiClient';
import {
  AlertTriangle, Shield, ChevronDown, ChevronUp, Send,
  Loader2, X, Clock, Ban, Scale, FileText
} from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';

// ─── Severity config ──────────────────────────────────────────────────────────
const SEVERITY_CONFIG = {
  minor:    { color: 'blue',   label: 'Minor',    icon: '⚠️' },
  moderate: { color: 'yellow', label: 'Moderate',  icon: '⚠️' },
  severe:   { color: 'orange', label: 'Severe',    icon: '🔶' },
  critical: { color: 'red',    label: 'Critical',  icon: '🚨' },
};

const ViolationBanner = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
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
      // Only show banner if there are active violations (not overturned)
      const activeViolations = (data.violations || []).filter(v => v.status !== 'overturned');
      if (activeViolations.length > 0 || data.is_suspended || data.is_banned) {
        setViolations({ ...data, violations: activeViolations });
      } else {
        setViolations(null);
      }
    } catch {
      // Silently fail — don't block the app
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
      toast.success('Appeal submitted — we\'ll review it shortly');
      setAppealingId(null);
      setAppealText('');
      fetchViolations(); // Refresh to show updated appeal status
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to submit appeal');
    } finally {
      setAppealSubmitting(false);
    }
  };

  // Don't render if loading, no violations, or dismissed
  if (loading || !violations || dismissed) return null;

  const { total_strikes, is_suspended, is_banned, suspension_until } = violations;
  const activeViolations = violations.violations || [];

  // Determine banner severity
  const isCritical = is_banned || is_suspended;
  const highestSeverity = activeViolations.reduce((max, v) => {
    const order = { minor: 1, moderate: 2, severe: 3, critical: 4 };
    return (order[v.severity] || 0) > (order[max] || 0) ? v.severity : max;
  }, 'minor');

  const bannerConfig = isCritical
    ? { gradient: 'from-red-600 to-red-800', border: 'border-red-500/50', textAccent: 'text-red-200' }
    : highestSeverity === 'critical' || highestSeverity === 'severe'
    ? { gradient: 'from-orange-600 to-red-700', border: 'border-orange-500/50', textAccent: 'text-orange-200' }
    : { gradient: 'from-yellow-600 to-orange-600', border: 'border-yellow-500/50', textAccent: 'text-yellow-100' };

  return (
    <div
      className={`relative z-[98] w-full border-b ${bannerConfig.border}`}
      data-testid="violation-banner"
    >
      {/* Collapsed Bar */}
      <div
        className={`bg-gradient-to-r ${bannerConfig.gradient} px-4 py-2.5 cursor-pointer`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {is_banned ? (
              <Ban className="w-5 h-5 text-white flex-shrink-0" />
            ) : is_suspended ? (
              <Shield className="w-5 h-5 text-white flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-white flex-shrink-0 animate-pulse" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {is_banned
                  ? 'Account Permanently Banned'
                  : is_suspended
                  ? 'Account Suspended'
                  : `${activeViolations.length} Active Violation${activeViolations.length !== 1 ? 's' : ''}`}
              </p>
              <p className={`text-xs ${bannerConfig.textAccent} truncate`}>
                {is_banned
                  ? 'Contact support to appeal'
                  : is_suspended && suspension_until
                  ? `Until ${new Date(suspension_until).toLocaleDateString()}`
                  : `${total_strikes} strike${total_strikes !== 1 ? 's' : ''} on your account`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Strike count badge */}
            {total_strikes > 0 && (
              <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-bold text-white">
                {total_strikes} strike{total_strikes !== 1 ? 's' : ''}
              </span>
            )}
            {expanded
              ? <ChevronUp className="w-4 h-4 text-white/80" />
              : <ChevronDown className="w-4 h-4 text-white/80" />}
            <button
              onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
              className="p-0.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              data-testid="violation-banner-dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div className={`${isLight ? 'bg-gray-50' : 'bg-zinc-900'} border-t ${bannerConfig.border}`}>
          <div className="max-w-4xl mx-auto p-4 space-y-3">
            {/* Info Box */}
            <div className={`p-3 rounded-lg text-sm ${isLight ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'bg-blue-950/30 text-blue-300 border border-blue-800/30'}`}>
              <div className="flex items-start gap-2">
                <Scale className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>
                  Violations are reviewed under our Community Standards. You may appeal any violation
                  you believe was issued in error. Appeals are typically reviewed within 24–48 hours.
                </p>
              </div>
            </div>

            {/* Violation List */}
            {activeViolations.map(v => {
              const sev = SEVERITY_CONFIG[v.severity] || SEVERITY_CONFIG.minor;
              const canAppeal = !v.is_appealed;
              const isPending = v.appeal_status === 'pending';
              const isDenied = v.appeal_status === 'denied';

              return (
                <div
                  key={v.id}
                  className={`rounded-xl border p-3 ${isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700'}`}
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
                        {v.violation_type?.replace(/_/g, ' ')} • {new Date(v.created_at).toLocaleDateString()}
                      </p>
                      {v.description && (
                        <p className={`text-sm mt-2 ${isLight ? 'text-gray-600' : 'text-gray-300'}`}>
                          {v.description}
                        </p>
                      )}
                    </div>

                    {/* Appeal Status */}
                    <div className="flex-shrink-0 text-right">
                      {isPending && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">
                          <Clock className="w-3 h-3" /> Under Review
                        </span>
                      )}
                      {isDenied && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">
                          Appeal Denied
                        </span>
                      )}
                      {v.appeal_status === 'approved' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">
                          Overturned
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Appeal Button / Form */}
                  {canAppeal && (
                    <>
                      {appealingId === v.id ? (
                        <div className="mt-3 space-y-2 pt-3 border-t border-border">
                          <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'}`}>
                            Explain why you believe this violation should be reconsidered:
                          </p>
                          <Textarea
                            placeholder="I believe this was a mistake because..."
                            value={appealText}
                            onChange={(e) => setAppealText(e.target.value)}
                            className={`text-sm h-24 ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-900 border-zinc-700'}`}
                            data-testid={`appeal-text-${v.id}`}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleSubmitAppeal(v.id)}
                              disabled={appealSubmitting || !appealText.trim()}
                              className="bg-cyan-600 hover:bg-cyan-700 text-white"
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
                              className="border-border"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
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
                      ⏳ Your appeal is under review. You'll be notified of the decision.
                    </p>
                  )}
                </div>
              );
            })}

            {/* Strike System Explanation */}
            <div className={`p-3 rounded-lg text-xs ${isLight ? 'bg-gray-100 text-gray-500' : 'bg-zinc-800/30 text-gray-500'}`}>
              <p className="font-medium mb-1">Strike System</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                <span>1 strike → Warning</span>
                <span>2 strikes → 7-day suspension</span>
                <span>3 strikes → 30-day suspension</span>
                <span>4+ strikes → Permanent ban</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ViolationBanner;

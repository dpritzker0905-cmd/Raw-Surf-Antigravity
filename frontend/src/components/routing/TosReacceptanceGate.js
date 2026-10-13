/**
 * TosReacceptanceGate - Blocking modal that requires users to accept updated ToS.
 *
 * Wraps authenticated routes. On mount, checks if the user has acknowledged
 * the current ToS version. If not, renders a full-screen modal with the
 * updated terms. The user must click "I Agree" to proceed.
 *
 * Pattern: Same as GromSafetyGate - wraps children, blocks until condition met.
 * Styling: Uses the shared light/dark/beach palette and a scrollable dialog.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Button } from '../ui/button';
import { Shield, FileText, Check, Loader2, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { CURRENT_TOS_VERSION } from '../../constants/tos';

const TosReacceptanceGate = ({ children }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [status, setStatus] = useState('loading'); // 'loading' | 'accepted' | 'needs_acceptance'
  const [submitting, setSubmitting] = useState(false);
  const [showFullText, setShowFullText] = useState(false);
  const [tosSections, setTosSections] = useState([]);
  const [hasReadConfirm, setHasReadConfirm] = useState(false);
  const dialogRef = useFocusTrap(status === 'needs_acceptance');
  const accentClass = theme === 'light' ? 'text-cyan-700' : theme === 'beach' ? 'text-lime-300' : 'text-cyan-400';

  // localStorage key for caching TOS acceptance per user + version
  const getTosKey = (userId) => `tos-accepted-${userId}-${CURRENT_TOS_VERSION}`;

  useEffect(() => {
    if (!user?.user_id && !user?.id) return;
    const tosUserId = user.user_id || user.id;

    // 1. Check localStorage cache first (instant, no API call)
    if (localStorage.getItem(getTosKey(tosUserId))) {
      setStatus('accepted');
      return;
    }

    // 2. Skip API check if no auth token (mock dev user or pre-login state)
    const stored = localStorage.getItem('raw-surf-user');
    const hasToken = stored && JSON.parse(stored)?.access_token;
    if (!hasToken) {
      setStatus('accepted');
      return;
    }

    // 3. Check server only if no local cache
    apiClient.get(`/compliance/tos-status/${tosUserId}?current_version=${CURRENT_TOS_VERSION}`)
      .then(res => {
        if (res.data.acknowledged) {
          // Cache server confirmation locally
          localStorage.setItem(getTosKey(tosUserId), Date.now().toString());
          setStatus('accepted');
        } else {
          // Fetch ToS content for display
          apiClient.get('/compliance/tos-content/current?doc_type=tos')
            .then(r => setTosSections(r.data.sections || []))
            .catch(() => {}); // Fallback: empty sections, user can still accept
          setStatus('needs_acceptance');
        }
      })
      .catch(() => {
        // If check fails, don't block the user - fail open
        setStatus('accepted');
      });
  }, [user?.id, user?.user_id]);

  const handleAccept = useCallback(async () => {
    if (!user?.user_id && !user?.id) return;
    const tosUserId = user.user_id || user.id;
    setSubmitting(true);
    try {
      // Cache acceptance in localStorage immediately (survives remounts)
      localStorage.setItem(getTosKey(tosUserId), Date.now().toString());

      // Check if we have a real auth token
      const stored = localStorage.getItem('raw-surf-user');
      const hasToken = stored && JSON.parse(stored)?.access_token;
      
      if (hasToken) {
        // Try to record server-side (best-effort)
        await apiClient.post('/compliance/acknowledge-tos', {
          tos_version: CURRENT_TOS_VERSION
        }, {
          params: { user_id: tosUserId }
        });
      }

      setStatus('accepted');
      toast.success('Terms accepted — welcome back!');
    } catch (error) {
      console.warn(`[TOS] Server record failed (cached locally):`, error?.response?.status || error.message);
      // Already cached in localStorage — user won't be re-prompted
      setStatus('accepted');
    } finally {
      setSubmitting(false);
    }
  }, [user?.id, user?.user_id]);

  // Loading state - show nothing extra while checking
  if (status === 'loading') {
    return children;
  }

  // User has accepted current version - render normally
  if (status === 'accepted') {
    return children;
  }

  // -- Blocking modal ------------------------------------------------
  return (
    <>
      {/* Render the app behind the overlay so it doesn't flash white */}
      {children}

      {/* Full-screen blocking overlay */}
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tos-gate-title"
          className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card text-card-foreground border border-border rounded-2xl shadow-2xl">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <ScrollText className={`w-5 h-5 ${accentClass}`} />
              </div>
              <div>
                <h2 id="tos-gate-title" className="text-lg font-bold text-foreground">Updated Terms of Service</h2>
                <p className="text-sm text-muted-foreground">Version {CURRENT_TOS_VERSION}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              We've updated our Terms of Service. Please review and accept to continue using Raw Surf.
            </p>
          </div>

          {/* Body */}
          <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Quick summary */}
            <div className="space-y-2">
              <SummaryItem icon={<FileText className="w-4 h-4" />} text="Updated community guidelines and strike system" />
              <SummaryItem icon={<Shield className="w-4 h-4" />} text="Enhanced privacy protections and data rights" />
              <SummaryItem icon={<Check className="w-4 h-4" />} text="Clarified photographer service terms" />
            </div>

            {/* Toggle full text */}
            <button
              aria-expanded={showFullText} onClick={() => setShowFullText(!showFullText)}
              className={`text-sm ${accentClass} hover:underline transition-colors flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              data-testid="tos-gate-toggle-full-text"
            >
              <FileText className="w-3.5 h-3.5" />
              {showFullText ? 'Hide full terms' : 'Read full Terms of Service'}
            </button>

            {showFullText && (
              <div className="rounded-xl border border-border bg-muted p-4 text-sm text-muted-foreground space-y-3 max-h-[40vh] overflow-y-auto">
                {tosSections.length > 0 ? (
                  tosSections.map((section, idx) => (
                    <React.Fragment key={idx}>
                      <h4 className="text-foreground font-semibold">{section.title}</h4>
                      <p>{section.body}</p>
                    </React.Fragment>
                  ))
                ) : (
                  <p className="text-muted-foreground">Loading terms...</p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border bg-muted/50 space-y-3">
            {/* Confirmation checkbox */}
            <label
              className="flex items-start gap-3 cursor-pointer group"
              data-testid="tos-gate-confirm-checkbox"
            >
              <div className="relative mt-0.5 flex-shrink-0">
                <input
                  aria-labelledby="tos-read-confirm-label"
                  type="checkbox"
                  checked={hasReadConfirm}
                  onChange={(e) => setHasReadConfirm(e.target.checked)}
                  className="sr-only peer"
                />
                <div className={`w-5 h-5 rounded border-2 transition-all duration-200 flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background ${
                  hasReadConfirm
                    ? 'bg-emerald-500 border-emerald-500'
                    : 'border-muted-foreground group-hover:border-foreground'
                }`}>
                  {hasReadConfirm && <Check className="w-3.5 h-3.5 text-black" />}
                </div>
              </div>
              <span id="tos-read-confirm-label" className={`text-sm transition-colors ${
                hasReadConfirm ? 'text-foreground' : 'text-muted-foreground'
              }`}>
                I have read and understood the updated Terms of Service
              </span>
            </label>

            <Button
              onClick={handleAccept}
              disabled={submitting || !hasReadConfirm}
              className={`w-full font-bold py-3 rounded-xl transition-all duration-200 ${
                hasReadConfirm
                  ? 'bg-gradient-to-r from-emerald-500 via-yellow-500 to-orange-500 text-black hover:opacity-90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
              data-testid="tos-gate-accept-button"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {submitting ? 'Recording...' : 'I Agree to the Updated Terms'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              By clicking "I Agree", you acknowledge that you have read and agree to the updated Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

/** Summary bullet item */
const SummaryItem = ({ icon, text }) => (
  <div className="flex items-start gap-2.5 text-sm text-foreground">
    <span className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</span>
    <span>{text}</span>
  </div>
);

export default TosReacceptanceGate;

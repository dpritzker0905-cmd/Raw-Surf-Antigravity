/**
 * TosReacceptanceGate — Blocking modal that requires users to accept updated ToS.
 *
 * Wraps authenticated routes. On mount, checks if the user has acknowledged
 * the current ToS version. If not, renders a full-screen modal with the
 * updated terms. The user must click "I Agree" to proceed.
 *
 * Pattern: Same as GromSafetyGate — wraps children, blocks until condition met.
 * Styling: Matches existing modal patterns (bg-black/80 backdrop-blur, zinc cards).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Shield, FileText, Check, Loader2, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { CURRENT_TOS_VERSION } from '../../constants/tos';

const TosReacceptanceGate = ({ children }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState('loading'); // 'loading' | 'accepted' | 'needs_acceptance'
  const [submitting, setSubmitting] = useState(false);
  const [showFullText, setShowFullText] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    apiClient.get(`/compliance/tos-status/${user.id}?current_version=${CURRENT_TOS_VERSION}`)
      .then(res => {
        setStatus(res.data.acknowledged ? 'accepted' : 'needs_acceptance');
      })
      .catch(() => {
        // If check fails, don't block the user — fail open
        setStatus('accepted');
      });
  }, [user?.id]);

  const handleAccept = useCallback(async () => {
    if (!user?.id) return;
    setSubmitting(true);
    try {
      await apiClient.post('/compliance/acknowledge-tos', {
        tos_version: CURRENT_TOS_VERSION
      }, {
        params: { user_id: user.id }
      });
      setStatus('accepted');
      toast.success('Terms accepted — welcome back!');
    } catch (error) {
      toast.error('Failed to record acceptance. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [user?.id]);

  // Loading state — show nothing extra while checking
  if (status === 'loading') {
    return children;
  }

  // User has accepted current version — render normally
  if (status === 'accepted') {
    return children;
  }

  // ── Blocking modal ────────────────────────────────────────────────
  return (
    <>
      {/* Render the app behind the overlay so it doesn't flash white */}
      {children}

      {/* Full-screen blocking overlay */}
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-zinc-800">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <ScrollText className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Updated Terms of Service</h2>
                <p className="text-sm text-zinc-400">Version {CURRENT_TOS_VERSION}</p>
              </div>
            </div>
            <p className="text-sm text-zinc-400 mt-3">
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
              onClick={() => setShowFullText(!showFullText)}
              className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1.5"
              data-testid="tos-gate-toggle-full-text"
            >
              <FileText className="w-3.5 h-3.5" />
              {showFullText ? 'Hide full terms' : 'Read full Terms of Service'}
            </button>

            {showFullText && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4 text-sm text-zinc-400 space-y-3 max-h-[40vh] overflow-y-auto">
                <h4 className="text-white font-semibold">1. Acceptance of Terms</h4>
                <p>By creating an account on Raw Surf, you agree to be bound by these Terms of Service ("Terms"). If you do not agree, you may not use the platform.</p>

                <h4 className="text-white font-semibold">2. Account Eligibility</h4>
                <p>You must be at least 13 years old to create an account. Users under 18 ("Groms") must have a parent or guardian link their account. You are responsible for maintaining the security of your account credentials.</p>

                <h4 className="text-white font-semibold">3. User Content</h4>
                <p>You retain ownership of all photos, videos, and content you upload. By posting content publicly, you grant Raw Surf a non-exclusive, royalty-free license to display and distribute that content within the platform.</p>

                <h4 className="text-white font-semibold">4. Photographer Services</h4>
                <p>Photographers set their own pricing and availability. Raw Surf facilitates connections between photographers and surfers but is not a party to the service agreement between them.</p>

                <h4 className="text-white font-semibold">5. Payments & Refunds</h4>
                <p>All payments are processed through Stripe. Refund eligibility is determined on a case-by-case basis.</p>

                <h4 className="text-white font-semibold">6. Location Data</h4>
                <p>Certain features use your location data. Falsifying your location is a violation of these Terms.</p>

                <h4 className="text-white font-semibold">7. Community Standards</h4>
                <p>Harassment, hate speech, spam, and fraud are prohibited. Violations follow a progressive strike system: warning → 7-day suspension → 30-day suspension → permanent ban.</p>

                <h4 className="text-white font-semibold">8. Privacy</h4>
                <p>We do not sell your personal information to third parties. You may request deletion of your data at any time.</p>

                <h4 className="text-white font-semibold">9. Limitation of Liability</h4>
                <p>Raw Surf is provided "as is" without warranties.</p>

                <h4 className="text-white font-semibold">10. Modifications</h4>
                <p>We may update these Terms from time to time. Material changes will be communicated via in-app notification.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/50">
            <Button
              onClick={handleAccept}
              disabled={submitting}
              className="w-full bg-gradient-to-r from-emerald-500 via-yellow-500 to-orange-500 text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity"
              data-testid="tos-gate-accept-button"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              {submitting ? 'Recording...' : 'I Agree to the Updated Terms'}
            </Button>
            <p className="text-xs text-zinc-500 text-center mt-2">
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
  <div className="flex items-start gap-2.5 text-sm text-zinc-300">
    <span className="text-cyan-400 mt-0.5 flex-shrink-0">{icon}</span>
    <span>{text}</span>
  </div>
);

export default TosReacceptanceGate;

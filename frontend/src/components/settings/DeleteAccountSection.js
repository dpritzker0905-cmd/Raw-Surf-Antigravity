/**
 * DeleteAccountSection -- GDPR Article 17 self-service deletion, with a 30-day restore window (David, 2026-11-18).
 *
 * By default the request SCHEDULES the deletion: the account is locked and signed out at once, a restore link is
 * emailed, and everything is permanently erased after 30 days. "Delete everything now" erases at once
 * (POST /compliance/delete-my-data?immediate=true).
 *
 * Themes: semantic tokens only (card/foreground/muted/border/destructive), which light, dark and beach all define.
 * Accessibility: real buttons, a labelled confirmation field, the outcome announced in a status region.
 */
import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { useAuth } from '../../contexts/AuthContext';

const DeleteAccountSection = () => {
  const [step, setStep] = useState('idle');
  const [confirmText, setConfirmText] = useState('');
  const [immediate, setImmediate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const { logout } = useAuth();
  const redirectTimer = useRef(null);

  // Leaving the page (logout sends a signed-out visitor to /auth) must not leave a hard redirect pending.
  useEffect(() => () => clearTimeout(redirectTimer.current), []);

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') return;
    setLoading(true);
    setError(null);
    try {
      // The client's base URL already ends in /api: a leading '/api' here made this /api/api/... and it always 404ed.
      const res = await apiClient.post('/compliance/delete-my-data', null, { params: immediate ? { immediate: true } : {} });
      const scheduled = res?.data?.mode === 'scheduled';
      setOutcome({ scheduled, purgeAfter: res?.data?.purge_after, emailed: res?.data?.restore_email_sent });
      setStep('done');
      toast.success(scheduled ? 'Your account is scheduled for deletion.' : 'Your account data was deleted.');
      // The account's sessions are revoked server-side; logout also clears this device's per-account caches.
      logout();
      localStorage.removeItem('raw-surf-token');
      redirectTimer.current = setTimeout(() => {
        window.location.href = '/auth';
      }, scheduled ? 6000 : 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    const until = outcome?.purgeAfter ? new Date(outcome.purgeAfter).toLocaleDateString() : 'in 30 days';
    return (
      <div role="status" className="rounded-xl border border-border bg-card p-6 text-center">
        <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" aria-hidden="true" />
        <p className="m-0 font-semibold text-foreground">
          {outcome?.scheduled ? 'Account scheduled for deletion' : 'Account data deleted'}
        </p>
        {outcome?.scheduled && (
          <p className="mt-2 text-sm text-muted-foreground">
            It is locked now and will be permanently deleted on {until}.{' '}
            {outcome.emailed
              ? 'To restore it before then, use the link we emailed you.'
              : 'We could not send the restore email; contact support to restore it before then.'}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-destructive/30 bg-card p-4">
      <h4 className="mb-2 text-base font-semibold text-destructive">Delete My Account</h4>
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
        Your account is locked and signed out straight away, and permanently deleted after 30 days. Until then you
        can restore it from the link we email you. Financial records are retained for legal compliance.
      </p>

      {step === 'idle' && (
        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="rounded-lg border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Request Data Deletion
        </button>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-destructive/10 p-3 text-sm leading-relaxed text-foreground">
            Your posts, comments, follows, check-ins, reviews and surf reports will be deleted and your profile
            anonymized{immediate ? ' right away. This cannot be undone.' : ' after 30 days, unless you restore it.'}{' '}
            Type <strong>DELETE</strong> to confirm.
          </div>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={immediate}
              onChange={(e) => setImmediate(e.target.checked)}
              className="mt-1"
            />
            <span>Delete everything now instead (no 30-day restore window; this cannot be undone)</span>
          </label>
          <input
            aria-label="Type DELETE to confirm account deletion"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setStep('idle'); setConfirmText(''); setError(null); setImmediate(false); }}
              className="flex-1 rounded-lg border border-border bg-muted/40 py-2 text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={confirmText !== 'DELETE' || loading}
              className="flex-1 rounded-lg bg-destructive py-2 text-sm font-semibold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {loading ? 'Deleting...' : immediate ? 'Delete Forever' : 'Delete in 30 Days'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeleteAccountSection;

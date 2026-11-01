import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Copy, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { Button } from '../ui/button';

/**
 * AskMyParentPanel -- the child's side of linking to a parent or guardian.
 *
 * Two ways in, and the link only starts when the CHILD's account takes part:
 *   1. "Get a code": a one-time code (valid 48 hours, works once, only for this account) the child gives the adult.
 *   2. "Invites": an adult asked to link; the child confirms or declines here.
 *
 * Theme: colours come from the shared tokens (bg-card, bg-muted, text-foreground, text-muted-foreground, border-border)
 * which resolve in light, dark and beach. Nothing here hardcodes a single-theme colour. Layout is one column and
 * wraps, so it works from a 320px phone to desktop. Status is written in words (never colour alone) and the code is
 * announced politely when it appears.
 */
export const AskMyParentPanel = ({ onLinked }) => {
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesError, setInvitesError] = useState(false);
  const inviteReadGeneration = useRef(0);
  const [error, setError] = useState('');

  const loadInvites = useCallback(async () => {
    const generation = ++inviteReadGeneration.current;
    setInvitesLoading(true);
    setInvitesError(false);
    try {
      const res = await apiClient.get('/grom-hq/guardian-invites');
      if (generation !== inviteReadGeneration.current) return;
      setInvites(res.data?.incoming || []);
    } catch (e) {
      if (generation !== inviteReadGeneration.current) return;
      logger.error('Failed to load guardian invites:', e);
      setInvitesError(true);
    } finally {
      if (generation === inviteReadGeneration.current) setInvitesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvites();
    return () => { inviteReadGeneration.current += 1; };
  }, [loadInvites]);

  const getCode = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post('/grom-hq/guardian-code');
      setCode(res.data.code);
      setExpiresAt(res.data.expires_at);
    } catch (e) {
      setError(e.response?.data?.detail || "Couldn't make a code right now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('Code copied');
      setTimeout(() => setCopied(false), 3000);
    } catch (e) {
      toast.error("Couldn't copy. Read the code out instead.");
    }
  };

  const answer = async (invite, accept) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/grom-hq/guardian-invites/${invite.invite_id}/${accept ? 'confirm' : 'decline'}`);
      toast.success(accept ? `Linked with ${invite.from?.full_name || 'your parent'}` : 'Invite declined');
      await loadInvites();
      if (accept && onLinked) onLinked();
    } catch (e) {
      setError(e.response?.data?.detail || "That didn't work. The invite may have expired.");
    } finally {
      setBusy(false);
    }
  };

  const until = expiresAt ? new Date(expiresAt).toLocaleString() : '';

  return (
    <section aria-labelledby="ask-parent-heading" className="space-y-4 text-foreground" data-testid="ask-my-parent">
      <h2 id="ask-parent-heading" className="text-lg font-semibold flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
        Ask my parent
      </h2>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Get a one-time code and give it to your parent or guardian. They enter it in Raw Surf to link with you.
          It works once, only for your account, and runs out after 48 hours.
        </p>
        {code ? (
          <div className="rounded-lg bg-muted p-3 flex items-center justify-between gap-3">
            <p className="text-2xl font-mono font-bold tracking-widest break-all" aria-live="polite" data-testid="guardian-code">
              <span className="sr-only">Your code is </span>{code}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={copy} aria-label="Copy code">
              {copied ? <CheckCircle className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
            </Button>
          </div>
        ) : null}
        {code ? <p className="text-xs text-muted-foreground">Valid until {until}. Getting a new code cancels this one.</p> : null}
        <Button type="button" onClick={getCode} disabled={busy} data-testid="get-guardian-code">
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : null}
          {code ? 'Get a new code' : 'Get a code'}
        </Button>
      </div>

      {invitesLoading ? (
        <p role="status" aria-label="Loading parent invitations" className="text-sm text-muted-foreground">Loading parent invitations...</p>
      ) : invitesError ? (
        <div role="alert" className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm">Parent invitations could not be loaded. Try again to check who has asked to link with you.</p>
          <Button type="button" variant="outline" onClick={loadInvites}>Retry parent invitations</Button>
        </div>
      ) : invites.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="guardian-invites">
          <h3 className="text-sm font-semibold">Asked to link with you</h3>
          <ul className="space-y-3">
            {invites.map((invite) => (
              <li key={invite.invite_id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="font-medium">{invite.from?.full_name || 'An adult'}</span> wants to be your parent or guardian on Raw Surf.
                  Only say yes if you know them.
                </span>
                <span className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => answer(invite, true)} disabled={busy}>Confirm</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => answer(invite, false)} disabled={busy}>Decline</Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
};

export default AskMyParentPanel;

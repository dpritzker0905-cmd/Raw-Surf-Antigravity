import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { mfaApi, mfaErrorMessage } from '../../lib/mfaApi';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { StepUpForm } from './StepUpForm';
import { TotpEnrolment } from './TotpEnrolment';
import { useSecurityTone } from './useSecurityTone';

/**
 * /settings/security -- two-step verification for every account. Views: overview, enrol (authenticator app), codes
 * (the one-time recovery-code screen), regenerate, disable. Moving between views moves focus to the new view's heading
 * (each view focuses its own), and every state is stated in words, never by colour or icon alone.
 */
export const SecuritySettings = () => {
  const navigate = useNavigate();
  const tone = useSecurityTone();
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState('overview');
  const [codes, setCodes] = useState(null);
  const overviewRef = useRef(null);

  const load = useCallback(async () => {
    try { setStatus(await mfaApi.status()); setLoadError(''); }
    catch (err) { setLoadError(mfaErrorMessage(err, "Couldn't load your security settings.")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (view === 'overview') overviewRef.current?.focus(); }, [view, status]);

  const showCodes = (newCodes) => { setCodes(newCodes); setView('codes'); };
  const backToOverview = () => { setCodes(null); setView('overview'); load(); };

  let body;
  if (loadError) {
    body = (
      <div role="alert" className={`rounded-lg border p-3 text-sm ${tone.bad}`}>
        <p>{loadError}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={load}>Try again</Button>
      </div>
    );
  } else if (!status) {
    body = <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading...</p>;
  } else if (view === 'enrol') {
    body = <TotpEnrolment onEnrolled={(res) => showCodes(res.recovery_codes)} onCancel={backToOverview} />;
  } else if (view === 'codes') {
    body = <RecoveryCodesPanel codes={codes} onDone={() => { toast.success('Two-step verification is on'); backToOverview(); }} />;
  } else if (view === 'regenerate') {
    body = (
      <StepUpForm idPrefix="regen" title="Get new recovery codes" submitLabel="Replace my recovery codes"
        description="Your old codes stop working the moment you get new ones."
        onSubmit={async (password, code) => { const res = await mfaApi.regenerateRecoveryCodes(password, code); showCodes(res.recovery_codes); }}
        onCancel={backToOverview} />
    );
  } else if (view === 'disable') {
    body = (
      <StepUpForm idPrefix="disable" destructive title="Turn off two-step verification" submitLabel="Turn off"
        description="Anyone with your password will be able to sign in. We'll ask for your password and a current code to make sure it's you."
        onSubmit={async (password, code) => { await mfaApi.disable(password, code); toast.success('Two-step verification is off'); backToOverview(); }}
        onCancel={backToOverview} />
    );
  } else {
    const low = status.enabled && status.recovery_codes_remaining <= 2;
    body = (
      <div className="space-y-5">
        <h2 ref={overviewRef} tabIndex={-1} className="sr-only outline-none">Two-step verification overview</h2>
        <div className={`flex items-start gap-3 rounded-lg border p-3 ${status.enabled ? tone.ok : tone.warn}`} data-testid="mfa-status-banner">
          {status.enabled ? <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> : <ShieldOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
          <div className="text-sm">
            <p className="font-semibold">{status.enabled ? 'Two-step verification is ON' : 'Two-step verification is OFF'}</p>
            <p>{status.enabled
              ? 'Signing in needs your password and a code from your authenticator app.'
              : 'Signing in needs only your password. Turn it on so a stolen password alone can\'t open your account.'}</p>
          </div>
        </div>
        {status.required && !status.enabled && (
          <p className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tone.warn}`} role="note">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Your account type is required to use two-step verification.
          </p>
        )}
        {status.enabled ? (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Authenticator app</dt><dd className="flex items-center gap-1 text-foreground"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Set up</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Recovery codes left</dt><dd className="text-foreground" data-testid="recovery-remaining">{status.recovery_codes_remaining} of 10</dd></div>
            </dl>
            {low && <p role="note" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tone.warn}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />You're running low on recovery codes. Get new ones.</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setView('regenerate')}>Get new recovery codes</Button>
              <Button type="button" variant="destructive" onClick={() => setView('disable')}>Turn off</Button>
            </div>
          </>
        ) : status.enrolment_available ? (
          <Button type="button" onClick={() => setView('enrol')} data-testid="start-enrol"><ShieldCheck aria-hidden="true" />Set up authenticator app</Button>
        ) : (
          <p role="note" className={`rounded-lg border p-3 text-sm ${tone.warn}`}>Two-step verification isn't available yet. Please check back soon.</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20" data-testid="security-settings-page">
      <div className="mx-auto max-w-md p-4">
        <Button type="button" variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => navigate('/settings')}><ArrowLeft aria-hidden="true" />Settings</Button>
        <h1 className="mb-4 font-oswald text-3xl font-bold text-foreground">Security</h1>
        <Card className="border-border bg-card">
          <CardHeader><CardTitle className="text-foreground">Two-step verification</CardTitle></CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SecuritySettings;

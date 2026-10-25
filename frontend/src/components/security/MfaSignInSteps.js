import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useAuth } from '../../contexts/AuthContext';
import { mfaErrorMessage } from '../../lib/mfaApi';
import { RecoveryCodesPanel } from './RecoveryCodesPanel';
import { TotpEnrolment } from './TotpEnrolment';
import { useSecurityTone } from './useSecurityTone';

/**
 * The two extra screens a password sign-in can lead to (shown inside the sign-in card, before any session exists):
 *   MfaChallengeStep -- the account has two-step verification on: enter an authenticator or recovery code.
 *   MfaSetupStep     -- the account's role requires it and none is set up: set it up now, then continue signed in.
 */
export const MfaChallengeStep = ({ challenge, onSuccess, onBack }) => {
  const { completeMfaLogin } = useAuth();
  const tone = useSecurityTone();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const inputRef = useRef(null);
  const canRecover = (challenge.methods || []).includes('recovery');

  useEffect(() => { inputRef.current?.focus(); }, [recovery, expired]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      onSuccess(await completeMfaLogin(challenge.challenge_token, code.trim()));
    } catch (err) {
      const message = mfaErrorMessage(err, "That code didn't work.");
      if (/start again/i.test(message)) setExpired(true);
      setError(message);
      setCode('');
    } finally { setBusy(false); }
  };

  const errorBox = error && (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tone.bad}`} data-testid="mfa-error">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>{error}</p>
    </div>
  );

  if (expired) {
    return (
      <div className="mt-6 space-y-4" data-testid="mfa-expired">
        {errorBox}
        <Button type="button" onClick={onBack}><ArrowLeft aria-hidden="true" />Back to sign in</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" aria-labelledby="mfa-challenge-title" data-testid="mfa-challenge-form">
      <h2 id="mfa-challenge-title" className="flex items-center gap-2 text-lg font-semibold text-foreground"><ShieldCheck className="h-5 w-5" aria-hidden="true" />Two-step verification</h2>
      <div className="space-y-1.5">
        <label htmlFor="mfa-code" className="text-sm font-medium text-foreground">{recovery ? 'Recovery code' : 'Authenticator code'}</label>
        <Input
          id="mfa-code" ref={inputRef} key={recovery ? 'recovery' : 'totp'} required value={code}
          onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className="h-12 font-mono tracking-widest"
          inputMode={recovery ? 'text' : 'numeric'} autoCapitalize={recovery ? 'characters' : 'off'} spellCheck={false}
          aria-describedby="mfa-code-hint" data-testid="mfa-code-input"
        />
        <p id="mfa-code-hint" className="text-xs text-muted-foreground">
          {recovery ? 'One of the 10 recovery codes you saved, like ABCDE-FGH23. Each works once.' : 'The 6-digit code from your authenticator app.'}
        </p>
      </div>
      {errorBox}
      <Button type="submit" className="h-12 w-full" disabled={busy || !code.trim()}>
        {busy && <Loader2 className="animate-spin" aria-hidden="true" />}Verify and sign in
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        {canRecover && (
          <Button type="button" variant="link" className="px-0" aria-pressed={recovery} onClick={() => { setRecovery(!recovery); setCode(''); setError(''); }}>
            {recovery ? 'Use my authenticator app' : 'Use a recovery code instead'}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>Back to sign in</Button>
      </div>
    </form>
  );
};

export const MfaSetupStep = ({ setupToken, onSuccess, onBack }) => {
  const { startSession } = useAuth();
  const [result, setResult] = useState(null);

  if (result) {
    return (
      <div className="mt-6">
        <RecoveryCodesPanel codes={result.recovery_codes} doneLabel="Continue to Raw Surf"
          onDone={() => onSuccess(startSession(result.session))} />
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-4" data-testid="mfa-setup-step">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground"><ShieldCheck className="h-5 w-5" aria-hidden="true" />Set up two-step verification</h2>
      <p className="text-sm text-muted-foreground">Your account type needs two-step verification before you can continue. It takes about a minute.</p>
      <TotpEnrolment setupToken={setupToken} onEnrolled={setResult} onCancel={onBack} />
    </div>
  );
};

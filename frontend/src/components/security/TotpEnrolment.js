import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertCircle, Copy, Loader2, Smartphone } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { mfaApi, mfaErrorMessage } from '../../lib/mfaApi';
import { QR_BG, QR_FG, useSecurityTone } from './useSecurityTone';

const groupKey = (secret) => (secret || '').replace(/(.{4})/g, '$1 ').trim();

/**
 * Set up an authenticator app: (password, unless this is the enrol-only sign-in) -> QR code + typed setup key ->
 * confirm with a live 6-digit code. Calls onEnrolled(response) with the recovery codes; the caller shows them.
 */
export const TotpEnrolment = ({ setupToken, needsCode = false, onEnrolled, onCancel }) => {
  const tone = useSecurityTone();
  const [phase, setPhase] = useState('start');
  const [password, setPassword] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const firstRef = useRef(null);
  const codeRef = useRef(null);

  useEffect(() => { if (phase === 'start') firstRef.current?.focus(); }, [phase]);
  useEffect(() => { if (phase === 'scan') codeRef.current?.focus(); }, [phase]);

  const begin = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      setSetup(await mfaApi.beginTotp(password, setupToken, needsCode ? stepUpCode.trim() : undefined));
      setPassword(''); setStepUpCode('');
      setPhase('scan');
    } catch (err) {
      setError(mfaErrorMessage(err, "Couldn't start setup."));
    } finally { setBusy(false); }
  };

  const confirm = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      onEnrolled(await mfaApi.confirmTotp(code, setupToken));
    } catch (err) {
      setError(mfaErrorMessage(err, "That code didn't work."));
      setCode('');
      codeRef.current?.focus();
    } finally { setBusy(false); }
  };

  const copyKey = async () => {
    try { await navigator.clipboard.writeText(setup.secret); setCopied('Setup key copied.'); }
    catch (_) { setCopied("Couldn't copy. Select the key and copy it by hand."); }
  };

  const errorBox = error && (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tone.bad}`}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>{error}</p>
    </div>
  );

  if (phase === 'start') {
    return (
      <form onSubmit={begin} className="space-y-4" data-testid="totp-start-form">
        <p className="text-sm text-muted-foreground">
          Use an authenticator app (such as 1Password, Google Authenticator, Authy or Microsoft Authenticator). After
          your password, we'll ask for the 6-digit code it shows.
        </p>
        {!setupToken && (
          <div className="space-y-1.5">
            <label htmlFor="totp-password" className="text-sm font-medium text-foreground">Confirm your password</label>
            <Input id="totp-password" ref={firstRef} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        {needsCode && !setupToken && (
          <div className="space-y-1.5">
            <label htmlFor="totp-stepup-code" className="text-sm font-medium text-foreground">Current code or recovery code</label>
            <Input id="totp-stepup-code" autoComplete="one-time-code" required value={stepUpCode} onChange={(e) => setStepUpCode(e.target.value)} aria-describedby="totp-stepup-hint" />
            <p id="totp-stepup-hint" className="text-xs text-muted-foreground">You already have two-step verification, so adding another way needs a code from it (or one of your recovery codes).</p>
          </div>
        )}
        {errorBox}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || (!setupToken && !password) || (needsCode && !setupToken && !stepUpCode.trim())} ref={setupToken ? firstRef : undefined}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Smartphone aria-hidden="true" />}
            Set up authenticator app
          </Button>
          {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4" data-testid="totp-scan-form">
      <ol className="list-decimal space-y-4 pl-5 text-sm text-foreground">
        <li>
          Scan this code with your authenticator app.
          <div className="mt-2 inline-block rounded-lg p-2" style={{ background: QR_BG }}>
            <QRCodeSVG value={setup.otpauth_uri} size={176} marginSize={2} fgColor={QR_FG} bgColor={QR_BG} level="M" role="img" aria-label="QR code that adds Raw Surf to your authenticator app" />
          </div>
        </li>
        <li>
          Can't scan? Type this setup key into the app instead (account: {setup.account}, time-based).
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className={`rounded border px-2 py-1 font-mono text-sm tracking-wider ${tone.code}`} data-testid="totp-secret">{groupKey(setup.secret)}</code>
            <Button type="button" size="sm" variant="outline" onClick={copyKey}><Copy aria-hidden="true" />Copy key</Button>
          </div>
          <p role="status" aria-live="polite" className="mt-1 min-h-[1.25rem] text-xs text-muted-foreground">{copied}</p>
        </li>
        <li>
          <label htmlFor="totp-code" className="font-medium">Enter the 6-digit code the app shows</label>
          <Input id="totp-code" ref={codeRef} className="mt-2 max-w-[10rem] text-center font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} aria-describedby="totp-code-hint" />
          <p id="totp-code-hint" className="mt-1 text-xs text-muted-foreground">The code changes every 30 seconds.</p>
        </li>
      </ol>
      {errorBox}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}Turn on two-step verification
        </Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
};

export default TotpEnrolment;

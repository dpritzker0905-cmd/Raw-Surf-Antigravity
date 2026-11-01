import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { mfaErrorMessage } from '../../lib/mfaApi';
import { useSecurityTone } from './useSecurityTone';

/**
 * Re-enter the password and give a current code before a sensitive change (turning two-step verification off,
 * replacing recovery codes). A session token alone is deliberately not enough for either.
 * onSubmit(password, code) resolves on success; a rejection's server message is shown and the form stays open.
 */
export const StepUpForm = ({ idPrefix, title, description, submitLabel, destructive = false, onSubmit, onCancel }) => {
  const tone = useSecurityTone();
  const headingRef = useRef(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { headingRef.current?.focus(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await onSubmit(password, code.trim());
    } catch (err) {
      setError(mfaErrorMessage(err));
      setCode('');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-labelledby={`${idPrefix}-title`} data-testid={`${idPrefix}-form`}>
      <h2 id={`${idPrefix}-title`} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-password`} className="text-sm font-medium text-foreground">Password</label>
        <Input id={`${idPrefix}-password`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-code`} className="text-sm font-medium text-foreground">Authenticator code or recovery code</label>
        <Input id={`${idPrefix}-code`} autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={`${idPrefix}-code-hint`} />
        <p id={`${idPrefix}-code-hint`} className="text-xs text-muted-foreground">The 6-digit code from your app, or one of your recovery codes.</p>
      </div>
      {error && (
        <div role="alert" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tone.bad}`}>
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>{error}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy || !password || !code.trim()}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}{submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
};

export default StepUpForm;

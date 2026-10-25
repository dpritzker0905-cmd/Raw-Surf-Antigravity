import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, KeyRound, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { passkeyApi, passkeyErrorMessage, passkeysSupported, registerPasskey } from '../../lib/passkeys';
import { useSecurityTone } from './useSecurityTone';

const day = (iso) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch (_) { return null; }
};

/**
 * The account's passkeys: list, add (password first), rename, remove (password; never the last second step - the
 * server refuses and its reason is shown). `onCodes(codes)` receives the one-time recovery codes when this passkey is
 * the account's first second factor; `onChanged()` tells the page to refresh its status.
 */
export const PasskeyManager = ({ onCodes, onChanged }) => {
  const tone = useSecurityTone();
  const supported = passkeysSupported();
  const [items, setItems] = useState(null);
  const [mode, setMode] = useState(null); // null | { type: 'add' } | { type: 'rename'|'remove', id }
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstRef = useRef(null);

  const load = useCallback(async () => {
    try { setItems(await passkeyApi.list()); setError(''); }
    catch (err) { setError(passkeyErrorMessage(err)); setItems([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (mode) firstRef.current?.focus(); }, [mode]);

  const open = (next, initialName = '') => { setMode(next); setPassword(''); setName(initialName); setError(''); };
  const close = () => { setMode(null); setPassword(''); setName(''); setError(''); };

  const run = async (action) => {
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError(passkeyErrorMessage(err)); } finally { setBusy(false); }
  };

  const add = (event) => {
    event.preventDefault();
    run(async () => {
      const result = await registerPasskey({ password, name: name.trim() });
      close();
      toast.success('Passkey added');
      await load();
      if (result.recovery_codes?.length && onCodes) onCodes(result.recovery_codes);
      else if (onChanged) onChanged();
    });
  };

  const rename = (event) => {
    event.preventDefault();
    run(async () => { await passkeyApi.rename(mode.id, name); close(); await load(); });
  };

  const remove = (event) => {
    event.preventDefault();
    run(async () => { await passkeyApi.remove(mode.id, password); close(); toast.success('Passkey removed'); await load(); onChanged && onChanged(); });
  };

  const errorBox = error && (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${tone.bad}`}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>{error}</p>
    </div>
  );

  const form = mode && (
    <form
      onSubmit={mode.type === 'add' ? add : mode.type === 'rename' ? rename : remove}
      className="space-y-3 rounded-lg border border-border p-3" aria-label={mode.type === 'add' ? 'Add a passkey' : mode.type === 'rename' ? 'Rename passkey' : 'Remove passkey'}
      data-testid="passkey-form"
    >
      {mode.type === 'add' && (
        <p className="text-sm text-muted-foreground">Your device will ask for your fingerprint, face or screen lock. First, confirm your password.</p>
      )}
      {mode.type === 'remove' && <p className="text-sm text-muted-foreground">Confirm your password to remove this passkey.</p>}
      {mode.type !== 'rename' && (
        <div className="space-y-1.5">
          <label htmlFor="passkey-password" className="text-sm font-medium text-foreground">Password</label>
          <Input id="passkey-password" ref={firstRef} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      {mode.type !== 'remove' && (
        <div className="space-y-1.5">
          <label htmlFor="passkey-name" className="text-sm font-medium text-foreground">{mode.type === 'add' ? 'Name (optional)' : 'New name'}</label>
          <Input id="passkey-name" ref={mode.type === 'rename' ? firstRef : undefined} maxLength={80} placeholder={mode.type === 'add' ? 'e.g. My phone' : undefined} required={mode.type === 'rename'} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      )}
      {errorBox}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={mode.type === 'remove' ? 'destructive' : 'default'} disabled={busy || (mode.type !== 'rename' && !password) || (mode.type === 'rename' && !name.trim())}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {mode.type === 'add' ? 'Add passkey' : mode.type === 'rename' ? 'Save name' : 'Remove passkey'}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
      </div>
    </form>
  );

  return (
    <section aria-labelledby="passkeys-title" className="space-y-3" data-testid="passkey-manager">
      <h3 id="passkeys-title" className="flex items-center gap-2 text-base font-semibold text-foreground"><KeyRound className="h-4 w-4" aria-hidden="true" />Passkeys</h3>
      <p className="text-sm text-muted-foreground">Sign in with your fingerprint, face or screen lock. Nothing to type, and nothing a fake site can steal.</p>
      {!supported && <p role="note" className={`rounded-lg border p-3 text-sm ${tone.warn}`}>This browser can't create passkeys. Try another browser or device.</p>}
      {items === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading passkeys...</p>
      ) : (
        <ul aria-label="Your passkeys" className="space-y-2">
          {items.length === 0 && <li className="text-sm text-muted-foreground">No passkeys yet.</li>}
          {items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium text-foreground">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {day(p.created_at) ? `Added ${day(p.created_at)}` : 'Added'}
                  {day(p.last_used_at) ? ` · Last used ${day(p.last_used_at)}` : ' · Not used yet'}
                  {!p.usable_here ? ' · Made for a different Raw Surf site' : ''}
                </p>
              </div>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" aria-label={`Rename passkey ${p.name}`} onClick={() => open({ type: 'rename', id: p.id }, p.name)}><Pencil aria-hidden="true" />Rename</Button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Remove passkey ${p.name}`} onClick={() => open({ type: 'remove', id: p.id })}><Trash2 aria-hidden="true" />Remove</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {form}
      {!mode && (
        <>
          {errorBox}
          <Button type="button" variant="outline" disabled={!supported} onClick={() => open({ type: 'add' })} data-testid="add-passkey"><Plus aria-hidden="true" />Add a passkey</Button>
        </>
      )}
    </section>
  );
};

export default PasskeyManager;

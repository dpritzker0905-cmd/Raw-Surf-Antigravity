import React, { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';

/**
 * LinkMyChildPanel -- the adult's side: enter the one-time code your child gave you.
 *
 * The link starts only because the child's own account made that code. There is no "pick any child" option and no
 * switch that turns you into a parent: being a parent means having a confirmed link.
 *
 * Theme: shared tokens only (light, dark and beach). Accessible: a real <label> + <input>, a submit <button>, errors in
 * role="alert", success announced politely.
 */
export const LinkMyChildPanel = ({ onLinked }) => {
  const { user, updateUser } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [linkedName, setLinkedName] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post('/grom-hq/link-by-code', null, {
        params: { parent_id: user.id, guardian_code: code.trim() },
      });
      setLinkedName(res.data?.grom?.full_name || 'your child');
      setCode('');
      updateUser({ ...user, is_grom_parent: true });
      toast.success('Linked');
      if (onLinked) onLinked(res.data?.grom);
    } catch (e) {
      setError(e.response?.data?.detail || "Couldn't link with that code. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="link-child-heading" className="space-y-3 text-foreground" data-testid="link-my-child">
      <h2 id="link-child-heading" className="text-lg font-semibold flex items-center gap-2">
        <UserPlus className="w-5 h-5 text-primary" aria-hidden="true" />
        Link my child
      </h2>
      <p className="text-sm text-muted-foreground">
        Ask your child to open Raw Surf and choose "Ask my parent" to get a one-time code. Enter it here.
        The code works once and runs out after 48 hours.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="child-link-code" className="block text-sm font-medium mb-1">Code from your child</label>
          <input
            id="child-link-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={9}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-describedby={error ? 'child-link-error' : undefined}
            aria-invalid={error ? 'true' : undefined}
            className="w-full rounded-md border border-input bg-background text-foreground px-3 py-2 font-mono tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="ABCD-EFGH"
          />
        </div>
        <Button type="submit" disabled={busy || !code.trim()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : null}
          Link
        </Button>
      </form>
      {error ? <p id="child-link-error" role="alert" className="text-sm text-destructive">{error}</p> : null}
      {linkedName ? <p role="status" className="text-sm">Linked with {linkedName}.</p> : null}
    </section>
  );
};

export default LinkMyChildPanel;

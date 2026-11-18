/**
 * RestoreAccount -- the page the deletion email links to (/restore-account?token=...). Restores an account that is
 * scheduled for deletion, within its 30-day window (POST /compliance/restore-account). No session is needed: the
 * deletion request ended them all; after restoring, the person signs in with their password.
 *
 * Themes: semantic tokens only (background/card/foreground/muted/border/primary). Accessibility: a real button,
 * the result announced in a status/alert region.
 */
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import apiClient from '../lib/apiClient';

const RestoreAccount = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');

  const restore = async () => {
    setState('working');
    try {
      const res = await apiClient.post('/compliance/restore-account', { token });
      setMessage(res?.data?.message || 'Your account is restored.');
      setState('done');
    } catch (err) {
      setMessage(err?.response?.data?.detail || 'This restore link is not valid or has expired.');
      setState('error');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-foreground">
        <h1 className="mb-2 text-xl font-semibold">Restore your account</h1>
        {state !== 'done' && (
          <p className="mb-4 text-sm text-muted-foreground">
            Your account is scheduled for deletion. Restoring it cancels the deletion; then sign in with your password.
          </p>
        )}
        {!token && <p role="alert" className="text-sm text-destructive">This link is missing its restore code.</p>}
        {token && state !== 'done' && (
          <button
            type="button"
            onClick={restore}
            disabled={state === 'working'}
            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {state === 'working' ? 'Restoring...' : 'Restore my account'}
          </button>
        )}
        {state === 'done' && (
          <div role="status">
            <p className="mb-4 text-sm">{message}</p>
            <Link to="/auth" className="text-sm font-semibold text-primary underline">Go to sign in</Link>
          </div>
        )}
        {state === 'error' && <p role="alert" className="mt-3 text-sm text-destructive">{message}</p>}
      </div>
    </main>
  );
};

export default RestoreAccount;

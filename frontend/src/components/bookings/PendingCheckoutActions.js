import React, { useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { getCheckoutUrl, navigateToCheckout } from '../../utils/checkoutUrl';
import { Button } from '../ui/button';

export function PendingCheckoutActions({ bookingId, onRefresh }) {
  const active = useRef(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  useLayoutEffect(() => () => active.current?.abort(), []);

  async function recover(action) {
    if (active.current || result) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const { data } = await apiClient.post(`/bookings/${bookingId}/pending-checkout`, { action },
        { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (action === 'resume' && data?.status === 'open') {
        const url = getCheckoutUrl(data.checkout_url);
        if (!url) throw new Error();
        navigateToCheckout(url);
      } else if (data?.status === 'Confirmed' || data?.status === 'Cancelled') {
        const message = data.status === 'Confirmed' ? 'Payment received. Booking confirmed.' : 'Checkout cancelled.';
        setResult(message);
        toast.success(message);
        onRefresh?.();
      } else {
        throw new Error();
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const detail = err?.response?.data?.detail;
        setError(typeof detail === 'string' ? detail : 'Could not confirm checkout. Try again from Scheduled Bookings.');
      }
    } finally {
      if (!controller.signal.aborted) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  if (result) return <p role="status">{result}</p>;
  return (
    <div className="mt-3 space-y-2">
      {confirmCancel && <p className="text-sm">Cancel this checkout? Any credits reserved for this unpaid booking will be returned.</p>}
      <div className="flex flex-wrap gap-2" aria-busy={busy}>
        {confirmCancel ? <>
          <Button type="button" size="sm" disabled={busy} onClick={() => recover('cancel')}>Confirm cancellation</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setConfirmCancel(false); setError(''); }}>Keep checkout</Button>
        </> : <>
          <Button type="button" size="sm" disabled={busy} onClick={() => recover('resume')}>Resume checkout</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setConfirmCancel(true); setError(''); }}>Cancel checkout</Button>
        </>}
      </div>
      {error && <p role="alert" className="text-sm">{error}</p>}
    </div>
  );
}

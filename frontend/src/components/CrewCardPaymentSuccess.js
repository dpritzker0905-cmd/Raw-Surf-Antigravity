import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Button } from './ui/button';
import { Loader2 } from 'lucide-react';
import apiClient from '../lib/apiClient';

const MAX_ATTEMPTS = 10;

const CrewCardPaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { theme } = useTheme();
  const userId = user?.id;
  const sessionId = searchParams.get('session_id');
  const identity = useRef(null);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ status: 'checking' });
  const key = JSON.stringify([userId, sessionId, retry]);
  identity.current = { key, authLoading };

  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempts = 0;
    const controller = new AbortController();
    const isCurrent = () => !cancelled && identity.current.key === key && !identity.current.authLoading;
    const show = (status, message) => setResult({ key, status, message });
    if (authLoading || !userId) return () => { cancelled = true; };
    if (!sessionId) {
      show('error', 'The checkout reference is missing. Open your bookings or contact support.');
      return () => { cancelled = true; };
    }
    show('checking');
    const poll = async () => {
      if (!isCurrent()) return;
      attempts += 1;
      try {
        const response = await apiClient.get(`/dispatch/crew-payment/${encodeURIComponent(sessionId)}`, {
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        const payment = response.data || {};
        if (payment.status === 'completed') {
          if (typeof payment.participant_id !== 'string' || !payment.participant_id ||
              typeof payment.dispatch_id !== 'string' || !payment.dispatch_id) {
            show('review_required', 'Your payment needs review. Contact support before starting another checkout.');
            return;
          }
          show('completed', 'Your crew share is paid. Open your bookings to view the session.');
        } else if (['review_required', 'refunded', 'partially_refunded', 'expired'].includes(payment.status)) {
          show(payment.status, typeof payment.message === 'string' ? payment.message : undefined);
        } else if (attempts < MAX_ATTEMPTS) {
          // Provider-paid alone does not prove that the crew participant was fulfilled.
          show('pending');
          timer = setTimeout(poll, 2000);
        } else {
          show('delayed');
        }
      } catch (error) {
        if (isCurrent()) show('error', 'We could not check your payment. Refresh its status before starting another checkout.');
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, authLoading, userId, sessionId]);

  const visible = authLoading || !userId || result.key !== key ? { status: 'checking' } : result;
  const busy = ['checking', 'pending'].includes(visible.status);
  const titles = {
    checking: 'Checking your crew payment',
    pending: 'Confirming your crew payment',
    completed: 'Crew payment confirmed',
    review_required: 'Your crew payment needs review',
    refunded: 'Crew payment refunded',
    partially_refunded: 'Crew payment partially refunded',
    expired: 'Crew checkout expired',
    delayed: 'Confirmation is taking longer',
    error: 'Payment status unavailable',
  };
  const messages = {
    checking: 'Please wait while your account and payment are verified.',
    pending: 'Your crew payment has not finished confirming. You do not need to start another checkout.',
    review_required: 'Contact support before starting another checkout. Your crew place has not been confirmed here.',
    refunded: 'This payment was refunded. This receipt does not confirm an active crew place.',
    partially_refunded: 'This payment has a partial refund. Contact support to confirm your crew place.',
    expired: 'This checkout has expired. Open your bookings to check your current invite.',
    delayed: 'Confirmation is still pending. Refresh the payment status or contact support before paying again.',
  };
  const canRefresh = !busy && visible.status !== 'completed' && !!sessionId;

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-4"
      data-theme={theme} aria-labelledby="crew-payment-title" aria-busy={busy}>
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center space-y-5">
        {busy && <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" aria-hidden="true" />}
        <h1 id="crew-payment-title" className="text-2xl font-bold">{titles[visible.status]}</h1>
        <p className="text-muted-foreground" role={busy || visible.status === 'completed' ? 'status' : 'alert'}
          aria-live="polite">{visible.message || messages[visible.status]}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {canRefresh && <Button onClick={() => setRetry(value => value + 1)}>Refresh payment status</Button>}
          <Button variant="outline" onClick={() => navigate('/bookings?tab=scheduled')}>Open bookings</Button>
        </div>
      </section>
    </main>
  );
};

export default CrewCardPaymentSuccess;

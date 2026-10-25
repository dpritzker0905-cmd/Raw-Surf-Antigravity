import React from 'react';
import { useThemeName } from '../../contexts/ThemeContext';

export default function LiveSessionCheckoutPending({ checkout }) {
  const theme = useThemeName();
  const surface = theme === 'light' ? 'bg-white text-zinc-950 border-zinc-300'
    : theme === 'beach' ? 'bg-black text-white border-white'
      : 'bg-zinc-900 text-white border-zinc-600';
  return (
    <div className={`rounded-xl border p-4 space-y-4 ${surface}`}>
      <div role="status" aria-live="polite">
        <h4 className="font-bold text-lg">Complete your checkout</h4>
        <p>You are not joined yet. Your session entry will be verified after payment.</p>
      </div>
      <a href={checkout.url} className="block rounded-lg bg-yellow-400 text-black p-3 text-center font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        Continue to checkout
      </a>
      <a href="/bookings?tab=live_sessions" className="block underline text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        View session bookings
      </a>
    </div>
  );
}

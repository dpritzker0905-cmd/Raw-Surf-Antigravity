import React from 'react';
import { crewId } from '../../hooks/useSharedQuickBookQuote';

const money = cents => `$${(cents / 100).toFixed(2)}`;

export default function SharedQuickBookPrice({ pricing, crew }) {
  const { quote, error, refresh } = pricing;
  if (!quote) return <div role="status">{error || 'Getting your crew price…'}
    {error && <button type="button" onClick={refresh}>Retry price</button>}
  </div>;
  return <section aria-label="Crew price" className="space-y-2">
    <p>Session before benefits <strong>{money(quote.gross_cents)}</strong></p>
    {quote.extra_surfer_fees_cents > 0 && <p>Includes {money(quote.extra_surfer_fees_cents)} in extra-surfer fees</p>}
    {quote.benefit_cents > 0 && <p>{quote.subscription_covered ? '1 included session for your seat' : 'Your plan discount'}
      {' '}−{money(quote.benefit_cents)}</p>}
    <p>You pay <strong>{money(quote.captain_cents)}</strong></p>
    {crew.map(member => <p key={crewId(member)}>{member.name || member.username || member.value} owes{' '}
      <strong>{money(quote.crew_cents[crewId(member)])}</strong></p>)}
    <p>Total due <strong>{money(quote.total_cents)}</strong></p>
  </section>;
}

import React from 'react';
import { Input } from '../../ui/input';

const PACKAGE_AMOUNTS = ['10', '25', '50', '100'];

export default function CreditPackageBonusesSection({ bonuses, onChange, disabled = false }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-4" aria-labelledby="credit-bonus-title">
      <div>
        <h3 id="credit-bonus-title" className="font-medium text-foreground">Credit package bonuses</h3>
        <p className="text-sm text-muted-foreground">
          Bonus credits are spend-only. Set a bonus to 0 to hide its promotional message.
          Saved changes apply to new checkouts; existing checkout offers keep their terms.
        </p>
      </div>
      {!bonuses ? (
        <p role="status" className="text-sm text-muted-foreground">Bonus configuration is unavailable. Reload pricing before saving.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PACKAGE_AMOUNTS.map(amount => (
            <div key={amount}>
              <label htmlFor={`credit-bonus-${amount}`} className="block text-sm text-foreground mb-1">
                Bonus credits for ${amount} purchase
              </label>
              <Input id={`credit-bonus-${amount}`} type="number" min="0" step="1"
                value={bonuses[amount] ?? 0} disabled={disabled}
                onChange={event => onChange(amount, event.target.value)}
                aria-describedby={`credit-bonus-help-${amount}`} />
              <p id={`credit-bonus-help-${amount}`} className="text-xs text-muted-foreground mt-1">
                {bonuses[amount] > 0 ? `${Number(amount) + bonuses[amount]} total credits; ${bonuses[amount]} spend-only bonus.` : 'No bonus advertised.'}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

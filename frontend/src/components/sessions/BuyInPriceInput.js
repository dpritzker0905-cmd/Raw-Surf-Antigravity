import React, { useEffect, useId, useRef, useState } from 'react';
import { Input } from '../ui/input';

export default function BuyInPriceInput({ price, onPriceChange, invalid, setInvalid, className }) {
  const [draft, setDraft] = useState(null);
  const previousPrice = useRef(25);
  const free = price === 0;
  const errorId = useId();
  useEffect(() => () => setInvalid(false), [setInvalid]);

  return (
    <div>
      <Input
        aria-label="Session buy-in price"
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        type="number"
        step="0.01"
        min="0.01"
        max="500"
        className={className}
        disabled={free}
        value={free ? 0 : (draft ?? price ?? 25)}
        onChange={event => {
          const value = event.target.valueAsNumber;
          const valid = Number.isFinite(value) && event.target.validity.valid;
          setDraft(event.target.value);
          setInvalid(!valid);
          if (valid) onPriceChange(value);
        }}
        onBlur={() => { if (!invalid) setDraft(null); }}
      />
      {invalid && <p id={errorId}>Enter $0.01 to $500 in whole cents, or select Free session.</p>}
      <label>
        <input type="checkbox" aria-label="Free session" checked={free} onChange={event => {
          setDraft(null);
          setInvalid(false);
          if (event.target.checked) {
            previousPrice.current = price > 0 ? price : 25;
            onPriceChange(0);
          } else {
            onPriceChange(previousPrice.current);
          }
        }} /> Free session
      </label>
    </div>
  );
}

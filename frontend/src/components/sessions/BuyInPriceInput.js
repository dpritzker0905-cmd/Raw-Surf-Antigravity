import React, { useRef, useState } from 'react';
import { Input } from '../ui/input';

export default function BuyInPriceInput({ price, onPriceChange, className }) {
  const [draft, setDraft] = useState(null);
  const previousPrice = useRef(25);
  const free = price === 0;

  return (
    <div>
      <Input
        aria-label="Session buy-in price"
        type="number"
        step="0.01"
        min="0.01"
        max="500"
        className={className}
        disabled={free}
        value={free ? 0 : (draft ?? price ?? 25)}
        onChange={event => {
          const value = event.target.valueAsNumber;
          const valid = Number.isFinite(value) && value > 0;
          setDraft(event.target.value);
          onPriceChange(valid ? value : 25);
        }}
        onBlur={() => setDraft(null)}
      />
      <label>
        <input type="checkbox" checked={free} onChange={event => {
          setDraft(null);
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

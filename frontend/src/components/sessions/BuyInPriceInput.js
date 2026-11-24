import React, { useRef, useState } from 'react';
import { Input } from '../ui/input';

export default function BuyInPriceInput({ price, onPriceChange, className }) {
  const [empty, setEmpty] = useState(false);
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
        value={empty && !free ? '' : (price ?? 25)}
        onChange={event => {
          const value = event.target.valueAsNumber;
          const valid = Number.isFinite(value) && value > 0;
          setEmpty(!valid);
          onPriceChange(valid ? value : 25);
        }}
        onBlur={() => setEmpty(false)}
      />
      <label>
        <input type="checkbox" checked={free} onChange={event => {
          setEmpty(false);
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

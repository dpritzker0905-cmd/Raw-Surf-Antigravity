import React, { useState } from 'react';
import { Input } from '../ui/input';

export default function BuyInPriceInput({ price, onPriceChange, className }) {
  const [empty, setEmpty] = useState(false);
  return (
    <Input
      aria-label="Session buy-in price"
      type="number"
      step="0.01"
      min="0"
      max="500"
      className={className}
      value={empty ? '' : price}
      onChange={event => {
        const value = event.target.value;
        setEmpty(value === '');
        onPriceChange(value === '' ? 25 : Number(value));
      }}
      onBlur={() => setEmpty(false)}
    />
  );
}

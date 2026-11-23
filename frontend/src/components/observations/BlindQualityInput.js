/**
 * BlindQualityInput - "How good is it right now?", the blind surf-quality truth (gates/surf-tide-v1.md section 0).
 *
 * Seven choices, the rating's own levels in words (the server sends the labels; surf_rating.LEVELS order). It shows
 * NO forecast, rating, tide, tide preference or example: the words are the whole question. It is optional and never
 * blocks the report. No reward depends on the answer.
 *
 * Accessibility: a native radio group in fieldset/legend (one Tab stop, arrow keys move within it, Space selects),
 * every level labelled in words, the selected one marked by a check mark and bold text as well as its border, so
 * nothing is conveyed by colour alone; a real "Clear" button undoes a choice. Themes: semantic tokens only
 * (foreground, muted, card, border, primary, ring), which light, dark and beach mode all define. Wraps on phones.
 */
import React from 'react';

const BlindQualityInput = ({ idPrefix = 'obs', levels = [], value = '', onChange }) => {
  const name = `${idPrefix}-quality`;
  const legendId = `${name}-legend`;
  return (
    <fieldset className="space-y-1.5" data-testid="blind-quality-input" aria-describedby={`${name}-help`}>
      <legend id={legendId} className="text-sm text-muted-foreground mb-1.5">How good is it right now? (optional)</legend>
      <p id={`${name}-help`} className="text-xs text-muted-foreground">Your own call, before any forecast.</p>
      <div className="flex flex-wrap gap-2">
        {levels.map((opt) => {
          const id = `${name}-${opt.value}`;
          const checked = value === opt.value;
          return (
            <label key={opt.value} htmlFor={id}
              className={`relative cursor-pointer select-none rounded-lg border px-3 py-2 text-sm min-h-[40px] flex items-center
                focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background
                ${checked ? 'border-primary bg-primary/15 text-foreground font-semibold' : 'border-border bg-card text-foreground hover:bg-muted'}`}>
              <input id={id} type="radio" name={name} value={opt.value} checked={checked}
                onChange={() => onChange(opt.value)} className="sr-only" />
              {checked && <span aria-hidden="true" className="mr-1">✓</span>}
              {opt.label}
            </label>
          );
        })}
      </div>
      {value && (
        <button type="button" onClick={() => onChange('')}
          className="text-xs underline text-muted-foreground hover:text-foreground">
          Clear my answer
        </button>
      )}
    </fieldset>
  );
};

export default BlindQualityInput;

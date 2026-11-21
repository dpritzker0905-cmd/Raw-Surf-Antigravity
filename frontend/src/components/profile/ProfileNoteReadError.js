import React from 'react';

export default function ProfileNoteReadError({ onRetry }) {
  return (
    <div className="mb-2 flex items-center justify-center gap-2 text-sm">
      <span role="status">Couldn't load the note.</span>
      <button type="button" className="underline" onClick={onRetry}>Retry note</button>
    </div>
  );
}

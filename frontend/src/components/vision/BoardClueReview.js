import React from 'react';

export const BoardClueReview = ({ clues = [], status, truncated, people = [] }) => (
  <section aria-label="Saved board clues" className="space-y-3 border-t border-border pt-3 text-foreground">
    <h4 className="font-semibold">Saved board clues for manual review</h4>
    <p className="text-xs text-muted-foreground">
      Compare the photo with these participants’ saved boards, then select a known surfer in manual assignment below.
      Similar boards can belong to different surfers. No one is selected or tagged automatically.
    </p>
    {status === 'no_linked_session' ? <p>Link this folder to a session to compare participants’ saved boards.</p>
      : status === 'no_saved_boards' ? <p>Linked participants have no saved board details to compare.</p>
        : status !== 'ready' ? <p>Saved board clues are unavailable for this scan.</p>
          : clues.length === 0 ? <p>No usable board overlap found. You can still review and assign surfers manually.</p> : null}
    <ul aria-label="Possible board overlaps" className="space-y-3">
      {clues.map((clue, index) => <li key={`${clue.board_id}-${clue.person_index}-${index}`}
        className="space-y-2 rounded-lg border border-border bg-background p-3 break-words">
        <p className="font-semibold">{clue.full_name || clue.username || 'Session participant'}
          {clue.username && <span className="ml-1 text-xs text-muted-foreground">@{clue.username}</span>}</p>
        <p>Saved board: {clue.board_label}</p>
        <p>Person {clue.person_index + 1}{people[clue.person_index]?.position ? ` (${people[clue.person_index].position})` : ''}
          {` — ${clue.relationship} a board`}</p>
        <p className="font-medium">{clue.strength === 'multiple' ? 'Multiple board details overlap' : 'Limited board clue'}</p>
        <ul aria-label="Overlapping board details" className="space-y-1 text-xs">
          {clue.evidence.map((item, i) => <li key={i}>
            {item.field.replace(/_/g, ' ')}: photo “{item.observed}”; saved “{item.saved}”
          </li>)}
        </ul>
        {clue.conflicts.length > 0 && <div className="text-xs">
          <p className="font-semibold">Details differ — check before assigning:</p>
          <ul>{clue.conflicts.map((item, i) => <li key={i}>
            {item.field.replace(/_/g, ' ')}: photo “{item.observed}”; saved “{item.saved}”
          </li>)}</ul>
        </div>}
        <p className="text-xs text-muted-foreground">Review this photo and the board details before manual assignment.</p>
      </li>)}
    </ul>
    {truncated && <p className="text-xs">Showing a limited set of saved boards or clues. Other possible overlaps may be omitted.</p>}
  </section>
);

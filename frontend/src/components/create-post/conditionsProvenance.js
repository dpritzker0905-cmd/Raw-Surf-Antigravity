// Where a post's session conditions came from, as the composer tells the server (check-in truth program P0, 2026-11-16).
// The server decides what is stored (backend services/conditions_provenance.py); the composer's job is not to lie:
// - a forecast prefill is 'auto' or 'auto_current';
// - ANY edit after a prefill makes it 'edited', never 'manual': the values are still a forecast the surfer adjusted;
// - with no prefill the composer holds 'unclaimed' (never 'manual': that word reads as a surfer's observation), and an
//   edit keeps it; the server stores it as 'unverified'.
const PREFILLED = new Set(['auto', 'auto_current', 'edited']);

export const sourceAfterEdit = (prev) => (PREFILLED.has(prev) ? 'edited' : prev);

// Wraps a field setter so that changing the field also records the edit. Pass it to inputs, not to the prefill code.
export const withEditMark = (setField, setConditionsSource) => (value) => {
  setField(value);
  setConditionsSource(sourceAfterEdit);
};

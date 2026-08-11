/**
 * The "Truth Violations" verdict — ONE function, every path.
 *
 * Extracted from TruthOverlay.js (2026-08-11, audit 11.2 mission T-1 last mile). The row was
 * decided inline by a nested ternary over `truthIssues.length` and a single parity status, which
 * meant every status the ternary did not name fell through to the GREEN branch. `useLayerTruthDiff`
 * and `__MARINE_SOURCE_PARITY__` are two INDEPENDENT validators; the row renders a verdict about
 * both, so it must consume both, exhaustively.
 *
 * ★ The invariant: this row may say "clean" only when a comparison actually ran AND agreed.
 *   Every other state — disagreement, refusal, or an instrument that is not there — is not clean.
 */

/** Statuses the parity gate is known to emit. Anything else is treated as unreadable. */
const KNOWN_PARITY_STATUS = ['MATCH', 'MISMATCH', 'UNSAMPLED', 'NOT_APPLICABLE'];

const violations = (issues, parityReasons) => ({ kind: 'violations', issues, parityReasons, notApplicable: false });
const unverified = (parityReasons) => ({ kind: 'unverified', issues: [], parityReasons, notApplicable: false });
const clean = (notApplicable) => ({ kind: 'clean', issues: [], parityReasons: null, notApplicable });

export function resolveTruthVerdict(truthIssues, parity, flags = {}) {
  const issues = Array.isArray(truthIssues) ? truthIssues : [];

  // A violation found by useLayerTruthDiff outranks everything — it is the most specific result.
  if (issues.length > 0) return violations(issues, null);

  const status = parity?.status;

  // Kill switch. Restores the pre-fix row exactly, so the change can be backed out in the browser
  // without a deploy if it turns out to be noisy in the resting state (the same failure mode the
  // UNSAMPLED scoping note in forecastDiagnostics.js records: a warning that is always on carries
  // as little information as a pass that is always on).
  if (flags.__RAW_DISABLE_PARITY_VERDICT__) {
    return status === 'UNSAMPLED'
      ? unverified(parity?.unsampledReasons || [])
      : clean(status === 'NOT_APPLICABLE');
  }

  // A real disagreement is a violation, even though the OTHER validator found nothing. These are
  // independent instruments; an empty list from one says nothing about the other.
  if (status === 'MISMATCH') return violations([], parity?.mismatchReasons || []);

  // A declared refusal.
  if (status === 'UNSAMPLED') return unverified(parity?.unsampledReasons || []);

  // ⛔ The instrument is missing or speaks a status we do not know. That is not a pass — it is the
  // absence of a measurement, and absence must REFUSE. Falling through to `clean` here is exactly
  // how `undefined ⇒ falsy ⇒ green` produced "AUTHORITATIVE NATIVE" during a total load failure.
  if (!KNOWN_PARITY_STATUS.includes(status)) {
    return unverified([`parity: status ${status == null ? 'absent' : String(status)}`]);
  }

  return clean(status === 'NOT_APPLICABLE');
}

export { KNOWN_PARITY_STATUS };

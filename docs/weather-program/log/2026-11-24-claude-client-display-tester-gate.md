# 2026-11-24 (claude, infobox-honesty session): pre-registered gate for the client display tester

Branch `claude/gate-client-display-tester` from dev ac7aadff7. Documentation only: no code, no flag and no served change.

- **The ask.**
  - David, 2026-11-24, via the lead: "Build client tester (Recommended)". #1219 ships dark; a client tester follows, then
    the flip under it.
  - The lead: pre-register the tester's acceptance first, as a docs PR, covering:
    - what it compares;
    - which spots and hours;
    - the cadence;
    - what counts as a mismatch or WORSE;
    - how it auto-disables at runtime;
    - the decide-style tests;
    - offline only;
    - and whether the kill must drop the subscription immediately (the advisor's nuance on #1219).
- **The gate.** `gates/client-display-tester-v1.md`, stamped 2026-11-24T18:56Z and committed before the tester exists.
  - **Rows:** 155 in all.
    - Infobox: 7 layer and model sets × 4 points × 5 hours. It includes the antimeridian, a land no-data point and an
      off-lattice hour.
    - Glyph tide: 3 spots × 5 hours, one hour past the payload's coverage.
  - **Comparisons:** the infobox against an independent Node decode of the shown frame, plus a generator sidecar as a third
    oracle; the glyph tide against the tide marker.
  - **Runs:** every 6 h and on `dev` frontend pushes, offline only.
  - **Verdicts:** PASS / WORSE / SANITY / INCONCLUSIVE.
  - **decide():** WORSE or SANITY -> off; INCONCLUSIVE ×3 -> off; PASS ×3 after an off -> propose_on only; the owner clears.
  - **Kill list:** a public, versioned list on the frame CDN (`v1/control/client_kills.json`, no Render load). It fails
    closed on a cold start with no last-known list.
  - **Immediacy:** a kill unsubscribes the infobox immediately (a store the hook's effect depends on), answering the
    advisor's nuance: yes, it must be immediate.
  - **Acceptance A1-A5:** decide() tests; client kill tests; 3 null PASS runs; seven seeded positive controls (WORSE for
    the card and for the glyph, three SANITY cases including a LEAK canary that never resolves, a wrong-frame CDN and an
    oracle disagreement); and an INCONCLUSIVE drill. Every kill goes to a STAGING list first.
- **Panel.**
  - SubQ and Reflection agreed on: persisting the last-known kill list; INCONCLUSIVE ×3 -> off with the owner told from
    the first; an immediate unsubscribe; and adding the SANITY and glyph positive controls, a third oracle, and kill-list
    parsing and versioning tests.
  - They split on a cold start with no list: SubQ said fail closed, Reflection said fail open on a first-ever start. The
    gate takes fail closed, because fail-closed only shows the shipped dark baseline, while fail-open could re-enable a
    known-bad flag.
- **Order:** this gate, then the code PR, then the results (a later commit), then the flip on the owner's word via the
  director.

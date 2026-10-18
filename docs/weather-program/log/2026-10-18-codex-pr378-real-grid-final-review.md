# 2026-10-18: independent final real-grid replay review

Owner: "Do a final independent review of the real-grid replay canary, ask Reflection to challenge it, and fix any real issues. Don't merge or enable the guard, and leave production and Claude's work untouched."

Reviewed branch33210fb6302f222990707e9be5adcbaaf8e78269 and isolated deployed adapter6f67cdb64842c4985b24072a3d3877638e8ec43a, backend6fbf439ac. Used the code-verification skill, an independent read-only reviewer, direct source inspection, and Reflection Beam. First Reflection attempt returned no final answer; the second identified the cache/hash gap. A subsequent focused challenge of the fixes found no concrete blocker. These are advisory reviews, not substitutes for executed checks.

## Confirmed findings and fixes

- P2: replay/grid reported the sealed SHA without hashing the loaded cached product. Actual ProductStore shallow copies share vectors. Offline fault injection changed one cached vector while disk integrity remained true; products correctly refused but replay incorrectly succeeded. Regression failed before the fix with Changed replay was served successfully. Replay now hashes the exact serialization and returns the parsed checked bytes; corruption is refused503 and restored data passes. No remote mutation exploit is claimed.
- P2: independent HTTP verifier accepted any nonempty adapter identity. It now requires an explicit expected full40hex SHA and exact equality. Wrong/arbitrary/short identity controls fail; matching SHA passes. Receipt records start and finish separately.
- P2: workflow path filters omitted pinned archive/source dependencies. Reader now qualifies every file in its canary directory; capture includes bootstrap/source pins/archive and its new helper. No shared workflow or concurrency group changed.
- P3: capture budget was enforced after buffering the entire response. Provider responses now stream in64KiB chunks, stop consumption on crossing the remaining budget, and close on success/failure. Offline fake-response controls prove early refusal and a fitting positive case. The original recorded capture was below budget, so its sealed evidence remains unchanged.
- Missing sealed disk files now yield bounded503 integrity refusal instead of an uncaught filesystem500. The offline missing-file test restores bytes in finally and proves the positive path afterwards.

Fresh local checks passed six startup refusals plus actual128product cold startup, memory corruption/missing-file/adapter/download-budget controls and restored positives with guard0 and zero reader network attempts. The regression harness initially needed its repository import path corrected before reaching the genuine failing-before control; that harness setup error is not product evidence.

Remote refs re-read2026-10-18T22:38UTC: dev2466e71e8f064b682a6e961fecc15bb570a911f6, main261db85a9508bf5a03ddd70dd21271493d5858a8, prior fixture branchcd4253652c53047f138b1237ac5f9fa3da1cd18d. None changed by this work. Publication, exact-head Linux qualification, and hosted final readback are pending below. No forecast number changed; no SCOREBOARD numerical gain claimed. Regional sampling, offline replay, no global/full-app/L2/guard-on/scientific acceptance limitations remain.

## Final qualification (2026-10-18T22:42UTC)

Fixes published on this isolated branch at c8e8013c9145e8ce9490b74883bbed4f7a552d7f. Exact-source Linux reader39173133571 passed startup/refusal/corruption controls and full HTTP qualification:128product hashes,48estimates,144contributor links,16cycle cases,48exact frames/48held-hour refusals,10negative routes,4concurrent reads. Downloaded reader artifacts were inspected directly. Local Windows fullHTTP passed at the same adapter SHA; its first sandboxed child startup produced no output and timed out, then the identical sanitized command passed outside that process/network sandbox. That environment failure is retained, not graded as product success.

Fresh provider capture39173133589 passed at the same c8e8013c source:128products/16cases,116680056HTTP bytes, guard0. Its newly timestamped artifact hash a4c4d292de45b1dfc3d1a7b2883efe0b8a66b2d46690f21a7860931ceaeb2502 is a new CI artifact, not the deployed bundle. The tracked/deployed sealed bundle remains unchanged at1d622527a910334880c127a65f6b68a84af800366c744d8ef0d1a8cd5178c64d.

Fresh hosted HTTP22:39:21..22:40:37UTC passed the same complete counts against explicitly expected OLD adapter6f67cdb64842c4985b24072a3d3877638e8ec43a. This proves current hosted replay/guard state, not deployment of the fixes. No Render mutation or deployment was performed for this review. The fixed branch is review-ready; applying its adapter to the hosted service remains a separate deployment step. No merge, guard enablement, production request/change, main/dev ref update, or Claude work modification occurred.

The independent reviewer's final pass found no remaining blocker and independently tested real Requests/urllib3 response compatibility for empty/JSON/70KiB bodies, including subsequent content/iter_content access after close. Reflection's focused follow-up also found no concrete blocker. Claims remain limited to sampled replay correctness and evidence integrity; no scientific acceptance or operational ICON availability guarantee follows.

Public review receipt: evidence/pr378-real-grid-final-review-2026-10-18.json.

# Amendment 1 to tide-guard-v1 (the advisor's pre-code limit L1 on #1278)
Stamp: 2026-11-24 18:44Z. Written before any tester code, any build has been scored, or any verdict exists. Where this file and `tide-guard-v1.md` differ, this file holds. Every other rule is unchanged. Source: the director's (`local_d6b521eb`) message relaying the advisor's PASS-WITH-LIMITS on #1278 at `3a7df56b4`.

## 1. Staleness is judged every cycle, never cached (L1 a)

- `tide-guard-v1` §2 and §5 let a cycle on an already-judged build reuse that build's verdict. This amendment narrows
  that.
- **The 36-hour staleness test runs on EVERY cycle, before any cached verdict is read.** It is now − the build stamp
  of the table read (or stamp-checked) in that cycle.
  - If that is more than 36 h, the cycle's verdict is UNTESTABLE, whatever the build's cached verdict was.
  - So a stalled build cannot keep returning its old NOT_WORSE (or WORSE) indefinitely.
- **Only a build within 36 h may reuse its cached verdict.** The no-double-strike rule is unchanged: a cached WORSE
  adds no strike.
- **A unit test pins this:** a build judged NOT_WORSE, then read again 37 h after its stamp, gives UNTESTABLE.

## 2. The blind report counts cycles across at least 24 hours (L1 b)

- `tide-guard-v1` §5's "3 consecutive UNTESTABLE builds open a report" is replaced. The new rule: **3 or more
  consecutive UNTESTABLE CYCLES, whose first and last cycle are ≥ 24 h apart, open the report.**
- These are guardrail cycles (every 6 h), not builds. A stalled build produces no new builds, so counting builds would
  never fire. That is the failure this report exists for.
- Any judged cycle (WORSE or NOT_WORSE) resets the count.
- UNTESTABLE still neither strikes nor resets the strike count (§5 unchanged).
- **A unit test pins this:** 3 UNTESTABLE cycles across 12 h open no report; 5 across 24 h open one.

## 3. ONE dedicated issue, matched by no other guardrail search (L1 c)

- **The report is one GitHub issue, titled exactly:**
  `TIDE guard blind: the tide tester could not judge the served tide for 24 h`
  - It is opened once and commented on while it stays open, like the PHYSICS family's issue.
  - It is found with `--search "\"TIDE guard blind\" in:title"`, then filtered with
    `select(.title | startswith("TIDE guard blind"))`.
- **Its title contains none of the words the other three searches use:** `Flag guardrail`, `"PHYSICS guard blind"` and
  `P0 cold-start snapshot drift`. In particular it contains no "flag", "guardrail", "PHYSICS", "P0", "cold-start",
  "snapshot" or "drift".
  - Each of the other three titles fails the new `startswith("TIDE guard blind")` filter.
  - The new title fails each of their filters.
- **A test pins all four ways:** like the existing test in `tests/test_flag_guardrail.py`, run against all four
  titles.

## 4. Disclosures (reported, not legs)

- **A near-lineage pair is reported on EVERY run.** It is HARBOR_BAY monitor 9418686 (Hookton Slough), at key donor
  9418723 (Fields Landing, d_K 3.186 km).
  - Its NOAA reference, 9418767 (Humboldt Bay, North Spit), is not the donor, as §3 requires. But it lies 4.865 km
    from the donor, in the same bay.
  - So the truth there and the ON arm draw on near-neighbouring constants. Any resulting agreement favours ON, the
    UNSAFE direction for a tester (it would hide a worse ON, not invent one).
  - The run report prints this monitor's per-arm medians beside the stratum's. The verdict is computed both with and
    without it; the verdict stands as §5 defines it, and the without-it verdict is printed.
  - It is not removed: the rule chose it, and changing the frozen set after the fact is not allowed.
- **An alternating sequence resets.** Under `tide-guard-v1` §5, NOT_WORSE resets the strike count. So a fix whose
  builds alternate WORSE, NOT_WORSE, WORSE, … never reaches two strikes, and is never disabled by WORSE alone.
  - Sanity breaches still act at once.
  - The run report prints the count of WORSE builds in the last 14 days, so the pattern is visible to the owner.
  - This is a known limit of the inherited persistence rule (`STRIKES`), not changed here.

## 5. What happens next (the advisor's L2 and L3, recorded)

- **L2:** the tester code and the A build's two-arm table each come as their OWN gated PR, carrying T1–T6 as they
  apply. Before anything is added to `flag_guardrail.py` (756/760 lines), a block moves out of it (#1267 L3).
- **L3:** `SURF_TIDE_A_HARCON` stays OFF until BOTH `tide-a-harcon-v1` PASSES and T4 accepts the tester on a real
  two-arm build.

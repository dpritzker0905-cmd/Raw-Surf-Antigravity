# ROLLBACK READINESS — Audit 11.4

**Verdict: PASS.** This is the strongest gate in the audit.

## Two independent rollback levers

### 1. Runtime kill switch (no deploy)

```js
window.__RAW_DISABLE_SHELTER_CACHE__ = true;
```

Restores the pre-cache path **exactly**: no key is computed, no lookup occurs, `classifySheltered`
plus the close run on every call. Verified two ways:

- **test-pinned** — mutation M5 (kill switch ignored) is CAUGHT by the suite;
- **runtime** — the author's A/B uses it as the control arm and it produced 0% hit in both phases,
  which is what a working switch must do.

### 2. Git revert (single commit)

```bash
git revert e6033e2b
```

| Check | Result |
|---|---|
| Single commit? | Yes — `e6033e2b`, 3 files |
| Clean revert? | Assessed clean — no later commit touches these files (`e6033e2b` is HEAD) |
| Data migrations | None |
| Cache format changes | None persisted — in-memory only, no storage, no service-worker entry |
| Service-worker version change | None |
| Public interface change | Two new exports (`_closeShelteredMask`, `_resetShelterCache`), both underscore-prefixed, consumed only by tests |
| Dependency / lockfile change | None |
| Feature flags left behind | One — and it is the kill switch itself |

⚠️ **Rollback rehearsal was NOT executed.** The revert is assessed clean by inspection of the commit
graph and the diff, not by running it. Given the change is additive within one file and HEAD sits on
the commit, the risk of a dirty revert is very low — but it was not demonstrated.

## Observability — what would signal a regression

Already exposed; no new instrumentation needed:

- `window.__RAW_GPU__.shelterCache` → `{hit, miss, size}`. A hit rate of 0 while static means the
  cache is not working; `size > 4` means eviction is broken.
- `window.__RAW_GPU__.shelteredCalls` / `shelteredWorkCalls` → call and work-call frequency.
- `window.__RAW_MASK_INPUT_HASH__` → full distinct-input histogram, off by default.

**Gap:** the failure mode this repair is least protected against — *a wrong mask on a hit* — has
**no telemetry signal at all**. It is visible only as a wrong render, and only to a human looking at
the map. That is the direct consequence of the Gate C failure, and it is why the corrected tests are
a precondition for the next gate rather than a nice-to-have.

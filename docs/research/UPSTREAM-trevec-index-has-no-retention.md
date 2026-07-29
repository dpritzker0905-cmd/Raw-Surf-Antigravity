# Upstream report — trevec: the Lance index grows without bound (437 GB over 0.46 GB of data)

Ready to send. Measured 2026-07-29 on trevec against a 0.46 GB repository on Windows 11.
Local mitigation is in place (`scripts/trevec_index_gc.py` + an hourly scheduled task); this is the
report that would make the mitigation unnecessary.

---

## Summary

`.trevec/lance` grew to **437.50 GB** while indexing a repository whose actual indexed content is
**0.46 GB** — an index **948× the size of the data it indexes**. It filled a 936 GB volume to zero
twice in one working day.

The cause is not a leak in the usual sense. LanceDB commits are versioned and append-only: every
re-index writes a complete new index and supersedes the previous one **without removing it**. Over
two months of normal agent use this accumulated **52,023 index versions, of which exactly one was
live**. Each version is a full ~13.4 MB copy.

    .trevec/lance/code_nodes.lance/
      _indices/       436.16 GB   99.7%   52,023 versions, 1 live
      _versions/        0.85 GB           68,232 manifests
      data/             0.46 GB           <-- the actual indexed content
      _transactions/    0.03 GB           69,669
      _deletions/       0.00 GB

**99.997% of the index directory was superseded versions.**

## Growth

| month | new files | added |
|---|---|---|
| 2026-05 | 20,742 | 19.3 GB |
| 2026-06 | 75,076 | 77.7 GB |
| 2026-07 | 209,885 | **340.5 GB** (partial month) |

Accelerating, because each copy grows with the repo — the oldest version is 5.6 MB, the newest
13.4 MB, so the same number of re-indexes costs 2.4× what it did in May. Measured rate: **22 new
index versions in 60 minutes** of light editing, 1–2.5 GB/hour under real work, **~11 GB/day**.

A rebuild of the identical content produces **55 MB with 1 index version** — so the steady state is
**7,950× smaller** than what accumulated.

## Why it cannot be worked around from outside

1. **No maintenance command.** `trevec --help` offers `init · index · ask · inspect · serve ·
   watch · mcp · projects · stats · update · telemetry · license · memory`. There is no `compact`,
   `vacuum`, `prune` or `gc`.
2. **No retention setting.** `.trevec/config.toml` has `[memory] retention_days` and `max_events`,
   but those govern episodic chat memory, not the Lance index. Nothing bounds the index.
3. **Lance's own dataset-level auto-cleanup is ignored by trevec's writer.** Setting
   `lance.auto_cleanup.interval` and `lance.auto_cleanup.older_than` via `update_config` works
   (verified against a control: 16 overwrites → 2 versions / 4.9 KB with it, 17 versions / 40.1 KB
   without). But with it installed on the live store at 15 versions, a real `trevec index` run wrote
   versions 16–22 — seven commits, crossing `interval=5` — and **every version from 1 onward
   survived**, including one well past the 30-minute `older_than`. Either the bundled Lance predates
   the feature, or the write path does not consult it.
4. **Deleting the store by hand is unsafe while a server is live.** Doing so left ~26 GB allocated
   behind an open handle (freed only when the process died), and the orphaned `serve` process went
   from 0.76 of a core to saturating all 16 in a retry loop — 13.3 CPU-hours total.

## Contributing factor worth fixing independently

**Two `trevec serve` processes ran against the same store** — one auto-started per client — and both
wrote to it, multiplying version churn. A lock, or reuse of an existing server for the same
`--path`, would halve this on its own.

## Suggested fixes, cheapest first

1. **Set `auto_cleanup_options` at dataset creation** in `trevec init`/`index`. Lance's docs note
   this reliably applies to a *new* dataset, which sidesteps whatever prevents the `update_config`
   path from taking effect.
2. **Call `cleanup_old_versions` after each index commit.** Lance's default `older_than` is two
   weeks, which at 11 GB/day still permits ~154 GB — so pass an explicit window (hours) plus a
   `retain_versions` floor.
3. **Expose `trevec gc` / `trevec compact`**, so operators have any supported recourse at all.
4. **Add an index retention block to `config.toml`**, alongside the existing memory retention.
5. **Single-writer guard on `serve --path`.**

## Reproduction

```bash
trevec init .            # any repo
# drive normal agent activity for a few days, or:
for i in $(seq 1 50); do trevec index . ; done
du -sh .trevec/lance/*/_indices     # grows ~13 MB per run, nothing is ever removed
```

## Impact

Two engineering investigations were spent on symptoms rather than the cause: a full disk presented
first as **96 flaky test failures** and later as **an empty log file**. Neither had anything to do
with the disk on its face. The diagnostic tell was available from the first measurement and nobody
looked at it — a 437 GB index over 0.46 GB of data is not a capacity problem to be solved with a
bigger disk; it is a correctness problem wearing a capacity problem's clothes.

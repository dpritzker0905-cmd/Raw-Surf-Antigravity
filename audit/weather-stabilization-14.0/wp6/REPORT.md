# WP-6 / F-06 — local record identity diagnostic

**Diagnostic delivered; live-process attribution remains unverified. No serving code was changed.** The [reproducer](probe_record_identity.py) executes the actual `ProductStore.restore_from_supabase`, `get_manifest`, `load_product`, and `resolve_grid` in one local process. Temporary subclass instrumentation records actual reads and returned object identities. L2 is an in-memory controlled byte source; socket connections and uploads are rejected. All files are inside a temporary directory. [Full result and source hashes](record-identity-results.json).

The local original cache was independently checked: its manifest was last updated August 14 and lacks the September 20 audit product. It cannot expose the live Render worker's record identity. No large live `/products` response was downloaded and no remote instrumentation was installed. The experiment below is explicitly synthetic, not a production snapshot.

## Discriminating result

Two controls use the same product filename and valid time, with an older L1 product and a newer L2 manifest/product version. One changes only provenance; the other changes provenance **and** height from 1 m to 2 m.

| Read after actual manifest restore | Manifest cycle | Served cycle | Heights: label-only / value-change scenario |
|---|---|---|---|
| Warm product cache | January 2 06Z | January 1 12Z | 1 m / 1 m |
| Clear only memory cache; read existing L1 file | January 2 06Z | January 1 12Z | 1 m / 1 m |
| Positive control: L1 absent, fake L2 download | January 2 06Z | January 2 06Z | 1 m / 2 m |

All dates in this table are **2035 fixture timestamps**. Both scenarios pass their assertions. The result records the actual local refresh time, manifest metadata, memory-cache insertion time, disk modification times, hashes, and each resolver read. A product filename match does not establish a matching version: the manifest entry and loaded `NormalizedProduct` are separate objects and can carry different cycles and ingestion timestamps.

The mechanism is concrete. Manifest restoration replaces/caches `manifest.json` while intentionally skipping individual product downloads. Product lookup first uses its five-minute memory cache; after that it reads an existing L1 file. It contacts L2 only when that local file is absent. Neither path reconciles the file's version with the freshly restored manifest entry. The probe shows the L1 bytes and mtime stay unchanged by manifest restore. Clearing memory alone therefore cannot resolve an older disk copy.

This establishes that the current mechanism can preserve **stale values as well as stale labels**. It does not establish which case occurred on the live deployment, when that worker's product file was last refreshed, or whether any measured live value is stale. The audit's upstream-value similarity does not distinguish these cases. Reporting F-06 as a labels-only defect would overstate the evidence.

## Recommendation and limits

Before a repair, capture one affected product in the actual serving process: selected manifest entry/version, loaded file path and content hash/mtime, product-cache insertion time, and response cycle/ingestion fields; compare those with the same L2 product version. Restrict the capture to that product. If disagreement is confirmed, design version-aware product identity or freshness validation across manifest and product objects, with coherent fallback when the newer bytes are unavailable. Do not simply relabel old values with new manifest timestamps.

The [Supabase Storage documentation](https://supabase.com/docs/guides/storage/serving/downloads) describes asset download paths; it does not provide coherence for this application's independent manifest, memory and disk stores. The current [changelog index](https://supabase.com/changelog.md) was read; no Supabase API or configuration change was made for this diagnostic.

Command: `python -B audit/weather-stabilization-14.0/wp6/probe_record_identity.py` from the repository root, exit 0, **two scenarios passed**. Python 3.14.4; parent `91b90ae9f642b9be015aa4c06a766cdfd557b74a`; exact working source hashes are in the receipt. An initial fixture timestamp formatting error was corrected to the provider's Z format; no source change was made. This neither verifies the live process nor claims a production fix.

Proposed evidence-only commit paths: this report, `probe_record_identity.py`, `record-identity-results.json`, and `probe.log`. No deployment or serving rollback applies to this packet.

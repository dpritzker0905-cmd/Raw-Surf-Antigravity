# Private gallery rollout

The receipt determines the purchasable edition. A reviewed row in `gallery_original_transfer_grants` extends only personal-library transfer for its linked receipt. Record the archived customer-facing offer or order as `evidence_ref`. A source-code comment, file path, or previous public URL alone does not establish a historical grant.

Use a private staging copy and the same private-capable reader for the forward and recovery mappings. Before production, confirm backup restore, storage capacity for both verified copies and all missing editions, and time to encode representative videos on the target worker. Review effective bucket policies, direct access and cached legacy URLs. Restrict legacy original reads while preserving public watermarked previews. Archive the database, local originals, private journal and evidence outside the release checkout with restricted access.

Run `supabase_scripts/provision_private_gallery_bucket.sql` in the target environment before starting the new reader. Review proven grants before inventory. Use the backend Python environment for the migration CLI. Each invocation takes the same private `--journal PATH`, and the database, storage origin and legacy upload root must match. Exercise this sequence in staging first.

| Phase | Operator check |
| --- | --- |
| `plan` | Inventory is read-only in the application database. Inspect held table/row/reason entries in the private journal. Resolve unknown master ownership before switching. |
| `stage` | Copy and hash both forward and recovery objects. Missing photo and video editions are generated privately from the verified master. Retry with the same journal after an interruption. |
| `cutover --legacy-writers-frozen` | Quiesce legacy uploads, revoke or quarantine legacy public reads, and switch references in one database transaction. Unresolved transfers receive an unavailable placeholder. Their receipts remain available for evidence review. |
| `verify` | Reconcile hashes and references. Exercise buyer, photographer, proven legacy and unrelated-account synthetic reads at the deployment being qualified. Check old URLs and CDN caches under the intended access policy. |
| `rollback --legacy-writers-frozen` | Keep the private-capable reader deployed. Switch to the journal's verified recovery objects. Preserve later purchases and unrelated rows. Reconcile edits to affected fields before retrying a refused rollback. Verify buyer access again. |
| `retire --legacy-writers-frozen` | A separate destructive operation after approval, retention and backup verification. A journal with outstanding holds refuses retirement. Confirm legacy writers stay stopped and current bytes still match the archived inventory. |

The journal records affected references and storage hashes. Keep it outside public storage. The application does not need access to it. A production rehearsal should record the actual recovery time, inventory, unresolved exceptions, and deployment identity privately.

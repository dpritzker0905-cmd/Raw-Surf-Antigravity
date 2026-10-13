# Run the prepared Dev publication test

2026-10-06 16:41Z: the Dev connector is responding again. Fresh read-only queries verify the
expected project, private weather bucket with0objects, pointer table with0rows/RLS enabled,
singleton/primary-key constraints and existing service-role CRUD grants. No cloud write occurred.
The actual Python publisher still uses separate Storage/REST authentication; the staging URL/key
are absent from this agent process. Its existing Dev service-role key must be available to the
child process. Do not send the key in chat. Reverify emptiness in the actual publisher preflight.
A separate unowned local canary edit is preserved and unqualified; use qualified committed
canary source from a clean checkout for an execution receipt.

Open Supabase, select **Raw Surf App Dev**, then **Settings > API Keys**. Use the existing legacy
**service_role** key for this existing publisher; do not select anon/publishable or a production key.
The [official key guide](https://supabase.com/docs/guides/getting-started/api-keys) explains the key
types and dashboard location. No new key or access grant is required by this launcher.

Use a clean checkout of the qualified commit. The launcher now rejects a canary
that differs from committed HEAD before requesting a credential. Preserve work
from other chats; do not discard or execute unqualified edits. Clean HEAD alone
does not establish qualification. [Launcher controls](STAGING-LAUNCHER-RESULTS.md)
passed under configured PowerShell7; PowerShell5 syntax passed but its execution
policy blocked runtime checks and was left unchanged.

From a configured PowerShell terminal in that clean checkout, a read-only preflight is:

```powershell
& ".\audit\repair-2026-10-04\run-staging-canary.ps1"
```

To run the prepared actual-source publication, two-writer CAS/readback and cleanup test:

```powershell
& ".\audit\repair-2026-10-04\run-staging-canary.ps1" -Execute
```

The hidden prompt accepts the existing Dev key. The launcher fixes the target to the verified Dev
project, passes credentials only in the child environment and restores the parent environment in
finally. It stores no key in a file or command argument. The default mode only checks existing state.
Execute mode creates three tiny synthetic objects and one manifest pointer, then cleans up the test's
owned objects/pointer. It refuses a nonempty or public target. It changes no bucket, policy or schema.

Share only the final JSON receipt. If the command fails, share the error without any credential value;
an error or syntax check is not publication success. The source-level canary was prepared previously;
the launcher has passed a PowerShell syntax check and has not been executed with a credential here.

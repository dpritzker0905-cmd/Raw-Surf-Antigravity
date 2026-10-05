# Run the prepared Dev publication test

The Dev connector is connected and the private weather bucket/pointer table are empty. The actual
Python publisher uses Storage/REST authentication independently of the connector's OAuth session.
Its existing Dev service-role key must be available to that child process. Do not send the key in chat.

Open Supabase, select **Raw Surf App Dev**, then **Settings > API Keys**. Use the existing legacy
**service_role** key for this existing publisher; do not select anon/publishable or a production key.
The [official key guide](https://supabase.com/docs/guides/getting-started/api-keys) explains the key
types and dashboard location. No new key or access grant is required by this launcher.

From regular PowerShell, starting in this checkout, a read-only preflight is:

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

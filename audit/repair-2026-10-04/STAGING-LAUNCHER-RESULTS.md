# Staging launcher source boundary

2026-10-06, local762. No actual publication or cloud write.

The Dev-only Supabase connector responds. A fresh read-only query confirms0
pointer rows,0weather objects, private bucket and enabled pointer RLS. MCP
authentication still does not supply the independent Storage/REST process
credential required by the actual publisher. Do not substitute a publishable
key or extract connector credentials.

The launcher previously reached its hidden credential prompt even though this
checkout's canary script contains uncommitted work from another chat. Three
actual-source tests failed and the clean-source control passed. The launcher
now checks the source exists in HEAD and has no staged or unstaged difference
before requesting any credential. It refuses a missing/untracked source or
failed Git check. Clean HEAD is necessary, not proof of hosted qualification.
Use a clean checkout of the qualified commit. No unowned edits were changed.

Six prompt-sentinel controls passed under the already-configured PowerShell7
environment: real source in both modes, independent clean source in both modes,
unstaged and staged fixture changes. The prompt sentinel throws before any
credential entry, child Python execution or request. Disposable nested Git
fixtures were removed only after verifying resolved paths stayed inside their
own scratch root. Portable probe:
`launcher-probe/test-staging-launcher-boundary.ps1` (run from the repository root).

PowerShell5 initially refused script execution under its existing policy; that
is not a test pass and no policy was weakened. Its parser accepted the launcher
syntax, but PowerShell5 runtime behavior is ungraded. The six integration
controls are PowerShell7 results. This wrapper has its own manual acceptance;
the app's hosted frontend/backend test counts do not qualify this wrapper.

The unowned canary SHA256 remains
`3E51C899490A8DCC07D453AEE2A1FED2864A5B02DB6A51C920CDE9801DD418C0`.
The actual publisher's create-only upload, two-writer CAS/readback and cleanup
test remains unexecuted until its process securely receives the existing Dev
credential. The user's credential must not be pasted into chat or tracked files.

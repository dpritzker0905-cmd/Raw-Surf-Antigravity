# Dev access incident: current availability verified, cause unconfirmed

2026-10-06. Owner reports that live dev cannot be opened. Exact error and failing
browser/URL are pending clarification. Do not label current availability a fix
of an unexplained prior failure.

## Bounded observations, 18:29–18:31Z

| Surface | Result |
|---|---|
| Dev `/` | HTTP200,7225bytes,379ms |
| Dev `/map` | HTTP200,7225bytes,205ms |
| Dev `/service-worker.js` | HTTP200,build073de1e2,213ms |
| Main asset `/static/js/main.7f5c89e4.js` | HEAD200,JavaScript content type |
| Shared API `/api/health` | HTTP200,healthy,version073de1e2,1157ms |
| Dev proxy `/api/health` | HTTP200,healthy,same backend version,495ms |
| Fresh Chrome `/map` | Authenticated map/navigation/weather controls and surf-spot markers mount; all weather layers inactive |
| Fresh Chrome `/` | Landing-page headings/content finish rendering; bounded captured error log empty |

These are individual request observations, not latency benchmarks or uptime
guarantees. The fresh map is left open for the owner. Previous test-tab handle
was absent; a fresh tab was created, without changing browser settings, clearing
storage, accepting permissions, entering credentials or restarting the server.

The fresh map captured two style-not-loaded startup warnings, as in the earlier
smoke check. Extension stream/listener warnings report a browser-extension source
URL; they are not established app failures. No active forecast/playback was
started in this check. This does not close the earlier native1FPS fallback.

The remote dev branch remains073de1e2. PR246 receipt7b594b76 remains OPEN/dev;
all reported application jobs and supplementary PR checks are successful. Its
runtime equals qualified5b286f7a. Previous747 publication was read back in
manifest-final-readback.json. No PR246 merge or feature activation occurred.

## Startup-path inspection and limits

Production React Scan loading is gated to localhost or explicit reactscan=1;
its URL appearing in HTML source does not prove the profiler loaded. Lazy routes
have an error boundary with one-reload chunk recovery. Auth restoration reads
and parses browser storage without guarding every failure; malformed or denied
storage is a plausible separate startup failure, not reproduced in this live
session and not attributed to the owner's report. Do not delete a real stored
session or weaken authentication based on that hypothesis.

Next discriminating evidence is the owner's exact failing URL and visible error
or stuck state. If failure persists in the new tab, inspect its captured console
and visible error boundary before selecting a code or deployment repair. Keep
the paused renderer/frame-time diagnosis separate from site availability.

No code/configuration/deployment repair is accepted here. Current successful
access is verified; the reported failure's cause remains unconfirmed.

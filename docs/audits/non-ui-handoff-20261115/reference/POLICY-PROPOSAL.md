# Pip initializer policy proposal v1, revision2 — inactive, for review

**This proposes a contract, not an executable exception.** No guard or constructor source is changed. No approval, import, socket, environment, test, collection, retry or cloud action is implied. The held construction artifact and its false release bits remain unchanged; CBR-01 stays open.

The proposed permission is limited to the first normal initialization of `pip._vendor.urllib3.util.connection`, from the exact pip25.0.1 wheel, in one explicitly approved initializer session inside already verified disconnected user/network namespaces. Two contexts are distinguished: a separately approved initializer-only qualifier, and a later separately approved installer worker. Each must bind its own launcher source, argv, archive path and scope identity; a mode string alone grants nothing. Qualification permission never authorizes pip CLI/install work. Its attested `_has_ipv6` helper may attempt at most one IPv6 stream constructor and one loopback ephemeral bind on the same object. The permission expires on that invocation's exit, including error or short-circuit. It never transfers across contexts, or to application urllib3, another module, caller, thread, process, reload or retry.

## Exact source and caller binding

| Identity | Required value |
|---|---|
| Existing interpreter | CPython3.12.14, SHA-256 `fa67443527ed9647f760d807e2a38f26340757123e643c4639cf273ed15d5ea7` |
| Wheel | `pip-25.0.1-py3-none-any.whl`, SHA-256 `c46efd13b6aa8279f33f2864459c8ce587ea6a1a59ee20de055868d8f7688f7f` |
| Qualified module | `pip._vendor.urllib3.util.connection` |
| Exact archive member | `pip/_vendor/urllib3/util/connection.py` |
| Module bytes | SHA-256 `e4bc760753d6dbd2b1067d93d3190dd420604416b780654904aa10a11a201159` |
| Helper source segment | SHA-256 `43d366e0838c6f70bcd690597e64a278a580136c6384b01730695843bd545ca2` |
| Helper structural AST | SHA-256 `1168790d1b13018c5744920b9f29659d1eefb8a4eb4ee0ca81018e4274f13b49` |
| Entry/call sites | Helper definition119; constructor138; bind139; direct module initialization149 |

`SOURCE-ATTESTATION.json` adds the complete module and initializer-assignment AST hashes, exact nine-module import provenance and file sizes, computed from the hash-verified wheel as data. `REFERENCE-SOURCE.txt` is the unchanged module as inert reference text. Line/function names are locators, not sufficient authorization.

Before importing pip in any future approved run, a trusted bootstrap must hash and pin the canonical wheel file, reject preloaded pip/vendored modules and alternate pip paths, and bind the zip loader's archive plus exact member suffix. A zip-member virtual filename is not an ordinary file: validate the real archive separately, then require exact virtual origin, __spec__.origin and co_filename agreement. No installed/base-pip fallback is allowed.

The future observer must compile those verified bytes for inspection only under the exact pinned interpreter, expected virtual filename, optimize0 and dont_inherit. Derive complete module/helper code fingerprints without executing that compiled module. At the actual import's exec event, compare the real module code with that expected fingerprint and retain its **actual** code-object reference and helper constant. At the module frame entry, bind its real globals/module/spec/loader identities. At helper entry require the actual retained helper code, the global function's __code__, the same globals dictionary and the retained module frame as direct caller at the attested initialization site. Reject clones, renamed wrappers, direct helper calls, fake filename-only matches and second module/helper executions.

The old v6 code-fingerprint design is a reference pattern only. Its source, old runtime config and permissions are not reused as authorization. The vendored member, zip origin and caller are different. Fingerprints must cover the typed code fields in `POLICY-CONTRACT.json`, including nested constants, bytecode, exception/line tables and filename. Unknown constant types fail closed. No runtime fingerprint is supplied from the local Windows3.12.10 tool; that would not attest the Linux3.12.14 runtime. This derivation is a required later gate, not performed now.

## Integration point and exact permission change

An added allowing audit hook cannot cancel an existing hook's fatal denial. A later implementation therefore needs a **newly versioned guard in a fresh worker**, replacing only its socket decision branch with this stateful admission rule. Do not layer it after the old mandatory socket-denial callback, modify that frozen callback in place or remove/bypass an installed guard.

The only proposed positive permission change is the attested constructor/bind pair. Observer-replacement denials and owner/context restrictions are additional constraints. All other old decisions remain default-deny/preserved. The current constructor source is not patched, no guard is registered and no release bit changes in this proposal.

A separate adjacent conflict, CBR-02, is recorded in `IMPORT-COMPATIBILITY-REVIEW.json`: the pinned parent urllib3 initializer attempts `urllib3_secure_extra`, outside the current import allow-list. The optional ImportError handler cannot recover from this guard's fatal denial. This is source-level analysis, not a fresh import failure; target runtime membership was not queried anew. This IPv6 proposal does not expand the import allow-list or claim the full pip path is ready. Resolve that independent import contract before proposing native/full-import execution; do not bypass it by executing an extracted helper body.

## Prerequisites before any permission is armed

The future released bootstrap needs a new explicit scope/hash/attempt decision and sole-executor allocation. It must recheck source/interpreter/ABI drift and verify fresh user and network namespace identities, private root mapping, only down loopback, no IPv4 routes, no IPv6 addresses or usable IPv6 routes, and no inherited namespace shortcut. Existing unshare-file presence and the historical false IPv6 result do not satisfy this gate. No interface/address/route configuration is permitted.

An initializer-only qualification context would use a separately frozen launcher and normal import of the exact qualified module from the verified wheel. It must preserve the actual module-to-helper call at149, with no extracted-body execution or direct helper call. The installer context would instead bind its reviewed pip CLI/worker. The higher-level launcher differs and must be attested for its own scope; this is explicit, not a caller bypass. Neither context can authorize the other, and both remain disabled here. CBR-02 must be resolved before either full-import path is requested for execution.

Pin the loaded stdlib socket module, `_socket` extension and constructor/bind/close/fileno call targets before arming. Their actual Linux identities have not yet been collected in this proposal. The actual socket module/global bindings must be original and stable; no socket proxy, function replacement, capability override, App Engine override, preload outside the guard or alternate importer is permitted. Verify the fixed empty-inherited environment and prohibit later unauthorized mutation. Keep the installer callback's existing private PIP_BUILD_TRACKER rule separate.

Install one attestation observer before the guard that denies replacement. Pin the observer object/code/configuration; keep it installed until the short-lived worker exits. While armed, reject setprofile/settrace replacement and any helper/socket activity from a different thread. The token belongs to one recorded owner thread and interpreter; no claim relies on profile functions covering other threads. A new thread or unknown observer state must never receive a token. Exact pinned-runtime observation coverage remains a qualification gate.

## Admission and one-use budget

The machine-readable rules and terminal states are in `POLICY-CONTRACT.json` and `TRANSITIONS.csv`. Missing prerequisites leave the token DISABLED. Only a witnessed normal module-to-helper entry may activate it; reserve the helper-call budget **before** admitting an operation.

| Operation | Proposed bound and pre-operation checks |
|---|---|
| Constructor | One `socket.__new__` event; exact integer family10/type1/protocol0, without extra flag bits; exact active helper/caller/owner-thread witness; attested stdlib wrapper chain; valid original socket object type. Reserve before returning permission and keep a strong object reference. Do not inspect uninitialized socket attributes. |
| Bind | One `socket.bind` event only after that constructor event; the same object, active helper's sock local and owner/context; exact two-item target tuple (`::1`,0). Reserve before returning permission. No alternate address, family, supplied port, object or second attempt. |
| Normal close | Only the helper's original cleanup of that witnessed object. Confirm closure after helper exit using the pinned fileno implementation; record a closed boolean, not a descriptor/address. |
| Emergency cleanup | At most one trusted post-helper close of the same fully initialized witnessed object if it remains open on validation failure. Record that the helper failed cleanup; terminate even if emergency close succeeds. Do not attempt discretionary cleanup inside a fatal audit callback or on an uninitialized/unknown object. Immediate fail-closed termination leaves cleanup telemetry unknown. No retry or continuation. This cleanup is explicitly part of the future contract, not an existing permission. |

Use object identity, not a serialized object ID; keep the strong reference until cleanup verdict so identity cannot be recycled. Serialized receipts use an opaque label S1, never repr, memory addresses, assigned ports or live descriptors. Every unexpected socket event retires the token and fails the worker before the requested operation. All IPv4/AF_UNIX, DNS/hostname, connect/listen/accept/send/receive/socketpair/fromfd/dup paths and all other socket operations remain denied. Do not copy v6's old hostname exception into this policy.

These are permission boundaries, not a claim that CPython audits every possible native API. Every observed socket event outside the two exact admissions must be denied; unobservable APIs receive no permission either. Source/call-target integrity and independent namespaces are required, and hostile-native-code confinement is outside this trusted-runner model.

Frame lookup, if needed, occurs only in the socket branch. Non-socket audit callbacks never walk frames or invoke `_getframe`; the nested `_getframe` event must not re-enter frame lookup. Profile/trace callbacks use the frame supplied by Python. Observer/audit exceptions terminate with a fixed diagnostic, never a catchable substitution for the original denial. No traceback/frame/global/environment dump is allowed.

## Outcomes and truthful receipts

Audit events establish attempted API entry, not successful OS calls. A future qualified observer must capture the actual helper return and selected original-source exception site/outcome, plus cleanup. Profile return alone is insufficient to classify an error; an exception path can produce a return event. Minimal exception observation may retain only class, errno when valid, source site and phase; never exception text or traceback. Any such observer implementation is still unimplemented and unqualified.

| Observed path | Permitted classification; never application acceptance |
|---|---|
| Genuine short-circuit, no constructor/bind events | Attested no-native-operation path; helper-call token still spent. Native allowance is unexercised, not a successful real probe. A forged/unknown predicate is failure. |
| Constructor exception, no bind | Constructor branch observed only; require actual source-site outcome and closed/invalid descriptor state. Bind path remains unqualified. |
| Bind exception, booleanFalse, same object closed | Bounded API-probe evidence if all provenance/outcome checks complete; record actual exception fields. False does not mean a guard denial was permissible or prove general host IPv6 capability. |
| Bind success, booleanTrue, same object closed | Bounded API-probe evidence if all checks complete; no network service/listen/connect permission or connectivity/application claim. Never force the upstream return to false. |
| Missing/None return, unknown outcome, changed context/observer, excess event, leak or malformed evidence | Failed/incomplete. Retire token, preserve partial/unknown fields and stop. Emergency cleanup never converts it to acceptance. |

Retire the token on return, exception, observer failure, timeout or process termination; no resets. Constructor/bind audit-attempt counters and observed outcomes are separate fields. No kernel syscall tracing is proposed, so kernel operation telemetry remains null unless a separately approved measurement supplies it. A synthetic audit event or count-only receipt cannot qualify a native allowance. The receipt collector's zero and a helper's false result are never sufficient.

## Preserved boundaries and release sequence

All other construction guard decisions, private write roots, ordered child budgets, filesystem/descriptor/import/environment/ctypes denials and resource ceilings remain intact. No package versions, test floors, application source, historical balances or refund policy change. This proposal grants no install, application test, collection, hosted acceptance or release slot.

The old22-control fixture baseline establishes only the old callback's behavior. First review/adopt this contract for implementation only; then freeze a new inactive implementation and required control plan. Obtain separate explicit permission for qualification. Only after appropriate source/identity/retained-denial/native-outcome evidence could a newly versioned construction bundle be considered for its own approval. No old attempt budget is renewed.

Current unresolved identities/observer implementation/qualifications are listed in `UNRESOLVED-GATES.json`. The proposal stays inactive while any required item is unknown. Nothing executable or an automatic cloud prompt is included in this review packet.

Python documents stable audit-event argument contracts, thread-specific profiling/tracing, and callback failure behavior; these constrain the observer design. Python also states that Python audit hooks are not an adversarial sandbox. We therefore require namespace isolation independently and make no hostile-native-code containment claim. [Audit API and observer semantics](https://docs.python.org/3.12/library/sys.html), [audit event table](https://docs.python.org/3.12/library/audit_events.html). The rolling3.12 documentation currently labels3.12.16; the proposed target remains the exact3.12.14 binary and needs its own qualification.

Hooks and weather/UI remain paused. No pip imports, real sockets, installs, environment creation, tests, collection, retries, cloud messages/uploads, source/index/shared-floor changes, publication, merge or deployment occurred in preparing this proposal.

# Permission delta for review; nothing adopted or activated

Reference guard: construction-freeze-20261114/payload/policy.py, SHA-256 b18e40990a86decd2d32d7975769da690838e76a4eacc7c56b8bb45157802f36.

| Area | Old callback | Disabled draft | Disposition |
|---|---|---|---|
| Socket events | Fatal all socket.* | One source/owner-bound constructor and same-object (::1,0) bind; all other observed socket events fatal | CBR-01 proposed positive change, not adopted |
| Optional name | Fatal import outside ordinary allowlist | One attested metadata-only negative resolution; finding any module/spec is fatal | CBR-02 independent proposed positive change, not adopted |
| Normal pip import | Installer only via allow_pip | Distinct reviewed initializer-only or installer worker context | Explicit new initializer context permission; launcher absent |
| Generic nonstdlib imports | stdlib plus __main__/policy/verify_install, pip only in installer | Same plus pip for the attested initializer context; optional name has its own narrow branch | No broad optional-name allowlist entry |
| Child processes | Ordered exact controller queue | All subprocesses denied in this worker-only draft | Narrower; no replacement controller or new child budget |
| Write roots | venv/tmp/home/config/cache/receipts | Same for installer; only tmp/receipts for initializer-only | Narrower in initializer role |
| Environment | Only private PIP_BUILD_TRACKER for installer | Same for installer; no mutations for initializer-only | Retained or narrower |
| Files, descriptor writes, dir_fd, links, special nodes/xattrs/signals | Old private-root and denial rules | Branches retained with fatal exception wrapper | Needs fresh qualification; no result transfer |
| SQLite/ctypes/shell/exec/fork/cwd | Fatal relevant events | Retained | No new positive permission |
| Observer or hook replacement | Not specially denied | sys.setprofile/sys.settrace/sys.addaudithook denied after registration | New restriction; requires fresh ordering qualification |
| Resolver execution | Ordinary import machinery | During one absence lookup compile/exec/import are fatal | New restriction; missing providers remain blockers |
| Registration liveness | No challenge | Custom inert sys.audit nonce must be acknowledged before other events | Draft-only, unexecuted; not a qualified test |
| Cleanup | No socket exception | Helper's original close, pinned post-helper fileno and at most one emergency close of a known initialized object, always terminal failure after emergency | Part of separately reviewed CBR-01 contract, not released |

The combined callback must live in a separately versioned future worker. An allowing hook cannot undo the frozen fatal callback. Never install it after the old mandatory socket-denial hook or remove/bypass an installed hook. Source filenames and mutable runtime JSON do not grant authority.

No package or wheel is modified; no stub module, forced IPv6/AppEngine value, direct/extracted helper execution, preload offguard, catchable replacement for a generic denial, application socket exception, alternate resolver fallback or installer substitution is supplied.

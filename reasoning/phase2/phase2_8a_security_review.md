# Phase 2.8A bounded security review — local JSON evidence

Canonical GitLab base: e49a099b8d05d6a5a530467c6ab9d8a49d343601. Issue #16.

## Trust inventory
Operator-owned root and operation-to-flat-basename configuration; operator controls tenant adapter registry and mapping. Source bytes remain untrusted. No API/model path, glob, root, or filename authority. No network or secret resolver. Existing evidence:acquire authorization, immutable artifacts, attested fact ingress, tenant boundaries and replay govern downstream use.

## Checked
- Traversal, URL encoding and duplicate name attempts fail during configuration.
- A known root is checked for owner-controlled writable mode; directory identity is checked per acquisition.
- Read-only O_NOFOLLOW protects the last path component; lstat and fstat require regular source and stable file inode/metadata.
- Response bounded to maxResponseBytes+1 with fatal UTF-8 and JSON parsing. Invalid JSON objects with dangerous prototype keys and nonfinite numbers fail.
- Native filesystem errors are redacted; missing-file and removed-root regression tests prevent path disclosure.
- Operation manifests are checked exactly; unknown/unregistered operations or caller-selected paths fail before disk access.
- Compatibility matrix fingerprints implementation bytes; existing provenance and offline gate verify artifact body changes.

## Residual limits
- Trusted root/parents and OS filesystem must not be attacker-writable; no openat2 or sandbox claim.
- File size/metadata checks do not provide cryptographically authenticated source truth; a privileged attacker can modify files and metadata. Previously captured artifacts remain independently hash-verifiable.
- Timeout is cooperative for local I/O, not a hard cancellation of a stuck kernel/filesystem syscall.
- Replays validate signed provenance but not source honesty, and user access still depends on app-level authorization.
- No object-storage API, MCP/SQL connector, external action, broker, vendor key provisioning, audited production deployment or profit guarantee.

No Critical or Important source-review finding is left known within this narrow adapter contract; deployment hardening is separate.

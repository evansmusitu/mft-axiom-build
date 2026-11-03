# Phase 2.8A — bounded local JSON file evidence adapter

GitLab canonical base: e49a099b8d05d6a5a530467c6ab9d8a49d343601 (Phase 2.7B post-merge green). Issue #16.

## Boundary
- Read-only server-configured filesystem snapshots into the existing registered evidence acquisition pipeline; no tenant/user/model-supplied filenames, paths, roots, mapping IDs or adapter operations.
- Each registered operation binds one flat basename under one trusted root directory, with an explicit parameter validator and an existing operation manifest.
- Root is a trusted operator-controlled, non-world-writable directory and is rechecked per read. This adapter is not a secure interface to an attacker-controlled writable filesystem, sandbox, or object-store protocol.
- No symlinks for the configured file: use lstat/open with O_NOFOLLOW and reject symbolic links, directories and special files. Race safety is bounded to stable root directory ownership and no malicious path-component changes by other processes.
- Stream/read at most maxResponseBytes+1 bytes, reject oversized and changing files, strict UTF-8 and JSON parsing before returning captured raw bytes. Timeout and maxResponseBytes are enforced.
- Reject dangerous or duplicate operation-to-basename bindings, unknown operations, any nonempty caller parameters unless the exact server-owned validator permits them (but parameters cannot affect the file path).
- No secret resolver or outbound network capability; no user-supplied arbitrary read path; no secrets or filesystem locations in an evidence result.
- The existing authorization, registry/tenant allowlist, mapper attestation, immutable evidence artifacts, SQLite/PostgreSQL atomic persistence, replay and verified world facts remain authoritative.
- No claims of general-purpose SQL, MCP, remote object store connectivity, live external source truth, exactly-once side effects or trading profit.

## Test-first evidence
RED: nonexistent adapter module on test import, expected failure.
GREEN: focused tests cover bounded read, endpoint binding, path traversal, symlinks, oversized responses, invalid bytes/JSON, denied and nonfile roots, tenant registry restriction, and evidence capture integration.
Verification: full Phase 1/2 suites and PostgreSQL, P2.8A acceptance gate, security review, feature exact-head CI, MR-native CI, non-squash merge with retained branch, postmerge main CI.

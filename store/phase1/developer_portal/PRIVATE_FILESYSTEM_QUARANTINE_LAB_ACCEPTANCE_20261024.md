# MUSITU Store V2 — single-host private quarantine lab adapter (24 October 2026)

**Status: implemented + locally tested, NOT production-admitted, NOT deployed, NOT malware-scanned and NOT published.** No Phase 1 acceptance gate is waived.

## Change

- `private-filesystem-quarantine.mjs` is an opt-in trusted adapter for **operator-controlled single-host private test machines only**. Requires an existing canonical absolute directory owned by the process, with mode `0700`, and no symlink at the root or in the resolved path. Refuses missing/wrong-mode roots; never creates a storage directory, grants public access or signs download URLs.
- Writes random 192-bit object identities to private `0600` temporary files with `O_CREAT|O_EXCL|O_NOFOLLOW`, bounds writes to the immutable manifest size, `fsync`s the file, atomically renames to an opaque `.apk` object and syncs the parent directory. Only an existing manifest's **QUARANTINED_UNSCANNED** state is returned by the portal; the stored bytes are never directly served by the adapter.
- Supports controlled object revocation, refusal of traversal/replayed keys and stale `.part` cleanup. Does not delete sealed `.apk` objects by time without independent DB reconciliation. Enforces a small **single-process** active-writer limit (not a distributed quota).
- The existing private upload controller and PostgreSQL candidate remain responsible for authenticated developer session checks, source-hash and size binding, append-only receipts, tenant isolation and conflict cleanup. Live IdP revocation callback is mandatory; it is **not** implemented by this adapter.

## Verification

- Local Node.js 22 test command: `node --test store/phase1/developer_portal/{portal,postgres-repository,quarantine-upload,private-filesystem-quarantine}.test.mjs` — **38 PASS / 0 FAIL** after the new lab tests. The private adapter tests include directory/symlink denial, storage mode, exact byte reproduction, quarantine-only responses, JWT/MFA cross-tenant and revoked-token denial, race loser cleanup, traversal denial, storage removal and bounded writers.
- An actual **first-party offline-only development APK** from the original Oct24 verified whole-product evidence archive was streamed through the private adapter, re-read and compared byte-for-byte. Source SHA-256: `34e22eb78002cf3c44479b78b292b641304be3930886eb127c1f26f5a3301a46`; 10,097 bytes; cleanup/revocation left no object. This was NOT the actual Store V2 signed installer, not installed on a phone and not submitted for independent APK signer/malware certification.
- GitHub Actions auth CI now includes the new adapter tests and syntax check. Do not mark **independent CI validated** until that exact new HEAD's run reports SUCCESS.

## Strict boundaries / release blockers

This lab implementation is unsuitable for Vercel ephemeral functions, multi-replica services, shared/untrusted hosts or public web directories. It does not provide distributed concurrency/quota enforcement, encrypted S3/R2 object lifecycle, audit event replication, malware scanning, `apksigner` certificate chain validation, zip bomb/safe-unzip review, binary package-name inspection, licensing verification, a live trusted IdP/JWKS and revocation service, real external publishers, commercial payments, entitlements or release authorization.

Before any customer-facing deployment, require a separately approved durable private object storage design with authenticated worker identity and encryption, explicit retention and incident response, scan/publisher rights evidence, reconciled orphan cleanup, production access control tests and independent reviewers. Original >=3 independent publishers, >=2 third-party apps and all other original Store Phase 1 acceptance gates remain unchanged. Phase 2 PENDING, Phase 1 RUNNING.

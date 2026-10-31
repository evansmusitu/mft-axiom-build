# MUSITU Store V2 | Private APK quarantine: abort, cleanup and opaque storage guard

**Status: isolated engineering candidate only.** This source change does **not** authorize a live identity provider, storage migration, third-party APK intake, malware verdict, Android signing certification, payment, publication, or Phase 2. PR #32 remains draft/unmerged and the original multi-publisher product scope is unchanged.

## Regression defects reproduced before changes

1. A request whose upload stream never resolves `reader.read()` retained a private writer after the HTTP abort signal. A real 0700 single-host directory test failed until cancellation was connected to the body reader.
2. A hostile stream with a permanently pending `cancel()` promise could still indefinitely delay the request even after cancellation. A bounded test failed until the read used an abort-rejecting race and cleanup stopped awaiting hostile cancellation.
3. The stale `.part` scavenger incorrectly deleted still-active private upload files after an apparent clock jump, breaking `seal()` and stream capacity safety. A real filesystem test showed two removals rather than one before active-token tracking.
4. A sealed private APK inode with more than one hard link was readable by the internal test inspection hook. A real filesystem test failed until inspection used `O_NOFOLLOW`, handle-bound `fstat`, single-link and ownership checks, and handle-bound read.
5. The upload controller accepted an incorrectly namespaced object key (`public/apk/...`) if an adapter claimed to have sealed it. A signed MFA portal upload regression originally returned HTTP 202 instead of rejecting the private storage identity. The controller now accepts only `private/apk/` plus 48 lowercase hex characters.

## Live compatibility and boundaries

The private filesystem adapter is **single-host lab-only**. It is not suitable for Vercel's ephemeral filesystem, multi-host workers, public file serving, or production object storage. The opaque key guard matches both the candidate PostgreSQL receipt repository and the lab adapter. Concurrent upload limits, SHA-256 and exact byte count checks, current MFA session checks, and all no-publication/no-payment invariants remain in force.

The cancellation logic is deliberately fail-closed for a hostile `ReadableStream`: when AbortSignal fires the blocked read promptly rejects, and writer abort/deletion is attempted even when reader cancellation itself never settles. The in-process active-set only protects writers belonging to this specific adapter instance; coordination across multiple hosts or worker restarts needs durable object leases and a production garbage-collection policy. The file inspection hook is **for private tests only** and does not perform Android cryptographic signature checking, malware scanning, authorship licensing or rights assessment.

## Evidence and reproducibility

Executed locally with Node 22 against the pinned verified source: `node --test *.test.mjs` -> **88 tests; 88 pass; 0 fail**. All five new cases were first observed failing under the original behavior; focused green and full-suite output are retained separately in the continuation artifact. Fresh GitHub Actions and a new immutable commit must be checked separately before claiming repository-wide acceptance. No Neon schema or Vercel deployment was modified.

**Gates that remain open:** independent publisher verification 0/3; approved third-party applications 0/2; live OIDC/MFA and revocation; encrypted durable private object storage and independent malware/Android signature checks; signed rights authorization; web, real Android and Windows device qualification; Paynow real settlement/refunds; independent security/legal review; explicit owner release permission. **Phase 1 RUNNING; Phase 2 PENDING.**

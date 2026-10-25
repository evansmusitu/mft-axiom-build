# MUSITU Intelligence — private enterprise canary acceptance matrix
**State: DEVELOPMENT ONLY / NO DEPLOYMENT APPROVED**

## Immutable product boundaries
- Existing website: `evansmusitu/evansmusitu.github.io` main at **13492fd3befd12af761d49399d6c6ed30d63ee2b** (verified before this engineering cycle; reverify before release).
- Original backend handoff: `feature/musitu-multidoc-evidence-20261020` at **6147ceed65dcc4d7594913db16408669423738c3**; not a merge target for other products.
- All new enterprise code is isolated on `feature/musitu-enterprise-tenant-workspace-20261024`, draft PR **#34** targeting only the original multidoc branch.
- Production Worker `musitu-intelligence-edge-20261019` and the pre-existing capacity canary must not be changed by enterprise qualification. The pinned Wrangler Git blobs are automatically checked in `enterprise_release_boundary.py`.
- The existing five browser-local encrypted slots are separate cryptographic/storage products; **never auto-upload, overwrite, migrate, import or decrypt their saved ciphertext** in enterprise code.

## Verified in isolated GitHub Actions (not a live canary)
| Control | Evidence method | Scope/limitation |
|---|---|---|
| Signed Cloudflare Access RS256 JWT + exact issuer/audience/expiry/subject | Adversarial Node tests with generated RSA keys | Simulated identity, not real Access provisioning |
| Bounded JWKS <=32 KiB and upstream timeout | Negative tests with oversized/stalled key responses | Cloudflare network resilience not independently exercised |
| Per-request active membership and SQL-time revocation | Node + real SQLite | D1 semantics approximated locally; not live Cloudflare |
| Editor/viewer roles and tenant separation | Signed test subjects + SQLite FK/compound PK | No production tenant or identity lifecycle |
| Mandatory If-Match / If-None-Match and revision CAS | Real SQLite + client roundtrip tests | No distributed/offline conflict resolution |
| 50 stored artifacts per tenant | SQLite DB trigger + 50/51 tests | Stored row count only |
| 20 successful writes per tenant per rolling 60 seconds | SQL audit trigger + rollback tests | Not GET/CPU/identity/network/AI cost rate cap |
| Bound metadata listing, max 10/page | Keyset SQL + adversarial tests | No guarantee of stable snapshot across pages |
| Browser-side AES-256-GCM, 96-bit nonce, tenant/object AAD | WebCrypto Node tests | Caller-supplied, non-extractable encryption key; recovery unavailable |
| Manual opt-in SDK with token provider, timeout, bounded JSON | Positive and negative Node tests | No production sign-in UI, no automatic token persistence |
| Explicit portable encrypted bundle | End-to-end SQLite and crypto test; checks ciphertext/revisions and final inventory | Not an atomic point-in-time export; does not automatically save or erase cloud data |
| Explicit same-tenant create-only backup restore | Offline AES-GCM validation, user acknowledgment, isolated signed JWT/D1 tests | One artifact per action, requires original key; no automated bulk restore or key recovery |
| Strict client mutation/catalog response contract | Adversarial fake HTTP and real SQLite tests | Does not attest live Worker or Cloudflare responses |
| Manual bounded audit retention | Real SQLite 30-day boundary, 100-row maximum, dry-run/explicit execution tests | Proposed policy only; no scheduled job, DSAR acceptance or cloud operation |
| No-deploy qualification | Workflow only runs local tests, checks pinned production/canary configs | Cannot attest remote Cloudflare state |

## Hard gates before creating an isolated private canary
1. **Owner and independent reviewer authorize specific zero-cost dedicated resources**: a new Cloudflare D1 database and new Cloudflare Access-protected Worker hostname. Never bind to any existing customer or AXIOM database. Record verified account/project/tenant identifiers **without credentials**.
2. **Identity lifecycle**: configure and validate the real Cloudflare Access application, actual audience/team domain, allowed principals, MFA, signed-token key rotation, revoked identity/session behavior, last-session termination and membership offboarding. Reject client-asserted roles.
3. **Encryption lifecycle**: approve key derivation/provisioning, recovery, passphrase quality, identity-to-key binding, key rotation and lost-key policy. Non-extractable CryptoKey validation alone is insufficient. No plaintext server-side encryption/recovery promises.
4. **Privacy acceptance**: decide consent, data controller/processor responsibilities, account and tenant deletion, audit retention period, portability semantics, cross-border transfers, complaints, breach notification, backup/deletion propagation, incident response and legal review. No invented retention windows.
5. **Capacity/abuse acceptance**: provision dedicated read/auth request throttles and aggregate account/cloud cost controls; verify Worker request limits and D1 storage quotas. SQL write-rate controls alone do not protect signing-key endpoint, unauthenticated probes or AI spending.
6. **Private canary qualification**: deploy only to a newly named hostname after explicit authorization, apply migrations `0001` through `0004` to the **new database**, seed disposable tenants through a reviewed admin process, verify signed GET/PUT/DELETE, 2-tenant isolation, 50/51 row cap, 20/21 mutation cap, stale ETags, key mismatch, token expiry, membership/session revocation, CORS, rollback and audit/export/manual encrypted restoration/deletion and separately authorized audit retention. Use no real customer records.
7. **Operations and approval**: publish rollback steps, owners and recovery custodians, secret/key custody, budget caps and security/privacy acceptance evidence. Production promotion remains blocked until each gate is signed and independently validated.

## Fail-closed go/no-go
**GO for further isolated engineering and offline tests only.**
**NO-GO for existing public Worker, capacity canary, website, real customer data, cloud tenancy, billing, or cross-project merges.**

The browser SDK and export module are prototypes. The old public website does not import them and cloud tenancy is NOT a delivered user feature. No manual step should request customers' passwords, JWTs, encryption keys, or provider secrets in chat, logs, issues or PR comments.

## Recovery and privacy evidence added in continuation
- The opt-in client refuses malformed backup bundles, wrong tenant or key, unauthorized auto-restoration and writes to occupied IDs. An external token callback cannot mutate the already-validated ciphertext upload. Full encrypted backup validation occurs before any authentication callback or network traffic.
- Export now does a final inventory revision comparison to catch most concurrent edits and insertions, but there is **no atomic multi-document snapshot**. Restore/backup usability and key custody require private canary acceptance.
- The isolated audit-retention helper cannot be imported into the Worker under the qualification boundary check. The proposed 30-day retention is **not an approved legal retention policy**; controller/reviewer signoff remains a NO-GO gate. See [ENTERPRISE_PRIVACY_OPERATIONS.md](ENTERPRISE_PRIVACY_OPERATIONS.md).

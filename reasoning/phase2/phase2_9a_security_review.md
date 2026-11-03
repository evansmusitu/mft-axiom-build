# Phase 2.9A bounded worker-control HTTP security review

Canonical baseline `2433415fd44252e756557dc8791ab4c502e337e3`. Issue #21, branch `feature/phase2-9a-worker-control-http`.

## Boundaries exercised
- Required `trustedIngress(req)` is evaluated before parsing any untrusted body. An operator must implement connection-level gateway/mTLS checks. False and missing predicates are blocked. The predicate is not derived from spoofable HTTP headers in this module.
- Only signed CLAIM, HEARTBEAT and RELEASE are routed. Remote COMPLETE, FAIL_TERMINAL, arbitrary tenant, clock, execution, worker runtime, or model/provider APIs are absent. Client body cannot choose authority-bearing time.
- The ingress enforces exact top-level shape, JSON content type, 32KiB maximum request, 1MiB response projection and decoded job-path syntax. Generic errors avoid leaking SQL, keys, full job records on denial, or server exceptions.
- Underlying stores independently verify registered ACTIVE worker Ed25519 public keys and per-action permissions, signed exact request body/target, request age, server lease duration cap, independent lease capability, expiration/epoch and persistence-hashed state, and signed transaction receipts.
- Real SQLite HTTP tests exercise claims, one persisted job, signed claim retry (same job/epoch), heartbeat capability rotation, stale old lease rejection, signed exact release retry and raw-ID denial.
- Real PostgreSQL integration was added for the same HTTP claim, signed receipt retry, release and terminal route refusal; require green CI on exact head.
- Source fingerprint added as `workerControlHttp` to the versioned compatibility matrix; P2.9A standalone gate wired after previous gates.

## Findings and decisions
- Initial CI at `ab16a627` failed due Node 24 TS strip-only constructor property syntax; corrected by `c6c940d3`, with other parser errors gone.
- The first full test at `c6c940d3` observed 232/233 Phase2 tests passing; the denial fixture lacked two repository methods and hit constructor validation before ingress validation. Fixed the fixture at `942cad5c`, preserving the denied-before-repository assertion.
- **Remote terminal updates remain intentionally disallowed.** A signed worker can still lie about work, and `distributedResultShape` alone is insufficient server-side proof for a remote COMPLETE. Do not add those routes until committed execution identity, tenant, certificate and network-free replay are independently verified.
- **Ingress TLS, mTLS identity, credentials and rate budgets are not implemented by this HTTP module.** Accepting `()=>true` at a public network listener would be insecure. Provide a real mTLS gateway/identity check; failed controls are an operator deployment defect.
- A 32KiB request bound alone does not bound slowloris duration; deploy with an authenticated reverse proxy request deadline, IP/rate quotas and socket timeouts. Worker key revocation, compromised client credentials, database abuse, audit export and disaster recovery remain operational obligations.
- The existing in-process trusted worker route still uses a server runtime and can terminalize via validated Phase1 execution; this remote transport must not bypass it.
- No confirmed independent external penetration test, production deployment, remote result attestation or return/profit guarantee is claimed.

## Verification ledger
- Initial RED test branch commit `62db55f9`, pipeline 3016056079 failed missing module.
- GREEN module `ab16a627` exposed TS syntax limitation; `c6c940d3` removed parameter properties.
- Fixture corrected `942cad5c`, pipeline 3016063242 success.
- Dedicated P2.9A gate and strict source fingerprint commit `23ce4083`.
- PostgreSQL HTTP integration commit `bdfc5caf`. Latest feature/MR/postmerge CI must be checked before claiming completion.

No unresolved Critical or Important issues can be asserted without the full exact-head green gate and source review; deployment gaps above are explicit.

# AXIOM Track B27 — S0 separate-process witness socket test (NOT independent authority)

Parent live B26 branch `frontier/axiom-trackb-b26-witness-gate-s0-20261014` at
`718eb7691e255bac4321b8f00a2e012f7bd34fe1` and authoritative whole-product
handoff SHA-256 `6510d5a1c7236b1b903c4993628350066deb7f3cb38b7acb847c32f1cf62de93`.

## Bounded earned properties (when verified live)

- A separate local Python process binds a loopback TCP socket and receives strict
  canonical JSON with a synthetic bearer token. The broker does **not** send its
  asserted clock or possess the witness signer. The child initializes its own
  synthetic Ed25519 signer at process start and re-checks the exact signed B25
  voter quorum against its configured voter public keys.
- SQLite commits before witness signing. Eight separate broker processes and concurrent HTTP requests
  to the one child's SQLite journal admit at most one identical checkpoint.
- Reviving the child process against its persisted journal rejects replay.
- A lost HTTP response AFTER durable commit is ambiguous and fails closed;
  automatic retries do not regain authorization. Bogus pins, credentials,
  extra clock claims, duplicate keys and public routes deny.
- The B26 `admit_audit_checkpoint` and receipt verification remain unchanged,
  and every returned outcome has `production_authority=false` and
  `provider_dispatch_allowed=false`. No provider request, production deployment
  or external egress is involved.

## Security qualifications NOT earned

- **FAILURE PRESERVED:** deleting the synthetic witness SQLite file AND
  majority local voter journals enables checkpoint replay. See permanent test
  `test_majority_and_witness_storage_deletion_still_reenables_attack`.
  A passing regression test here confirms a counterexample, NOT security success.
- The parent and child run under the SAME operator/host/security account. A
  broker administrator can delete both SQLite stores or tamper with startup
  configuration. Test-controlled bootstrap public keys are NOT independently
  pinned external trust anchors. A long-lived local bearer is NOT S4/S5 identity.
- No independent cross-host/third-party witness, authoritative key rotation,
  revocation, cross-region disaster recovery, proof against majority rollback,
  provider-certified exact free quota, hard financial ceiling, production auth,
  independent release review, global superiority or customer readiness.
- This is Track B stage B27 (S0), NOT sealed product Phase 27; the full AXIOM
  product architecture and governance are preserved.

## Evidence and replay

From the repo root:

`python3 ops/trackb27/VERIFY_B27_LOCAL.py`

Run in an isolated standard (not larger) GitHub-hosted Ubuntu Actions runner,
using synthetic keys only and repository permissions `contents: read`. No
artifacts/caches need be uploaded. The parent B26 verifier must also pass and
is not modified. Green logs demonstrate isolated local tests only; linked
GitHub Actions must independently qualify a committed branch before claiming
B27 CI PASS. Historical RED and failure evidence is never rewritten.

## Release gate

`EXTERNAL_INDEPENDENCE=NOT_PROVEN`;
`MAJORITY_ROLLBACK_RESISTANCE=FAILED_IN_SYNTHETIC_ATTACK`;
`PROVIDER_EXACT_ZERO_COST=NOT_PROVEN`;
`PRODUCTION_AUTHORITY=false`;
`PROVIDER_DISPATCH_ALLOWED=false`.

Actual external qualification requires separable operator control with
independently provisioned immutable pinned trust root; atomic append-once,
recovery from destroyed primary, revocation and key rotation verified against
separate client hosts; independent audit records; and provider-enforced hard
$0 ceiling BEFORE any live inference or production release.

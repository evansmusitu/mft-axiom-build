# Phase 2.5B Progress — Out-of-Process Deterministic Certificate Signing

Baseline main: `1d1bbbdcada5faaa2d706f7572c17263464402b4`

Issue: #11

Design:
- `docs/specs/2026-10-09-phase2-5b-external-deterministic-signing-design.md`

Implementation plan:
- `docs/plans/2026-10-09-phase2-5b-external-deterministic-signing.md`

## Delivered

- Phase-1 prepare/finalize certificate primitives preserve the existing certificate envelope.
- External Ed25519 signing requires only pinned public keys and an `ExternalEd25519SigningBackend`; no private key is accepted by the provider.
- Signing intent is deterministic and commits exact signer identity plus canonical certificate payload hash.
- `HttpEd25519SigningBackend` provides bounded fixed HTTPS transport with header-only secrets and strict response echoes.
- Platform-context v2 commits signer identity before Phase-1 execution.
- Control-plane persistence commits signer identity and signing intent and validates both against the actual trusted key/certificate.
- Legacy v1 platform-context replay remains supported.
- Distributed lost-response retry repeats the exact signing request while existing Phase-2.5A lease fencing and execution-intent mapping preserve one durable execution.
- P2.5B has a dedicated acceptance gate and explicit GitLab CI invocation.

## TDD / verification evidence

- Task 1 RED: pipeline `2928991739` failed because the certificate finalization API was absent.
- Task 1 GREEN: pipeline `2928994450` succeeded across Phase 1, Phase 2, and PostgreSQL.
- Task 2 RED: pipeline `2928999568` preserved 163 prior Phase-2 tests and failed only the two new missing signer/backend modules.
- Task 2 GREEN: pipeline `2929009806` succeeded after the signer/backend implementation.
- Task 3 RED: pipeline `2929013660` preserved 168 prior/new tests and failed only because new records lacked platform-context version 2.
- Task 3 GREEN: pipeline `2929017779` succeeded after v2 signer commitment and test-contract migration.
- Extended signer tamper, legacy replay, and distributed lost-response coverage: pipeline `2929021964` succeeded with Phase 2 at 172/172.
- P2.5B acceptance gate: pipeline `2929025474` succeeded; all prior gates through P2.5B passed.

## Security review

Bounded source diff baseline: `1d1bbbdcada5faaa2d706f7572c17263464402b4`.

Two Important findings were identified and fixed:

1. A malformed/custom signer provider could present trusted-key-valid certificate output while giving inconsistent signer identity/signing intent, allowing a record that would later fail replay. The control plane now validates identity/key/hash before execution and signing intent against the actual certificate before persistence.
2. The new Phase-1 certificate finalizer did not initially recheck that `replay.program` matched the signed `core.programHash`. It now fails closed on replay-program mutation before certificate finalization.

No unresolved Critical or Important finding remains in the bounded review after those fixes.

## Current verification status

The last fully successful feature pipeline is `2929025474` at pre-hardening head `5e5a816a20ad4bc3310fc184c9a2f3f4eb9987ed`.

After the security-review regression commits, GitLab pipelines began failing all jobs before runner start (`started_at: null`) with no trace, including unchanged Phase-1 jobs. Those runner failures are not treated as product verification. A fresh exact-head successful feature pipeline is mandatory before MR creation/merge eligibility is claimed.

# AXIOM Security Gateway S0 — revocation and financial zero-spend preflight

**2026-10-24 | ISOLATED DEVELOPMENT CANDIDATE | NOT INDEPENDENT | NOT RELEASE**

## Permanent AXIOM breadth

AXIOM preserves Project, Work, Agent, Artifact and Evidence, and the objective → context → governed plan → capability routing → execution → artifacts → verification → memory/evidence → outcome package loop. The gateway is shared infrastructure for all 20 declared surfaces, **not** a narrower coding-agent product and not a replacement product architecture.

## Scope of the candidate

- `financial_zero_boundary.FinancialZeroBoundary`: STRICT S0, local-only, allowlisted in-process tool classification. Only accepts fully explicit USD zero-charge numeric inputs with **no provider account, no credits, no billing method, no external egress, no secrets, no external write and no provider invocation**. An “approved” free provider, soft budget, account credits or user-provided zero quote does not pass. Cannot claim actual $0 external provider hard cap. Every result sets `execution_allowed=false`, `provider_dispatch_allowed=false`, `production_authority=false`.
- `revocation_snapshot_review.RevocationSnapshotReview`: domain-separated Ed25519 signature validation of an exact-field revocation snapshot for pinned issuer, operator, witness, policy, epochs, predecessor anchor, strictly incrementing revision and short validity. Enforces explicitly revoked active signer holds, signature substitutions, stale/expired snapshots and root identity collisions. It **does not** obtain or authenticate an external high-water revision, independently provision keys, prove the revoker's account, or check real IAM revocation. All output explicitly forbids execution, production and provider dispatch.
- `test_nonrelease_cross_boundary`: integrate actual local SQLite witness and signed operator receipt with S0 finance/revocation evidence; even when cryptographically valid, **S3 source mutation is blocked** and no external or production authority exists.

## Threat boundary and outstanding human/external dependencies

### T1 Builder-controlled roots and forged provenance — NOT PROVEN

Keys are ephemeral synthetic test fixtures; the code cannot prove the issuer, revocation authority or witness is operator-controlled rather than builder-controlled. Distinct signer bytes and IDs prove *syntactic* separation only. External identity provider tenant, MFA, dedicated authorization roles, separate billing owner, short-lived broker credentials and out-of-band root custody require independent provider evidence.

### T2 Destructive rollback — FAILED_IN_SYNTHETIC_ATTACK

Local SQLite witnesses and caller-presented sequence/revocation anchors can be rolled back together. Old valid signed evidence can be accepted again. Both source tests and B27 historical tests keep the rollback counterexample. A second local file, same-host database or another builder-controlled signer is not a fix. Require **separately controlled, externally durably monotonic append-once reservation**, independently anchored and cross-host destructive-loss tested, including key rotation/revocation, fork detection, lost ACK and partitions. No automatic reset, rebootstrap, replay or privileged recovery fallback is permitted.

### T3 Missing real provider cost guard — NOT PROVEN

USD0 in a local payload is not account-wide provider billing control. Account owner must verify provider origin, SKU pricing, on-demand charges, prepaid credits and external costs with a true hard **$0 ceiling** that cannot overrun. If vendor cannot furnish hard zero spend, external dispatch stays disabled. GitHub Actions and cloud execution can have costs; no new paid resources are authorized. FinancialZeroBoundary never claims real billing enforcement or releases actions.

### T4 Revocation freshness / control-plane split — NOT PROVEN

Signed revocation snapshots are only as authoritative as the key provenance, snapshot freshness, trusted external current revision and correct account-wide kill switch. A test-controlled clock is not a globally trusted time source. Deletion, rollback, stale caches, concurrent epoch rotations and emergency recovery all require adversarial cross-host evidence. An unsigned, stale, incorrect or missing revocation snapshot must fail closed.

### T5 Independent review and production — BLOCKED

Builder cannot write, approve or certify its own gate. The independent verifier needs a separate identity and ability to reject builder output, plus audit readback outside the builder's control. Until independent security, financial and rollback gates earn PASS, no S3 repository mutation by AXIOM, S4 deployment or S5 privileged operation; preserve production as rollback origin. PR #1 stays open/draft/unmerged, main stays sealed, and the OpenAI frozen submission is unchanged.

## External qualification checklist (future human-approved work)

1. Independently provision ISO operator/revoker/verifier accounts with MFA and least privilege; verify provider-origin custody and revoke ability.
2. Out-of-band pin trust root and signer epochs; external verifier separately authenticates current issuer, revoker and witness.
3. Deploy an independent, truly durable monotonic single-use backend and independently repeat the destructive rollback adversarial scenario on separate hosts/accounts.
4. Verify revocation freshness, recovery, unknown-time and revoked/rotated-key tests with provider-origin evidence.
5. Obtain provider-origin proof of account-wide USD0 hard cap and separate budget kill switch, or keep dispatch blocked.
6. Independent adversarial reviewer verifies evidence and signed release package. Consequential release remains subject to user approval.

## Local evidence

Run from repository root, with test-only `cryptography==46.0.4` in isolated environment:

```sh
python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v
python3 ops/trackb27/VERIFY_B27_LOCAL.py
python -m compileall -q ops/iso_trust_boundary
```

The signed protocol tests use synthetic ephemeral Ed25519 keys and local SQLite. They do **not** establish real provider independence. No S3/S4/S5 action or deployment is authorized by a green local test.

## Release-state invariants

`B27_GLOBAL_ANTIROLLBACK=FAILED_IN_SYNTHETIC_ATTACK`

`OPERATOR_CUSTODY=NOT_PROVEN`

`EXTERNAL_REVOCATION=NOT_PROVEN`

`EXTERNAL_PROVIDER_ACCOUNT_WIDE_HARD_ZERO=NOT_PROVEN`

`OPENHANDS_S2=BLOCKED_CREDENTIAL_NOT_AVAILABLE`

`INDEPENDENT_SECURITY_VERIFIER=NOT_PROVEN`

`SECURITY_GATEWAY_RELEASE=NOT_AUTHORIZED_NOT_QUALIFIED`
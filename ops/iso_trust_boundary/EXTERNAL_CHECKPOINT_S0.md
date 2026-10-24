# AXIOM ISO — external checkpoint contract / S0 candidate (2026-10-24)

## Objective and scope

Add deterministic, **non-executing** cryptographic checkpoint continuity review to the
existing independently controlled Security/Authorization Gateway development track.
It reviews a caller-supplied high-water anchor and a domain-separated checkpoint
signed by two distinctly pinned Ed25519 test principals, matching exact policy,
operation, receipt digest, signer epochs, time window and next sequence.

**This is NOT an independently deployed security gateway, external monotonic
service, independent custody, durable single-use authorization, or recovery
protocol qualified for real execution.** The source holds no production keys,
network access, provider credentials, signing/issuance methods, persistence,
financial account linkage or deployment entrypoint. All results explicitly
report `execution_allowed=false`, `provider_dispatch_allowed=false`,
`recovery_authorized=false`, `production_authority=false`.

## Adversarial and recovery truth

- Missing high-water anchor blocks recovery unconditionally. No reset/bootstrap.
- Stale or forked caller-provided anchor and sequence gaps are rejected.
- Invalid or substituted signatures, signer reuse, revoked local epoch, wrong
  operation/receipt/policy, expired record, and schema expansion are rejected.
- **Critical known failure retained:** replaying an earlier valid checkpoint
  after restoring *all* caller-supplied anchors also validates again. No local
  signature algorithm solves deletion of the external high-water truth. B27
  remains `FAILED_IN_SYNTHETIC_ATTACK`. This must not be relabeled PASS.
- Same-host evidence must never be promoted to external independence. The
  caller's claimed anchor origin and revocation list are not trusted/verified.

## Missing real-world gates — fail closed

1. Human-authorized operator in independently controlled tenant, MFA/roles and
   exclusive key custody; builder cannot provision or export signing secrets.
2. Trust roots pinned via external separately controlled authority and verified
   freshness, rotation/revocation, and signer separation.
3. Atomic append-once global sequence reservation with durable multi-host
   external readback, cross-host destructive rollback/recovery challenge and
   tested anti-equivocation under concurrency/partitions/lost ACKs.
4. Independent security/red-team reviewer and verifier with preserved logs.
5. Authorized operation-specific financial policy: verified provider-account
   USD 0 hard ceiling, tool/network/data scopes, identities, kill/revoke.
6. Separate approval before real S3 mutations, S4/S5 actions, production,
   or any external security qualification.

## Nonproduction checks

`python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v`

`python3 ops/trackb27/VERIFY_B27_LOCAL.py`

Test signing keys are disposable ephemeral local fixtures only. CI pass (if any)
proves the S0 local contract at that commit, never provider independence.

## Change control

Branch: `build/axiom-iso-external-checkpoint-s0-20261024` (fresh isolated)
from `build/axiom-iso-witness-e2e-s0-20261023` exact parent
`da594855cf1ad9bcb1ef6e91dc2343f0a6c24a44` subject to live recheck.

Risk: S0 local review and S1 isolated source write only; no gateway authority
expansion or production. Rollback: delete this isolated branch or revert only
these three additive files; preserve parent, main, PR #1 and B27 evidence.

Whole-product invariants: all five Project/Work/Agent/Artifact/Evidence objects,
objective-to-outcome loop, 20 named surfaces, capability/phase truth unchanged.

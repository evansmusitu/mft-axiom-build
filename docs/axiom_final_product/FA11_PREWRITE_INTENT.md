# FA-11 — Governed Execution Substrate — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_IMPLEMENTATION

## Frozen source authority
Authoritative final-product program defines FA-11 as:
- Class: Implementation
- Scope: terminal/files/sandbox/build/test/secret broker/network/worktree isolation.
- Gate: **S0-S5 enforced.**

Live implementation parent / rollback origin: sealed FA-10 head `1b38f3ed9c1a106e0b4a142bba5196fd614acd35`.

## Binding cybersecurity authority
Core law: AXIOM may request authority; it cannot be the ultimate authority granting itself unrestricted authority.

Required authorization flow:
`Identity → AXIOM planner → action request → Independent Authorization Gateway → sandbox/broker → result → evidence/rollback`.

Risk classes are frozen as:
- S0 harmless read/compute — automatic;
- S1 private local reversible write — bounded automatic;
- S2 external read — policy bounded;
- S3 external reversible write/repo mutation — scoped grant;
- S4 public publication/deployment — strong policy/approval;
- S5 secrets/identity/security/destructive customer data/critical irreversible action — strongest authorization, normally requiring explicit independent/human authority.

The gateway must evaluate workload identity, user/organization, capability, tool/data/network scopes, resource/destination, sensitivity, reversibility, risk class, budget, jurisdiction, instruction provenance, approval and incident posture. Callers may not downgrade the computed risk class.

## Implementation intent
Build one additive governed execution substrate for the vNext application. It must provide a common request/authorization/receipt contract for terminal, files, sandbox, build, test, network, secret-broker and worktree operations rather than allowing each surface to invent its own authority model.

The first qualified substrate is intentionally browser-local and deterministic. It establishes the policy and evidence contracts later local/cloud executors must satisfy, without falsely claiming unrestricted OS shell, production credentials, remote network execution or production deployment.

### Independent Authorization Gateway
The gateway is policy authority separate from the requesting Builder/Agent. It will:
- normalize a closed operation vocabulary and compute S0-S5 from operation semantics;
- reject caller attempts to understate risk or widen tool/data/network scope;
- require active workload identity, project binding, grant, budget and non-revoked/non-killed state;
- bind approvals to the exact request hash, actor, risk class, scopes, destination and expiry;
- enforce stronger separation as risk rises;
- reject self-approval/self-promotion for consequential operations;
- treat untrusted retrieved instructions as data, never authorization;
- fail closed for unknown operations, stale approvals, policy mismatch or integrity failure.

### Sandboxes and worktrees
Each execution is isolated by project, sandbox and worktree identity. The browser-local implementation will use virtual files/worktrees with path traversal prevention, immutable base identity, explicit snapshots/checkpoints, bounded resource budgets and rollback receipts. Cross-project or cross-worktree file access is forbidden.

### Governed terminal / files / build / test
The local terminal is a bounded command vocabulary over the virtual sandbox, not an arbitrary shell. Commands or syntax that can escape the vocabulary, spawn a system shell, inject control operators or access host resources fail closed. File reads are S0; bounded reversible private writes/build/test state are S1 unless their semantic target requires a higher class. Every mutation is receipt-linked and reversible where declared.

### Network
Network is default-deny. S2/S3/S4/S5 network requests may be classified and previewed but this FA-11 browser-local substrate introduces no direct `fetch`, WebSocket, XHR, EventSource or other external transport. A later executor/connector may act only after passing the same gateway contract and its phase-specific qualification.

### Secret broker
No plaintext long-lived secret enters ordinary prompts, files, traces or receipts. The local broker models opaque symbolic handles and short-lived operation-scoped leases only. Secret/identity/security-policy operations are S5. Lease scope, workload identity, destination, operation, expiry and approval are exact-bound; plaintext recovery is not implemented by this browser-local substrate.

### S4/S5 boundary
Public publication/production deployment (S4) and secrets/identity/security/destructive or critical irreversible operations (S5) cannot silently execute in this substrate. They require the frozen approval/separation contract and remain blocked when the required external/human authority or qualified executor is absent.

## Composition boundary
Reuse, do not replace, already-earned contracts:
- Agent/Mission Control workload identity, least-privilege grants, budget, delegation and kill switch;
- Project provenance and work ownership;
- FA-10 Deep Context instruction-provenance/data-not-authority boundary;
- Computer exact-preview approval, rollback receipt and symbolic credential patterns;
- Observability/Evidence append-only, tamper-evident receipts and privacy boundaries.

Existing earned source-authority files remain unchanged unless a later explicitly frozen repair proves modification necessary.

## Required adversarial verification
Before FA-11 can be earned, an independent read-only repository gate must prove at minimum:
1. every registered execution operation deterministically maps to S0-S5 and unknown operations fail to S5/block;
2. caller-supplied lower risk cannot override computed risk;
3. S0 automatic behavior is read/compute only;
4. S1 mutations are private, bounded, reversible and budget limited;
5. S2 requires policy-bounded external-read authority and cannot use an unapproved destination;
6. S3 requires exact scoped grant plus non-self consequential approval and reversible mutation semantics;
7. S4 requires strong independent/human publication/deployment approval and remains blocked without a qualified executor;
8. S5 requires strongest independent/human authorization, cannot expose plaintext secrets, and cannot let a builder/security agent lower its own gate;
9. stale/tampered approvals, receipts, leases, events and request hashes fail closed;
10. workload kill/revocation/budget exhaustion blocks execution;
11. prompt-injected/retrieved instructions cannot alter risk, scope, network, approval or secret policy;
12. path traversal, cross-project access and cross-worktree access fail closed;
13. terminal shell/control-operator escape attempts fail closed;
14. network stays default-deny and FA-11 introduces no direct external transport;
15. secret leases are opaque, short-lived and exact-operation scoped;
16. builder and verifier/security/release duties remain separated;
17. cumulative vNext and selected earned legacy regressions pass;
18. CI is read-only with no deployment or repository-write authority.

## Claim boundary
Passing FA-11 will earn only the governed execution-substrate implementation gate for the qualified browser-local contract. It will not certify unrestricted local shell access, production secrets, external network execution, production deployment, external security validation, Phase 13/14/15, Wolfram parity or superiority.

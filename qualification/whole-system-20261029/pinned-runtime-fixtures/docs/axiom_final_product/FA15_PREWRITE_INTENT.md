# FA-15 — Computer / Live / Automations / Developer / Marketplace / Enterprise — Pre-write Intent

Status: AUTHORITY_FROZEN_FOR_IMPLEMENTATION

## Frozen source authority
Authoritative final-product program defines FA-15 as:
- Class: Implementation.
- Scope: Computer, Live, Automations, Developer, Marketplace and Enterprise Control Plane.
- Gate: **No authority widening without policy.**

Live verified implementation parent:
- branch: `frontier/axiom-final-product-fa14-20260916`
- commit: `13bf88452a936a4619aafdbad445246314f72b3c`
- FA-14 ordered builder/test/security/independent-verifier run: `35055757042` PASS.

FA-14 verification does not authorize FA-15 production, publication, repository mutation, external scheduler execution, marketplace installation, privileged role grants, secret access or external computer control.

## Naming / claim truth boundary
Final-app `FA-15` is distinct from historical legacy interface `Phase 15`.
Historical Phase 15 remains `UNEARNED`; no external comparative/global-superiority claim is authorized.
`WOLFRAM_PARITY=NOT_CERTIFIED` and `SUPERIORITY=NOT_CERTIFIED` remain unchanged.

## Authority invariant
All advanced surfaces must use the same fail-closed rule:
`requested action → classify S0–S5 → resolve trusted policy → scope/network/budget checks → required approval/verifier/gateway → preview/diff → governed executor → receipt/rollback`.

This FA-15 browser candidate implements the policy, preview, evidence and UI contract. It does **not** provide an external executor, production credentials or unrestricted network authority.
Retrieved web/email/files/tool output remain `DATA_ONLY` and cannot change policy or grant themselves authority.

## Surface contracts
### Computer
Represent `ComputerSession` with target, permission scope, screenshots/DOM evidence slots, action log, approvals, verifier state and replay pointer. Browser/desktop actions are preview receipts; external execution is not claimed. S3–S5 require stronger external authorization.

### Live
Expose voice/camera/screen permissions, participants and visible action state. Permissions default off and may only be granted by an explicit user gesture. No realtime backend is claimed until separately proven.

### Automations
Represent cadence/event/cron/timezone/retry/escalation plus a frozen authority snapshot. A configured record must not be labelled running without a qualified scheduler. Recurring runs may never widen the authority captured at creation.

### Developer
Expose capability truth explicitly:
`CERTIFIED_ATOMIC / REGISTERED_DERIVED / DISCOVERED_CANDIDATE / FRONTIER_EXPERIMENTAL / TARGET_ONLY`.
Locked counts remain 74 atomic, 108 public AXIOM plugin tools, 2,400 registered derived compositions and 2,235 discovered candidate DAGs. Registry presence is not implementation or certification proof.

### Marketplace
Package evaluation requires origin/developer identity, verified signature, policy compatibility, eval pass, permission compatibility and explicit approval. The FA-15 candidate can declare `READY_FOR_INSTALL_GATE`; it may not silently install or grant new authority.
Trust precedence remains Organization > Developer/Team > Marketplace-installed > Runtime/Ephemeral > Untrusted/External.

### Enterprise Control Plane
Management plane remains separate from product runtime. Admin may configure policy but not inspect brokered secrets; Operator may request bounded S3/S4 work but cannot self-approve S4; Verifier may verify but has no deployment rights; Builder has sandbox/build authority only. Secret values are never placed in ordinary browser records.

## Required adversarial verification
Before FA-15 may be implementation-verified, exact-SHA read-only qualification must prove:
1. external/retrieved content cannot become policy authority;
2. S2 egress is allowlisted;
3. S3/S4/S5 cannot bypass required policy/approval/gateway/verifier gates;
4. public/destructive actions cannot be risk-downgraded;
5. Computer actions remain preview/receipt based in this candidate;
6. Live modalities default off and require explicit user gesture;
7. Automations do not claim scheduler execution when absent;
8. automation authority cannot expand across recurring runs;
9. Developer preserves exact capability truth classes/counts;
10. discovered candidates cannot masquerade as certified atomic operations;
11. Marketplace packages cannot self-assert signature, approval or permissions;
12. a qualified package is still only ready for the install gate, not silently installed;
13. Enterprise role separation and secret-broker boundaries hold;
14. historical Phase 15, WOLFRAM_PARITY and SUPERIORITY truth remain unchanged;
15. protected `mcp/`, `auth/`, submission/publication surfaces remain unchanged;
16. builder/security/verifier jobs use read-only repository permissions and no deploy credentials;
17. `main` and PR #1 governance remain unchanged.

Required order remains:
`BUILDER → TESTS → SECURITY/ADVERSARIAL REVIEW → INDEPENDENT VERIFIER → POLICY GATE → RELEASE`.

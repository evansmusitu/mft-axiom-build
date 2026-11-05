# Customer frontier continuation — governed isolated review candidate

**No deployment or production release. No real payment. No independent benchmark superiority claim.**

## Newly added since candidate PR #57 baseline

- Strict cross-tenant relational foreign keys at the database layer for orders, refunds, invoices, project/work/agent/artifact/evidence and optional work reservation linkage.
- Settlement evidence required for settlement-state transitions; invoice/provider event/credit ledger entries remain immutable via SQLite triggers.
- New **keyless enrollment candidate** backed only by qualified independent identity-service binding, freshness, MFA and verified-email proof. Idempotent active identity; revoked and replayed proof rejected. No OAuth production cutover.
- Provider-owned `/auth/start` login broker with HTTPS origin and PKCE-S256/state validation; refuses login when unqualified. A customer portal can now explain disabled enrollment accurately and offers explicit finish-setup action.
- Owner/admin billing access separated from member workspace edit. Viewers cannot create projects or view sensitive finance history. Portal hides billing tabs from nonfinancial roles.
- Portal adds persistent draft Work creation, Work evidence navigation, explicit unverified status and accessible controls.
- 34 deterministic numerical reference cases across NPV, periodic-coupon bond pricing and unconstrained convex QP. These vectors **do not measure live AXIOM**, baseline, UI or real end-user outcomes.

## Local evidence

- Node: 42/42 local isolated tests PASS.
- Python: 10/10 reference/benchmark validator tests PASS.
- Static JS syntax checks PASS.
- Independent real IdP, finance provider, D1 production, concurrency, deployed API, screen-reader and mobile/tablet acceptance, remote AXIOM execution, actual competitors and B27 antirollback qualification **NOT PROVEN**.
- B27 global rollback attack is **FAILED_IN_SYNTHETIC_ATTACK** in authoritative prior evidence; unchanged.

## Release acceptance path

Identity -> staging data isolation -> PSP merchant/provider verification -> settlement/chargeback/refund accounting -> real AXIOM runtime and evidence -> independent security and B27 verification -> device/performance/resilience -> stage/canary/monitor/rollback.

Before any future GitHub mutation re-read the live branch, main, PR #1 and source authority. Do not fast-forward main or merge PR #57 without separate authorization. Production remains rollback origin.

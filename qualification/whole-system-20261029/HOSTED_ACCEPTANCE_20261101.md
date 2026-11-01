# Hosted acceptance scope

The explicit 1 November user request authorizes one isolated hosted Agents mission,
storage migration and recovery qualification. This checkpoint implements the runner;
only downloaded workflow output establishes live success or failure.

The workflow runs on PR 55's authorization file, uses the previously approved
existing credential in runner memory, and creates only the fixed, isolated
`axiom-acceptance-20261101-01` Cloudflare resources. No OpenAI credential enters the
Worker. Its D1 marker is seeded through the authenticated provider API before
privileged access. The operator endpoint cannot bind to an unmarked database.

The live check uses the actual decision pipeline for two tenants and the normal
governance/reservation/completion implementation through hosted D1. It checks
cross-tenant read denial, revoked credentials, concurrent call ceilings, immutable
completed replay, a real Worker redeployment, expired-lease reclaim and stale-owner
denial. These checks qualify this isolated deployment, not production migration.

The hosted mission creates at most one session. The initial SSE observer closes
after the turn checkpoint; reconciliation uses saved IDs without resending input.
The actual completed JSON is checked against an independently specified nonce and
17 × 23 = 391 oracle. Its Axiom artifact, provider proof and receipt are committed
and reread. A second, separately reserved turn in the same session checks actual
terminal cancellation; a cancellation request alone does not pass.

The runner captures actual output and receipts before session deletion, verifies
the session then returns 404, and deletes the temporary Worker. Hosted sandbox
termination after session deletion is asynchronous. The isolated D1 ledger is
retained deliberately to prevent a workflow rerun from creating another session.
A lost dispatch acknowledgment is uncertain and must not be resent. No hard token
or currency ceiling is claimed by the cooperative deadline or call budget.

Independent custody and destructive anti-rollback acceptance remain separate
requirements. The runner emits `release_authorized: false` and cannot certify
those gates. Product merge, deployment and publication remain conditional on
their independent acceptance.

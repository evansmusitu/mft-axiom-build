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

## Actual Cloudflare attempts

At source `af17ea82e6d395b6b896e4e2de8b77a49ea0e635`, workflow
`41277403053` stopped on the existing global key: HTTP401/CF10000. Its exact
artifact digest is `0b480cd90cb1addce3ece8236b5a4c0f11f62a13fd163aca95f07a750ff7e761`.

At source `2b389925ac9626f994993ea84c6146fa0b35d10a`, workflow
`41277591641` verified the alternate existing API token by listing D1 databases,
then database creation stopped on HTTP403/CF7406 (account database limit).
Artifact digest:
`ff8ffba5c8d6352098487a7236eacf06ca156565c96b60bbf093c1045b9d9c1b`.
Neither attempt created a database, Worker, hosted session or provider invocation.
No existing database was deleted to make capacity.

The separately authorized hosted protocol runner can exercise an actual
OpenAI-hosted session using isolated local workerd governance, with an immutable
remote dispatch claim and acknowledged session/turn journal artifacts. That scope
is explicitly **not hosted D1 qualification**. Its remote claim prevents automatic
input retries even after local runner loss. Artifacts are retained 90 days;
expiration, privileged deletion and rollback are outside this ordinary retry guard.
The original Cloudflare workflow is pinned to its already failed source checkpoint.

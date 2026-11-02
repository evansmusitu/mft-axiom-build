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

## First hosted protocol outcome

Workflow `41278597576`, source `b917362878757c9ad4c09b5f7ca10212d9bab46d`,
created one hosted session and remotely acknowledged both identity checkpoints.
No final output or Axiom completion receipt was obtained. Reconciliation remained
unsuccessful; cleanup requested cancellation, acknowledged session deletion and
verified GET404. This is a **failed acceptance**, not a completed governed task.
Its exact artifact digest is
`41cef72ff9f98ca8424fc42400012f3c56c49f6cc23216716c1ce576b199550b`.

The live result exposed insufficient queued-turn waiting and insufficient safe
provider-status diagnostics. The client now offers bounded read-only completion
waiting, preserving exact IDs, a120-read ceiling, a single overall deadline and
no input submission. One durable reconciliation operation can wait for queued or
running status rather than exhausting all three logical attempts immediately.
The original artifact did not retain the underlying provider error code, so its
precise provider-side cause is not asserted.

A separate revalidation uses a new Work/invocation and remote claim02, after
checking the old session still returns404. It retains the old failure and never
resends that invocation. The isolated acceptance lease is15minutes; ordinary
production defaults are unchanged. Provider state and safe typed observation
errors are retained before failure cleanup. Only its actual downloaded output,
receipt, terminal cancellation and deletion evidence can establish success.

## Final diagnostic outcome and current blocker

Attempt02, workflow `41279039771`, was also a failed provider turn without any
final output or completion receipt. Its artifact SHA256 is
`a7733bdd14615ff1f1e1c16c1bd5d981a4caaa022b6f2aaa6f3307c6a7689857`.
GET-only diagnostics verified that the exact default model was available and
both deleted sessions/turns returned404; no diagnostic request created a session.

The final bounded diagnostic was a new Work/claim03, workflow `41279972075`, at
source `a515bf57bf8441e6b218c1625bf17b4478a89c46`. Its interrupted creation
observer saved and remotely acknowledged both IDs. Read-only waiting then
observed the provider's documented **`usage_limit_exceeded`** category and
terminal `failed` status. The normal governed failure path persisted the Run as
FAILED, with one provider-call reservation, no successful Artifact and no
completion receipt. Cancellation was requested during cleanup; deletion was
acknowledged after a transient failed deletion attempt, then GET404 was verified.
Its exact artifact SHA256 is
`629fb96660103074fb469c4faf8200368d03f6cc5c20450540fa216b005395b3`.

The final session is
`sess_05e73702a5f56bd0006ae6d8bdd54c8192997871f2c6ef9538`; its saved turn is
`turn_05e73702a5f56bd0006ae6d8c389708192805cb21cc95ae28b`.
No session remains addressable. Provider sandbox destruction after deletion is
asynchronous and is not independently attested. Three separate failed sessions
were attempted in total; previous failed invocations were never resent.

**Successful hosted output, Axiom completion receipt and terminal active-turn
cancellation remain unqualified.** The acceptance never reached its follow-up
cancellation probe. Resolving the provider usage limit is required before that
remaining acceptance can pass. Further automatic inference dispatch is pinned
off; remote one-shot claims and all failed outcomes are retained.

These failures also supplied a concrete recovery regression: documented terminal
failures are now reconciled once rather than repeatedly polled as unknown
outcomes. Logical lifecycle deletion may handle such an invocation only with a
failed governed Run, captured provider IDs, empty output and the exact terminal
failure/cancellation observation. It still requires a verified export and an
separately provisioned server-owned lifecycle grant. A failed Run alone cannot erase an
uncertain provider outcome.

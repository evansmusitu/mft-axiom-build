# Governed OpenAI Agents integration — 1 November 2026

The owner selected reuse of an existing credential. No credential was created,
printed, copied to a sandbox or written to a local environment file. This is a
source candidate with offline acceptance, not a live hosted-access or release
claim. It continues checkpoint `f99e0bd` on draft PR #55.

## Integrated behavior

The current task API can explicitly select `AXIOM_AGENT_PROVIDER=openai_agents`.
The server must separately set `AXIOM_OPENAI_AGENTS_ADMITTED=true` and provide its
existing `OPENAI_API_KEY` binding. `OPENAI_AGENTS_MODEL` selects the model; the
official quickstart default is `gpt-6-astra`. No client request may set these
server properties. Existing provider behavior and local decisions are preserved.

The public `openai@7.15.0` SDK creates an OpenAI-hosted session with no application
tools, no subagents and sandbox network disabled. Transport pins OpenAI's origin,
rejects redirects and disables SDK retries. Checkpoints are awaited before the
next event. Only the intended completed turn's assistant answer can be returned;
idle, required actions, contradictory identities and failed/cancelled turns do
not produce success. Reconciliation reads persisted turns/items and never sends
input. The client exposes explicit cancellation and deletion; deletion is never
automatic. Required artifacts must be downloaded and verified before deletion.

A local 45-second deadline and output/body bounds cover observation and reads.
Timeout/abort with known identities makes at most one best-effort cancellation
attempt under its own <=1-second deadline. Cancellation is not a terminal receipt.
The API cancels a session's active turn and offers no conditional turn-ID cancel;
the client does not claim stronger race-free cancellation. JavaScript deadlines
use cooperative timers.
The API supplies no session-create idempotency guarantee used by this adapter:
invocation IDs are local, and uncertain input is never automatically resent.

The existing execution contract reserves each hosted model action before
dispatch. Atomic admission checks the authenticated tenant, Work commitment,
current task/binding/generation, active lease, Project/Agent authority and durable
budget history. A pending invocation is written before the upstream request.
Session/turn checkpoints use atomic compare-and-set guards.

Completed model proofs resolve persisted outputs and their original reservations.
The full task receipt binds those proofs, and Artifact/Evidence completion checks
the verified invocation set inside the transaction. New or altered invocations
between preflight and commit abort the entire completion transaction. A resumed
lease cannot silently adopt a previous lease's provider proof.

Explicit recovery is tenant-scoped and bounded to three persisted reconciliation
attempts. It may record a completed provider output but cannot complete the Axiom
task, adopt a lease, reset a budget or create/resend input. The new internal
`musitu-agent-recovery` candidate documents this implemented seam. There remain
30 existing native packages and two internal candidates; no public count changed.

## Qualification and limits

All 15 local command groups pass, including 367 application tests, 62 SDK
tests using injected Fetch, 11 actual local workerd/D1 cases, five credential-preflight methods and the existing
kernel/worker/frontier/recovery suites. Independent review reproduced and verified
repairs for task-binding confusion, checkpoint replacement, provider drift,
completion/admission races and cross-generation proof reuse. Counts overlap;
they are not independent external benchmark totals.

Install the integration's checked-in lock with `npm ci --ignore-scripts` inside
`integrations/openai-agents`, as well as the existing Phase2 lock and pinned
Miniflare dependency. Then run the root portable checks with `--with-local-d1`.
The CI credential preflight uses existing standard/MUSITU/MFT GitHub secret
aliases. Its optional GET-only check lists at most one session; it records only
the HTTP status and read-access verdict, discards all response bodies and
prohibits redirects. It creates no session or inference and does not verify
hosted write/inference permissions. The key is scoped only to that preflight step.

Apply the current execution-contract SQL and qualify it in an isolated hosted
environment before deployment. The new invocation and completion-guard tables
do not rewrite legacy task history. Partially applied experimental schemas need
an explicit admitted migration; the application does not silently repair them.

One model action reserves a hosted-session invocation, not every internal model
step or SDK control request. Reconciliation has a separate three-attempt bound.
These controls are not a token, currency or account-wide spending ceiling. Live
hosted permission, lifecycle/cleanup, financial admission and longer-running
acceptance remain open. No paid call, production rollout or publication occurred.

## Primary contract sources

- https://developers.openai.com/api/docs/guides/agents-api/overview
- https://developers.openai.com/api/docs/guides/agents-api/quickstart
- https://developers.openai.com/api/docs/guides/agents-api/configuration
- https://developers.openai.com/api/reference/resources/beta/subresources/agents

Implementation and offline wire tests use the installed SDK's exact 7.15.0 types.

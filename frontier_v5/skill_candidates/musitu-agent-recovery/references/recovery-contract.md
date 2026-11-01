# Governed recovery seam

Use the server exports in `ops/axiom_agent_model_store.mjs`:

- `inspectAgentInvocations({db, customer, taskId})` reads only the authenticated
  tenant's saved identities and state.
- `reconcileAgentInvocation({db, customer, taskId, stage, client})` resolves the
  saved session/turn and invokes the trusted client's read-only reconciliation.
  Unknown identities block execution; no session is guessed or recreated.

The client is `createHostedAgentClient` from the pinned public SDK integration.
Keep credentials on the caller's server, outside the hosted sandbox. Hosted
execution requires explicit server admission; a reuse-key choice is not live
qualification, a spending ceiling, or release admission.

Reconciliation retains the original reservation and invocation. Its response
sets `input_resubmitted:false` and `task_completion_authorized:false`. A provider
output commitment can be captured after an observer failure; application task
completion still requires the current execution lease and the complete atomic
Artifact/Evidence transaction. Old generations are not silently adopted.

Offline acceptance includes lost-observer readback, tenant denial, three-attempt
limits, no repeated input, stale-generation rejection, concurrent checkpoint
fencing, and rejection of an invocation inserted between proof validation and
artifact commit. Run the root application contract suite and the SDK client's
injected-Fetch tests. Live hosted access, cancellation and artifact download
remain separate acceptance gates until exercised against the admitted account.

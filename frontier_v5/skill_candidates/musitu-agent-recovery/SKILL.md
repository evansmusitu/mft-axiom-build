---
name: musitu-agent-recovery
description: "Inspect and reconcile an interrupted Axiom hosted-agent invocation using saved tenant, Work, task, session and turn evidence. Use for uncertain provider outcomes and lost observers; preserve reservations and lease fences, and never automatically resend input or grant task-completion authority."
---

# MUSITU Agent Recovery

Read `../../shared/QUALITY.md` and `references/recovery-contract.md`. Treat this
package as an internal candidate; it is not installed or publicly qualified.

1. Resolve the authenticated tenant and existing Project/Work/task identity
   through the trusted service. Inspect its persisted invocation ledger. Do not
   accept caller-supplied session IDs, JSON rows or success flags as authority.
2. Separate saved Axiom completion from provider completion. Return an existing
   verified Axiom receipt when available, preserving its original commitments.
   A missing or uncertain provider checkpoint never authorizes a new request.
3. For a recorded session and target turn, use the server-owned read-only
   reconciliation adapter. It reads persisted state and items, with at most
   three durable attempts. It never creates a session, resubmits input, resets
   a reservation, or marks the Axiom task complete.
4. Preserve pending, failed and cancelled outcomes. A completed provider turn
   supplies a committed model output, not factual validation or permission to
   execute its recommendations. Resolve its evidence against the stored ledger.
5. Respect the task's lease generation. Do not adopt an old lease's model proof
   into a resumed task or fabricate approval. Report the separate admission or
   recovery decision that remains unavailable.
6. Route an explicit cancellation or cleanup request through the trusted tenant
   record and documented client methods. Cancellation is not proof of a terminal
   outcome. Download and verify required artifacts before any authorized deletion.
7. Report the known state, evidence commitments, uncertain outcome and next
   permitted step. Keep API keys, raw provider errors and hidden reasoning out
   of the report. Never label local simulation as live hosted acceptance.

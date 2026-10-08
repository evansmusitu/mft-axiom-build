# MUSITU Axiom Support Console Contract

This is an **isolated implementation contract**. It carries no production, public-submission, or release authority.

## Operating model

The console combines the proven frontier pattern: a private operator inbox, one durable case conversation, explicit customer-vs-internal message visibility, auditable state transitions, escalation, and independent approval for sensitive actions.

### Customer-visible workflow labels

- NEW
- IN_PROGRESS_MUSITU_SUPPORT
- ACTION_REQUIRED
- SOLUTION_PROVIDED
- CLOSED
- ESCALATED

To preserve the existing live case schema during isolated development, these labels map to current storage states: NEW → NEW, IN_PROGRESS_MUSITU_SUPPORT → IN_PROGRESS, ACTION_REQUIRED → WAITING_FOR_CUSTOMER, SOLUTION_PROVIDED → RESOLVED, CLOSED → CLOSED, ESCALATED → TRIAGED.

## Conversation contract

Messages are one of CUSTOMER_MESSAGE, AGENT_REPLY, INTERNAL_NOTE, or SYSTEM_EVENT. Customer messages and agent replies are encrypted at rest. Internal notes are never returned through recovery-authenticated customer endpoints. Operators never need or receive the customer's recovery code. Every mutation appends a hash-chained support event.

## Operator authority

Production operator access must fail closed unless a Cloudflare Access identity assertion is verified and maps to an explicitly configured operator identity/role. The console must not use recovery codes as operator credentials. Bulk plaintext export is outside scope.

## API surface

- `GET /api/v1/operator/cases`
- `GET /api/v1/operator/cases/:case_id`
- `POST /api/v1/operator/cases/:case_id/messages`
- `POST /api/v1/operator/cases/:case_id/state`
- `POST /api/v1/cases/:case_id/messages`
- existing `GET /api/v1/cases/:case_id` expands into the customer-visible thread

## Sensitive actions

Account recovery, identity/entitlement changes, refunds, data export/deletion, security disclosure, public incident statements, case purge, legal-hold actions, and production changes remain subject to the existing independent-human approval model.

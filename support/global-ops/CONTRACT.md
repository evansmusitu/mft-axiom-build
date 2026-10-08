# MUSITU Axiom Global Support Operations Contract

This branch is an isolated implementation track derived from the currently deployed recovery-enabled support system. It does not alter `main`, PR #1, the frozen OpenAI submission, Claude distribution, or unrelated production surfaces.

## Software scope

The goal is to close the remaining software gaps between MUSITU Support and mature global support operations:

1. SLA/SLO timers with acknowledgement/update/resolution clocks, breach detection, escalation and handoff.
2. Actual notification delivery state and retry semantics, inbound email threading contract, and outbound webhook delivery.
3. Secure attachment metadata/upload boundary with malware-scan state and consented diagnostics.
4. Incident/known-issue correlation, engineering/security/privacy/billing escalation, customer escalation, and public status records.
5. Organization/workspace support entitlements and support-plan metadata.
6. Operator productivity: saved macros, handoff notes, collision/lease semantics, queue filters and routing.
7. Language detection/routing and AI-triage handoff metadata without pretending automated translation or human-language coverage exists when it does not.
8. Analytics, SLA attainment, QA sampling and CSAT.
9. Customer/enterprise API contracts and event webhooks.
10. Accessibility-preserving customer/operator UI integration.

## Evidence boundaries

The software may calculate SLA targets and breach timers, but MUSITU must not advertise contractual 24/7 response commitments until real staffing evidence exists.

A configured independent-approver reference is not equivalent to a second bound human identity. Sensitive recovery and other two-person actions remain non-operational until a genuinely distinct authorized identity is bound.

External systems such as email sending, malware scanning, paging providers, storage providers and webhook consumers must fail closed when their production binding is absent. The data model and delivery queues must preserve retriable evidence without fabricating delivery success.

## Security invariants

- Customer narratives/messages remain encrypted at rest.
- Attachments never enter D1 as plaintext blobs.
- No secrets, OTPs, raw Access JWTs or recovery codes are stored.
- Internal notes, QA reviews and engineering notes never appear in customer-facing APIs.
- Bulk plaintext export remains outside scope.
- All material state changes append auditable events.
- Production migration must be additive and preceded by a D1 Time Travel bookmark.

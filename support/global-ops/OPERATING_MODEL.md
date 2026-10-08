# MUSITU Axiom Global Support Operations

## Classification

### Implemented software

The verified branch implements:

- encrypted case intake and durable customer/operator conversations;
- private operator authentication and case operations;
- recovery-code and verified-identity recovery controls;
- priority-derived SLA/SLO clocks and automated breach detection;
- assignments, short operator leases, shift handoffs and customer/operator escalations;
- engineering, quantitative, security, privacy, billing, identity and incident routing lanes;
- incident records, case correlation and public status data;
- organization/support-plan/entitlement records;
- retryable notification and webhook queues with delivery-attempt evidence;
- hashed inbound-email thread binding and a verified-ingress email adapter;
- encrypted macros, handoff notes, QA notes and CSAT reasons;
- consented diagnostic metadata;
- private attachment object-storage contract with SHA-256 verification, quarantine-by-default and clean-only customer download;
- deterministic self-service knowledge search plus an optional advisory AI-assist hook;
- language-routing metadata and human-review-required triage;
- analytics, QA, CSAT and bounded customer reopen;
- append-only evidence for material actions.

### Provider-dependent capabilities

These software paths fail closed until a real provider is bound and verified:

- outbound customer email delivery;
- inbound email routing to the email-thread Worker;
- private object storage until an R2 bucket is provisioned;
- automated malware scanning of attachments;
- external webhook delivery until a destination/secret resolver and sender are bound;
- external paging/on-call delivery;
- AI answer generation or translation.

A queue record or provider hook is not evidence that delivery occurred. Provider delivery is recorded only after an actual provider receipt/result.

### Human operating boundaries

Software cannot establish these facts:

- 24/7 human staffing or follow-the-sun coverage;
- contractual SLA commitments;
- a genuinely different independent approver identity;
- human-language coverage by trained operators;
- legal/compliance certifications not independently obtained.

Until those facts are evidenced, public wording remains limited to operating objectives and available software controls.

## SLA policy

Priority clocks are impact-driven rather than payment-driven. Support plans may enable channels, APIs, webhooks or escalation rights but do not reduce incident severity or override safety priority.

Current clocks are operational targets, not contractual guarantees:

- P0: 15-minute acknowledgement; 60-minute update; 4-hour resolution target.
- P1: 1-hour acknowledgement; 4-hour update; 24-hour resolution target.
- P2: 8-hour acknowledgement; 24-hour update; 72-hour resolution target.
- P3: 48-hour acknowledgement; 72-hour update; 7-day resolution target.

## Attachments

Attachments are stored outside D1. D1 stores metadata, size, SHA-256, storage key and scan state only. Customer download is permitted only when the attachment is marked `CLEAN`. `PENDING`, `QUARANTINED` and `FAILED` objects are not exposed through customer download APIs.

The production attachment feature is operational only if the private object-store binding exists. Automated malware scanning requires a separately verified scanner.

## Email and notifications

Customer narrative remains encrypted in the case store. Email-thread metadata stores address/provider hashes rather than raw addresses. Inbound email is accepted only after provider verification and a thread/sender-hash match.

Outbound notifications use the notification outbox and immutable delivery-attempt records. A notification is not marked delivered unless a real provider returns success.

## AI and multilingual assistance

Knowledge search is deterministic and available without an AI provider. Any AI-assisted answer is advisory, preserves a human-escalation path and cannot modify case authority. Language metadata may route work but is not a claim that a human fluent in that language is currently staffed.

## Production migration rule

Every production schema release must:

1. verify protected Git/OpenAI/Claude states;
2. take a fresh D1 Time Travel bookmark;
3. capture metadata-only existing row counts;
4. apply the additive schema;
5. prove existing row counts did not decrease or change unexpectedly;
6. deploy Workers with strict inherited secrets;
7. keep workers.dev and preview URLs disabled;
8. run negative authentication/provider tests before positive tests;
9. record provider/human boundaries without overclaiming.

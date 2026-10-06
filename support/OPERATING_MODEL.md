# MUSITU Axiom official support operating model

This operating model covers the whole MUSITU Axiom product. It is not provider-specific.

## Accountable roles

- Primary owner reference: `github:evansmusitu`
- Independent approver reference: `person:elvis-musitu`

The independent approver is a different real person. Private contact destinations are held only in approved operational systems and are not committed to the repository.

## Decision rights

The primary owner may triage, assign and coordinate cases. Identity or entitlement changes, refunds, data export or erasure, security disclosure, public incident statements, case purge, key rotation and production changes require the independent approver. No person may approve their own sensitive action.

## Escalation roster

1. Primary owner: intake ownership, severity validation and customer coordination.
2. Independent approver: sensitive-action approval and incident/evidence verification.
3. Infrastructure escalation: isolated support runtime, storage, encryption and abuse-control recovery under the same two-person approval rule.
4. Product escalation: quantitative-result disputes and reproducibility packages routed to the relevant MUSITU Axiom operation owner.

## Operating boundaries

- Never request or store passwords, API keys, OAuth codes or tokens, client secrets, session cookies, private keys, payment-card data or unrestricted private datasets.
- Customer narratives remain encrypted at rest and are accessed only through one-time recovery credentials.
- Public incident statements require evidence and an independent verifier.
- Support targets are operational objectives, not contractual guarantees, until formally published in customer terms.
- Support mailbox routing and end-to-end delivery are verified. This does not make the web support service publicly operational; publication still requires the remaining readiness gates and explicit hostname deployment authorization.

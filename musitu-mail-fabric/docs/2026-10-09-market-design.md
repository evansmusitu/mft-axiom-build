# MUSITU Mail Fabric commercial thesis and design
Date 2026-10-09

## Hypothesis
Email sending is commoditized. Resend, Postmark and Amazon SES have established delivery tools and sender reputation. A start-up with zero money cannot replicate that infrastructure immediately. A better first wedge is a provider-independent communications trust fabric providing signed, reproducible evidence of policy decisions and provider events.

## Initial customers
Target regulated African fintech, cross-border commerce, security notification and public services. Customer retains its own approved transport; MUSITU sells auditable decisions, portability and governance. Real customers and payment willingness are unverified hypotheses.

## Architectural boundaries
Authenticated request => domain/sender/recipient/purpose/declared-region policy => safe idempotent orchestration => provider adapter => provider API acknowledgment => signed receipt. Record recipient via opaque keyed digest, not plaintext. Unknown API outcome must not trigger automatic duplicate sends. API acceptance is not SMTP delivery, inbox placement, open tracking or a human read receipt.

## The hard-to-copy moat must be earned
Long-run potential differentiators: independently auditable key histories, region-specific verified sender and delivery datasets, dispute-resolving evidence protocols, trusted local partners, compliance workflows, signed downstream delivery signals, measured routing decisions, customer integrations and reference contracts. Competitors can copy many software features; no years-long barrier or measurable superiority exists yet.

## Phases
Phase 0: isolated running prototype, no production email.
Phase 1: durable transactional idempotency, sender DNS ownership, real multi-tenant access control, webhooks, suppressions, abuse protection, lifecycle encryption, key custody and trust anchoring.
Phase 2: two genuinely independent provider integrations and one opt-in pilot, delivery and price benchmarks, customer outcome measurements, security and legal review.
Phase 3: enterprise contracts, certified SLAs and multi-region partnerships; dedicated SMTP only if justified by reputation, capital and demand.

## Unresolved business choices
Trademark clearance, initial customer, country-specific law, legal counsel, data retention, billing, key registry, independently validated service levels, approved sending domains and launch authorization.

Do not represent this prototype as an operational public email provider, or as proven better than existing providers.


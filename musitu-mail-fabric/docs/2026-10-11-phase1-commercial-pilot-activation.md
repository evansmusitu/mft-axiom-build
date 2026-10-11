# MUSITU Mail Fabric — Phase 1: earn with qualified Resend-backed service

**Date:** 2026-10-11 (UTC). **Classification:** actionable commercial preparation on isolated branch, **not a production release**. No DNS, Cloudflare production, PR #1, protected main, Resend send, webhook or payment mutations are implied by this document. Existing system's customer sending remains OFF.

## Goal and boundaries

Phase 1 has two independently measurable milestones:

1. **First paid preparation contract**: a customer chooses and pays for scoped assessment, setup design, verification readiness or non-production integration. Work never includes real customer delivery or customer secrets until legal and contractual approvals. This may generate revenue earlier than production sending, but **the previously integrated Paynow rail exists within MUSITU; a distinct MMF paid-product integration, lawful invoice authority and first customer remain unverified**.
2. **First authorized, bounded live delivery pilot**: use MUSITU Mail Fabric's customer-facing governed service with Resend as the replaceable SMTP/API transport. This is NOT approved yet. It requires every production readiness gate below and explicit manual release, not merely a provider free tier or successful code tests.

### Proven as of 2026-10-11

- At GitHub isolated branch `product/musitu-mail-fabric-isolated-20261009` and SHA `db71b07ef1d6ebf51372f41d94625b2da268db3f`, CI was green and the live-provider release gate fails closed without 3 distinct cryptographic attestations (owner, approver and separate auditor). Existing production customer sending is OFF.
- On 2026-10-11, one explicitly authorized real Resend test email was sent to an owner-controlled mailbox. Two **genuine** `email.sent`/`email.delivered` signed events were received and verified at a **disposable independent HTTPS receiver**, after correcting an initial syntax defect. Both events received HTTP 204 on replay. This does NOT prove live MUSITU Mail Fabric durable outbox-to-webhook reconciliation or inbox placement. [Source evidence](2026-10-11-genuine-resend-standalone-receiver-proof.md).
- Original temporary Resend webhook was disabled and receiver alias switched to a non-functional 410 handler. Neither historical Vercel deployments nor the webhook resource has been claimed deleted. Do NOT reuse the temporary receiver as a permanent public ingress.

## Phase-1 go/no-go gates (read-only)

`node src/commercial/check-cli.mjs docs/2026-10-11-phase1-evidence-snapshot.json` returns exit code **2** because release is blocked. A zero exit can only indicate manual **review eligibility**, NOT authority to enable sending. Every missing gate requires separate, genuine and inspectable independent evidence. The `status=verified` entries are asserted by an operator; this code **cannot independently validate their truth**.

**Paid preparation contract** requires a documented, reviewed legal ability to contract (sole trader vs entity), tax/invoice treatment, signed customer scope, and actually owned payment collection method. No customer funds should be requested or accepted before these controls are satisfied.

**Live email-delivery pilot** additionally requires written provider reselling/agency permissibility and Acceptable Use compliance, applicable data controller/processor obligations and cross-border consent, third-party assessment of the actual deployment, managed encryption and signing keys with recoverable backup exercise, sender-domain DNS authorization, one controlled real provider result durably reconciled inside MMF with signed event and sender/recipient correlation, bounce/complaint suppressions proven without invented negative provider events, registered production webhook with safe replay, tenant-specific customer contract and consent, per-tenant monitoring/incident response, two separate approved time-limited release signatures plus independently signed qualification, and manual go/no-go. **Do not copy test private keys or signed synthetic qualification fixtures into production.**

## Minimal viable paid offer, provisional and negotiable

**Offer A: MUSITU Verified Communications Readiness** — suggested USD $99 one-time project fee. Scope: one defined organization's notification inventory (up to 3 transactional flows), DNS/sender readiness recommendations, delivery and risk-policy design, integration specification, non-production demonstration of signed evidence, and handover report. No promises of inbox placement, security certification or live customer sending; no real-message processing unless separately approved.

**Offer B: MUSITU Controlled Delivery Pilot** — *indicative only*, setup fee negotiable, and subsequent operating fee USD $49/month for an initial cap negotiated with a customer after the release gates close. Resend pass-through usage, support terms, service credits, statutory taxes and scope must be separately agreed in writing. **Do not sell Offer B as available now**, charge recurring amounts without a functional billing/settlement rail, or imply it includes guaranteed delivery/inbox placement.

These are starting price **proposals**, not tested market prices or published commitments. Customer contracts and lawful invoice issuer must be determined before any quote is sent as binding.

## Reuse the existing MUSITU Paynow integration — no new merchant registration

The earlier statement that Paynow merchant registration was not done **was incorrect**. MUSITU's existing Paynow integration (merchant integration ID **26343**, keep any secret key private) has already been used through its Phase-8 payment authority `mft-phase8-external-authority`, shared transport `mft-paynow-transport-gateway`, and product-specific FMI billing `mft-fmi-billing`. The historical FMI test proved provider checkout initiation; a separate 2026-09-13 AXIOM real-money E2E certificate records a settled USD $19 payment and one exact entitlement. These are historical evidence, **not today's live merchant audit or proof that MMF can collect money now**. We are reusing that established checkout architecture, not opening an additional Paynow account or copying merchant credentials into Mail Fabric. See `docs/2026-10-11-existing-paynow-authority-reuse.md`.

FMI's `FOUNDING` (USD 49) and `PRO` (USD 149) subscriptions are **FMI-only**; a paid FMI subscription cannot pay for MMF. Likewise Chemistry's existing endpoint is Chemistry-only. MUSITU Mail Fabric must have an independently authorized product quote, exact business invoice, its **own** order/contract identifiers and an isolated settlement/entitlement state, while reusing only the existing shared merchant/payment authority and transport. Never redirect customers to an unrelated FMI or Chemistry checkout.

The proposed USD $99 one-time assessment remains **a proposal**, not a permitted charge. The isolated `src/commercial/fmi-paynow-reuse.mjs` now defines the MMF-only quote, official Paynow URL allowlist and strict, pinned-issuer signed receipt validation contract. It **cannot initiate money or mark a business-ready payment route operational**. A real MMF-specific authority-binding route, legal/tax/contract approvals, provider confirmation and live negative tests must exist before a checkout can be offered. The checkout must remain unavailable in the public product until those gates pass. Pending/cancelled/created statuses never become paid; Paynow verification must originate from the trusted server-side payment authority, not user-provided query parameters.

## Commercial/legal reviews

- Confirm lawful business contracting and invoice identity, tax treatment and customer agreement under applicable Zimbabwe law. If customer data is involved, establish controller/processor roles and whether data controller licensing and cross-border notification/licensing requirements apply. [POTRAZ S.I. 155 of 2024](https://www.potraz.gov.zw/wp-content/uploads/2025/02/sI-155-of-2024-Cyber-and-Data-Protection-Normal_240913_1250178.pdf).
- Resend's current AUP prohibits unsolicited marketing, requires explicit opt-in and enforces complaint/bounce thresholds; confirm the intended operated-service/agency commercial use is allowed rather than assuming software resale rights from an integration key. [AUP](https://resend.com/legal/acceptable-use); [terms](https://resend.com/legal/terms-of-service).
- A third-party security assessment and disaster recovery rehearsal are still missing for real production. Do not present synthetic evidence, local CI, standalone webhook test or owner-only sign-offs as an independent certification.

## Zero-cost execution order, with externally owned steps distinguished

**MUSITU engineering (safe in isolation):** maintain immutable independent evidence test, continue real MMF durable outbox/feedback integration in new disposable resources, expand incident/recovery exercises, keep customer API OFF, produce bounded monitoring and quotas. **Business owner:** confirm the existing approved merchant/payee identity and settlement account without registering again, complete a product-specific MMF payment authority binding, obtain legal/tax and Resend agency review, identify exactly one consenting prospect and agree pilot scope, and nominate independent release and independent security reviewer. **External independent reviewers:** conduct security/recovery/legality assessments and sign scoped approvals. **Only after all these:** create a production-scoped webhook (not the disabled test webhook), provision fresh protected infrastructure, grant bounded production approval, and conduct a precisely observed low-volume pilot.

## Success evidence metrics — all currently unknown for commercial customers

- Number of named consenting pilots, signed contracts, collected revenue and net contribution margin.
- Verified provider accepted/delivered/bounced counts with provider ID and receipt linkage, not inbox-placement assertions.
- Human-supported incident response, queue age, ambiguous outcomes and complaint/bounce safety metrics.
- Independent security assessment report, current keys backup restore evidence, expiring grant & revocation observations.

**No signed customer contract, money collected, commercial launch, public MMF ingress or live customer send is claimed by this document.**

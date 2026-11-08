# MUSITU WhatsApp AI SaaS — Two-Phase Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking. One testable work package is one review gate; do not infer commercial release from a passing local test.

**Goal:** Deliver a genuinely integrated business-specific WhatsApp SaaS incorporating all 20 differentiating capabilities, verified tenant isolation, and authorized commercial infrastructure, without altering protected or independent MUSITU systems.

**Architecture:** One new isolated SaaS owns tenant membership, canonical message/event history, booking/order/inventory ledgers, source documents, consents, costs and UI. Official Meta Cloud API is the WhatsApp transport, PostgreSQL is the system of record, a typed deterministic executor authorizes consequential actions, an interchangeable model gateway handles conversation, and narrow interfaces expose only qualified AXIOM analytics and separately approved MAIL FABRIC notifications. Chatwoot CE may be a replaceable human-inbox sidecar; no unrestricted general-purpose AI service is offered over WhatsApp.

**Tech Stack:** Next.js/React/TypeScript, Fastify/TypeScript, PostgreSQL + pgvector, pg-boss, Keycloak for production OIDC (or separately qualified authorized identity provider), React Flow for workflow editing, Meta Cloud API, optional Chatwoot CE, OpenTelemetry/Prometheus, Coolify/container staging, tested AXIOM quantitative API and separately authorized MAIL FABRIC email APIs. Optional document/voice providers require separate vendor/model licenses and quality evidence.

## Global Constraints and Source Authority

- Existing MUSITU source remains separate. AXIOM source handoff verified from 2026-10-12 archive; prior observed AXIOM public-inference branch `61b927776cb68d5f79eeb8be9bdd3bcd2309c8ee`; FA20 `21d087f0fdebffd4cfb4065286aa16696fcec9c0` (failed independent release jobs). MMF audited source `6e5c3097e2ef6a18dfabe9295faaf14d43ff07c7`, 442 pass / 0 fail / 1 skip on local source. Refresh source heads before any GitHub write; the source `main` and historic PRs must not be reset, merged or modified for this project.
- No cloud account mutations, genuine customer messages, money movement, mail delivery, public signup, or paid infrastructure until the relevant separately approved release conditions are evidenced. Pre-existing MUSITU projects have a USD 0 budget. Do not borrow their payment credentials, sender authority, user entitlements, databases or model tokens.
- NEVER deploy unofficial WhatsApp-Web/QR-session gateways as the production channel, never enable unrestricted AI on WhatsApp as the primary product, never use WhatsApp message data for prohibited cross-customer model training, and never assume marketing consent from inbound messages.
- No LLM can execute a booking, product reservation, discount, customer follow-up, or payment. It proposes a typed action; server-side authoritative policy and a database transaction decide. Model text never constitutes payment/booking authorization.
- Source availability is not production proof. Every feature has one status: `SPECIFIED`, `LOCALLY_TESTED`, `INTEGRATED_IN_PRIVATE_STAGE`, `PROVIDER_QUALIFIED`, `CONSENTED_PILOT`, `RELEASED`. Production marketing claims use only the last two states, with scope disclosed.
- The test harness in this deliverable is a **local security seed**: it has no persistent database, no Next.js UI, no Meta network calls, no real LLM, no payment gateway, and no customer service. It is not the completed Phase 1.

## Timeline and Acceptance Philosophy

**Two phases, not two promises.** A 72-hour internal engineering sprint is an *aspiration* only when prerequisite access, team capacity, credentials, license approvals and infrastructure are already available. Proposed allocation: Phase 1 approximately hours 0–36; Phase 2 approximately hours 36–72 for integration candidates. Provider App Review, independent security/legal review, monitored customer pilot and any external approvals happen when complete, even if later than hour 72. Neither phase is declared done simply because every menu item renders.

**Mandatory independent evidence:** source SHA + dependency lock + license inventory + reproducible tests + deploy environment inventory + test output + failure ledger + release-signoff + incident rollback. Tests that use a synthetic Meta webhook must say `SIMULATED`, not `DELIVERED`.

---

# PHASE 1 — Secure Platform and One End-to-End Revenue Workflow

**Business result:** A salon/barbershop/appointment business can privately sign in, configure information, verify a controlled WhatsApp development number, receive authenticated test customer inquiries, produce grounded answers, check actual staff availability, make bookings without double-booking, escalate to a real employee, and see source-grounded metrics. AXIOM and MAIL FABRIC are integrated only at independently authorized interfaces. Real payment capture and unrestricted customer sending remain off until separately qualified.

**Phase 1 feature scope:** #2 (basic intention-to-workflow builder), #4 (verified end-to-end actions), #9 (booking), #11 (verified analytics), #14 (cost enforcement), #15 (accuracy/safety), #16 (simulation), #18 (human handover). These eight are required to pass in the private stage; descriptions of 12 remaining features stay `SPECIFIED` until Phase 2.

### P1.1 — Reproducible, isolated source and security baseline

**Proposed files:** `docs/source-lock.json`, `docs/licenses.md`, `apps/api/src/security/release-policy.ts`, `apps/api/test/release-policy.spec.ts`, `.github/workflows/ci.yml`, `pnpm-lock.yaml`.

**Consumes:** independently refreshed source SHAs and explicit signed environment approvals.
**Produces:** `assertReleased(action: 'META_SEND'|'PAYMENT_CAPTURE'|'MAIL_SEND'|'PUBLIC_SIGNUP', tenantId: string): void`; private-stage config and immutable evidence registry.

- [ ] First write failing tests proving all four external actions are denied with missing, malformed, conflicting or absent approval; unknown action names must be denied.
- [ ] Introduce source/dependency pins and a separate new repo. Never alter existing AXIOM/MMF branches or production configurations.
- [ ] Require exact environment-scoped release grants verified against a pinned trusted public key, not environment flags controlled by the same untrusted process. Real grants are a separately governed step.
- [ ] Run unit tests, `pnpm lint`, `pnpm typecheck`, secret scanning, dependency/license inventory. A missing credential means a clear NOT_TESTED_PROVIDER verdict.
- [ ] Deliver: source-locked, nonpublic, reproducible build with a signed-off risk register, not a public endpoint.

### P1.2 — Multi-tenant identity, WABA binding and relational guarantees

**Proposed files:** `db/migrations/001_tenant_core.sql`, `apps/api/src/auth/oidc.ts`, `apps/api/src/tenancy/context.ts`, `apps/api/test/tenant-isolation.integration.spec.ts`.

**Consumes:** actual validated OIDC `iss`, `aud`, JWK signature, expiry and membership; provider WABA ID and business phone ID.
**Produces:** `requireTenantActor(subject, tenantId, role)`, `resolveVerifiedPhone(wabaId, phoneId)`, database tenant-scoped transaction boundary.

- [ ] Fail initial two-tenant cross-read/cross-write/unauthorized-member/owner-role tests before building authorization.
- [ ] Use PostgreSQL RLS (`ENABLE`/`FORCE`), non-owner runtime DB role, explicit tenant transaction context, composite tenant+phone foreign keys, scoped credential references and revocation on every action.
- [ ] Explicitly prevent one business from binding another's phone, reading another's vectors or changing another's human-inbox mode; account for connection-pool tenant-context leakage.
- [ ] On a genuine disposable Postgres instance, create tenants A/B, verify all rejected accesses and `UNIQUE` behavior; repeat with pooled connections and concurrent requests. No database integration result may be claimed if Postgres was not actually executed.
- [ ] Deliver: sign-in + profile + scoped staff roles + verified test WABA mapping.

### P1.3 — Official Meta ingress, consent and canonical message ledger

**Proposed files:** `apps/api/src/channels/meta/webhook.ts`, `apps/api/src/channels/meta/mapping.ts`, `apps/api/src/channels/meta/outbound-policy.ts`, `apps/api/test/meta-webhook.integration.spec.ts`.

**Consumes:** original raw POST bytes, Meta `X-Hub-Signature-256`, subscribed event IDs and WABA/phone mapping.
**Produces:** `verifyAndIngestMetaWebhook(raw, signature): IngestReceipt`, `planOutbound(tenant, message): PolicyDecision`.

- [ ] First demonstrate rejection of forged/malformed/tampered HMAC; valid signature with mismatched WABA, wrong phone ID, replayed provider ID and suspended tenant must fail without side effects.
- [ ] Write all inbound/message-status events into canonical Postgres ledger with unique provider keys, timestamp ordering, raw payload retention limited by approved policy, and explicit unknown/undelivered state.
- [ ] Gate outbound messages on approved service window, templates, business messaging opt-in, opt-out, tenant daily spend cap and recipient eligibility. Unknown send acceptance must not be automatically retried as a new send.
- [ ] If and only if approved Meta development credentials exist: prove actual signed inbound and send/status callback against a consenting test device. Otherwise record `PROVIDER_QUALIFIED=FALSE` and keep channel in simulator mode.
- [ ] Deliver: real supported channel adapter with verified local unit tests, not merely a webhook mock.

### P1.4 — Human control and one working service vertical

**Proposed files:** `apps/api/src/conversations/ledger.ts`, `apps/api/src/conversations/handover.ts`, `apps/api/src/bookings/reserve.ts`, `apps/api/test/booking-concurrency.integration.spec.ts`, `apps/web/app/inbox/page.tsx`.

**Consumes:** verified inbound message, current tenant/actor, confirmed resource availability and desired timeslot.
**Produces:** `requestHandover(tenantId, conversationId): HandoverReceipt`, `reserveAppointment(tenantId, resourceId, interval, effectKey): BookingReceipt`.

- [ ] Red tests: 10 simultaneous requests for one salon timeslot yield exactly one confirmed booking; retries with identical effect key return the original booking; an overlapping different-start booking conflicts; other tenants' inventory/appointments remain unseen.
- [ ] Implement transactional bookings with Postgres exclusion constraints. Cancellation/refund/modified-slot operations must be idempotent and audited.
- [ ] Chatwoot CE is a private optional API-channel adapter only if per-business inbox staff isolation and WhatsApp outbound policy reentry are proven. Otherwise the built-in minimal inbox is the Phase 1 solution.
- [ ] Once mode is HUMAN, queued bot sends for that conversation are cancelled/fenced. Human replies route through Meta policy gate, not directly to provider credentials.
- [ ] Deliver: a complete inbound→knowledge→booking→human escalation→dashboard vertical slice.

### P1.5 — Grounded model gateway and AXIOM quantitative adapter

**Proposed files:** `apps/api/src/ai/gateway.ts`, `apps/api/src/ai/retrieval.ts`, `apps/api/src/ai/action-schema.ts`, `apps/api/src/adapters/axiom.ts`, `apps/api/test/model-safety.spec.ts`.

**Consumes:** tenant-scoped approved knowledge passages and redacted customer query, bounded LLM response and exact allowlisted AXIOM operation.
**Produces:** `proposeAction(context): ActionProposal`, `evaluateAuthorizedAction(proposal): Decision`, `calculateBusinessMetric(request): VerifiedCalculation`.

- [ ] Red tests: model proposes an unsupported price, invalid staff ID, forged paid status, malicious injected “ignore policy” text or another tenant's knowledge; the engine must never execute an action from that output.
- [ ] Use hybrid lexical+pgvector search with tenant mandatory filters, document version, effective dates and source citation. Missing/stale business facts trigger staff handover, not hallucinated confirmation.
- [ ] AXIOM adapter permits only the separately verified 74 atomic quantitative operation registry subset relevant to product metrics; no raw customer message or phone/email sent without separate lawful basis and approval.
- [ ] Model-agnostic gateway supports a tested mock provider in local CI and a separately selected/contracted provider in private deployment; record real model ID, latency, tokens, redaction and per-conversation cost.
- [ ] Deliver: safely grounded customer support and quantitative insight, with every outbound action still governed.

### P1.6 — Business dashboard, cost ledger and private deployment

**Proposed files:** `apps/web/app/dashboard/page.tsx`, `apps/api/src/analytics/ledger.ts`, `apps/api/src/usage/quotas.ts`, `apps/api/src/adapters/mail-fabric.ts`, `ops/staging-compose.yaml`, `apps/api/test/revenue-truth.spec.ts`.

**Consumes:** actual confirmed booking/order records, verified provider statuses, Meta/AI rate tables and per-tenant budgets.
**Produces:** business-event metrics, spend reports, forecast-ready AXIOM aggregation requests, private deployment acceptance bundle.

- [ ] Red tests: no paid revenue from a message sent/accepted event; delivery cost is `UNVERIFIED` without an actual rate card; spend cap rejects messages before provider submission; duplicate status does not double count.
- [ ] Display grounded metrics: inquiries, verified bookings, human takeover, messages by status and estimated operating cost clearly labeled. Stage email adapter returns `MAIL_FABRIC_NOT_RELEASED` until separate authority is verified.
- [ ] Install approved pinned stack in isolated private container environment; exercise backups/restores, queue replay, tenant lockout, service outage and rollback. Never touch AXIOM/MMF production release routes.
- [ ] Deliver: private demonstration plus signed evidence pack and reproducible tests.

## PHASE 1 EXIT GATE — GO / NO-GO

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` exit 0 on pinned versions; generated CI provenance archived.
- [ ] Disposable Postgres integration verifies RLS under non-owner role, unique phone binding, no double booking under concurrent clients, restart recovery and idempotent ingress/outbound attempts.
- [ ] Meta valid/invalid raw signature, WABA ownership, consent, 24h/template boundary and unknown send outcomes tested; external provider proof only if approved test credentials exist.
- [ ] In a two-business scenario, one cannot read, modify, search or message the other business's data, knowledge or inbox.
- [ ] Agent handover fences bot; malicious model/tool outputs produce denial with zero writes; every business action has a separate authoritative receipt.
- [ ] AXIOM analytics are invoked only through a reviewed tenant-safe allowlist. Mail Fabric/Paynow/provider flags retain their existing release restrictions.
- [ ] Zero unresolved critical/high defects; no leaked secrets; documented restoration and deployment rollback with source pinning.

**Decision:** If any gate fails, Phase 1 stays open and Phase 2 feature development may proceed only in isolated branches without presenting Phase 1 as finished or exposing customers.

---

# PHASE 2 — All 20 Features, Enterprise Operations and Qualified Commercial Release

**Business result:** Complete the remaining 12 major product features, harden and connect the first eight into an integrated customer experience, qualify actual WhatsApp/voice/payments where authorized, then run consenting merchant pilots and commercial release gates. "Every feature connected" means a complete source→action→event→analytics test, not a clickable dashboard card.

**Phase 2 feature scope:** #1 photo onboarding; #3 multilingual voice; #5 verified payments; #6 inventory; #7 compliant lead follow-ups; #8 owner-bounded negotiation; #10 CRM memory; #12 growth advisor; #13 marketing experiments; #17 teaching AI by conversation; #19 franchise/branches; #20 public connector ecosystem. All 20 features must retain and pass Phase 1 guarantees.

### P2.1 — Self-service AI employee creation and controlled teaching (#1, #17, expand #2)

**Proposed files:** `apps/api/src/onboarding/catalogue.ts`, `apps/api/src/onboarding/vision.ts`, `apps/api/src/agents/config-proposals.ts`, `apps/web/app/assistants/create/page.tsx`, `apps/api/test/onboarding-approval.spec.ts`.

**Interface:** `proposeAgentConfig(tenant, files, ownerIntent) -> ProposedConfig`; `approveAgentConfig(tenant, draftHash, authorizedOwner) -> ConfigVersion`.

- [ ] Fail tests for OCR/product price mismatches, hidden instructions in uploaded menus, stale owner rules, owner/tenant mismatch, blind price changes and one business seeing another's files.
- [ ] Parse uploads using vetted file-type checks, bounded size and sandboxed document/vision workers (Docling/PaddleOCR where licensed). Require owner visual review before catalogue activation.
- [ ] Generate versioned workflow diagrams with React Flow; conversation-based updates create a draft diff, test preview and explicit owner approval, never automatic live configuration changes.
- [ ] Certify rollback to previous approved configuration and per-branch rule versioning.

### P2.2 — Multilingual conversations, audio and local-language quality (#3)

**Proposed files:** `apps/api/src/media/ingest.ts`, `apps/api/src/languages/transcribe.ts`, `apps/api/src/languages/evaluate.ts`, `apps/api/test/voice-language.spec.ts`.

**Interface:** `transcribeConsentedVoice(tenant, mediaRef, languageHint) -> {text, confidence, source, provider}`.

- [ ] Verify real Meta media authorization, retention/deletion, malicious audio/document content, and no cross-tenant media URL access.
- [ ] Evaluate on a consented native-speaker corpus for Shona, Ndebele, Swahili and any other advertised languages; mixed accents/code switching must be in the test set. Publish measured WER, intent accuracy, rate and latency per language before offering that language.
- [ ] When confidence is low, ask clarifying question or route to staff rather than inventing transcription; actual speech-to-text/provider use is separately approved.

### P2.3 — Inventory, orders, safe discounts and payments (#5, #6, #8)

**Proposed files:** `apps/api/src/inventory/ledger.ts`, `apps/api/src/orders/commands.ts`, `apps/api/src/pricing/policy.ts`, `apps/api/src/payments/provider.ts`, `apps/api/test/order-payment-concurrency.integration.spec.ts`.

**Interface:** `reserveStock(tenant,sku,count,effectKey) -> StockReceipt`; `quoteDiscount(tenant,product,amount) -> GuardedQuote`; `confirmPayment(verifiedProviderEvent) -> PaymentReceipt`.

- [ ] Prove concurrent last-item race yields one reservation, inventory reconciliation under external POS drift and stale prices refusing confirmation.
- [ ] Discount requests above owner-approved maximum or below product price floor always fail, regardless of AI prompt contents.
- [ ] Approved provider integration validates exact merchant, currency, amount, order, tenant, signed callback, independent server-side status and reconciliation; `accepted` is never treated as bank-settled.
- [ ] Chargeback, refund, disputed, cancelled, pending and timeout states do not grant/revive a paid entitlement. Real Paynow is OFF until MMF/MUSITU independent approval confirms specific merchant/product authority and safe rollback.

### P2.4 — Consented CRM, lead recovery and marketing experiments (#7, #10, #13)

**Proposed files:** `apps/api/src/consent/registry.ts`, `apps/api/src/marketing/followup.ts`, `apps/api/src/marketing/experiment.ts`, `apps/api/test/consent-campaign.spec.ts`.

**Interface:** `scheduleFollowup(tenant,contact,template,proof) -> JobReceipt`; `registerOptOut(tenant,contact) -> OptOutReceipt`; `calculateCampaignLift(experimentId) -> EvidenceBasedResult`.

- [ ] Delayed job rechecks opt-in, approved template, window, spend cap, tenant and suppression immediately before sending. Revocation cancels all later automated marketing sends.
- [ ] Memory requires permitted customer relationship data, retention schedule, export and erasure. No contact data or embeddings from one tenant may train another business's assistant.
- [ ] Marketing experiments use explicit opt-in, approval, exposure/event ledger and appropriate metric attribution; cannot claim causality without suitable design.

### P2.5 — Business advisor, multi-branch operations and deeper analytics (#12, #19)

**Proposed files:** `apps/api/src/analytics/advisor.ts`, `apps/api/src/branches/authorization.ts`, `apps/api/src/branches/routing.ts`, `apps/api/test/branch-advisor.spec.ts`.

**Interface:** `recommendBusinessAction(tenant, period) -> SourcedRecommendation`; `routeToBranch(tenant,sku,customerLocation) -> AvailableBranchResult`.

- [ ] Enforce branch-level stock, opening hours, staff, permitted discounts and shared-customer privacy. Wrong branch or low-confidence inventory yields no guarantee.
- [ ] Business recommendations cite actual records and assumptions, distinguish trends from measured uplift, and use AXIOM only through reviewed quantitative endpoints.
- [ ] Audit every branch override, delegated staff action and cross-branch visibility grant.

### P2.6 — Controlled integration ecosystem (#20)

**Proposed files:** `packages/connector-sdk/src/contracts.ts`, `apps/api/src/connectors/registry.ts`, `apps/api/src/connectors/permissions.ts`, `apps/api/test/connector-security.spec.ts`.

**Interface:** `installApprovedConnector(tenant, manifest, scopes) -> ConnectorGrant`; `invokeConnector(tenant, grant, action) -> AuditedResult`.

- [ ] Reject unsigned or unapproved connector manifests, changed scopes, unbounded network destinations, SSRF, secrets in logs and cross-tenant resource names.
- [ ] Token rotation, revocation, quota, callback verification, schema versioning and restore tested; install is opt-in per tenant and business action still flows through the policy engine.
- [ ] Document public SDK only after platform security controls and independently reviewed default manifests pass.

### P2.7 — Provider qualification, UX integration and operational hardening (all 20)

**Proposed files:** `apps/web/tests/complete-business-journey.spec.ts`, `apps/api/test/chaos-regression.spec.ts`, `ops/observability/alerts.yaml`, `docs/feature-evidence-register.md`, `ops/restore-drill.md`.

**Interface:** full customer→Meta→tenant→retrieval/LLM→policy→business action→notification→analytics journey with evidence IDs and explicit permitted charge state.

- [ ] 20 feature-specific acceptance suites each include successful path, malformed input, tenant collision, duplicate/replay, provider timeout, permission/consent denial, PII review and business rollback where state-changing.
- [ ] Load/p95 throughput, cost per successful conversation, restore/RPO/RTO, no stale queue send after opt-out, privacy deletion, abuse/fraud and human support workflows tested.
- [ ] Compare chosen AI models and AXIOM-supported quantitative computations against reproducible baselines without unsupported superiority claims.
- [ ] Deployed source/version/secret scopes and all 3rd-party licenses re-audited. Real Meta, payment and provider events never replaced with fixture evidence.

### P2.8 — Consented pilot, billing/merchant release and public launch decision

**Proposed files:** `docs/release/approval-record.md`, `docs/release/merchant-terms.md`, `docs/release/compliance-review.md`, `docs/release/customer-evidence.md`, `docs/release/go-no-go.md`.

**Interface:** formal feature and product release approvals matching exact commit, deployed service IDs, jurisdiction, billable product, provider permissions and rollback.

- [ ] First opt-in pilot using actual business account, actual support staff, business contract and verified messaging budget; distinct delivery states and payment state receipts.
- [ ] Independent review: Meta partner/business AI policies and current October 2026 charges, local privacy/tax requirements, customer contracts, permitted sender/merchant scopes, external penetration tests and cloud secret management.
- [ ] Verify per-tenant costs and configurable quotas before offering $19/$59/$149/etc. The earlier prices are hypothetical, not approved rates.
- [ ] Public signup and paid traffic stay OFF until required approvals, owner and independent gates are met. Explicit stop/rollback if security, payments, message compliance, availability or data deletion fails.

## PHASE 2 EXIT GATE — FULL PRODUCT ACCEPTANCE

All items below must be evidenced at the correct assurance level; a marketing feature card is not evidence.

- [ ] All 20 features listed below are present, genuinely connected, independently tested and assigned an evidence status. Capabilities blocked by external provider authority must be labeled unqualified, which prevents a claim of a fully complete live product.
- [ ] No known critical/high security defects, tested tenant isolation across messages/knowledge/media/actions/branches, reproducible backup and incident rollback, signed/verifiable webhook handling, human handover and complaints.
- [ ] The official WhatsApp provider test has authentic signed events, outcome-status evidence and billable message accounting; marketing consent and template checks pass against provider requirements.
- [ ] Payments are controlled through an explicitly approved merchant product, callback signature verification, independent reconciliation and dispute/reversal state machine; real charges occur only with explicit payer approval.
- [ ] All externally integrated languages, OCR, LLMs, Meta onboarding and delivery operations have measured quality/latency/cost and correct legal licensing.
- [ ] Company has documented support/on-call, privacy controls, contracts and refund mechanism, regional tax treatment, and product/customer offboarding. Public launch is approved against exact running versions.

## All 20 Features Assigned Exactly Once (Implementation Coverage)

| # | Feature | Build phase | Primary acceptance |
|---|---|---|---|
| 1 | Create AI employee from business photos | 2 | Owner approves corrected catalogue and price extraction |
| 2 | Describe workflow in plain language | 1 basic; 2 visual refinement | Validated versioned workflow, preview and approval |
| 3 | African languages, mixed-language audio | 2 | Native-speaker accuracy benchmarks and secure media handling |
| 4 | Complete approved business actions | 1 | Idempotent, server-authorized business transaction |
| 5 | Local/global payments | 2 | Verified live merchant permission, signature and settlement reconciliation |
| 6 | Real-time inventory | 2 | Accurate POS sync, stock reservation, stale-data refusal |
| 7 | AI sales recovery | 2 | Consent + approved template + opt-out honored at execution |
| 8 | Negotiation within firm rules | 2 | Server-side discount floor is never violated |
| 9 | Appointments and reminders | 1 bookings; 2 provider reminders | No double booking; consented reminders |
| 10 | Customer relationship memory | 2 | Consent, tenant isolation, deletion/retention |
| 11 | Revenue intelligence | 1 basic; 2 settlement-grade | Verified transactions only, attributable sources |
| 12 | Growth advisor | 2 | Cited observed evidence and bounded recommendations |
| 13 | Marketing experimentation | 2 | Consenting sample, valid assignment and measured outcomes |
| 14 | Cost optimization | 1 | Real quotas/caps, usage metering and uncertain-rate labeling |
| 15 | AI accuracy and safety | 1, hardened 2 | Source-grounded answers, denial on unknowns and injection |
| 16 | Simulate/test AI employee | 1, hardened 2 | Reproducible replay with attack/failure corpus |
| 17 | Update AI by talking | 2 | Draft diff, approvals, version rollback |
| 18 | Intelligent human handover | 1 | Bot stops; staff gets context; isolation verified |
| 19 | Franchise/multi-branch operation | 2 | Correct branch stock, staff limits and policy isolation |
| 20 | Open connector ecosystem | 2 | Reviewed signed manifests, scoped token/revocation and sandbox |

## Decisions that Change Externally Observable Behavior

1. Launch vertical: **recommendation** appointment-based services first. Restaurant/retail requires stock/payments and raises Phase 1 scope materially.
2. Target geography and legal company: **recommendation** Zimbabwe initial pilots, but data/privacy, merchant and Meta jurisdiction must be independently reviewed.
3. Meta: direct provider Cloud API versus approved BSP; Embedded Signup depends on partner qualifications. **Recommendation** start with official development WABA manual test, then approved onboarding flow.
4. Identity: self-hosted Keycloak versus externally hosted OIDC. **Recommendation** Keycloak if hosting/operations are qualified, otherwise select a reviewed OIDC service with the same claims contract.
5. Conversational model: select only after quality, data rights, cost, English/regional language test and production provider access qualification. **Recommendation** use provider-independent gateway, not a preselected model.
6. Initial hosting budget and secrets/ops owner: cannot activate paid systems without an explicit amount and delegated scope. **Recommendation** maintain zero-remote-spend until allocation is documented.
7. Payments: region/provider, merchant settlement account, refunds, paid entitlements and real billing model require separate approval. **Recommendation** Phase 1 displays no actual paid revenue unless verified by a lawful source.
8. Inbox: retain Chatwoot CE only if isolation, WhatsApp policy gate and supported self-hosted topology are confirmed; otherwise use owned minimal agent inbox.
9. Product positioning: business automation with AI, **not** general-purpose AI assistant over WhatsApp; obtain Meta compliance assessment before commercial launch.
10. Final performance and pricing thresholds: agree with signed launch test plan based on measured workloads; do not silently classify targets as achieved.

## Evidence and Current Actual Delivery Status (12 October 2026)

- Earlier AXIOM/MMF audit: available locally in `/mnt/data/MUSITU_AXIOM_MAIL_FABRIC_AUDIT_2026-10-12.md`; mature infrastructure analysis: `/mnt/data/MUSITU_OPEN_INFRASTRUCTURE_DEEP_AUDIT_2026-10-12.md`.
- New isolated local seed in `musitu-whatsapp-two-phase/`: authenticated Meta raw HMAC check, WABA/phone routing, two-tenant local inbox/inbound deduplication, human takeover and hard-disabled external action policy. It is **only a small unit-tested core**, not Next.js/Fastify/PostgreSQL/Meta provider integration.
- Postgres migration sketch `db/001_private_tenant_core.sql` has NOT been executed against a real PostgreSQL server and must not be represented as schema-qualified.
- No new GitHub repository was pushed; no customer messages, payments, production emails, Cloudflare/Meta mutations or spending occurred.
- Phase 1 is **IN PROGRESS / NOT COMPLETE**. Phase 2 is **NOT STARTED**. Production release is **NOT AUTHORIZED**.

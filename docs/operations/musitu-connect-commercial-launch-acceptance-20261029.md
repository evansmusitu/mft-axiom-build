# MUSITU Connect / Axiom — commercial GA external acceptance and controlled launch

**29 October 2026 — STATUS: NO-GO.** This is an operator acceptance packet, **not**
an independent security assessment, merchant certificate, legal signature,
support-service contract, production deployment instruction or approval.
The authoritative release register remains
`qualification/musitu_connect_commercial_ga_release.json`.
`commercial_ga_enabled=false` and `new_customer_registration_open=false`.
All **13 controls are NOT_DEMONSTRATED**; the existence of code, a CI run, an
owner's engineering instruction, a payment made for a different product or
a synthetic test does not change the controlling evidence status.
The predictive methane model remains
`RESEARCH_ONLY_UNTIL_INDEPENDENT_FIELD_QUALIFICATION`.

## 1. Independent evidence custody and reviewer roles

Before marking any control `QUALIFIED`, the **independent verifier** must have
direct access to the authenticated source system, a dated test/run ID, exact
resource and source-commit identity, result and negative-case logs, and a
private SHA-256 evidence digest. Do not publish raw API tokens, merchant keys,
customer IDs, payment references, personal data or production secrets.
Evidence references are documentary pointers; they are not authority by
themselves. Independent reviewer approval must identify the reviewer,
organization, role, UTC timestamp, control, outcome, finding disposition,
residual risk and signed acceptance in a separately controlled repository.
Do not use `example.invalid`, synthetic test fixtures or an assistant's
assertion as external proof.

Separate accountable humans must confirm Finance, Production Operations,
Security and Legal/Privacy requirements; a source-code author or AI agent
cannot self-approve those independent controls. Production release requires a
distinct release approver with separately held
`MUSITU_GA_RELEASE_APPROVAL_KEY`, after verification of original source
evidence. The key is never put in routine CI or repository files.

## 2. Provider-backed test sequence — staged before any customer access

Only use **real authorized test accounts** in a distinctly isolated,
non-production environment and documented test merchant integration.
Do not reuse the existing production Axiom account, another MUSITU product's
merchant integration, any real mine measurements or live customer credentials.
The infrastructure owner first proves account isolation and D1 token-scope
directly in Cloudflare's control plane; the read-only D1 probe cannot prove
either claim, because successful SQL queries also work with broader write
tokens. Begin with the manual staging identity/schema and zero-row observation.
Then have authorized operators conduct separate controlled transactional
staging tests with disposable synthetic tenant records, followed by
verified cleanup and recovery. Record provider-side results, not only mocks.

### Commercial payment reconciliation, invoicing and refunds

Paynow test-mode, with merchant-authorized credentials, can simulate payment
without moving funds. The merchant must establish a **Connect-specific**
integration and its sandbox status; an MFT/Axiom production merchant approval
does not certify a Connect billing product. Merchant operators must perform and
record successful payment, delayed payment, cancellation, failed payment,
duplicate callback, replayed signed callback, wrong amount/currency,
out-of-order status, merchant-side polling, expiry, retry, subscription
idempotency, upgrade/downgrade, invoicing, and refund / dispute cases.
Use no real money for these initial tests; no unfunded test account is
presented as a paying customer. Refunds must never be inferred from
`Cancelled` or `Disputed` provider states.

A finance reviewer uses the independent provider ledger from the merchant's
original system, then joins the order/checkout
intent, immutable event record, subscription/entitlement state, generated
invoice, refund and settlement records with amount/currency, fees, timestamps,
provider transaction IDs and idempotency keys. Reconcile counts and net/gross
amounts, prove all mismatches fail closed, and certify separate refund/credit
handling. Keep raw records private; publish only a digest, test matrix, and
signoff. An unpaid disposable Paynow checkout run or an Axiom-only test is
insufficient for `commercial_checkout_billing_invoicing_and_refund_reconciliation`.
Production charges or settlement are not authorized by this packet.

### Real authorized test customer lifecycle

Use at least two isolated tenants and their separately scoped synthetic
test accounts: registration by an authorized operator, identity proof,
credential issue, scoped access, rotation, expired credential, duplicate
registration, suspension, revocation, offboarding and deletion/retention
policy. Revoke during an in-flight request and test forced rollback;
check replay/duplicate request IDs, quota minute/day boundaries and
cross-region propagation. For every test check that one tenant cannot read
or charge another tenant's records. Reconcile the source event, metering
receipt, billing ledger and customer-facing support case, with production
secrets redacted. Prove disabled/expired/revoked tenants cannot access
Axiom downstream compute. Record the externally observed provider logs.

### Support, on-call and human incident response

A private authorized support inbox or ticket platform, owner, staffed service
hours, severity policy, SLA commitments, escalation and privacy-safe retention
must exist before GA. The repository's public GitHub issue guidance alone
is not a contracted, privacy-safe customer support operation. The ticket
must carry a receipt ID, UTC timestamps, tenant-safe correlation ID, triage
decision, severity, assigned operator, next response and closure evidence;
never request raw credentials in public issues.

Run an actual sandbox incident tabletop with a realistic unauthorized tenant
attempt, billing reconciliation mismatch and cloud/D1 outage. From each event
emit an external alert, capture **human acknowledgment** with timestamp and
delivery channel, escalation if unacknowledged, containment, credential
revocation, immutable incident log, restore rehearsal, measured RPO and RTO,
and a reviewer-accepted rollback test. CI-generated "alert sent" without
an independent delivery receipt and a named human acknowledgment fails the
`external_alert_delivery_and_human_acknowledgment` control.

## 3. Exact independent commercial control acceptance matrix

Each key below is a distinct release blocker; none is automatically satisfied
by passing tests for another key. Every record needs the independent reviewer
and original dated proof described above.

- `hosted_isolated_cloudflare_d1_staging_concurrency` — isolated staging account, authenticated D1 UUID, no live data, multi-invocation write consistency, actual provider transaction traces and cleanup
- `hosted_customer_tenant_isolation_and_request_attribution` — two isolated tenants, denied cross-tenant reads and write attempts, audited correlation IDs; negative-case proof
- `hosted_idempotent_quota_rate_payload_enforcement` — unique request IDs, exact-once reservation, rate/payload ceilings and forced-retry tests over hosted D1
- `production_scoped_customer_identity_and_rotation` — scoped identity issuance and rotation/revocation with original identity-provider logs and security reviewer
- `production_registration_offboarding_and_revocation` — tested authorized signup, deactivation, in-flight denial, deletion/retention and verified absence of lingering access
- `commercial_checkout_billing_invoicing_and_refund_reconciliation` — Connect-specific merchant approval, independently reconciled provider/invoice/entitlement and refund outcomes with finance signoff
- `backup_restore_rpo_rto_and_recovery_rehearsal` — actual restore to isolated target with measured RPO and RTO, integrity and rollback evidence
- `external_alert_delivery_and_human_acknowledgment` — delivery receipts, real human acknowledgment, escalation and audit trails
- `operations_on_call_and_incident_rollback_signoff` — staffed duty roster, severity playbook, rollback practice and named operations approver
- `commercial_terms_privacy_data_processing_and_retention_signoff` — approved Connect terms, privacy notices, DPA, subprocessors, lawful processing, deletion/retention and legal counsel signature; drafts are not signatures
- `production_security_review_and_secrets_access_audit` — independent security reviewer findings including tenant auth, credentials, CI secrets, payment callback validation, vulnerability remediation, pen-test scope and access review
- `customer_support_and_service_level_readiness` — verified private support intake, customer support owner, published response commitments, ticket handling and escalation test
- `public_connect_mcp_and_domain_review` — independent OpenAI/public review, owned DNS/TLS/OAuth callback routes, MCP version and tooling contract, terms/support/privacy availability, negative authorization tests and signed publication decision

Public Axiom MCP version drift has been observed as live `4.0.2` against
a pinned `4.0.0` submission contract. Do **not** rewrite the expected
version merely to clear a check. Verify deployed Cloudflare Worker
source/build provenance, security behavior and OpenAI compatibility with
the authorized reviewer. Connection publication and payment readiness
are separate controls.

## 4. Final controlled launch — not executed

1. **NO-GO** unless each of the 13 original-provider evidence links is
   independently verified, the findings are closed or explicitly accepted by
   the responsible external reviewer, support and incident coverage is active,
   the public review is accepted and privacy/commercial documents are signed.
2. Require distinct **Finance, Security, Legal/Privacy, Operations and final
   Release Authority** signoffs on the same immutable artifact digest.
   Save each approval with UTC timestamp in private custody, never in routine
   GitHub Actions logs. Reject missing signatures, stale or mismatched evidence,
   expired access approvals and unresolved critical findings.
3. Only then use the separate signed release-record attestation;
   `qualification/validate_commercial_ga.py --audit` is non-enabling and a
   zero exit from `--enforce-ready` means only signed **documentary**
   readiness, not independently proven production safety. Independently verify
   Cloudflare account and deployment identity before acting.
4. Prepare a backup and tested rollback; record the exact staged source digest,
   Worker/D1 bindings, merchant integration, OAuth clients and domain ownership.
   On an approved change window, use authorized operator tooling to deploy the
   reviewed build and perform negative authorization and billing tests. Never
   auto-deploy from an ordinary push or PR.
5. Use a limited **non-methane** general-purpose customer canary only after all
   release gates are satisfied; capture billing, metering, tenant separation,
   support escalation and alert receipts. Halt, revoke, refund if applicable and
   rollback on any mismatch. This is controlled GA verification, not a mandatory
   pilot or beta programme.
6. Only the accountable release operator may enable customer registration,
   commercial checkout and public publication after signed final approval.
   Preserve Axiom arithmetic runtime and all existing research-only methane
   restrictions. Verify post-launch monitoring, refund reconciliation and
   on-call human coverage before a wider rollout.

**Current decision remains NO-GO.** No real charges, production customer
credentials, Cloudflare migrations, independent security findings, legal
counsel approvals, human paging acknowledgment, public domain approval or
external reviewer signatures were generated by this packet. All external
qualification work must produce independently inspectable original evidence.

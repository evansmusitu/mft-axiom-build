# AXIOM Phase 2 release — independent external evidence contract

**Status:** NO-GO (2026-11-06). This is an acceptance contract, **not** a claim that any external gate passed.

## Provenance boundary

- Canonical public GitHub product/deployment `main`: `b10a74b435feb25654d4cf67ba67d09602698a3e` at this audit.
- Unmerged draft Phase 2.10A: [PR #76](https://github.com/evansmusitu/mft-axiom-build/pull/76), head `bd8adc82daf87c38a2d90894c6b297106eccb752`.
- Unmerged stacked draft Phase 2.10B: [PR #81](https://github.com/evansmusitu/mft-axiom-build/pull/81), head `5dd65a4a659730c4506cd5f350e29af793e5263e`.
- The Phase 2.10B CI test exercises two independent PostgreSQL pools against one ephemeral test database. It does **not** verify any real deployed worker or tenant billing account.
- The separately published GitHub production admission workflow currently verifies Cloudflare/D1 product services; it does **not** demonstrate that Phase 2 provider compilation/explanation paths are wired to a common protected PostgreSQL authority.
- The isolated MUSITU AXIOM Operator Reviewer V2 reports `external_provider_execution_authority=false`, `production_authority=false` and `release_authority=false`. It cannot provide missing external attestations.

**Release rule:** all gates below require independent, current, environment-specific evidence. A code test, mock, staging simulator, screenshot of an unchecked setup, manual declaration without proof, or a reviewer artifact is not vendor, security, finance or production certification. Do not enable trading, publish customer claims, or promise guaranteed returns.

## G1 — Production-wide central PostgreSQL metering

**Owners:** deployment/DBA lead, platform lead, security reviewer.

**Proof required:** inventory every deployed compile/explain API handler, edge route, queue consumer, scheduled job and worker, including version/config hashes and all tenant/adapter registration seams. For every paid path show a fail-closed operator-owned ledger backed by the *same* protected PostgreSQL instance/cluster and immutable tenant and vendor organization budget; no SQLite, mock ledger, unmetered provider or bypass route in deployed production. Verify TLS identity, scoped DB role/grants, transaction isolation, immutable provisioning, backup/restore, restart and concurrent cross-replica contention. Deny absent/mismatched vendor account caps before any paid request. Exercise provider error/retry/overage paths with redacted traces; a timeout may leave a durable reservation for manual reconciliation. Show whether Cloudflare/D1 and Phase 2 are different product paths and explicitly bind or disable unused paths.

**Acceptance:** signed deployment topology and role inspection; exact deployment/config digests; bounded authorized multi-worker tests; independent DBA/security approval. CI alone: insufficient.

## G2 — Real OpenAI and Anthropic account billing reconciliation

**Owners:** provider-account administrator and independent finance approver.

**Proof required:** explicit cost ceiling and account/project authorization; exact model IDs, region, rates, token classes, caching, currency, taxes and effective price dates. Capture vendor usage/charges and internal reserve/settle logs for the *same* approved request IDs; compare every line, including errors, retries, timeouts, cache hits, ambiguous responses and recorded overages. Reconcile starting balances and historical pending reservations before policy migration; never reset counters or create new billing DBs to evade caps. Independently review actual upstream organization/account limit, alert thresholds, suspension paths and limits of worst-case billability.

**Acceptance:** redacted vendor invoice or authoritative usage export; arithmetic reconciliation with explained differences; finance and security sign-off. No sample, fabricated invoice or zero-cost mock may qualify.

## G3 — Credentialed, authorized live-provider and evidence-target smoke

**Owners:** every target owner, provider account owner, security lead.

**Proof required:** signed target/scope document, purpose, rate, request count, timeout, budget, allowed read-only operations, stop conditions and contact. Use secret-manager scoped ephemeral credentials *outside* source, GitHub issue text, public actions logs and chat. The existing `reasoning/phase2/scripts/live-provider-smoke.ts` is a gate-protected runner and must not be invoked without full authorization. Verify actual OpenAI/Anthropic explain calls, read-only MCP JSON-RPC with wrong-tenant denial, least-privilege PostgreSQL evidence view/TLS, immutable version-pinned object, and approved read-only remote compute. Capture signed, redacted source/manifest/response digests, observed version IDs, negative tests and actual spend.

**Acceptance:** six actual scoped endpoint records with redacted hashed receipts and independently verified post-call billing; no simulated run qualifies.

## G4 — Independent penetration assessment

**Owners:** independent professional tester and asset/security owner.

**Proof required:** named scope of systems/tenants/endpoints, written owner authorization, test dates/limits, authorized accounts, permitted techniques, forbidden operations (no trade/payment/customer mutations), confidentiality and incident response. Independent assessor executes the assessment and signs findings, severity, fixes and retest; critical/high findings require independent remediation confirmation.

**Acceptance:** signed external statement of work, assessment report and independent high/critical retest. Self-test, unit tests, automatic scanners and this reviewer are not a substitute.

## G5 — Operational security and workstream approvals

**Owners:** IdP, security/key custody, operations, privacy/data protection, finance, product and all ten accountable roadmap stream owners.

**Proof required:** real SSO/MFA enforcement and deprovision/revocation; RBAC/SOD/just-in-time grants; service-account/DB privileges; HSM/KMS key ownership, rotation, revocation and break-glass procedure; signed audit-log continuity and retention; backup recovery, restoration/chaos and controlled rollback against pinned artifacts; outage and spend alerts. Collect individually attributable evidence of all ten roadmap stream approvals, exact source SHA, deployment digest and immutable configuration pin.

**Acceptance:** security operator test records, separation-of-duties reviewer, ten independent signed stream approvals and release/rollback authorization. An unchecked checkbox is not approval.

## G6 — Private GitLab historical archival

Use [privacy-safe GitLab archive procedure](../migrations/2026-11-06-private-gitlab-history-archive.md). Archive all GitLab objects and confidential issue/MR/CI metadata only in an approved **private** destination after disclosure review. Never force-update public GitHub `main`.

## Common evidence receipt (template only, **not a passing record**)

Store each receipt in a protected evidence vault. Reference only a redacted digest in the public release issue:

```json
{
  "schema": "musitu.axiom.release-gate-evidence.v1",
  "gate": "G1-G6",
  "outcome": "BLOCKED",
  "environment": "UNVERIFIED",
  "repository_sha": "INSERT_VERIFIED_SHA",
  "deployment_digest_sha256": null,
  "manifest_digest_sha256": null,
  "evidence_bundle_sha256": null,
  "assessor_or_owner_id": null,
  "independent_reviewer_id": null,
  "signed_at_utc": null,
  "sensitive_evidence_location": null,
  "exceptions": ["NO_EXTERNAL_ATTESTATION"]
}
```

Never change `BLOCKED` to `PASS` without actual evidence, named independent approval and a logged release decision. The [release issue #74](https://github.com/evansmusitu/mft-axiom-build/issues/74) is authoritative for outstanding gates; [history issue #75](https://github.com/evansmusitu/mft-axiom-build/issues/75) separately tracks the private migration.

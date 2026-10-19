# MUSITU Store V2 — exact nonproduction payment deployment blocker

**Qualification date:** 2026-10-19 (Africa/Harare)
**Scope:** Only isolated Store Phase 1 draft branch, not production.
**Current decision:** STAGING NOT DEPLOYED. CHECKOUT DISABLED. PAYNOW PAYMENT DISABLED.

## What was actually verified

1. Store-only checkout worker now contains signed Paynow initiation and
   `POST /store/billing/webhooks/paynow`, authenticated
   `GET /store/billing/checkout/{STORE-reference}`, and an advisory
   browser return. The callback verifies the Store-specific merchant
   signature *before* Store database reads, independently polls
   Paynow on the original persisted URL and limits results to
   manual `review_required` / `refund_review_required`.
   A unique Store provider reference and D1 conditional transaction
   protect against cross-order paid-claim reuse and stale status races.
   No entitlement, publisher payout, real refund or settlement is granted.
   **70/70 offline/synthetic tests passed**, CI:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39184495434
2. Authenticated read-only Cloudflare account discovery SUCCEEDED using
   existing connected GitHub Actions repository secrets. It verified
   the expected Cloudflare account and zone, read Workers, D1 and
   route listings. A separate billing-entitlement read showed a
   **Workers Paid** plan and **11 existing D1 databases**. Read-only
   gate: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39185122398
3. A guarded provisioning workflow attempted to create one *new*, isolated,
   empty Store staging D1 database named
   `musitu_store_v2_payments_staging`, intended for a separate disabled
   Worker named `musitu-store-v2-payments-staging-20261019`.
   **Cloudflare returned HTTP 403 on the D1 database creation POST**.
   The code stopped immediately, before any Store Worker upload, D1
   migration, route, secret or checkout operation.
   Failed-at-the-external-permission-gate run:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39185220941
4. A fresh read-only audit **AFTER** the denied write independently
   confirmed 11 D1 databases, no Store-specific D1 or Store Worker, and
   no Store domain route. All unrelated Axiom production billing routes
   remained untouched. Independent readback:
   https://github.com/evansmusitu/mft-axiom-build/actions/runs/39185375530

**Do not confuse a successful read-only workflow with write permission.**
HTTP 403 could mean absent D1 Create/Edit permission, account policy,
or another Cloudflare restriction. The precise cause is not yet proven;
it does not authorize trying unrelated accounts or databases.

## Exactly what must change (privately, not in this chat)

An authorized Cloudflare account administrator needs to verify
**D1 database create/write** permission for account
`93f395f5121954671f92fffa453d6b61` and ensure a narrowly scoped
Workers Scripts Write permission is available to the provisioning
credential when future Worker upload is required. Cloudflare API tokens
are preferred to a Global API key. Do not create new secrets via
plain chat messages or commit them to GitHub. The existing isolated
GitHub Actions workflow reads an authorized repository secret called
`CLOUDFLARE_API_TOKEN` (and has a legacy GitHub-secret fallback only).
Tokens must be created by a verified administrator in the Cloudflare
dashboard and stored privately in GitHub Actions secrets if needed.
A 403 may instead be account-level permission or billing enforcement:
inspect the dashboard/API rejection there before granting broader access.

**Safe user route:**
Cloudflare dashboard at https://dash.cloudflare.com/ →
My Profile / API Tokens → create a token with account-scoped **D1
edit/create** and **Workers Scripts edit** permissions, only for this
MFT Cloudflare account (plus read-only account/zone information as
necessary). Then GitHub repository `evansmusitu/mft-axiom-build` →
Settings → Secrets and variables → Actions → repository secret
`CLOUDFLARE_API_TOKEN`. Never share its value in ChatGPT.
After securing account permissions, re-run **MUSITU Store V2 isolated
non-public disabled payment staging provision** on the existing Store
isolated branch. Do not start Axiom's production commercial-enable or
real-money certification workflows.

Even after a successful staging deployment, **no live Store sales
are authorized** until the Store merchant integration, private key
custody, real Paynow-hosted test-mode transactions, genuine callbacks,
independent bank/provider settlement and legal publisher rules have
been individually verified. A staging Worker without a custom domain,
workers.dev subdomain or merchant secret is a security qualification,
not a public payment service.

## Immutable boundaries

Original signed Store V1, Axiom subscriptions/quotas and production
Worker scripts, protected main, OpenAI frozen PR #1, unrelated MMF/FMI
and existing MFT Paynow integrations remain untouched. No customer
was charged. Phase 1 remains RUNNING; Phase 2 remains PENDING.

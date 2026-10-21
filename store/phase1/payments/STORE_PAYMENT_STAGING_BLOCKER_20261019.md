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

## 2026-10-19 source-preflight repair and manual-only provisioning guard

A *second*, independent staging blocker was found **in our own branch**:
`provision_store_payments_staging.py` still required the obsolete exact
source statement `import {createStorePaymentRoutes} ...`. The actual,
reviewed checkout module now legitimately imports
`createStorePaymentRoutes,boundedBytes`, so the preflight would reject
every current code revision **before reaching the Cloudflare API**, even
if an administrator corrected the Cloudflare permission problem.

The staging preflight now validates the **actual current module import**
using a narrow audited import pattern, while rejecting an unexpected or
rerouted checkout dependency. A new offline-only Python acceptance file,
`test_store_staging_source_preflight.py`, exercises the real source/schema
contract and a maliciously replaced module-import path without Cloudflare
network access.

**Behavior-first evidence:**
- RED: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39237758443 — current real checkout source failed the preflight with
  `Store payment imports and module dependencies unexpectedly changed`.
  The hijacked-import rejection case passed.
- GREEN: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39237861935 — both offline staging acceptance tests passed;
  complete Store Paynow/checkout suite **77/77 tests passed**, 0 failed.
  Signed Store V1 source hashes were reverified.

**Cloudflare staging creation remains BLOCKED by the prior HTTP 403.**
The successful source-preflight result does not grant D1 Create/Edit or
Workers Write permission, provision any database, or deploy any Worker.

Additionally, staging provisioning is now **explicit-intent only**
rather than reacting to source or workflow pushes. The workflow retains
`workflow_dispatch`, but GitHub may not deliver that event for a workflow
that exists only on a non-default isolated branch. To permit an isolated
branch rollout without touching protected main, its sole push trigger is an
edit to `store/phase1/payments/PROVISION_STAGING_APPROVAL_TRIGGER.txt`
committed **by GitHub actor `evansmusitu`**. The initial value is
`MUSITU_STORE_STAGING_PROVISION_APPROVAL=NOT_AUTHORIZED`.
Only changing its first line to the exact
`MUSITU_STORE_STAGING_PROVISION_APPROVAL=ALLOW_DISABLED_UNROUTED_STORE_ONLY`
value can pass the guarded preflight and attempt to create an *empty*,
disabled, unrouted Store-only D1 + Worker. Other source, workflow and
documentation pushes cannot start provisioning. The workflow's account,
branch, zone, no-route, checkout-OFF and V1 preservation guards remain.

**Do not approve that sentinel until the Cloudflare D1 Create/Edit
permission is corrected in the existing secure GitHub secret** and
the user explicitly approves an isolated, no-public-route staging
resource. The prior HTTP 403 remains unresolved. Even a green sentinel
run will not authorize live checkout or real merchant transactions.
Existing production Axiom billing, Store V1 and protected branches
must remain unchanged.

The sentinel opt-in regression first failed before its controlled
GitHub Actions trigger was implemented (run `39238302105`). The final
`77/77` offline payment and source-preflight suite passed at
https://github.com/evansmusitu/mft-axiom-build/actions/runs/39238436744.
No Cloudflare D1 creation or Worker deployment was attempted in that
test run.

The next verified success criterion is *not* a green unit-test count:
after explicit permission correction and manual workflow dispatch, the
operator must independently read back a **new empty Store-only D1** and
a **disabled, unrouted, secret-free Store Worker**. Genuine Store checkout
still requires its own subsequent security/merchant approval; no live
money transactions were executed here.

## 2026-10-21 root-cause confirmation: Cloudflare D1 quota 7406, not token setup

After the owner created a new scoped Store-only Cloudflare token and privately saved
it as GitHub Actions secret `CLOUDFLARE_API_TOKENV2`, the exact isolated branch
trigger was retried. Explicit owner approval, credential presence, Store V1 freeze,
real SQLite schema preflight, account ID, GET account/Workers/D1/routes,
and Workers Paid subscription read passed. **The one POST to create the
Store-only D1 was rejected HTTP 403**, while no new D1/Worker was created.
Workflow: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39551637781.

The staging script was patched to print only *numeric* Cloudflare error codes
and suppress the original response body, headers, and secret values. Regression
tests and offline Store payment review CI passed. A second and final controlled
diagnostic retry returned **HTTP 403; error_codes=7406** exactly on
`POST /accounts/93f395f5121954671f92fffa453d6b61/d1/database`.
Workflow: https://github.com/evansmusitu/mft-axiom-build/actions/runs/39551940747.

Cloudflare's documented `7406` is `System limit reached: databases per
account (10)`. Cloudflare D1 standard published plan limits are 10
databases on Workers Free versus 50,000 on Workers Paid; the account has
previously listed **11 existing D1 databases** and the Store script's
read-only subscription check recognized Workers Paid. **This is a
Cloudflare-enforced account quota/entitlement mismatch requiring owner
dashboard inspection or Cloudflare Support resolution**, *not evidence that
another token permission is missing*.

**Next owner action:** verify the actual Workers Paid plan on account
`93f395f5121954671f92fffa453d6b61` in the Cloudflare dashboard;
open a Cloudflare support request quoting the exact 7406 error, account ID,
the 11 existing database count and the supported Paid D1 50,000 limit.
Do not delete or repurpose unrelated existing D1 databases, change the
billing plan, incur new charges, or launch real Store payments as a workaround.
After Cloudflare lifts the enforced limit, use the same secret to retry the
existing isolated-disabled/unrouted provisioning approval. Confirm D1,
disabled Worker, absent routes, and no merchant secret by independent readback.

Current truth: **STAGING NOT PROVISIONED; PHASE 1 RUNNING; PHASE 2 PENDING**.

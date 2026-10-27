# Store V2 — Private signed Paynow status observation writer candidate (27 October 2026)

**DO NOT DEPLOY OR MIGRATE WITHOUT AN INDEPENDENT REVIEW.** Applies to private SQLite/D1 qualification only. Store third-party checkout, entitlements, refunds, publisher payouts and public launch remain disabled. Integration **27721** is Testing-only. No merchant secret is included.

## Exact opt-in behavior

`store-axiom-payment-routes.mjs` retains the existing signed Paynow callback and independent, signed provider-status polling. Once provider reference, Store order, amount, poll URL and provider status agree, `Paid` and `Refunded` continue to create only manual-review records, never grant entitlements.

When the matching provider status is one of `Created`, `Sent`, `Cancelled`, `Disputed`, `Awaiting Delivery` or `Delivered`, the handler **by default** leaves the order pending and returns `processed:false`. Only with private flag `STORE_PAYNOW_OBSERVATIONS_ENABLED='true'` and a separately migrated Store-only SQLite/D1 database, it attempts a single atomic SQL `INSERT ... SELECT ... WHERE EXISTS` of signed callback and poll digests, bound transaction reference, status and order identity. An immutable event ID is derived from the order, provider reference and evidence digests. Replay reads the existing event and confirms its identity before returning idempotent success.

The SQL schema's immutable append-only and one-to-one Paynow reference constraints independently prevent duplicate events, cross-order and same-order provider reference rebinding. A competing cancellation, missing migration or storage failure cannot produce an affirmative recorded result. No signed status becomes an automatic refund, payout, entitlement or withdrawal of disputed funds.

## Mandatory deployment and approval gaps

1. The candidate schema `store-paynow-status-observations.candidate.sql` is **not deployed** in live Cloudflare D1, Neon or customer data. The current Vercel stage runs a *deny-all witness*, not this handler.
2. The feature flag is intentionally absent from deployed Vercel environments. **Do not set it** before migration, signed callback ingress, auth, independent E2E testing and reviewer approval.
3. The optional ledger is forensic evidence, **not a financial settlement or legal record**. `Cancelled` is provider-terminal, but Store order cancellation/reconciliation must still be independently designed. `Disputed`, `Awaiting Delivery` and `Delivered` require escrow/suspense workflows and human decisions.
4. `Paid`/`Refunded` observations after the first review need a separate approved append-only finance/reconciliation design. Genuine marketplace merchant-of-record permissions, publisher contracts, customer authentication/MFA, certified third-party apps and independent security acceptance remain outstanding.
5. Provider-hosted fake-success and cancellation tests are not yet certified; no real purchases, money or customer data were used here.

## Evidence and acceptance

- Recorded TDD: new route test suite baseline **19 pass / 3 fail** before implementation; **22/22 passed** after fix.
- Full offline Node 22 payment tests **104/104 passed**.
- Python payment and SQLite tests **46/46 passed**, including 5 tests executing the **exact SQL string from the production candidate** against real disposable in-memory SQLite.
- Developer portal Node tests **140/140 passed**, protected Neon stage tests **9/9 passed**.
- GitHub CI: pending at authoring; only mark passed when the **exact candidate commit** has a successful independent workflow run.

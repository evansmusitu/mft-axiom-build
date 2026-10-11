# Private Cloudflare SQLite Durable Object: isolated billing stage fallback

Owner granted explicit authorization on 2026-10-11 for *separate, non-public* MMF Cloudflare staging resources, with existing production services protected and customer payment/email disallowed. Earlier Cloudflare D1 deployment workflow `38125979858` passed preflight but the D1 create endpoint returned HTTP 403. Attempt `38126162092` independently confirmed **Cloudflare quota code 7406**, so creating a separate D1 database within that account is currently blocked. No payment Worker or D1 for MMF was created by these attempts.

Rather than reuse FMI billing tables or request paid capacity, this build uses a **new, independent SQLite-backed Durable Object namespace**, leveraging Cloudflare Workers SQLite Durable Objects already used by MUSITU's separate private Mail Fabric staging environment. No existing Worker, Durable Object, D1 database, Paynow service binding, DNS route, or queue is changed.

New script: `musitu-mail-fabric-payment-private-stage-20261011`, with fresh SQLite DO class `MmfBillingPrivateStageSqliteDO` and migration `mmf-private-billing-sqlite-stage-v1-20261011`.

The Worker has zero public routes; workers.dev and preview URLs disabled, no provider or customer secrets, receipt intake OFF, commerce OFF, mail OFF, webhook OFF. It accepts a private service-bound HTTP request only when activated by a separately generated, scoped operator credential; initial stage token is never exposed, stored in repo or uploaded in CI artifacts.

The sole self-namespaced SQLite Durable Object implements the exact `D1.prepare(...).bind(...).run/first` contract expected by the synthetic MMF payment order ledger. This integration is tested against real SQLite locally, but **a successful cloud configuration readback does not yet constitute a real private Cloudflare order execution or a real Paynow paid transaction**. Those have separate gates.

Workflow `.github/workflows/mmf-billing-private-sqlite-do-stage-authorized-20261011.yml` is a one-time exact previous SHA branch-triggered deployment. It verifies the existing Mail Fabric staging Worker settings fingerprint before and after and fails closed on drift.

# Private Cloudflare MMF billing order: real remote qualification

This is a scoped continuation of authorized **private MMF-only Cloudflare staging**; it does **not** authorize genuine Paynow payment initiation, customer charges, external checkout, customer email or changes to the shared FMI/Axiom/Chemistry payment authority.

## Observed prior state

- On GitHub branch `product/musitu-mail-fabric-isolated-20261009`, prior authoritative commit was `dea00e70f57d27338c6b238a25b3df6bb3d34110`.
- Cloudflare Worker `musitu-mail-fabric-payment-private-stage-20261011` was deployed by successful CI run `38126454796` with `workers_dev=false`, `preview_urls=false`, zero public routes and a new isolated SQLite Durable Object.
- D1 creation failed at account quota (7406); no attempt to reuse existing production D1 databases is permitted.
- Cloudflare deployment settings were live verified, **but no remote order had yet been executed**.

## Authorized one-time qualification

`.github/workflows/mmf-billing-private-remote-order-qualification-20261011.yml` is **one-time**: it only runs on the exact isolated branch push from `dea00e70f57d27338c6b238a25b3df6bb3d34110` that adds that exact workflow. It does not deploy or configure any public Worker, Webhook, Paynow or mail sender.

The workflow first verifies read-only Cloudflare configuration, secret presence, off-by-default commerce/email/receipt flags and separation from any production resource. It cryptographically generates a temporary *MMF-only stage operator credential* on GitHub's private runner, rotates **only** that Worker secret, and calls the already-deployed private Worker through a Wrangler **local development service binding** (`remote:true`) via HTTP loopback `127.0.0.1:8789`. It tests six properties: pending order creation, read, duplicate-order idempotence, wrong-credential denial, client price rejection, and non-existent-order denial. It restarts its **local-only proxy**, then proves the pending order survived against the **same remote deployed Worker**. No public route, preview URL, public access or real payment is involved.

The temporary operator key is rotated again and deleted even when qualification fails; **the post-rotation credential is intentionally not retained outside Cloudflare**. The workflow verifies final private settings and stores a *sanitized* outcome artifact with no secret, customer data or order ID. A failed run does **not** imply remote qualification passed, even if individual steps succeed.

Technical note: The remote service binding exists **only** in a local Wrangler dev configuration and forwards *only* private billing-order paths. It has no routes, `workers_dev=false`, no DO class, and no customer-capable endpoint. The remote target remains the already-deployed private MMF billing Worker with its own authorization and stage-only flags.

## Verification commands

```sh
cd musitu-mail-fabric
npm run test:cloud-remote-order
npm run check
npm test
npm run check:phase1 # expected BLOCKED until real external approvals
```

If remote service binding fails due to account rights, unavailable remote binding support or quota, report the actual blocker; do **not** bypass it by enabling workers.dev, a preview URL, a production checkout or an FMI customer credential.

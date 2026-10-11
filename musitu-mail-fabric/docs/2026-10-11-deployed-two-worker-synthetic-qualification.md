# MMF deployed two-Worker synthetic payment qualification

Status: isolated qualification candidate, **not** commercial activation.

## Scope

- Cloudflare-only `musitu-mail-fabric-paynow-private-authority-stage-20261011` -> private service binding -> `musitu-mail-fabric-payment-private-stage-20261011` -> separate SQLite Durable Object.
- Both existing staging Workers remain `workers_dev=false`, `preview_urls=false`, `routes=[]`, with real commerce, mail and public APIs disabled.
- Temporary test signer is generated in CI, independently from FMI/Axiom/Chemistry or Paynow merchant keys. It signs only synthetic payment/reversal claims. There is **no Paynow provider HTTP request**, merchant credential, customer consent/invoice or live settlement.
- A local-only Wrangler bridge on `127.0.0.1:8794` sends pending-order creation/read to billing and signed receipt calls to the **separate authority Worker**. Service bindings must be declared `remote:true` and no public HTTP route is created.
- Signed `Paid` and `Refunded` claims must reach the separate authority Worker, then the private billing Worker. Both independently authenticate/verify a pinned signing key. Verify forbidden forgery, wrong caller, duplicate receipt idempotence and no reactivation after reversal.
- Qualification is bound to a single GitHub isolated branch and its previous SHA, with strict read-only Cloudflare preflight. A failure still triggers both Worker restoration steps.
- After the synthetic test, redeploy **both** baseline Worker configurations, revoke test tokens, discard the signing private key, verify Cloudflare readback of locked flags and private bindings, and upload **sanitized** evidence only.

## Evidence required before claiming proof

1. Full Node checks and tests, release check EXIT 2.
2. GitHub Actions run for `.github/workflows/mmf-two-worker-private-synthetic-cloud-qualification-20261011.yml` must conclude SUCCESS.
3. Run logs/artifact contain `MMF_DEPLOYED_PRIVATE_TWO_WORKER_SYNTHETIC_RECEIPT` PASS and `MMF_DEPLOYED_TWO_WORKER_PRIVATE_RELOCK` PASS; no credentials, order references or raw provider data in evidence.
4. Read-only live GitHub confirms protected main unchanged and PR #1 remains OPEN / DRAFT / UNMERGED.

## Non-goals (separately gated)

Real payment initiation, real Paynow authority issuance, production merchant scope, live callback/poll qualification, taxes/invoicing, customer email, production launch, and changes to shared existing payment Workers are explicitly out of scope and unapproved.

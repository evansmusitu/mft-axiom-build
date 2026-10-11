# Authorized private MMF billing Cloudflare staging (2026-10-11)

User explicitly approved **a separate private MUSITU Mail Fabric staging environment and isolated resources** in Cloudflare, with the existing FMI/Axiom/Chemistry/Paynow services protected and **no real payments or customer email sending**. This approval does not authorize enabling live billing, changing shared payment authority or modifying production services.

## Exact one-off Cloudflare deployment

The workflow `.github/workflows/mmf-billing-private-cloud-stage-authorized-20261011.yml` is restricted to the isolated branch and the exact prior SHA `cdc39fd87b050372ba2f891025fde78fcd56715a`. All Cloudflare API token values come from existing GitHub environment secrets; no values are checked in or surfaced in CI output. It must preflight the exact account ID and verify fresh target names before mutation.

Planned *new* resources only:

- D1: `mmf-isolated-billing-stage`, empty `mmf_prep_orders` schema, no customer account or FMI tables.
- Worker: `musitu-mail-fabric-payment-private-stage-20261011`, no routes, workers.dev or preview URL. Binds *only* `MMF_PAYMENT_DB`, not the existing FMI, Axiom, Chemistry or Paynow Workers.
- Operator token: separately generated, installed as a Cloudflare Worker secret, not logged or uploaded as an artifact. This does **not** itself grant production customer access.
- All flags deny commerce, real payment settlement, mail sending, webhook ingress and receipt ingestion.

The script `src/staging/authorize-private-billing-stage.mjs` independently verifies the database is empty and checks Cloudflare Worker flags, binding type, secret presence and absence of public routes. The workflow uploads only a sanitized evidence artifact if every gate passes.

## Release classification

A passing Cloudflare staging deployment proves only real Cloudflare control-plane provisioning and private binding configuration, not a paid MMF order, public checkout, Paynow settlement, legal invoice, independent production security certification, or customer email. MMF payment receipts and customer delivery remain disabled pending distinct authorization and genuine qualification.

Any partial failure must be reported by its exact stage and not relabeled deployment success. Existing protected `main`, PR #1 and the frozen OpenAI review remain unchanged.

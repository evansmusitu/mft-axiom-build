# MUSITU Mail Fabric v0.17 — Sender-Private Recipient Proof and Live Nonpublic External Outbox Binding

**2026-10-10.** Repository: `evansmusitu/mft-axiom-build`. Authoritative engineering branch: `product/musitu-mail-fabric-isolated-20261009`.

## Outcome and evidence

**An actual Cloudflare staging Worker was newly deployed** with a private external Durable Object binding to the separate sender staging script. Its outbound sending, API and inbound webhook processing remain disabled. This is provisioning of the transport binding, **not** activation or validation of real provider feedback.

- [Actual cloud provisioning run 38063284176](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38063284176): completed successfully. The test/dry-run source gate and Cloudflare preflight passed, Wrangler deployed `musitu-mail-fabric-webhook-linked-test-only` as nonpublic, and independent API readback reported `MMF_V017_REAL_PRIVATE_CLOUDFLARE_EXTERNAL_OUTBOX=PASS` with `externalSenderObjectBound=true`, `separateWebhookWorker=true`, `publicAccess=false`, `customerDataUsed=false`, `networkMailSent=false`, and `scopedFeedbackEnabled=false`.
- The owner staging Worker `musitu-mail-fabric-staging-20261010` remained nonpublic. Existing staging ledger, encryption/signing secrets and production systems were not rewritten by this provisioning action.
- The newly deployed linked Worker has **zero configured MMF secrets**, and keeps `MMF_WEBHOOK_ENABLED=false`, `MMF_OUTBOX_LINK_ENABLED=false`, `MMF_REAL_SEND_ENABLED=false` and `MMF_API_ENABLED=false`. It cannot process real inbound events or send customer messages. The prior separate isolated webhook-only Worker is also not publicly reachable.
- Read-only [pre-deployment audit run 38062366612](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38062366612) confirmed the link was initially missing, and identified no configured feedback capability secrets. The new provision establishes a binding without altering those closed security gates.

## Cryptographic privacy improvement

Previously, the webhook-only ingress needed the **same HMAC recipient-identity key** as the outbound sender to compare the signed provider event's recipient with the accepted transaction. That copied a sensitive key into another Worker with a potentially public-facing purpose.

Version 0.17 changes recipient attribution:

1. The webhook ingress verifies the signed Resend-format event as before, but its `createFeedbackSqlAdapter` now requests an **exact recipient match from the sender Durable Object** using `/feedback-rpc/recipient-match`.
2. Only an independently authorized, tenant-matched `MMF_FEEDBACK_RPC_SECRET` can request this operation; no sender private key or recipient HMAC key is returned. Request bodies are capped at 1,000 bytes, use strict JSON MIME and fatal UTF-8 decoding, and require a single tenant/provider/recipient tuple. The sender returns only `true`, `false` or `null` (provider not yet attributable).
3. The owner computes the recipient HMAC using its own configured privacy key, or—only in isolated synthetic stage—the existing stage key and deterministic stage derivation. A false response rejects the cross-recipient event; `null` retains the retryable pending-correlation behavior. Provider acceptance, event replay and durable recipient suppression remain intact.
4. The webhook Worker may therefore have a **different random local privacy key** without defeating recipient correlation. This was verified with the linked Worker integration fixture. The local stage owner's derived-key path and whitespace/regular-email validation have dedicated tests.

Test-first evidence: [commit 2a9a16f](https://github.com/evansmusitu/mft-axiom-build/commit/2a9a16f6ac912c45336d36d727e009e6c525c435) deliberately gave the ingress a different privacy key, and GitHub Actions recorded the expected recipient attribution failure before the new owner-only matching code and route were added. A separate test exposed incorrect whitespace escaping that rejected valid addresses containing `s`; it was corrected after the expected red run.

## What remains strictly blocked

The link's existence is not proof the two actual Cloudflare Workers have processed a real signed provider event. Before any live traffic, the *owner* must be provisioned with its separate feedback-only capability secret and enabled on a precisely scoped tenant, and the *ingress* must receive a matching scoped credential plus an authenticated Resend Svix signing secret and sender-originated identity context. This step requires guarded private-only positive and negative tests, independent secret custody and coordinated rotation/revocation. Never share the unrestricted SQL RPC key.

The connected Resend account currently reports one verified sending domain but **zero registered webhooks**. Thus no actual Resend-delivered or bounced message has been observed by MUSITU. A public Resend webhook callback, controlled-recipient sending, signed vendor-originated receipts, KMS/HSM key escrow, independent third-party security assessment, consent/retention legal review and production outage qualification remain unavailable or unverified.

**Security disclosure:** A scoped recipient-match interface reveals one Boolean for a known provider ID. A stolen feedback capability could be used as a recipient-existence oracle; production deployment requires short-lived scoped credentials, access auditing, rate limiting and an independent review. The staging Worker remains private and the new endpoint is disabled in Cloudflare by default.

## Production release decision

**HOLD — protected systems unchanged.** No customer email, Resend webhook subscription, public endpoint, paid infrastructure upgrade, account-wide DNS edit, frozen OpenAI submission modification or AXIOM protected-branch change was performed. The only cloud mutation was creation of the separately named, nonpublic linked staging Worker and its disabled external DO binding.

The implementation is *closer to production qualification*, but it is **not commercially activated or independently certified**.

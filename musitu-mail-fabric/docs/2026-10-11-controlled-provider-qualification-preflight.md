# 2026-10-11 — Controlled provider qualification: implementation and external gate

**Scope:** Isolated product branch only. This change does not deploy Workers, register Resend endpoints, send mail, request paid services, unlock production traffic, edit main, or claim a completed real webhook qualification. The product release label stays at `0.18.0`.

## Defect addressed

Previously, two correctly signed live-release grants, a local `MMF_WEBHOOK_ENABLED=true` flag and a syntactically valid `whsec_` value were sufficient to pass the live-provider preflight. Those settings are not evidence that a registered Resend webhook has ever delivered a provider-originated event. The live-release path could therefore admit sending under an unqualified or non-existent webhook. An isolated test confirmed the prior implementation returned HTTP 202 where the stricter policy required HTTP 503.

The live delivery branch now **also** calls `verifyProviderQualification()`. The default is DENY. This is evaluated before building any real network-enabled Resend adapter and is applied to intake, scheduled sends and queue consumers through the common `fromEnv()` guard. The callback can continue to operate in receive-only mode while outbound release is expired or absent. All existing staging modes remain nonpublic and disabled.

## Qualification attestation required BEFORE a separate production release decision

An independent, trusted auditor must assess an actual isolated **provider-originated**, Svix-signed `email.delivered` event, verify its Resend dashboard webhook and delivery-attempt records, match the provider message ID, and preserve redacted source-evidence hashes. The auditor then signs a short-lived, exact-tenant/domain/provider qualification claim using a separately pinned **Ed25519 public key**. It must differ from BOTH live-release signers. One claim includes:

- `schema=mmf-provider-qualification-v1` and exact `tenantId`, `domain`, `provider=resend`;
- verified Resend `webhookId`, `svixId`, `providerMessageId`, `deliveryAttemptId`, `eventType=email.delivered`;
- `rawSha256` for original signed event bytes and a distinct nonce;
- qualification timestamp and expiry no later than seven days later.

The bounded signed statement lives in `MMF_PROVIDER_QUALIFICATION_JSON`. The audited public key and separately trusted SHA-256/SPKI pin live in `MMF_QUALIFICATION_AUDITOR_PUBLIC_KEY_PEM` and `MMF_QUALIFICATION_AUDITOR_FINGERPRINT`. All are missing on live staging. Unknown fields, wrong tenant/provider/domain, missing IDs, expired attestations, self-signed owner/approver attestations, changed hashes, changed keys and incorrect signatures fail closed.

**Important limitation:** This proves that a separately pinned auditor *signed those claims*. It cannot independently interrogate Resend, reproduce Resend's delivery attempt, confirm a webhook registration, prove inbox placement, verify original event bytes from hash alone, or establish independent security certification. A malicious/dishonest operator or an attacker who controls runtime config and every signing key can still forge self-asserted evidence. Provider-origin proof and external sign-off must actually take place. Synthetic key fixtures in tests do not qualify any real account.

## Control-plane sequencing — external, not yet performed

1. Obtain explicit permission to use a named sender address, an owner-controlled test recipient, disposable public HTTPS callback, agreed teardown and no real customer data. Keep the original private Cloudflare staging workers locked.
2. Set up a **new** route-scoped webhook Worker and outbox linkage with dedicated disposable credentials; read back disabled flags and binding isolation before any exposure. Never expose sender/recipient privacy/signing/encryption keys to the ingress Worker.
3. Register a **new** disposable Resend webhook to that callback, subscribe only to required transactional outcomes, and preserve the webhook ID. Do not modify an existing webhook.
4. Perform one idempotent, approved, controlled test send with separately logged email ID. Test genuine signed `email.sent`/`email.delivered`, negative signature, wrong-recipient and replay cases safely; report any unable-to-trigger bounce/complaint as unverified rather than fabricate it.
5. Independently inspect original event bytes, webhook attempt metadata and recipient/provider correlation; create a redacted evidence pack. Have a genuine independent assessor review before signing the qualification statement.
6. Unregister the disposable webhook, revoke secrets, remove bindings, disable callback routing, and verify post-test lockdown. The dry-run qualification should not be mistaken for production's permanent registered feedback infrastructure.
7. Only after a production-specific verified webhook, key custody and operator access controls, legal/customer rights and retention reviews, qualified security review, and independent two-party live-release grant may an authorized team consider customer sending.

### Read-only local verification

```sh
cd musitu-mail-fabric
node --test test/live-provider-feedback-gate.test.mjs test/provider-qualification-v019.test.mjs test/live-sender-guard.test.mjs
npm run check
npm test
```

A test signing helper in `test/helpers/qualification-grant.mjs` is explicitly **synthetic** and must never be deployed to the runtime or used for an actual qualification. None of these tests send real email.

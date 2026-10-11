# 11 October 2026 — Mail Fabric isolated retention safety and rotation-readiness audit

This is an *engineering continuation on the isolated branch*, not a release, a certification, provider delivery proof, or deployment authorization. Product release label remains v0.18.0.

## Fixed safety defect

The prior retention candidate SQL erroneously treated `OUTCOME_UNKNOWN` as a terminal provider state. An API timeout may have occurred after provider acceptance; safe provider-ID investigation, duplicate-send avoidance and human reconciliation may still be pending. The old behavior could delete the encrypted content of unresolved messages after an age threshold. The guarded offline sweep now excludes this state in both its preview COUNT and conditional UPDATE. A red-before-green test proved the old behavior counted two candidates rather than one; the exact negative case now passes. `QUEUED` and `SENDING` remain protected too.

## Read-only dependency audit

`auditKeyRotationDependencies(db,{tenantId})` runs a *single* tenant-scoped SQLite aggregate SELECT (a statement-level count snapshot). It reports only bounded counters for encrypted envelopes, unreconciled messages, recipient-HMAC references, durable suppressions and provider events. Cross-tenant data are excluded. It never reads message bodies, ciphertext, recipients, signing keys, raw webhook payloads or private credentials. It performs **zero writes**.

Even if every reported count is zero, the return value keeps `rotationAuthorized:false`. Key retirement requires independent verification of offsite backups, retained proof/trust chain history, archived privacy-key references, queues and all external storage. The code cannot verify an independent HSM/KMS policy, external storage inventory or offline custody.

The audit is useful to *block obviously unsafe key retirement*, not to approve it. Source DB writes can happen immediately after the audit; any authorized migration must enforce a separately tested maintenance freeze and recheck transactionally.

## Explicit external provider qualification still required

At this inspection, connected Resend had a verified sending domain but **zero registered webhooks**. A private Cloudflare two-Worker proof processed only locally generated Svix-signed events; this is not genuine Resend-originated feedback. No signup, webhook registration, test send, or public endpoint was attempted in this continuation.

A genuine qualification requires prior explicit permission for disposable provider-side webhook registration, an isolated permitted callback endpoint, a narrowly approved controlled recipient/address/domain and its sender authority, account-specific binding and secrets, an agreed expiry/cleanup window and an independent operator. Conduct only with independently isolated resources; never repurpose the locked-down synthetic Workers.

1. Verify account ownership, new disposable endpoint and provider webhook ID through the connected provider service; record only IDs, endpoint digest and redacted account details. Never publish the webhook signing secret.
2. Explicitly authorize one controlled test send and a test-only recipient, with no customer or third-party mail. Confirm provider acceptance ID and match it to the locally stored test message without revealing the address or message body.
3. Accept the provider's **original signed bytes** and `svix-id`, `svix-timestamp`, `svix-signature` through the isolated callback; verify against its actual endpoint-specific secret. Check one-recipient binding, correct provider ID, duplicate replay, wrong-recipient refusal and wrong-signature refusal.
4. Independently inspect the provider's webhook delivery attempt and signed event ID. Distinguish `email.sent` and `email.delivered` (receiving server accepted) from actual inbox placement/read. Bounce/complaint suppression must use legitimate controlled negative events, never fake a genuine negative provider response.
5. Disable/delete the disposable webhook, revoke its secret and any temporary binding, return callback to disabled mode; verify no lingering public ingress and retain redacted event hashes, read-only provider attempt identifiers and a signed cleanup receipt.
6. Only after external legal/sender authorization, independent penetration/security review, real disaster-recovery qualification and operational readiness should anyone separately consider production customer delivery.

The remaining third-party security assessment remains **uncommissioned and uncertified**. These steps are requirements, not evidence that the test has been executed.

## Reproducible offline checks

From `musitu-mail-fabric/` run:

```
node --test test/retention-safety-v019.test.mjs test/key-rotation-readiness-v019.test.mjs
npm run check
npm test
```

All checks are local, use synthetic in-memory SQLite and perform zero provider API calls.

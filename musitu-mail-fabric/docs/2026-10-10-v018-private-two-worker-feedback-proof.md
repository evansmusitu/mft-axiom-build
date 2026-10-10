# MUSITU Mail Fabric v0.18 — Real private two-Worker signed synthetic feedback qualification

**2026-10-10.** Engineering authority: isolated branch `product/musitu-mail-fabric-isolated-20261009`. No customer sending, public webhook, or independent certification.

## Actual evidence

GitHub Actions [38073486380](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38073486380) **passed**. The job ran 217 Node automated tests (216 passed, one optional skipped, zero failed) and a dedicated 17-case cross-Worker/security suite (17 passed, zero failed). It then:

1. Checked actual private Cloudflare sender and linked ingress staging scripts, Queue, account and permissions. Both remained nonpublic with preview/subdomain disabled, no public routes, real sending off, customer API off and actual webhook intake off.
2. Generated two **different random staging-only credentials inside the GitHub runner**, with mode-0600 temporary files and no credential values printed: a scoped owner/ingress feedback capability and a separate private synthetic-test service-binding capability.
3. Deployed **only** the previously isolated nonpublic linked webhook staging Worker and isolated sender staging Worker, preserving the existing sender encryption/signing/general-storage secrets and previous SQLite namespace. The owner now has a private service binding to the linked Worker and a **separate feedback-only SQL capability**. The ingress has no sender encryption, signing, recipient-identity HMAC or unrestricted storage RPC secrets.
4. Independently queried Cloudflare deployment settings, enabled flags, namespace names and secret *names only*. Recorded `MMF_V018_CLOUD_SCOPED_FEEDBACK_BINDING=PASS` with `separateSenderAndIngress=true`, `noSenderKeysAtIngress=true`, `publicRoutes=false`, `webhookEnabled=false` and `networkCustomerMailEnabled=false`.
5. Posted a new random synthetic message into the actual private Cloudflare Queue. The sender stored it as an encrypted accepted transaction in its existing SQLite Durable Object using an **in-process simulated provider**. The sender called the separate linked Worker over a Cloudflare service binding. That ingress locally generated a test-only Svix-style signature, rejected a validly signed *wrong-recipient* event, recorded one recipient-matched synthetic bounce into the sender-owned DO via the strictly whitelisted RPC, and verified duplicate idempotency.
6. A final **independent sender-owned readback** checked the signed evidence, one persisted provider event, durable bounce suppression, and rejection of a later attempted message to the suppressed recipient. The attested gate was `MMF_REAL_CLOUD_PRIVATE_TWO_WORKER_PROVIDER_FEEDBACK=PASS` with `crossWorkerTransport=true`, `senderOwnedProofAndDurableSuppression=true`, `realResendEvent=false`, `customerMailSent=false`, `publicAccess=false`.

### Implemented source

- `src/edge/feedback-rpc.mjs`: explicit 15-minute-maximum previous-key overlap for **feedback-only** credentials, strict invalid-configuration fail-closed validation, immediate revocation by deleting the previous key. Its scoped SQL whitelist and owner-only recipient match remain unchanged.
- `src/webhooks/feedback-recorder.mjs`: receives and persists authenticated provider feedback without a copy of the sender's Ed25519 private key, encryption key or HMAC recipient-identity key.
- `src/edge/worker.mjs`: supports `MMF_WEBHOOK_RECORDER_ONLY` for a disabled-outbound ingress; customer API and live sends must both be disabled.
- `src/edge/webhook-private-probe.mjs`: **test-only** private ingress; synthetic signature created in the Worker, not from Resend. Its path is gated by a separate secret, stage flags, stage tenant, and no public routes.
- `src/edge/synthetic-cross-worker.mjs`: exercises actual owner-accepted synthetic message and separate private service binding, then validates only sender-owned durable signed evidence. Cannot accept a fake positive result from the ingress without SQLite proof.
- `wrangler.mmf.do-feedback-qualification.jsonc` / `wrangler.mmf.webhook-linked-stage.jsonc`: separate, explicit staging configurations retaining the original disabled baseline templates.
- `test/feedback-capability-rotation.test.mjs`, `test/webhook-recorder-without-sender-keys.test.mjs`, `test/private-cross-worker-probe.test.mjs`, `test/private-cross-worker-config.test.mjs`, `test/cross-worker-feedback-orchestration.test.mjs`: positive and fail-closed local cases.

## Limitations and remaining release blockers

This proves **real cloud cross-Worker integration on synthetic traffic**, not authenticated events actually sent by Resend, Gmail, an SMTP provider, or any external mailbox. The connected Resend account previously showed a verified domain but **zero registered webhooks**. A real signed vendor-originated delivery, bounce and complaint round trip with designated controlled recipients remains unproven.

The test also does not qualify long-term KMS/HSM custody, historical signing-key escrow, autonomous key recovery, issuer trust certification, independent security assessment, consent/regional legal obligations, production reputation, billing, payment collection or service-level operations.

Secret material used for this stage exercise was disposable, not recorded in GitHub commits, not included in the handoff or output. Its temporary synthetic-testing capability should be revoked or disabled after proving the bridge. Until legitimate vendor-originated events, independent external review and full operational approvals are obtained, **commercial sending and public webhook intake stay blocked**.

Protected GitHub main, PR #1, AXIOM production/support, Claude distribution and the frozen OpenAI submission are out of scope and were not changed by the v0.18 stage exercise.

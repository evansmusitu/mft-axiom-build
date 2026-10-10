# MUSITU Mail Fabric v0.15 — Bounded Webhook Ingress and Scoped Sender-Outbox Bridge

**Date:** 2026-10-10. **Scope:** isolated repository implementation and Cloudflare bundle qualification. Outbound customer delivery remains disabled and the webhook Worker is not publicly accessible.

## Defects discovered and closed

1. **Unbounded inbound request allocation:** the older shared Resend endpoint called `request.text()` before enforcing the maximum body size. A malicious or faulty client could force excessive memory allocation. The new `src/webhooks/bounded-body.mjs` reads request streams incrementally, caps total bytes at 65,536, rejects unsupported media types, refuses declared oversize content before body parsing, and decodes UTF-8 with fatal error handling. The data is verified against the ORIGINAL raw body bytes before any provider event processing.
2. **Disconnected provider attribution:** v0.14 provisioned a separate private webhook Worker with a completely independent SQLite `MMF_RECEIPTS` Durable Object. Because that store has no outbound transactions, it **cannot** correlate genuine Resend events with MUSITU accepted message IDs. Using it as the correlation ledger could result in endless retry/false readiness. v0.15 explicitly refuses detached receipt-store correlation: production ingress must have an approved `MMF_OUTBOX` Durable Object bridge and `MMF_OUTBOX_LINK_ENABLED=true`; no fallback is permitted.
3. **Overprivileged data bridge:** a normal database adapter enables broad SQL mutation. The new `src/edge/feedback-rpc.mjs` permits only exact required signed-feedback lookups, insertion of provider-event records for existing accepted sender/provider pairs, and insertion of bounced/complained recipient suppressions after durable evidence of the event. It requires a separate private capability secret, tenant match, and owner-side `MMF_FEEDBACK_RPC_ENABLED=true`. General message updates and arbitrary queries fail closed.

## Verified software behavior

- New stream tests cover oversized declared length and chunked streams, malformed UTF-8, wrong MIME, and absence of storage access on malformed requests.
- New linked-ledger integration tests use an actual SQLite-backed `MmfStagingSqliteDO` stub as the sender ledger, an explicitly unrelated receipt namespace, and separately authenticated feedback RPC. The authenticated Resend-format test event is **synthetically signed**, not provider-originated.
- Provider message identity and recipient suppression remain tenant-scoped, idempotent and bounded by signed event attribution.
- The strictly private, **nondeploying** `wrangler.mmf.webhook-linked.template.jsonc` demonstrates Cloudflare's external Durable Object `script_name` binding. All traffic and public route flags are set to false. The template is for **isolated staging design and dry-run compilation only** and must not be deployed as a live customer release.
- Node regression gates and Wrangler dry-run build are recorded under GitHub Actions; only report a PASS for individual runs after their actual logs have been checked.

## Actual environment and blocked gates

- The previously deployed nonpublic Worker `musitu-mail-fabric-webhook-isolated-20261010` is still isolated and has its independent `MMF_RECEIPTS` namespace. **It is NOT connected to the outbox in live Cloudflare** by this change.
- Previous read-only Resend account inspection reported **zero registered webhooks**. No public URL, delivery event subscription, real Resend-generated signature or real recipient mail was tested by v0.15.
- A live cross-Worker bridge needs a separately provisioned feedback-only capability, the right sender ledger namespace, strict source/tenant ownership checks, and independent cloud access and replay qualification. Do not activate public ingress before they pass.
- Production KMS/HSM custody, recoverable keys, live provider events and authorized test recipient, independent third-party security assessment, real outage scenario tests, anti-abuse/customer consent and compliance remain separate requirements.
- Do not claim certified delivery or legal registered-mail status from provider acceptance or cryptographic signatures alone.

## Protection

Only `product/musitu-mail-fabric-isolated-20261009` is modified. No AXIOM production, protected main, frozen OpenAI submission, PR #1, or actual customer delivery route is intentionally changed.

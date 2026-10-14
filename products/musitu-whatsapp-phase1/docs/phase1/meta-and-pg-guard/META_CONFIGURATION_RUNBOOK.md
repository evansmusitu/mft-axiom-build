# Meta webhook connection — guarded qualification runbook

The current `createMetaWebhookBridge` binds to loopback only. That is **not** a public Meta callback URL and must not be pointed at a live business until additional reviewed infrastructure exists.

1. Obtain Meta WhatsApp Business Platform developer-app access and a dedicated test WABA/phone-number ID belonging to the operator. Meta challenge verification requires `hub.mode=subscribe`, a private verify token and a challenge. Do not paste or commit Meta app secrets.
2. Deploy an isolated TLS 1.2+ endpoint with strict host/rate/body limits and managed secrets. Implement server-side Meta challenge GET using `createMetaWebhookBridge` semantics (not the loopback listener itself).
3. POST callbacks must be checked with the original raw request bytes and X-Hub-Signature-256 before any parsing or database write. A WABA+phone mapping must resolve to exactly one authorized tenant; never accept tenant IDs from the event payload as trusted authority.
4. Route only to an independently qualified non-BYPASSRLS transaction-scoped Postgres ingress role. Confirm webhook retries are idempotent; withhold 200 after storage failures.
5. Confirm signed inbound events for the dedicated test phone and negative replay, wrong-WABA, forged-signature, concurrent and restart scenarios. Log only redacted synthetic IDs for certification evidence.
6. Outbound messaging is still disabled in the application. Before qualifying a minimal user-authorized test send, establish consent and session-window evidence, dedicated sender credential custody, durable outbox and accurate delivery/failure receipt linkage. Unknown Graph HTTP outcomes must be reconciled rather than blindly retried.
7. Run the release matrix and independent review. Public launch authorization is separate from a successful provider connectivity test.

Reference: Meta official WhatsApp Business Platform Cloud API Postman collection, messages endpoint `POST https://graph.facebook.com/{Version}/{Phone-Number-ID}/messages`.

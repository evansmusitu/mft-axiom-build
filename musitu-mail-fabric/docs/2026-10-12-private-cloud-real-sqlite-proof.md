# MMF Cloudflare synthetic SQLite storage qualification — isolated, private

Date: 2026-10-12. Owner authorization: continue only the already deployed non-public MMF commercial-stage Worker; **do not modify shared payment Workers or their secrets**. This change does not enable login, billing, message sending, or any production tenant. All release flags remain `false`.

## Purpose and method

Verify actual Cloudflare SQLite-backed Durable Object storage rather than merely inspecting the namespace. Add a constrained test-only `MmfPrivateStorageProofEntrypoint` to the existing isolated Worker, callable solely through an internal Service Binding, with no public URL. Stage Worker retains HTTP 503 with `workers_dev=false`, `preview_urls=false`, no routes and no domain.

The test writes a random digest in a dedicated, fixed-name synthetic-only SQLite table in a single private test Durable Object. It reads the digest, forces that **test Durable Object only** to restart with `ctx.abort`, checks that the digest survives a new RPC invocation, deletes it, then verifies absence. It never reads/writes commercial customer tables. Methods reject if any commercial flag is enabled. RPC exposure is within the owner's Cloudflare account only; do not attach this Worker to a public customer route.

The GitHub workflow checks source and closed commercial status; independently confirms no public exposure, no secrets, and no shared-worker mutations before/after; updates only the isolated Worker, then launches a Wrangler **local loopback-only** Worker with a remote service binding to the deployed named entrypoint. No remote test Worker is published. A synthetic-only GitHub Actions artifact (no secrets) records the observed result. **No production assertion** is justified by this test.

## Required evidence

- Focused test first fails for missing implementation and passes after implementation (red/green).
- Full MMF regression and all protected repo controls green; branch only, `main` and PR #1 untouched.
- Cloudflare preflight proves existing private Worker binding inventory and no public routes / secrets.
- Remote service binding has `remote:true`, pinned name+entrypoint; a successful read after deliberate DO reset, then cleanup, proves real durable persistence.
- Zero merchant secrets, customer identities, Paynow calls, real email, new public domain or customer API.
- Cloudflare public and Preview URLs stay disabled.

## Remaining release gaps

Live MMF OIDC federation, production tenant provisioning and verified DNS ownership, public dashboard/API security, Resend webhook in the genuine MMF outbox, authorized real MMF Paynow checkout and signed settlement, and independently documented operational/privacy/legal acceptance remain outside this proof. Do not falsify external signatures. No public production release.
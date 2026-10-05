# MUSITU Axiom official support control plane

This directory is the isolated, whole-product support implementation. It is not Claude-specific and does not modify the frozen OpenAI surface.

## Implemented

- public, accessible support surface and secure case intake;
- one canonical case contract across product and provider surfaces;
- impact-derived priority and explicit state transitions;
- pre-storage credential/payment-secret rejection;
- AES-256-GCM narrative encryption with case-bound AAD;
- one-time recovery credentials with hash-only persistence;
- append-only, hash-chained case events;
- D1 schema with immutable event triggers;
- quantitative-dispute evidence packages that bind operation, result and hashes without raw inputs;
- verified public-incident receipts and an eleven-gate operational-readiness contract;
- human-approval gates for identity, billing, privacy, security, incident, purge, and production actions;
- fail-closed production readiness and anti-abuse checks;
- focused tests and a branch gate.

## Deployment prerequisites

Deployment must not proceed until all of these are real and verified:

1. A dedicated Cloudflare D1 database with `schema.sql` applied.
2. A newly provisioned 32-byte data-encryption key supplied only as `SUPPORT_DATA_KEY_B64` through the platform secret store. It must never be committed or printed.
3. A Cloudflare Turnstile widget for the approved hostname, with its public site key in `SUPPORT_TURNSTILE_SITE_KEY` and secret key only in the Worker secret store as `TURNSTILE_SECRET_KEY`. Server-side Siteverify, hostname, and action checks are mandatory.
4. The owner-approved `support.mftintelligence.com` hostname and DNS route. Approval is recorded; it is not a live claim until deployment verification passes.
5. A designated, trained human support owner and a different independent approver, each represented by an opaque non-secret reference, plus an escalation roster.
6. Privacy/security retention, key-rotation, incident, and erasure procedures.
7. Real accessibility, mobile, security, load, backup/restore, and notification-delivery evidence.

The approved public contact is `support@mftintelligence.com`; it must not be advertised as operational until Cloudflare Email Routing delivery is proven to a publisher-controlled destination.

`axiom-official-support-deploy.yml` is manual-only, branch-locked, exact-commit-bound, and environment-gated. It verifies that `SUPPORT_DATA_KEY_B64` and `TURNSTILE_SECRET_KEY` were already provisioned by name without reading either value. The workflow must not be dispatched until all eleven readiness gates pass.

`axiom-official-support-cloudflare-provision.yml` is a narrower, one-shot prerequisite workflow. It reuses the repository's already-masked Cloudflare API credential path to create or reuse only the exact `musitu-axiom-support` D1 database. It does not create or print Turnstile or encryption secrets, attach a hostname, deploy a Worker, alter DNS, or touch the frozen OpenAI surface.

`axiom-official-support-control-plane-provision.yml` performs the next approved prerequisite stage. It uses the existing masked Cloudflare email/global-key path, creates or reuses the exact Turnstile widget and approved email destination, deploys the Worker with no route and `workers.dev` disabled, generates a fresh 256-bit data key, stores both secrets directly through Cloudflare's secret API, and applies the D1 schema. It never records secret values and it verifies that the bootstrap remains non-public.

## Local tests

```sh
node --test support/tests/*.test.mjs
```

No production credentials are required or accepted by the test suite.

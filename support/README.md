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

## Current live verification status

The current authoritative readiness snapshot is `EVIDENCE/axiom-official-support-readiness-snapshot-20261006.json`. It records 6 PASS, 3 PARTIAL and 2 MISSING gates, with public deployment and operational claims explicitly blocked. Verified live prerequisites include D1 secure storage, a real zero-data encryption-key rotation drill, inbound support-email routing and delivery, outbound notification delivery, D1 Time Travel backup/restore, and automated Chromium keyboard/mobile/WCAG checks. The public support hostname remains unattached.

## Deployment prerequisites

Deployment must not proceed until all of these are real and verified:

1. A dedicated Cloudflare D1 database with `schema.sql` applied.
2. A newly provisioned 32-byte data-encryption key supplied only as `SUPPORT_DATA_KEY_B64` through the platform secret store. It must never be committed or printed.
3. A Cloudflare Turnstile widget for the approved hostname, with its public site key in `SUPPORT_TURNSTILE_SITE_KEY` and secret key only in the Worker secret store as `TURNSTILE_SECRET_KEY`. Server-side Siteverify, hostname, and action checks are mandatory.
4. The owner-approved `support.mftintelligence.com` hostname and DNS route. Approval is recorded; it is not a live claim until deployment verification passes.
5. A designated, trained human support owner and a different independent approver, each represented by an opaque non-secret reference, plus an escalation roster.
6. Privacy/security retention, key-rotation, incident, and erasure procedures.
7. Real accessibility, mobile, security, load, backup/restore, and notification-delivery evidence.

The approved support contact is `support@mftintelligence.com`. Cloudflare Email Routing and end-to-end delivery are now verified to a publisher-controlled destination, but the overall support service must not be advertised as publicly operational until the remaining readiness gates pass and the hostname deployment is explicitly authorized.

`axiom-official-support-deploy.yml` is manual-only, branch-locked, exact-commit-bound, and environment-gated. It verifies that `SUPPORT_DATA_KEY_B64` and `TURNSTILE_SECRET_KEY` were already provisioned by name without reading either value. The workflow must not be dispatched until all eleven readiness gates pass.

`axiom-official-support-cloudflare-provision.yml` is a narrower, one-shot prerequisite workflow. It reuses the repository's already-masked Cloudflare API credential path to create or reuse only the exact `musitu-axiom-support` D1 database. It does not create or print Turnstile or encryption secrets, attach a hostname, deploy a Worker, alter DNS, or touch the frozen OpenAI surface.

`axiom-official-support-control-plane-provision.yml` performs the next approved prerequisite stage. It uses the existing masked Cloudflare credentials, preferring the authorized email/global-key path and safely falling back to the already-working scoped token, creates or reuses the exact Turnstile widget and approved email destination, uploads a bundled Worker directly through the Workers API with no assets or route and `workers.dev` disabled, generates a fresh 256-bit data key, stores both secrets directly through Cloudflare's secret API, and applies and reads back the D1 schema through the D1 API. It never records secret values and it verifies that the bootstrap remains non-public. Historical email-address permission failures were recorded without weakening the isolated bootstrap. Destination verification and delivery have since passed; public deployment remains blocked by the current eleven-gate readiness snapshot.

## Local tests

```sh
node --test support/tests/*.test.mjs
```

No production credentials are required or accepted by the test suite.

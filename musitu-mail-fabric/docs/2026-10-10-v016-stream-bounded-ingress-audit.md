# MUSITU Mail Fabric v0.16 — Stream-Bounded Ingress and Internal RPC Security Review

**Date:** 2026-10-10. **Authority:** isolated product development branch; no protected GitHub branch, frozen OpenAI surface, or customer infrastructure changes.

## Security failure modes addressed

Three independently reachable request-processing surfaces accepted attacker-controlled bodies without a complete, early byte bound and/or deterministic UTF-8 validation.

| Surface | Previous behavior | v0.16 verified requirement |
| --- | --- | --- |
| Scoped `/feedback-rpc` cross-Worker bridge | `await request.text()` consumed an entire authenticated-but-untrusted stream, checking only JavaScript character length after buffering. | Reject declared body over 15,000 **bytes** immediately; stop a chunked stream after the first threshold-crossing chunk; accept JSON MIME only; reject invalid UTF-8, negative/non-numeric Content-Length, and authorization failures **before any SQL access**. |
| Customer `POST /v1/messages` | `await request.text()` buffered an arbitrarily large body and checked 30,000 bytes only afterward; malformed UTF-8 could be replaced. | Require a hard 30,000-byte streaming limit, early declared-length rejection, fatal UTF-8 decoding, and no database mutation on rejected requests. Legacy authenticated small JSON sent without an explicit JSON media type remains compatible, matching the preexisting API behavior. |
| Operator suppression / sender revocation | Duplicated custom capped readers used replacement UTF-8 decoding and accepted malformed Content-Length headers. | Centralize strict JSON MIME, byte limits (1,024 and 300 bytes), cancellation, fatal UTF-8 decoding and malformed-length errors while preserving separate operator-token authorization and existing atomic safety controls. |

The implementation reuses the existing `src/webhooks/bounded-body.mjs` bounded stream reader for all four entry points. Feedback RPC and operator mutations require JSON MIME; customer API retains its existing MIME compatibility, but JSON parsing and authentication still apply.

**No changes were made to the cryptographic provider event verification logic, authenticated provider correlation, message encryption algorithms, sending quotas, PITR recovery, or signed evidence format.**

## Test-first evidence

The corresponding regression tests were committed before implementing their fixes, so the CI failure phase can be inspected:

- [GitHub commit 3dbf7c2](https://github.com/evansmusitu/mft-axiom-build/commit/3dbf7c24287de163537a7485dc449db5d13c20f7) and [workflow 38061481026](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38061481026): three expected failures exposed unbounded scoped feedback RPC behavior, oversized stream consumption, and missing strict MIME handling.
- [GitHub commit a167541](https://github.com/evansmusitu/mft-axiom-build/commit/a1675417287066e64933a8b651769fb818b38dab) and [workflow 38061669245](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38061669245): three expected failures showed customer oversized body declared length returning 400 instead of 413, excessive streaming reads, and malformed UTF-8 returning INVALID_JSON rather than INVALID_UTF8.
- [GitHub commit aed27b9](https://github.com/evansmusitu/mft-axiom-build/commit/aed27b9af0e6b2250bba2c8f79688feb616f4060) and [workflow 38061825816](https://github.com/evansmusitu/mft-axiom-build/actions/runs/38061825816): two expected failures showed malformed operator Content-Length and malformed UTF-8 did not have the required fail-closed responses.

After correcting these bugs, the existing isolated regression workflows passed. A separate **nondeploying** build gate was updated to run the ingress security suite, the scoped bridge tests, and `wrangler deploy --dry-run` with explicit checks for no public routes, disabled customer transport and a still-disabled external outbox link. Its current run status should be checked live rather than inferred from the presence of this document.

Relevant tests:

- `test/webhook-scoped-feedback-rpc.test.mjs`
- `test/customer-api-bounded-body.test.mjs`
- `test/operator-input-bounds-v016.test.mjs`
- `test/webhook-linked-outbox.test.mjs`
- `test/webhook-ingress-boundary-v015.test.mjs`
- All prior suites remain in `npm test`.

## Provider and independent assessment status

A read-only check of the connected Resend account on 2026-10-10 confirmed one **verified sending domain**, with sending enabled, but **zero configured webhooks**. The application therefore **cannot** assert that real Resend-originated events reach an actual MUSITU accepted-message outbox. The nonpublic webhook Worker still has no live external outbox association; the linked template remains explicitly disabled.

The following are not completed by this implementation:

1. Provisioning a genuinely isolated, least-privilege cross-Worker sender/outbox capability in real Cloudflare staging and verifying authenticated feedback through both deployed Workers without public ingress or real delivery.
2. Registering a public event ingress with Resend and conducting a separately authorized provider-originated delivery, bounce and complaint test to controlled recipients.
3. Production key escrow/recovery in an independently controlled KMS/HSM, offline authenticated restore with real cloud storage, and full long-duration failure-recovery drills.
4. Independent third-party security/penetration assessment with a signed scope, named auditor, critical/high finding remediation and retest.
5. Legal, data retention, consent, sender-reputation operations, customer contracts, incident monitoring and service-level readiness.

These cannot be substituted with internal tests, synthetic signatures, private Cloudflare deployment, or the appearance of a successful CI run. No live customer email, public route, DNS change, paid infrastructure upgrade or external assessor certification occurred in this v0.16 change.

## Risk classification

The newly fixed unbounded parsing behavior was an availability and resource-exhaustion vulnerability for authenticated customer and internal operator/feedback routes. It was not evidence of unauthorized public access, leaked data or actual exploitation. Shared parsing logic reduces inconsistent parser behavior but does not replace perimeter rate limiting, user authentication, data retention or an independent audit.

**Current release decision:** FAIL-CLOSED; appropriate for isolated development/testing, **not** authorized for public customer traffic.

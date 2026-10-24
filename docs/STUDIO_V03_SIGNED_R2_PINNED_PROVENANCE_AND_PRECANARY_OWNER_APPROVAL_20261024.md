# MUSITU Enterprise Studio V0.3 — Signed R2 Pinned Provenance and Pre-Canary Owner Approval

Date: 2026-10-24. **Development branch source only. No production deployment, provider authentication, live Cloudflare R2 reads, Neon cutover or billable rendering.**

## Correctness/security deficiencies addressed

1. The prior read-only Neon canary callback only asked for signed owner browser approval **after** a SQLite-to-Neon route CAS. Even if rollback worked, an unsigned user could briefly observe Neon before the owner had accepted the operation. The updated guard demands a **structured, independently signature-verified owner approval before CAS**, and verifies the same acceptance ID again after cutover. An unscoped, expired, stale, unauthenticated, viewer-signed, boolean-true, or changed-epoch approval fails closed.
2. The prior R2 provider attestation required `versions_pinned: true` and an independent provider verification callback, but lacked a reusable, testable cryptographic commitment linking the exact frozen **asset contents**, their **pinned object versions**, the **R2 bucket identity**, the **GitHub source revision**, and the **canary run**. The new source-only `r2_signed_attestation.mjs` provides deterministic digesting of the complete version manifest and domain-separated Ed25519 verification of an owner-operator-signed evidence envelope. It rejects extra unsigned fields, duplicate or missing assets, invalid pinned object IDs, unmatched content HMACs, expired signatures, wrong trust roots, key types, run IDs, freeze IDs and source heads.
3. The new optional `createStudioR2ProviderReceiptVerifier` composes signature verification with independent callback checks for genuine provider-origin/version assurance and **all remaining provider receipts**. A mocked `true` in tests demonstrates only control flow, not Cloudflare provider assurance. Failures return `false`, not secret-bearing error text. Untrusted evidence cannot supply its own trusted public keys.

## Trust boundaries that remain intentionally unproven

- The signature belongs to an **operator-controlled pinned Ed25519 public-key root**, **not** an automatic Cloudflare R2 signature. Do not claim Cloudflare cryptographically signs these receipts. Provider origin must be independently established by a trusted, authenticated Cloudflare reader that examines immutable object identity and bytes. Neither an object ETag nor an arbitrary string called a `version_id` establishes immutability.
- Trusted public keys must come from owner-pinned configuration and be passed as a `Map` of *public Ed25519 `KeyObject` instances*, not private keys or raw PEM strings. Keep private signing keys off client/CI artifacts and outside this repository. Rotate trust anchors under a documented owner-controlled process. A signature does not create ownership authority from nothing.
- A manifest proves consistency of a claimed version ID for every asset. The production system must demonstrate that each version is actually provider-retrievable, immutable and tied to the bytes read. If Cloudflare account/bucket capabilities cannot supply this proof, the migration remains blocked. Never substitute R2 object metadata or naked ETags for provider-backed verification.
- `verifySignedBrowser` **must** independently verify actual owner login and the browser signature under Cloudflare Access or an equivalent trusted authority; an object with fields set to `true` is not itself proof. Require `owner_role:owner`, exactly scoped `studio-v03-neon-readonly-canary`, exact source SHA, freeze and run ID, an independently verified signature, fresh timestamps and an unexpired approval ID. This schema is intentionally strict and changes the source-only callback contract; an old boolean acceptance is rejected.
- The new composition helper cannot replace an independent signer identity registry, revocation checks, nonce replay storage, genuine SQLite DO freeze/backup/restore, live immutable-audit and R2 reconciliation, private Worker-to-Neon transport, tested rollback, and provider-enforced absolute billable-spend protections.
- The promotion module still only permits a **temporary READ-ONLY canary** and attempts to restore SQLite before lease release. It is not authorization for production database migration or write activation. Lease/route controls must be durable, independent, crash recoverable and validated on provider infrastructure before routing any customer traffic.

## Offline reproducer

From the repository root, on Node.js 22:

```sh
node --test musitu_studio/neon/tests/*.test.mjs
node --test musitu_studio/edge/tests/v03_glb_animation.test.mjs musitu_studio/edge/tests/v03_glb_export.test.mjs musitu_studio/edge/tests/v03_scene_preview.test.mjs
python -m unittest discover -s ops/tests -p 'test_studio*.py'
```

Tests verified before branch commit: **140 Neon, 23 GLB/scene preview, 27 Python operations**. Old owner approval regression was observed failing before the safety change and passing after. Full Edge (including `jose`-dependent tests) and GitHub-hosted CI at this new commit have not been independently verified. External `npm ci` in the isolated work environment was not available and must not be described as a full Edge test pass.

## Source-only cutover posture

Cloudflare Studio V0.3 Access, SQLite Durable Objects, production R2, Studio V0.2, Axiom main, Neon public-network protection and Modal billing have not been mutated. **NO-GO** until verified signed owner mobile browser acceptance, signed authenticated production DO export, complete immutable audit and byte-level R2 reconciliation, independent provider origin attestation, private Neon connectivity, safe hosted restore, rollback and provider-enforced spending restrictions.

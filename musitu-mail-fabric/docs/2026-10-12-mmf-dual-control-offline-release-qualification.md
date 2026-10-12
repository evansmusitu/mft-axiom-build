# MMF — two-signer encrypted patch release qualification (isolated, never production approval)

**Date:** 2026-10-12. **Authority:** user authorized engineering continuation, **not** a second independent institutional release approval. **Scope:** isolated product branch only. No shared Cloudflare Worker deploy, real Paynow payment, customer mail or production secret access.

## What the code establishes

`src/commercial/mmf-dual-release-gate.mjs` strictly validates a canonical JSON release-intent envelope that names the **specific archived encrypted patch** (`52ed96bc4ed92e127fff36aeefc857fe31ca5c9558c59648291d867cafcac97b`), its manifest SHA-256 (`718eb22a26a4d2949647aeaa8b0e367bf596dfc96ccf852bbf35860c2850f359`), the captured source Git HEAD (`b60f8b34cd184b3a405085b1ef46ec9db6cf7027`), exact two original normalized source hashes, legacy binding metadata SHA-256 hashes, and proposed source hashes. The values are pinned to verified 2026-10-11/12 encrypted candidate and GET-only baseline evidence. The release intent has an expiry bounded to ten minutes and a nonce.

Both *test-only* Ed25519 signatures must cryptographically validate over exactly the same canonical intent, with different public key fingerprints and the fixed roles `OWNER` and `INDEPENDENT_REVIEWER`. Replay state is atomically recorded after both pass. Unknown schema fields, unsafe flag changes, source or binding substitution, stale/future intent, swapped signatures, extra credentials, identical signer keys and wrong candidate digest are rejected. No real signer has signed this intent. Caller-provided test keys **are not an institutional trust anchor**: a local attacker who controls the caller can create two keys and pass the isolated check, which **always** returns `productionReleaseAuthorized=false`, `canDeploySharedWorkers=false`, and `mayInitiateRealPayments=false`.

## Verified local test sequence

- `node --test test/mmf-dual-release-gate.test.mjs` initially observed three relevant failing cases with the deliberately denied production stub (red); two negative-control tests stayed green as expected.
- After implementation, the same command passed five tests and zero failures (green).
- `npm run check`, `npm test`, and `npm run check:phase1` are required for final qualification. The last command **must** exit 2 with BLOCKED status.
- The branch-scoped GitHub workflow `.github/workflows/mmf-dual-release-offline-ci-20261012.yml` runs only pure Node offline checks with `contents:read`, no secrets and no deployment permission. Verify its actual run before claiming GitHub Actions success.

## Missing evidence needed for any production decision

1. A **separate, identified and independently authorized reviewer** must be established via verified out-of-band identity, including an independently pinned public key or HSM-backed signature validation. Test signers do not count.
2. Exact release payload must be refreshed after a same-run Cloudflare source/binding inventory and checked against the *then-current* source, routes, and full Worker deployment configuration.
3. An owner and the real independent reviewer must sign the identical candidate, deployment plan, rollback procedure and expiration window. A durable, centralized anti-replay record and independent audit journal are required.
4. Paynow's merchant/product rights for MMF, legal/tax/settlement terms, provider callback signature validation, credential creation/rotation/revocation and a non-exportable-secret-safe canary rollback must be verified externally.
5. Complete FMI, Chemistry and Axiom legacy regression verification is required, including real Cloudflare version/binding/route management. An offline exact-source restore is not a tested production rollback.
6. A separate explicitly controlled deployment and consent-based payment pilot remain further release gates. No production write or provider transaction is performed or authorized by these tests.

**Bottom line:** Pure offline cryptographic construction and negative qualification completed. Real two-person governance, Paynow merchant authority, operational secrets and live rollback have **not** been demonstrated.
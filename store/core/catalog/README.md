# MUSITU Store signed catalog v2 — isolated candidate

**Status:** EXPERIMENTAL, NOT PUBLISHED, NOT USED BY THE EXISTING ANDROID STORE.

This is a security-validation foundation for the Phase-1 multi-publisher marketplace. It does not change the signed Phase-1 catalog, APK, Cloudflare worker, production route or native Android client.

## Interface

`verifySignedRegistryV2({catalogBytes,signatureBytes,rootPublicKeyPem,expectedRootPemSha256,highestAcceptedRevision,highestAcceptedDigest,allowedArtifactHosts,now})`

- `catalogBytes`: exact raw UTF-8 JSON bytes, maximum 1 MiB.
- `signatureBytes`: detached **DER** ECDSA P-256/SHA-256 signature over those exact bytes. A transport using base64 must decode before calling the validator.
- `rootPublicKeyPem`: operator-provisioned catalog trust anchor (not a value accepted from a publisher upload or a catalog).
- `expectedRootPemSha256`: trusted SHA-256 of **UTF-8 PEM file bytes including its final newline**. The current Phase-1 PEM uses `4cf17f70dbab900237d8b82b4e989978c667e6ec841de6df79469aa6c5ebd5c0`. This is not the SHA-256 of the DER-encoded SPKI.
- `highestAcceptedRevision` / `highestAcceptedDigest`: durable trusted rollback/equivocation watermark. A new install explicitly starts with revision `0`; an established client must load its last committed watermark.
- `allowedArtifactHosts`: operator-provisioned exact HTTPS delivery hosts, never supplied by an uploaded app.
- `now`: trusted observation time. The validator has **no implicit local-clock fallback**.

The result contains `registry`, `catalogSha256` and `verifiedRootPemSha256`. The registry is recursively immutable.

## Root-authorized ownership

Catalog schema: `musitu.store.catalog.v2`.

`publishers[]` define unique IDs and root-authorized platform/package/signing-certificate delegations. `apps[]` refer to exactly one publisher and list immutable versioned artifacts.

An Android or Windows release must match its owner's delegated package ID and signing-certificate SHA-256. Web releases must match a delegated HTTPS application identity. Duplicate package ownership, missing delegations, unauthorized signers, untrusted delivery hosts, invalid hashes, expired metadata and catalog rollback are rejected.

The ECDSA root signature authorizes the **registry metadata**, not the contents of remote binaries. Download clients must separately verify actual bytes, native package identity, platform certificates, version compatibility, required permissions and OS installation approval.

## Not yet built / security boundaries

- Publisher identity verification and proof of package ownership at onboarding.
- Governance and approval process for root signing or signer rotation.
- Secure transactional persistence of accepted catalog revision/digest; race-safe atomic update.
- Revocation distribution, key-compromise recovery and offline freshness policy beyond the signed expiry.
- Android native integration, automatic updater, Windows/MSIX path and actual operating-system certification.
- Commercial publisher onboarding, billing and dispute processes.

Never convert a passed Node test into a claim of physical-device certification, customer readiness or a production release. A signed v2 catalog must not be produced without separate approval and signing custody.

## Isolated test

```bash
node --test store/core/catalog/signed-registry-v2.test.mjs
```

The Node suite uses a newly generated ephemeral P-256 test key; it does **not** use MUSITU's production private key. The historical public PEM is read only to verify trust-anchor fingerprint continuity.

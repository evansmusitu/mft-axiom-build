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


## Isolated private catalog rollback-watermark candidate (2026-10-18)

`signed-registry-v2-watermark.mjs` is a **Linux-only, private, offline**
persistence gate for future signed catalog consumers. It does not authorize
production publication, onboard actual publishers, or connect a live client.
The operator must provision a trusted absolute owner-controlled filesystem
directory (mode 0700) and securely supply the pinned P-256 root public key,
its fingerprint, trusted artifact-host allowlist and trusted time.

`verifyAndCommitSignedRegistryV2({storeDirectory,verificationOptions,bootstrapAuthorized})`
takes the usual `verifySignedRegistryV2` inputs **except** the two watermark
arguments, which this module derives exclusively from its owner-private disk
state. First-use enrollment requires explicit `bootstrapAuthorized: true`.
Existing states cannot be silently re-enrolled, and root-fingerprint changes,
same-revision equivocation, lower-revision replay and altered signatures fail
closed. State is written via exclusive lock, private temporary file, file fsync,
same-directory rename and directory fsync. Incomplete pending writes and stale
locks halt automatic processing for independent operator review; the
implementation deliberately does **not** auto-delete or bypass evidence of
interrupted persistence. It never signs or publishes catalog contents.

**Limitations / unmet production gates:** durable state resides only on local
filesystem custody, not a remotely anchored transparency log or
hardware-backed monotonic counter. Restoring an old whole-filesystem image or
deleting the entire trusted state directory can defeat persistence; OS
permission isolation, a backed-up or externally witnessed watermark, crash
recovery and multiple-node coordination require independent qualification.
It is not Windows-compatible. The original signed V1 client, production worker,
signed root key, and release paths remain unchanged.

Offline isolated tests:

```sh
node --test store/core/catalog/signed-registry-v2.test.mjs \
  store/core/catalog/signed-registry-v2-watermark.test.mjs
```

## Offline signed-artifact staging candidate (2026-10-18)

`signed-artifact-stage-v2.mjs` introduces an **isolated, Node/Linux-only**
byte-verification step for a single platform-specific release selected from
a **root-signed V2 catalog**. The candidate verifies the catalog signature,
root fingerprint, package delegation, release identity, trusted time and
revision watermark supplied by an **independently trusted caller**, then
copies the selected local artifact through a bounded SHA-256-verifying process
into a 0700 operator-owned private cache. File entries are private (0600),
must be regular owner-owned single-link files, are never followed through
their final-component symlinks, and are atomically published using a
no-overwrite hard link after fsync. Reused cache content is rehashed before
a path is returned. Tampered sources, size mismatches, cache poisoning,
ambiguous releases, invalid signatures and expired catalogs are rejected.

This module **does not** download from the network, publish a catalog,
declare a publisher approved, install an APK, invoke a Windows package
installer, trigger a browser PWA prompt or issue entitlement/payments. The
returned status is only `STAGED_PRIVATE_REVIEW_ONLY`.

Important: the caller's `verificationOptions` (pinned root, approved hosts,
trusted time and last-accepted revision/digest) are a **security dependency**,
not subscriber-controlled metadata. The standalone byte-staging helper
does not yet call `verifyAndCommitSignedRegistryV2` and does not itself
persist rollback protection. Do not expose it to publisher, app-user or
network inputs until an authenticated, transactional durable watermark
integration and secure OS-specific consumer handoff have been qualified.
Filesystem ownership cannot prevent whole-filesystem snapshot rollback or
a compromised trusted user. All tests use synthetic ephemeral signing
identities and synthetic local artifact bytes, not commercial apps.

Offline test command:

```sh
node --test store/core/catalog/signed-registry-v2.test.mjs \
  store/core/catalog/signed-registry-v2-watermark.test.mjs \
  store/core/catalog/signed-artifact-stage-v2.test.mjs
```

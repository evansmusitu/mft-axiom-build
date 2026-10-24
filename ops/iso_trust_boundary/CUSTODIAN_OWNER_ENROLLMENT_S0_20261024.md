# AXIOM — owner appointed as independent security custodian (isolated S0 candidate)

**Authority event (owner):** The owner explicitly appointed themselves as the intended independent AXIOM security custodian on 2026-10-24 and authorized no-charge, isolated security qualification. This is an **owner decision only**. It is **not evidence** of independent account ownership, separate identity, hardware or cloud key custody, verified MFA, independent verifier, production authority, provider access, or authorization to alter protected infrastructure.

**No external provisioning or activation has occurred through this feature.** Public GitHub source must not contain an actual custodian's account identity, recovery contact details, private key, real signed enrollment evidence, provider billing information, session token, device evidence or immutable security credentials.

## Contract implemented

`custodian_enrollment_s0.CustodianEnrollmentS0` accepts a caller-supplied Ed25519 *public* key, a custodian reference, a **different** verifier reference, an exact policy digest and key epoch. Its `prepare_local_challenge()` creates a random 256-bit local challenge with a maximum five-minute life. `review()` checks a signed, domain-separated challenge, public key fingerprint, pinned role/verifier/policy, exact fields, strict timestamp and local replay hints. Both methods have **no network and no durable storage**. It never signs or holds private material and never issues a credential, grant, reservation, external write, production authority, or provider dispatch.

Positive tests can assert `LOCAL_PUBLIC_KEY_POSSESSION_ONLY`. This means the synthetic signer has the private key corresponding to a *caller-provided* pin. It does not authenticate a real human, prove independent custody, prove verifier independence, or upgrade operation risk. In particular `owner_authorized_custody` MUST NEVER be mistaken for `external_identity_verified` or `production_authority`.

## Custodian steps outside AXIOM (not completed)

1. **Private account and MFA:** Custodian establishes a separately owned identity provider or security account with MFA; builder/AXIOM agents have no administrator or recovery privileges. Keep recovery factors separate and private. Do not enter secrets in the chat or repository. Creation or mutation of external security accounts is a separate S5 approval and is **not** authorized by this document.
2. **Independent verifier:** Appoint a distinct trusted verifier with **read-only** independent access and ability to reject evidence. The owner can be the custodian but must not simultaneously act as the sole independent verifier of their own custody. Independent verifier identity and authority are pending.
3. **Non-exportable signer:** Under authorized external custody, create or select a non-exportable signing key and obtain a provider-origin public key, algorithm, attestation/custody evidence, key ID, epoch and revocation authority. No payment method or paid service may be enabled without separate approval; no free-tier promises count as account-wide $0 hard-cap proof. Backend must support compatible domain-separated signing, or independently reviewed protocol adaptation.
4. **Out-of-band pin:** Independent verifier obtains and pins the public key and trust roots directly from trusted provider origin, separately from builder input. An unreviewed user claim or screenshot is NOT pin verification. Recheck key rotation, revocation and current trust state.
5. **Challenge/response:** Independent verifier issues and tracks a unique single-use challenge; custodian approves one signing operation through the custodian-controlled service/device. AXIOM may review a **public** signature against a verified pin, but must never see the private key or inherit the service's authorizing privileges. Local test challenges created by this module have no trustworthy issuance record.
6. **Monotonic ledger and attacks:** Independent service performs atomic reservation and append-only external monotonic anchoring, with dual independent readback and deliberate cross-host rollback/deletion/replay/lost-ACK/concurrent-key-rotation testing. Evidence that restoring ALL local anchors allows replay means **B27=FAILED_IN_SYNTHETIC_ATTACK** until separately proven fixed.
7. **Revocation and zero spend:** Demonstrate independent revocation freshness and emergency kill from custodian-owned controls. Obtain provider-origin confirmation of an enforceable **hard account-wide USD $0 ceiling** before any paid provider call. An ordinary budget alert or local JSON quote is not a hard cap.
8. **Independent review and owner release:** Independent security reviewer verifies all evidence; fail closed on missing gaps. Only owner separately approves any S3 security integration or repository agent mutation, S4 public/production deployment, or S5 identity/secret/policy or destructive operation. Production remains rollback origin.

## Qualification status and interpretation

| Gate | At this handoff |
|---|---|
| User-appointed custody authority | **AUTHORIZED_DECISION_ONLY** |
| Real separate security tenant/MFA/roles | **NOT_PROVEN** |
| Exclusive external non-exportable signing key | **NOT_PROVEN** |
| Out-of-band authenticated public root pin | **NOT_PROVEN** |
| Independent verifier separate from custodian/builder | **NOT_PROVEN** |
| External durable atomic single-use ledger | **NOT_PROVEN** |
| Full destructive rollback / global antirollback | **FAILED_IN_SYNTHETIC_ATTACK** |
| Independent live revocation / time | **NOT_PROVEN** |
| External account-wide USD $0 enforcement | **NOT_PROVEN** |
| Production/public/privileged execution | **NOT_AUTHORIZED_NOT_QUALIFIED** |

**Keep all AXIOM surfaces and five permanent objects:** Project · Work · Agent · Artifact · Evidence. Isolated S0 security engineering does not narrow AXIOM's whole-product objective-to-outcome architecture.

## Reproduce only the local, synthetic checks

`python -m unittest ops.iso_trust_boundary.test.test_custodian_enrollment_s0 -v`

`python -m unittest discover -s ops/iso_trust_boundary/test -p 'test_*.py' -v`

`python3 ops/trackb27/VERIFY_B27_LOCAL.py`

Never reinterpret PASS from the negative B27 test suite as resolving the B27 vulnerability. No signer or independent security service has been provisioned by these tests.

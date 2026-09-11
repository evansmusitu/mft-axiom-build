from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping
import hashlib
import hmac

from .core import canonical, parse_time, sha256


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


def _canonical_identity(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and value == value.strip()
        and value == " ".join(value.split())
    )


def _valid_secret(value: Any) -> bool:
    return isinstance(value, (bytes, bytearray)) and len(value) >= 32


def _valid_trusted_key_set(value: Any) -> bool:
    return (
        isinstance(value, frozenset)
        and all(_canonical_identity(key_id) for key_id in value)
    )


def _ambiguous_trust_key_ids(trusted_issuers: Mapping[str, frozenset[str]]) -> set[str]:
    owners: dict[str, set[str]] = {}
    for issuer_org, key_ids in trusted_issuers.items():
        if not _canonical_identity(issuer_org) or not _valid_trusted_key_set(key_ids):
            continue
        owner = issuer_org.casefold()
        for key_id in key_ids:
            owners.setdefault(key_id, set()).add(owner)
    return {key_id for key_id, issuer_orgs in owners.items() if len(issuer_orgs) > 1}


@dataclass(frozen=True)
class ExternalAttestationReceipt:
    schema: str
    subject_type: str
    subject_id: str
    subject_hash: str
    issuer_org: str
    verifier_key_id: str
    provenance_type: str
    issued_at: str
    receipt_hmac: str

    def __post_init__(self) -> None:
        if self.schema != "musitu.axiom.external-attestation.v1":
            raise ValueError("unsupported external attestation schema")
        identities = (
            self.subject_type,
            self.subject_id,
            self.issuer_org,
            self.verifier_key_id,
            self.provenance_type,
        )
        if any(not _canonical_identity(value) for value in identities):
            raise ValueError("external attestation identities must be canonical non-empty strings")
        if not _valid_sha256(self.subject_hash):
            raise ValueError("external attestation subject hash must be SHA-256")
        parse_time(self.issued_at)
        if not _valid_sha256(self.receipt_hmac):
            raise ValueError("external attestation HMAC must be SHA-256")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class ExternalAttestationService:
    """Runtime verification for externally held attestation keys.

    Verifier secrets and the issuer/key trust map are supplied by the evaluator at
    execution time and must never be committed to the candidate repository. HMAC
    authenticates the receipt bytes; it does not by itself prove organizational
    independence, so issuer/key trust is a separate required input. A verifier key
    ID is bound to exactly one normalized issuer organization within a trust root.
    """

    @staticmethod
    def _body(
        *,
        subject_type: str,
        subject_id: str,
        subject_hash: str,
        issuer_org: str,
        verifier_key_id: str,
        provenance_type: str,
        issued_at: str,
    ) -> dict[str, Any]:
        return {
            "schema": "musitu.axiom.external-attestation.v1",
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_hash": subject_hash,
            "issuer_org": issuer_org,
            "verifier_key_id": verifier_key_id,
            "provenance_type": provenance_type,
            "issued_at": issued_at,
        }

    @classmethod
    def issue(
        cls,
        *,
        subject_type: str,
        subject_id: str,
        subject_hash: str,
        issuer_org: str,
        verifier_key_id: str,
        provenance_type: str,
        issued_at: str,
        verifier_secret: bytes,
    ) -> ExternalAttestationReceipt:
        identities = (subject_type, subject_id, issuer_org, verifier_key_id, provenance_type)
        if any(not _canonical_identity(value) for value in identities):
            raise ValueError("external attestation identities must be canonical non-empty strings")
        if not _valid_secret(verifier_secret):
            raise ValueError("external verifier secret must be bytes with length >=32")
        parse_time(issued_at)
        if not _valid_sha256(subject_hash):
            raise ValueError("subject_hash must be SHA-256")
        body = cls._body(
            subject_type=subject_type,
            subject_id=subject_id,
            subject_hash=subject_hash,
            issuer_org=issuer_org,
            verifier_key_id=verifier_key_id,
            provenance_type=provenance_type,
            issued_at=issued_at,
        )
        signature = hmac.new(bytes(verifier_secret), canonical(body).encode("utf-8"), hashlib.sha256).hexdigest()
        return ExternalAttestationReceipt(**body, receipt_hmac=signature)

    @classmethod
    def verify(
        cls,
        receipt: ExternalAttestationReceipt,
        *,
        expected_subject_type: str,
        expected_subject_id: str,
        expected_subject_hash: str,
        verifier_secrets: Mapping[str, bytes],
        trusted_issuers: Mapping[str, frozenset[str]],
    ) -> dict[str, Any]:
        reasons: list[str] = []
        ambiguous_key_ids = _ambiguous_trust_key_ids(trusted_issuers)
        if receipt.verifier_key_id in ambiguous_key_ids:
            reasons.append("external_attestation_key_reused_across_issuers")
        trusted_keys = trusted_issuers.get(receipt.issuer_org)
        if trusted_keys is None:
            reasons.append("untrusted_external_issuer_or_key")
        elif not _valid_trusted_key_set(trusted_keys):
            reasons.append("external_attestation_trust_root_invalid")
        elif receipt.verifier_key_id not in trusted_keys:
            reasons.append("untrusted_external_issuer_or_key")
        secret = verifier_secrets.get(receipt.verifier_key_id)
        if not _valid_secret(secret):
            reasons.append("external_verifier_secret_unavailable")
        if not _canonical_identity(expected_subject_type):
            reasons.append("external_attestation_expected_subject_type_invalid")
        elif receipt.subject_type != expected_subject_type:
            reasons.append("external_attestation_subject_type_mismatch")
        if not _canonical_identity(expected_subject_id):
            reasons.append("external_attestation_expected_subject_id_invalid")
        elif receipt.subject_id != expected_subject_id:
            reasons.append("external_attestation_subject_id_mismatch")
        if not _valid_sha256(expected_subject_hash):
            reasons.append("external_attestation_expected_subject_hash_invalid")
        elif receipt.subject_hash != expected_subject_hash:
            reasons.append("external_attestation_subject_hash_mismatch")
        parse_time(receipt.issued_at)
        if _valid_secret(secret):
            body = cls._body(
                subject_type=receipt.subject_type,
                subject_id=receipt.subject_id,
                subject_hash=receipt.subject_hash,
                issuer_org=receipt.issuer_org,
                verifier_key_id=receipt.verifier_key_id,
                provenance_type=receipt.provenance_type,
                issued_at=receipt.issued_at,
            )
            expected = hmac.new(bytes(secret), canonical(body).encode("utf-8"), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(receipt.receipt_hmac, expected):
                reasons.append("external_attestation_authentication_failed")
        return {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": sorted(set(reasons)),
            "issuer_org": receipt.issuer_org,
            "verifier_key_id": receipt.verifier_key_id,
            "provenance_type": receipt.provenance_type,
            "receipt_sha256": receipt.fingerprint,
        }

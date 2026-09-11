from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping
import hashlib
import hmac

from .core import canonical, parse_time, sha256


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
        if not all((self.subject_type, self.subject_id, self.issuer_org, self.verifier_key_id, self.provenance_type)):
            raise ValueError("complete external attestation identity required")
        if len(self.subject_hash) != 64:
            raise ValueError("external attestation subject hash must be SHA-256")
        parse_time(self.issued_at)
        if len(self.receipt_hmac) != 64:
            raise ValueError("external attestation HMAC must be SHA-256")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class ExternalAttestationService:
    """Runtime verification for externally held attestation keys.

    Verifier secrets and the issuer/key trust map are supplied by the evaluator at
    execution time and must never be committed to the candidate repository. HMAC
    authenticates the receipt bytes; it does not by itself prove organizational
    independence, so issuer/key trust is a separate required input.
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
        if len(verifier_secret) < 32:
            raise ValueError("external verifier secret must be >=32 bytes")
        parse_time(issued_at)
        if len(subject_hash) != 64:
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
        signature = hmac.new(verifier_secret, canonical(body).encode("utf-8"), hashlib.sha256).hexdigest()
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
        trusted_keys = trusted_issuers.get(receipt.issuer_org, frozenset())
        if receipt.verifier_key_id not in trusted_keys:
            reasons.append("untrusted_external_issuer_or_key")
        secret = verifier_secrets.get(receipt.verifier_key_id)
        if secret is None or len(secret) < 32:
            reasons.append("external_verifier_secret_unavailable")
        if receipt.subject_type != expected_subject_type:
            reasons.append("external_attestation_subject_type_mismatch")
        if receipt.subject_id != expected_subject_id:
            reasons.append("external_attestation_subject_id_mismatch")
        if receipt.subject_hash != expected_subject_hash:
            reasons.append("external_attestation_subject_hash_mismatch")
        parse_time(receipt.issued_at)
        if secret is not None and len(secret) >= 32:
            body = cls._body(
                subject_type=receipt.subject_type,
                subject_id=receipt.subject_id,
                subject_hash=receipt.subject_hash,
                issuer_org=receipt.issuer_org,
                verifier_key_id=receipt.verifier_key_id,
                provenance_type=receipt.provenance_type,
                issued_at=receipt.issued_at,
            )
            expected = hmac.new(secret, canonical(body).encode("utf-8"), hashlib.sha256).hexdigest()
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

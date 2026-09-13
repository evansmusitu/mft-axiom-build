import importlib.util
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

BASE = Path(__file__).resolve().parents[1]
SCRIPT = BASE / "scripts/fmi_v9_6_rights_intake.py"


def load_module():
    spec = importlib.util.spec_from_file_location("v96", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


v96 = load_module()


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_case(tmp_path, **overrides):
    now = datetime(2026, 9, 13, 12, 0, tzinfo=timezone.utc)
    doc = tmp_path / "rights.pdf"
    doc.write_bytes(b"synthetic private rights document bytes - not a real license")
    doc_sha = v96.hashlib.sha256(doc.read_bytes()).hexdigest()
    data = {
        "schema": v96.SCHEMA,
        "provider": "Twelve Data",
        "license_authorized": True,
        "redistribution_authorized": True,
        "external_api_authorized": True,
        "rights_reference": "SYNTHETIC-RIGHTS-REFERENCE-0001",
        "rights_document_sha256": doc_sha,
        "authorization_recorded_at": iso(now - timedelta(days=2)),
        "effective_at": iso(now - timedelta(days=1)),
        "expires_at": iso(now + timedelta(days=30)),
        "allowed_market_classes": ["FOREX", "COMMODITIES", "CRYPTO"],
        "max_retention_seconds": 86400,
        "attribution": {
            "required": True,
            "text": "Synthetic provider attribution",
            "url": "https://example.invalid/provider-attribution",
        },
        "entitlement_label": "synthetic-commercial-entitlement",
        "freshness_label": "synthetic-realtime",
    }
    data.update(overrides)
    intake = tmp_path / "private-rights.json"
    intake.write_text(json.dumps(data), encoding="utf-8")
    return now, doc, intake, data


def set_creds(monkeypatch):
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "synthetic-provider-key-123456")
    monkeypatch.setenv("FMI_DEPLOYMENT_PROBE_API_KEY", "fmi_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")


def test_valid_intake_builds_public_safe_readiness(monkeypatch, tmp_path):
    set_creds(monkeypatch)
    now, doc, intake, _ = make_case(tmp_path)
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    out = v96.build_public_artifact(validated)
    assert out["status"] == "PRIVATE_RIGHTS_INPUT_STRUCTURALLY_VALIDATED"
    assert out["legal_certification"] is False
    assert out["promotion_ready"] == "NOT_EVALUATED"
    assert out["ready_for_read_only_v9_4_preflight"] is True
    assert out["cloudflare_mutation_performed"] is False
    assert set(out["rights_hash_by_market_class"]) == {"FOREX", "COMMMODITIES", "CRYPTO"]


def test_public_output_never_contains_private_values(monkeypatch, tmp_path):
    set_creds(monkeypatch)
    now, doc, intake, _ = make_case(tmp_path)
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    out = v96.build_public_artifact(validated)
    raw = json.dumps(out)
    assert "synthetic-provider-key-123456" not in raw
    assert "fmi_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef" not in raw
    assert "SYNTHETIC-RIGHTS-REFERENCE-0001" not in raw


def test_document_hash_mismatch_fails_closed(monkeypatch, tmp_path):
    set_creds(monkeypatch)
    now, doc, intake, data = make_case(tmp_path)
    data["rights_document_sha256"] = "0" * 64
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_expired_rights_fail_closed(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["effective_at"] = iso(now - timedelta(days=10))
    data["expires_at"] = iso(now - timedelta(seconds=1))
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="not currently effective"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_future_rights_fail_closed(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["effective_at"] = iso(now + timedelta(hours=1))
    data["expires_at"] = iso(now + timedelta(days=10))
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="not currently effective"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


@pytest.mark.parametrize("field", ["license_authorized", "redistribution_authorized", "external_api_authorized"])
def test_authorization_must_be_explicit_true(tmp_path, field):
    now, doc, intake, data = make_case(tmp_path)
    data[field] = False
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="explicitly true"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_unknown_market_class_rejected(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["allowed_market_classes"] = ["FOREX", "EQUITIES"]
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="unknown market class"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_duplicate_market_class_rejected(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["allowed_market_classes"] = ["FOREX", "forex"]
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="duplicates"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_retention_out_of_range_rejected(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["max_retention_seconds"] = v96.MAX_RETENTION_SECONDS + 1
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="max_retention_seconds"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_required_attribution_must_use_https(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["attribution"]["url"] = "http://example.invalid/a"
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="must use HTTPS"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_not_required_attribution_must_be_empty(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["attribution"] = {"required": False, "text": "must-not-remain", "url": ""}
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="must be empty"):
        v96.validate_intake(v96.load_intake(intake), doc, now=now)


def test_not_required_attribution_projects_nulls(monkeypatch, tmp_path):
    set_creds(monkeypatch)
    now, doc, intake, data = make_case(tmp_path)
    data["attribution"] = {"required": False, "text": "", "url": ""}
    intake.write_text(json.dumps(data))
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    out = v96.build_public_artifact(validated)
    assert out["attribution"] == {"required": False, "text": None, "url": None}


def test_provider_and_probe_credentials_must_be_distinct(monkeypatch, tmp_path):
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "fmi_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
    monkeypatch.setenv("FMI_DEPLOYMENT_PROBE_API_KEY", "fmi_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
    now, doc, intake, _ = make_case(tmp_path)
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    with pytest.raises(ValueError, match="must be distinct"):
        v96.build_public_artifact(validated)


def test_probe_credential_format_fail_closed(monkeypatch, tmp_path):
    monkeypatch.setenv("TWELVE_DATA_API_KEY", "synthetic-provider-key")
    monkeypatch.setenv("FMI_DEPLOYMENT_PROBE_API_KEY", "bad")
    now, doc, intake, _ = make_case(tmp_path)
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    with pytest.raises(ValueError, match="format invalid"):
        v96.build_public_artifact(validated)


def test_missing_credential_fails_closed(monkeypatch, tmp_path):
    monkeypatch.delenv("TWELVE_DATA_API_KEY", raising=False)
    monkeypatch.setenv("FMI_DEPLOYMENT_PROBE_API_KEY", "fmi_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
    now, doc, intake, _ = make_case(tmp_path)
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    with pytest.raises(ValueError, match="TWELVE_DATA_API_KEY is not present"):
        v96.build_public_artifact(validated)


def test_unknown_intake_field_rejected(tmp_path):
    now, doc, intake, data = make_case(tmp_path)
    data["legal_opinion"] = "do-not-silently-admit"
    intake.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="unknown private intake fields"):
        v96.load_intake(intake)


def test_rights_hash_projection_matches_v95_algorithm(monkeypatch, tmp_path):
    set_creds(monkeypatch)
    now, doc, intake, _ = make_case(tmp_path)
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    out = v96.build_public_artifact(validated)
    market_class = "FOREX"
    rights = {
        "schema": "musitu.fmi.provider-rights.v1",
        "provider": "Twelve Data",
        "rights_reference_hash": v96.stable_hash("SYNTHETIC-RIGHTS-REFERENCE-0001"),
        "license_authorized": True,
        "redistribution_authorized": True,
        "external_api_authorized": True,
        "market_class": market_class,
        "max_retention_seconds": 86400,
        "effective_at": v96.js_iso(now - timedelta(days=1)),
        "expires_at": v96.js_iso(now + timedelta(days=30)),
        "attribution": {
            "required": True,
            "text": "Synthetic provider attribution",
            "url": "https://example.invalid/provider-attribution",
        },
        "raw_provider_data_persisted": False,
    }
    assert out["rights_hash_by_market_class"][market_class] == v96.stable_hash(rights)


def test_cli_artifact_has_no_private_intake_reference(monkeypatch, tmp_path):
    set_creds(monkeypatch)
    now, doc, intake, _ = make_case(tmp_path)
    out = tmp_path / "public.json"
    monkeypatch.setattr(os.sys, "argv", ["v96", "--intake", str(intake), "--rights-document", str(doc), "--output", str(out), "--now", iso(now)])
    v96.main()
    body = out.read_text()
    assert str(intake) not in body
    assert str(doc) not in body
    assert "SYNTHETIC-RIGHTS-REFERENCE-0001" not in body


def test_cross_version_rights_hash_matches_committed_v95_verifier(monkeypatch, tmp_path):
    set_creds(monkeypatch)
    now, doc, intake, _ = make_case(tmp_path)
    validated = v96.validate_intake(v96.load_intake(intake), doc, now=now)
    out = v96.build_public_artifact(validated)

    v95_path = BASE / "scripts/fmi_v9_5_atomic_promote.py"
    spec = importlib.util.spec_from_file_location("v95_for_v96_contract", v95_path)
    v95 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v95)

    monkeypatch.setenv("TWELVE_DATA_LICENSE_AUTHORIZED", "true")
    monkeypatch.setenv("TWELVE_DATA_REDISTRIBUTION_AUTHORIZED", "true")
    monkeypatch.setenv("TWELVE_DATA_EXTERNAL_API_AUThorized", "true")
    monkeypatch.setenv("TWELVE_DATA_RIGHTS_REFERENCE", "SYNTHETIC-RIGHTS-REFERENCE-0001")
    monkeypatch.setenv("TWELVE_DATA_ALLOWED_MARKET_CLASSES", "FOREX,COMMODITIES,CRYPTO")
    monkeypatch.setenv("TWELVE_DATA_MAX_RETENTION_SECONDS", "86400")
    monkeypatch.setenv("TWELVE_DATA_RIGHTS_EFFECTIVE_AT", iso(now - timedelta(days=1)))
    monkeypatch.setenv("TWELVE_DATA_RIGHTS_EXPIRES_AT", iso(now + timedelta(days=30)))
    monkeypatch.setenv("TWELVE_DATA_ATTRIBUTION_REQUIRED", "true")
    monkeypatch.setenv("TWELVE_DATA_ATTRIBUTION_TEXT", "Synthetic provider attribution")
    monkeypatch.setenv("TWELVE_DATA_ATTRIBUTION_URL", "https://example.invalid/provider-attribution")
    monkeypatch.setenv("FMI_MARKET_PROBE_MARKET_CLASS", "FOREX")
    _, expected_hash = v95.expected_rights()
    assert out["rights_hash_by_market_class"]["FOREX"] == expected_hash

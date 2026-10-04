from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

_REQUIRED_TOP = {"provider_id", "display_name", "distribution_mode", "mcp", "oauth", "submission"}


def _https_url(value: object, field: str) -> str:
    value = str(value or "")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError(f"{field} must be an absolute HTTPS URL")
    return value


def _validate_callback(uri: object) -> str:
    uri = _https_url(uri, "oauth.callback_uris entry")
    if "*" in uri:
        raise ValueError("oauth callback wildcard is forbidden")
    parsed = urlparse(uri)
    if parsed.query or parsed.fragment:
        raise ValueError("oauth callback URI must not contain query or fragment")
    return uri


def load_provider_profile(path: str | Path) -> dict:
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    missing = sorted(_REQUIRED_TOP - set(data))
    if missing:
        raise ValueError(f"missing required provider profile fields: {', '.join(missing)}")

    provider_id = str(data["provider_id"]).casefold()
    if not provider_id or provider_id != str(data["provider_id"]):
        raise ValueError("provider_id must be lowercase and non-empty")

    mcp = data["mcp"]
    if not isinstance(mcp, dict):
        raise ValueError("mcp must be an object")
    _https_url(mcp.get("canonical_upstream"), "mcp.canonical_upstream")
    _https_url(mcp.get("submission_url"), "mcp.submission_url")

    oauth = data["oauth"]
    if not isinstance(oauth, dict):
        raise ValueError("oauth must be an object")
    callbacks = oauth.get("callback_uris")
    if not isinstance(callbacks, list) or not callbacks:
        raise ValueError("oauth.callback_uris must be a non-empty list")
    oauth["callback_uris"] = [_validate_callback(x) for x in callbacks]

    submission = data["submission"]
    if not isinstance(submission, dict):
        raise ValueError("submission must be an object")
    if not isinstance(submission.get("portal_requires_paid_plan"), bool):
        raise ValueError("submission.portal_requires_paid_plan must be boolean")
    if not isinstance(submission.get("team_enterprise_org_connector_admin_controls"), bool):
        raise ValueError("submission.team_enterprise_org_connector_admin_controls must be boolean")

    return data

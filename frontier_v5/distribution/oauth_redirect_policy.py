from __future__ import annotations

from urllib.parse import urlparse

_OPENAI_HOST = "chatgpt.com"
_CLAUDE_HOST = "claude.ai"
_CLAUDE_PATH = "/api/mcp/auth_callback"


def classify_redirect(uri: str) -> str | None:
    try:
        parsed = urlparse(str(uri))
    except Exception:
        return None
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port:
        return None
    if parsed.query or parsed.fragment:
        return None

    host = parsed.hostname.casefold()
    path = parsed.path or "/"

    if host == _OPENAI_HOST and (
        path == "/connector_platform_oauth_redirect"
        or path.startswith("/connector/oauth/")
    ):
        return "openai"

    if host == _CLAUDE_HOST and path == _CLAUDE_PATH:
        return "claude"

    return None


def is_allowed_redirect(uri: str, *, provider: str | None = None) -> bool:
    classified = classify_redirect(uri)
    if provider is None:
        return classified is not None
    return classified == str(provider).casefold()

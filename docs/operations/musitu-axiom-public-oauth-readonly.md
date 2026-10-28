# Public OAuth / MCP metadata observation — no token, no admission

`qualification/diagnose_axiom_public_oauth.py` uses GET only against three
fixed public URLs: `auth.mftintelligence.com/.well-known/oauth-authorization-server`,
`mcp.mftintelligence.com/.well-known/oauth-protected-resource`, and
`auth.mftintelligence.com/oauth/userinfo` without bearer authorization.
A valid UserInfo observation MUST reject the request with HTTP 401,
`invalid_token` and a Bearer challenge. OAuth discovery must expose the
approved issuer, userinfo endpoint, PKCE S256, and expected public identity
and computation scopes; the protected-resource description must advertise the
approved resource/issuer/scope relationship.

The tool never follows redirects, logs a response body, sends an OAuth token
or calls login/registration/token exchange. Response bodies are capped to
8 KiB, and errors are converted into fixed field names.

Run `python -m unittest tests.connect.test_axiom_public_oauth -v`
and `python qualification/diagnose_axiom_public_oauth.py --output new.json`
from the repository root. A green read-only observation is **not** an
OAuth end-to-end security review; it does not verify live credentials,
valid-token scope/resource binding, revocation, redirect URI registration,
tenant attribution, billing, or production customer admission. It cannot
override the failed public MCP version/source provenance requirement or the
13 outstanding commercial GA release controls.

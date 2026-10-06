# MUSITU Delivery OS — external benchmark access boundary

This file defines how real Onfleet and Bringg benchmark access is checked without placing secrets in source, logs, artifacts, chat, or the operational Delivery Core.

## Onfleet

The benchmark uses a dedicated testing organization/API key, never a production customer key. Onfleet authenticates API requests with HTTP Basic authentication using the API key as the username and a blank password. The preflight calls only `GET https://onfleet.com/api/v2/auth/test`.

Required secret at execution time:

- `ONFLEET_TEST_API_KEY`

If it is absent or authentication fails, the benchmark remains blocked and `NOT_CERTIFIED`.

## Bringg Own Fleet

Bringg Own Fleet exposes the applicable API calls and identifiers through the customer's Sandbox. The benchmark therefore does not hard-code guessed service UUIDs or tenant endpoints. It requires the exact token URL supplied by the real Sandbox plus a dedicated Sandbox client ID and secret.

Required secrets/configuration at execution time:

- `BRINGG_SANDBOX_TOKEN_URL`
- `BRINGG_SANDBOX_CLIENT_ID`
- `BRINGG_SANDBOX_CLIENT_SECRET`

The preflight performs OAuth2 client-credentials token acquisition only. Any returned access token is used only in memory and is never returned in the report.

## Commands

Secret-free contract check:

```bash
node evaluation/run-access-preflight.mjs --offline
```

Live sandbox access check, after the dedicated test credentials are securely configured in the execution environment:

```bash
node evaluation/run-access-preflight.mjs --require-ready --output /tmp/external-access-report.json
```

The live command must not be run with production credentials. Passing access preflight means only that the two test environments can be authenticated; it does not certify parity or superiority.

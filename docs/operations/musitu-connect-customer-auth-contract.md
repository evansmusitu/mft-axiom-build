# MUSITU Connect — customer identity verification contract (not deployed)

**Engineering checkpoint: 21 October 2026.** This design belongs to the
`feat/musitu-connect-frontier` branch. It is **not imported by**
`connect/production_worker.mjs`, contains no actual customer credentials and
does not authorize anyone to use the currently enabled production API.

## Current scope

`connect/customer_identity.mjs` provides one async interface:

`verifyConnectCustomerBearer({authorization, requiredScope, env, nowMs})`

For an enabled *isolated test configuration*, it validates the bearer
credential and returns only a server-derived
`{tenant_id, credential_id, scope}` principal. A production customer
must never supply trusted tenant identity in its request body.

The verifier fails closed by default unless
`CONNECT_CUSTOMER_AUTH_ENABLED` is exactly the string `true` and a
well-formed `CONNECT_CUSTOMER_CREDENTIALS_JSON` secret binding is present.
**Do not set this flag on the live Worker or distribute any tokens.**
This is an offline qualification seam; enabling it alone would not create a
secure customer API or satisfy launch admission.

## Credential and secret-config format

An authorized future provisioning system must securely generate **32 random
bytes** using a cryptographically secure generator and encode the secret as
base64url (43 characters), with prefix `mct_`. The verifier checks this
format but cannot prove the token was actually generated with sufficient
entropy. It never generates, emails, logs, stores or reveals bearer tokens.

The server stores *only* SHA-256 hashes of these high-entropy opaque tokens
in a secret-bound canonical JSON array. Each element must have exactly these
fields:

- `credential_id`: unique opaque identifier, never the raw token
- `tenant_id`: server-side organization identity
- `token_sha256`: unique lowercase 64-hex SHA-256 digest of the full token
- `scopes`: a nonempty subset of `mining.plan` and `mining.risk`
- `status`: `active`, `suspended` or `revoked`
- `expires_at`: strict UTC `YYYY-MM-DDTHH:mm:ssZ` timestamp

Use `JSON.stringify(records)` for canonical serialization. Ambiguous JSON
(including repeated object keys), unknown fields, repeated hashes or
credential IDs, invalid scopes and times fail closed. At most 64 credential
records are supported by this preparatory test implementation; it is **not**
a scalable authenticated credential database or durable revoke path.

A caller can rotate credentials by having two independently issued active
credentials for the same tenant with separate scopes, then revoking the old
record. The verifier refuses the revoked record, but real-world revocation
speed, concurrency and distributed consistency are **not qualified**.

## Isolated verification and failure contract

Run:

```bash
node --test tests/connect/test_customer_identity.mjs tests/connect/test_production_worker.mjs
python -m unittest tests.connect.test_beta_release_gate -v
```

The Node tests cover missing configuration, two independent tenants, distinct
scopes, wrong/legacy tokens, exact expiry, suspension, revocation, rotation,
duplicate hashes or identifiers, noncanonical configurations, and output
sanitization. A disabled feature returns HTTP-equivalent 503, missing/invalid
bearers return 401, and valid principals lacking the required scope return
403. No HTTP route is currently changed by these outcomes.

## Mandatory separate gates before customer exposure

1. Establish an owner-approved credential issuer and isolated persistent
   tenant registry; never derive customer tokens from the upstream Axiom key.
2. Add atomic, globally consistent per-tenant rate limits, request byte/CPU
   budgets, quotas and usage attribution. Static in-memory Workers counters do
   **not** qualify as durable global quotas.
3. Ensure all customer data reads, writes, logs and metering use the verified
   server-derived tenant ID, with cross-tenant negative tests.
4. Prove secure issuance, secret delivery, rotation, revocation and offboarding
   with two separately approved fictional test tenants.
5. Qualify a nonproduction canary, secure incident paging, customer terms,
   privacy/data agreements and release-owner signoffs; obtain independent
   explicit production authorization before any rollout.
6. Keep methane predictive safety qualification blocked. This module makes no
   mine data provenance, sensor accuracy, autonomous control or model claims.

The controlling release gate remains
`qualification/musitu_connect_beta_release_gate.json`:
**new beta customer admission and public launch are BLOCKED.**

# MUSITU Store V2 — protected Neon Stage Vercel endpoint

This private nonproduction diagnostic endpoint is **not Store checkout**.
It validates the isolated Neon database and a **least-privilege LOGIN role**
using read-only queries only after Vercel Authentication (SSO) protects
all deployments. No customer routes or payments, callbacks or Paynow secret
are deployed. Deployment must be manual only (no production Git integration).

The endpoint returns HTTP 503 until a Store-only read/write-limited
`musitu_store_v2_gateway` login has been provisioned by an authorized
database administrator and a matching `STORE_NEON_DATABASE_URL` secret
has been stored directly inside the Vercel project's Preview environment.
It independently rejects connections using Neon elevated roles.

**Updated 29 October 2026 — owner-observed private HTTP witness:** The owner
provided the redacted JSON response `ok:true`,
`code:"stage_db_connected_disabled"`, and all five commerce flags `false`
from the protected Neon stage endpoint. In this exact source, that code is
returned only after a restricted database query qualifies the expected
`musitu_store_v2_staging` database, gateway identity, four empty Store tables
and non-elevated role. Separately, a fresh read-only Neon query explicitly
using `role_name=musitu_store_v2_gateway` confirmed those same database
facts and absence of `TRUNCATE`, review `INSERT`, and amount-column `UPDATE`
permissions. See `OWNER_OBSERVED_PRIVATE_STAGE_WITNESS_20261029.md`.

**Bounded acceptance:** The response is owner-supplied, not an independently
captured HTTP trace; raw status headers, authenticated Vercel browser session,
unauthenticated denial, and real Store OIDC/PKCE/MFA login have not been
independently certified. Vercel SSO protection is still enabled. Do not export
credentials to ChatGPT, GitHub or public code, and do not enable checkout,
callbacks, entitlements or payouts. This HTTP canary is NOT a Paynow worker,
merchant approval, third-party publisher license or a Phase 2 release gate.

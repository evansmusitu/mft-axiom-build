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

**Current state:** Owner-approved Neon Scale Stage project/DB is deployed,
but database authentication has NOT been bound into Vercel. Do not copy
credentials into ChatGPT, GitHub or public code. The Neon-to-Vercel automatic
credential transfer is not an authorized operation via the available tools.

No live backend is qualified merely because Vercel returns a protected
nonproduction denial. Phase 1 commercial/legal/external acceptance remains
open, and Phase 2 is pending.

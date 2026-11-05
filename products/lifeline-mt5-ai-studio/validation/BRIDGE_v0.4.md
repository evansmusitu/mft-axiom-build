# LIFELINE MT5 AI Studio — Secure Cloud/Windows Bridge v0.4

Status: **IMPLEMENTED IN SOURCE / LOCALLY TESTED — NOT PRODUCTION CONNECTED**.

## Purpose and topology

- GitHub: isolated source, native Windows MetaEditor acceptance and cross-platform CI.
- Vercel: private customer UI scaffold; no credentials in browser or repository.
- Cloudflare: Access JWT validation for operator and ChatGPT-safe MCP status; HMAC verification for agent requests; proxy-auth forwarding to Modal. Dedicated Cloudflare Account ID: `93f395f5121954671f92fffa453d6b61`.
- Modal: private ASGI service (`requires_proxy_auth=True`), independent backend secret, tenant-bound agent queue endpoints. **Linux Modal does not execute native MetaEditor**.
- Neon: dedicated LIFELINE database; SQL migrations `001_init.sql` and `002_agent_bridge.sql`, tenant-scoped RLS and audit receipts. No other project's database is reusable.
- Windows: outbound-only HTTPS polling to Cloudflare, signed jobs, local SQLite at-most-once claims, MetaEditor and Strategy Tester restricted to reviewed development, no broker login or trading.

### Edge paths

`POST /mcp`: valid Cloudflare Access RS256 JWT; read-only LIFELINE status only.

`POST /operator/probe`: valid Cloudflare Access RS256 JWT; creates probe job for the bound agent only.

`POST /operator/status`: valid Cloudflare Access RS256 JWT; sees its bound agent's job summary only.

`POST /agent/pull`: timestamped HMAC-bound agent ID, tenant, nonce and request body; signed job returned (or null). Never accepts arbitrary code/commands.

`POST /agent/receipt`: HMAC request + independently HMAC-signed job receipt; server atomically records it, idempotently accepts exact duplicates, rejects mismatches.

In local tests, one durable SQLite queue simulates the Neon queue. A PostgreSQL queue adapter is implemented for Modal, but **has not been exercised against an actual Neon database**. The private end-to-end cloud path and Access-JWT verification still require external staging acceptance.

## Security and correctness rules

1. Cloudflare JWTs use pinned issuer/audience and RSA algorithm; the user's identity comes from verified claims, never a caller-supplied tenant header.
2. Agent requests use a separate HMAC pairing key, UTC timestamp +/-120s and one-time nonce; Cloudflare verifies before Modal is invoked and Neon persists nonce consumption.
3. Before agent starts work, it records durable job claim in a local SQLite database. On uncertain native completion, the task is **not automatically re-executed**. Exact receipts are reused during reconnection.
4. Claimed jobs are reoffered to their *same* agent to reconcile lost receipts, never reassigned to different agents.
5. Each Neon table uses `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`; production connection must be a dedicated nonowner, non-`BYPASSRLS` role. Every DB transaction sets local `lifeline.tenant_subject` before reading/writing.
6. Any native compile or tester job additionally requires explicit trusted-host environment enablement. Stage operator routes only create `probe`, never compile/backtest/trade.
7. No generic shell tool, trade execution, account login, arbitrary upstream proxy, public database port or incoming Windows socket exists.
8. Modal and Vercel/Cloudflare deploy are **not** part of CI. Do not copy credentials from Axiom, FMI, WhatsApp or MMF.

## Deployment blockers

- Create a dedicated, correctly scoped **free-tier-qualified or otherwise explicitly funded** Neon project and runtime role. Run migrations and RLS denial tests, especially cross-tenant rows and role bypass.
- Provision dedicated Cloudflare Access application, token issuer/audience and Worker secrets. Verify account identity before any mutation. Deny unauthenticated requests at Cloudflare and direct anonymous Modal requests.
- Create private Modal application, add private `lifeline-mt5-stage-secrets`, verify proxy authentication and Neon TLS, exercise web endpoints; do not enable uncontrolled billed compute.
- Provision protected Vercel staging project with SSO; confirm redirect and failed authentication cases without disabling protections.
- Pair a Windows machine that can run continuously and is authorized by its owner; GitHub Actions Windows runners remain disposable test machines, not a 24/7 execution service. Confirm Windows licensing and hosting costs before purchasing.
- Verify a **historical-price trading backtest** using an approved broker demo account and data; the existing proof is a mathematical Strategy Tester optimization, *not* market-performance evidence.

## Repeatable offline acceptance

From the repository root (Python 3.12+):

```sh
python -m pip install 'fastapi>=0.115,<1' 'httpx>=0.28,<1'
cd products/lifeline-mt5-ai-studio/windows
python -m unittest -v test_agent.py test_poller.py
```

Cloudflare tests (Node.js 22):

```sh
cd products/lifeline-mt5-ai-studio/infra/cloudflare
npm install --omit=dev --ignore-scripts --no-audit --no-fund
node --test test.mjs
```

CI will independently test Windows and Linux. Only a successful CI run qualifies CI status.

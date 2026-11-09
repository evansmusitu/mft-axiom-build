# LIFELINE MT5 AI Studio — One-Pass Execution Acceptance & Blocking Gates

Date: 2026-10-21. User authorized completion across existing providers with a zero-dollar launch budget. **This is an evidence record, not a production acceptance certificate.** Never trade from ChatGPT, publish unreviewed native operations, merge draft PR #30, or modify protected main.

## Completed and independently checked

| Gate | Result | Evidence |
|---|---|---|
| Vendor-signed native Windows MetaEditor install, MQL5 EX5 compile | PASS | Native run 39472075489; source and SHA in `NATIVE_ACCEPTANCE_20261020.md` |
| Mathematical Strategy Tester optimization | PASS, **not** historical market backtest | Native run 39472075489 |
| Signed outbound Windows agent + at-most-once claim and receipt code | PASS offline only | Bridge security tests + `windows/agent.py`, `poller.py` |
| Native MetaQuotes Terminal/MetaEditor MCP loopback-only read adapter | PASS mocked tests Win+Linux; live native-MCP untested | Run 39495426549 |
| Host readiness audit fails closed when no permanent Windows host exists | PASS Windows CI | Run 39541717442; `windows/Test-LifelineHost.ps1` |
| Vercel private status operator website | READY / deployment authentication ON | Project `prj_qkviXEqdi9n0qxpbRdhVuylvPRq9`, deployment `dpl_3UQvT4xZy4SnmLbL5qr4PjzMHocy` |
| Live guest request to the Vercel stage | PASS denial (HTTP 302 to authentication; **not** HTTP 200) | Run 39541336913 |
| Independent LIFELINE Neon DB and tenant RLS | PASS simulated role tests | Project `frosty-rain-34922526`; all three tables active FORCE RLS; observed tenant A/B row isolation and rejected cross-tenant insert |
| Separate restrictive SQL runtime role | PASS permissions / CANNOT LOGIN YET | `lifeline_stage_app`: LOGIN, NOBYPASSRLS, NOCREATEROLE, NOSUPERUSER, inherited `lifeline_executor`; PASSWORD NULL; owner SET permission revoked |
| Cloudflare Worker isolated and unrouted | PASS prior deployment | Run 39492791190, `workers_dev=false`, `preview_urls=false`; still no runtime secrets |
| Cloudflare Zero Trust Access application | CREATED / verified deny-all; no route/DNS modifications | App `71c315f0-3cfa-4217-98f1-e31d9ec8a44b`, host `lifeline-mt5-stage.mftintelligence.com`, run 39541204816, policy readback run 39541665632 |

## Actual live infrastructure readiness

GitHub Actions read-only secret-presence qualification run **39541336913**:
- Existing **Modal** token ID+secret: present.
- Existing **Cloudflare** bearer token: present.
- `NEON_API_KEY` repository secret: absent.
- `LIFELINE_NEON_DATABASE_URL` repository secret: absent.
- `LIFELINE_ACCESS_OWNER_EMAIL` repository secret: absent.

Direct Neon connector can administer the isolated database, but cannot magically export new restricted credentials into Modal Secrets or GitHub encrypted secrets. `lifeline_stage_app` password is deliberately NULL to prevent premature direct login. A real `run_sql` as this identity returned missing authentication credentials. Testing `SET LOCAL ROLE` during a temporary narrowly scoped grant demonstrated FORCE RLS; a cross-tenant insert was rejected. Temporary `SET ROLE` grant was revoked; `pg_has_role(...,'SET')` is false. The role's permanent inherited permission is only `lifeline_executor`.

Cloudflare Access was deliberately created with a **deny-all** policy; it does not yet authorize an owner or customer. It has no DNS or Worker route. User identity and MFA must be verified before replacing deny-all with any allow policy.

**Vercel warning:** Vercel returned deployment `target=production` despite the requested preview. Its project has `ssoProtection.enabled=true` and `deploymentType=all`, and actual unauthenticated network access redirected for authentication. No custom domains have been provisioned; no trading APIs, secret values or backend are exposed in HTML.

## Non-negotiable remaining external blockers

1. **Owner-controlled persistent Windows x64 machine** or explicitly approved third-party Windows hosting and its costs/licensing. GitHub-hosted Windows runner can compile, but it is **not** continuously online, and none has been rented/purchased.
2. **Secure credential transport** for newly restricted Neon runtime role into a private Modal Secret, without committing passwords or placing DSNs in front-end/client-side code. Modal direct connector is not available here; existing Modal credentials in GitHub Actions alone do not include isolated Neon credentials. Stage role password is intentionally unset.
3. **Owner authorization to enroll protected Cloudflare Access identity with MFA** and route a dedicated hostname only after negative-auth tests. Present Access policy intentionally denies every request.
4. **Real host-side MetaTrader MCP activation and pairing**, application token generation within that Windows instance, localhost 22345/22346 loopback-only listeners, and E2E signed-probe delivery; none can be claimed without the host.
5. **Verified historical price/broker demo data** and a reproducible market-backtest report. The existing tester proof is mathematical calculation mode, not a market test.
6. **Platform/regulatory review** before future sale, public listing or financial execution. ChatGPT plugin-facing route remains read-only.

## Next-safe-execution checklist (no secret values in code)

- On permitted Windows host run `Test-LifelineHost.ps1` without `-AllowUnpaired`; report must pass. Enable native MCP Trading=No Trading and dangerous shell operations disabled in MetaTrader UI. Never expose RDP or MCP externally.
- Create strong restricted Neon app login password privately and immediately install it in **LIFELINE-only** Modal Secret `lifeline-mt5-stage-secrets`; test exact-login tenant separation with two tenants and TLS verification. Never use the existing `lifeline_runtime` or owner role: both bypass RLS.
- Bind Modal proxy-auth + edge HMAC secrets in a closed isolated service and verify direct unauthenticated HTTP 401/403 before adding any Cloudflare route.
- Enable owner-only Cloudflare Access MFA via already authorized identity; test valid/invalid/expired JWT, then connect the isolated Worker to the private backend and paired Windows machine.
- Only after full proofs, update protected UI from staging to usable customer-facing product, with user-directed review of spend, platform permissions and trading laws.

**Conclusion:** Native Windows/MetaEditor build, offline signed agent/MCP adapter, Neon RLS isolation, Vercel guest denial and Cloudflare deny-all Access app have real evidence. **A fully connected permanent MT5 agent and live Modal/Cloudflare/Neon path do not.** Product launch is intentionally blocked rather than falsely claimed complete.

# ATLAS Axiom: authorized service connection

The isolated Neon project is `muddy-wildflower-85740352`, database `atlas_axiom`, with a dedicated Vercel **sensitive** environment variable `ATLAS_AXIOM_DATABASE_URL`. No private connection strings are committed or displayed in chat.

## Live activation gates

1. Owner obtains a NEW Axiom account credential specifically authorized for `axiom.execute` on `https://mcp.mftintelligence.com/mcp`. The ChatGPT connector token cannot be exported or copied into the website. This credential must be entitled and revocable.
2. Owner stores it directly in the isolated Vercel project as a sensitive `AXIOM_MCP_BEARER_TOKEN`. Never commit it, paste it into ChatGPT, or store it in client-side JavaScript.
3. Authenticate provider identity/entitlement with a harmless, **explicitly approved** computation; fail closed if provider does not accept the credential. Configure `ATLAS_AXIOM_EXECUTE_ENABLED=enabled` ONLY after success.
4. Rotate the previously disclosed operator access code before operating with a real service credential. Preserve Vercel SSO and the API operation allowlist.
5. Each execution requires a matching deterministic preview digest, a unique UUID idempotency key, a server-side operator code, and one explicit consent. The database claims and audits that request before the one external MCP dispatch.
6. Duplicate operation keys never cause another provider call. Errors after dispatch are recorded for review. An uncertain operation must never be re-sent automatically. Daily safety ceiling is 20 approved requests.
7. Only `arithmetic.evaluate` is allowed. The provider's returned numeric value is cross-checked using a separate exact-rational engine. No payments, trading or external effects are enabled.

The first-party MUSITU OAuth worker currently permits only `chatgpt.com` connector redirect URIs for dynamic client registration. Therefore it must NOT be assumed that the existing ChatGPT plugin OAuth session authorizes website OAuth redirection. An alternative registered ATLAS OAuth client or revocable service token is needed. Do not loosen the current production ChatGPT redirect allowlist to bypass this restriction.

The log records row-level event timestamps and SHA-256 content fingerprints. It is **not** a third-party signed or externally anchored immutable audit log; the database owner is still privileged. The single owner-side tenant value `atlas-private-owner` is server-defined; there is no self-service multi-tenant customer signup at this stage.

## Verified configuration

- Dedicated Neon SQL tables `atlas_axiom_attempts`, `atlas_axiom_audit`, `atlas_axiom_quotas` were created through the connected Neon app.
- The Vercel environment holds `ATLAS_AXIOM_DATABASE_URL` only as a sensitive production variable.
- Axiom account key **not available** to the website as of 2026-10-20. `ATLAS_AXIOM_EXECUTE_ENABLED` remains unset; no account compute calls dispatched by website.
- Public production `musitu-atlas-groq`, protected main, and frozen OpenAI submission remain untouched.

## Outstanding Neon privilege restriction

The Neon management API provisioned `atlas_runtime` with inherited `neon_superuser` membership, despite application-level table grants. Database readback confirmed `DELETE` privileges remain available to this role; therefore it is **not** a least-privilege identity. Attempts to revoke the inherited membership or role attributes were denied by the Neon admin boundary. A separate SQL-created `atlas_web_limited` role currently lacks a usable password, so it was **not** substituted into the live Vercel environment. Only the isolated ATLAS ledger database is exposed, never the legacy Axiom customer database. DO NOT enable account-backed execution until a genuinely restricted runtime identity can be provisioned and verified with `has_table_privilege(...,'DELETE') = false` and `rolbypassrls = false`. The provider token and execution activation flags are absent, providing an independent fail-closed safeguard.


## 2026-10-20 qualification continuation — completed safely

New, separate **atlas_web_limited** PostgreSQL role is created in the isolated ATLAS Neon project with:
- `rolcanlogin=true`, `rolbypassrls=false`, `rolcreatedb=false`,
  `rolcreaterole=false`, `rolinherit=false`.
- Direct required grants to read and insert ledger claims, append audit events,
  use the audit sequence, read/insert quota rows and update only the
  prescribed status/result/quota columns.
- **Verified readback**: can read=true, insert=true, status update=true,
  delete=false, and `neon_superuser` membership=false.
- **Outstanding**: SQL-created restricted role does not yet have a working
  database login password. Neon returns a URI for this role but it contains
  *no password*. Do not replace Vercel's current ledger URL with that URI yet.
  The currently configured `atlas_runtime` role has excessive privileges and
  remains **disallowed for any account execution**.

A new independent runtime role assessor queries the **actual Postgres session**
before any account-metered request is claimed or dispatched. It checks table
DELETE access, DDL/role-creation privileges, row-security bypass, inherited
`neon_superuser` membership and minimum required select/insert/update grants.
**If the assessor fails, it rejects execution without a provider call**, even
if someone erroneously enables `ATLAS_AXIOM_EXECUTE_ENABLED` or provides a
bearer key.

The site and API expose a read-only role qualification verdict. CI test
`atlas-axiom-security-qualification.yml` proves that the overprivileged
mock role cannot cause database writes or external Axiom requests. CI does NOT
prove the new restricted role's live login until a password is set.

### Exactly two owner credential steps remaining

1. **Database password**. Sign in to your existing Neon account. In the
   isolated `muddy-wildflower-85740352` project, open the SQL Editor for
   database `atlas_axiom`, using the database owner/admin. Assign a NEW
   high-entropy password to `atlas_web_limited` **inside Neon only**, never
   in ChatGPT or GitHub:
   `ALTER ROLE atlas_web_limited WITH PASSWORD '<GENERATE_AND_KEEP_PRIVATE>';`
   The operator must substitute their own unique password. Afterward, the
   connected Neon API can produce the correct limited-role connection URL,
   and Vercel can be switched from the overprivileged temporary URL to the
   limited one without exposing the password in chat.
2. **Axiom service entitlement**. Authorize a dedicated revocable MUSITU Axiom
   token scoped to `axiom.execute` (not the private ChatGPT plugin token),
   and set it as `AXIOM_MCP_BEARER_TOKEN` using the Vercel project's sensitive
   environment variable UI. This is NOT a request to buy an account or
   subscription. If no entitled credential is available, stop; do not incur
   charges, loosen OAuth redirect validation, or harvest ChatGPT secrets.

After both prerequisites, rotate the currently user-visible operator code,
validate exact entitlement and one approved arithmetic call, and only then
consider `ATLAS_AXIOM_EXECUTE_ENABLED=enabled`. The user retains an explicit
per-request approval and a daily quota. These requirements are intentionally
not satisfied by a GitHub Actions secret, unverified bearer string, or Vercel
AI Gateway free credits: Gateway credits are unrelated to Axiom account units.

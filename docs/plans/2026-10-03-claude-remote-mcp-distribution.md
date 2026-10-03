# Claude Remote MCP Distribution Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, analysis-only MUSITU Axiom remote MCP distribution surface suitable for Claude custom-connector/directory validation without changing the frozen OpenAI submission, production auth, production MCP, main, or PR #1.

**Architecture:** Add a provider-neutral distribution layer under `frontier_v5/distribution/`. Claude v1 uses a dedicated OAuth 2.1-style DCR/PKCE worker with separate `dist_oauth_*` state tables and a curated MCP facade exposing only the 30 approved quantitative/financial-analysis operations. The implementation is CI-only in this phase: no DNS, Cloudflare deployment, production hostname, or Claude portal submission is performed.

**Tech Stack:** Cloudflare Worker-compatible JavaScript (ES modules), D1/SQLite schema, Python 3.12 repository-contract tests, GitHub Actions.

## Global Constraints

- Production `main` remains byte-identical to sealed SHA `d6a846f6bbe0bccac1758713eb4de167caf07113`.
- PR #1 remains open, draft, and unmerged.
- Do not modify `auth/`, `mcp/`, `submission/`, or `chatgpt-app-submission.json`.
- Do not deploy, change DNS, Cloudflare configuration, or the live OpenAI endpoint.
- Do not expose checkout, billing-write, payment, transfer, trading, order-entry, or other transaction-adjacent capabilities in the Claude profile.
- Do not expose a generic execute-any-operation tool in the Claude profile.
- Claude v1 OAuth scope is `axiom.execute` only.
- Dynamic Client Registration accepts only absolute HTTPS redirect URIs without userinfo or fragments and persists exact redirect URIs for later exact-match authorization/token exchange.
- Distribution OAuth mutable state uses only `dist_oauth_*` tables. Existing `oauth_*` client/flow/code/token state is not reused.
- Distribution access tokens may map to the existing Axiom `api_keys` authority so the already-built Axiom runtime can validate bearer access.
- Tool names must be <=64 characters and include Claude-required titles/annotations.
- Streamable HTTP is the MCP transport target.
- No “best in the world” or externally uncertified superiority claim.

---

### Task 1: Freeze the distribution contract and Claude allowlist

**Files:**
- Create: `frontier_v5/distribution/DISTRIBUTION_CONSTITUTION.json`
- Create: `frontier_v5/distribution/providers/claude.json`
- Create: `frontier_v5/tests/test_distribution_surface.py`
- Create: `.github/workflows/axiom-universal-distribution-gate.yml`

**Interfaces:**
- Consumes: frontier base SHA `8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3`; existing 30 business-operation mappings in `mcp/musitu_axiom_mcp_worker_v2.mjs`.
- Produces: machine-readable Claude allowlist and CI assertions used by Tasks 2–4.

- [ ] **Step 1: Add the focused failing test**

Assert:
- constitution/provider files must exist;
- exactly 30 Claude operation mappings;
- no commerce/transaction keywords;
- no generic execute tool;
- every configured tool name <=64 characters;
- only `axiom.execute` scope;
- frozen OpenAI/auth/MCP/submission paths have no branch diff versus frontier base.

- [ ] **Step 2: Verify the relevant failure**

Run in GitHub Actions:
`PYTHONPATH=. python frontier_v5/tests/test_distribution_surface.py`

Expected: non-zero because constitution/provider files are absent.

- [ ] **Step 3: Implement the minimum behavior**

Create constitution and Claude profile with the exact 30 analysis operations, safe names, titles, and required annotations.

- [ ] **Step 4: Verify the focused pass**

Run the same command.
Expected: Task-1 profile/constitution assertions pass; worker-specific assertions may remain intentionally skipped until their files exist.

- [ ] **Step 5: Run the affected integration check**

Run:
`PYTHONPATH=. python frontier_v5/tests/test_frontier_runtime.py`
`PYTHONPATH=. python frontier_v5/tests/test_advanced_runtime.py`

Expected: both pass without changes to existing frontier behavior.

- [ ] **Step 6: Commit the passing deliverable**

Commit only Task-1 files.

### Task 2: Add isolated provider-neutral OAuth DCR/PKCE worker

**Files:**
- Create: `frontier_v5/distribution/oauth/schema.sql`
- Create: `frontier_v5/distribution/oauth/musitu_axiom_distribution_oauth_worker.mjs`
- Modify: `frontier_v5/tests/test_distribution_surface.py`

**Interfaces:**
- Consumes: D1 binding `AXIOM_DB`; environment `OAUTH_ISSUER`, `MCP_RESOURCE`; existing `customers` and `api_keys` tables only for MUSITU account validation and bearer-key authority.
- Produces: OAuth discovery, DCR `/oauth/register`, PKCE authorize/token/refresh/revoke, health; mutable OAuth state solely in `dist_oauth_*` tables.

- [ ] **Step 1: Add the focused failing test**

Assert the new worker:
- contains DCR, PKCE S256 and refresh rotation;
- uses `dist_oauth_clients`, `dist_oauth_authorization_flows`, `dist_oauth_authorization_codes`, `dist_oauth_access_tokens`, `dist_oauth_refresh_tokens`;
- never reads/writes legacy `oauth_clients`, `oauth_authorization_flows`, `oauth_authorization_codes`, `oauth_access_tokens`, or `oauth_refresh_tokens`;
- permits only `axiom.execute`;
- validates DCR redirects as HTTPS, no userinfo, no fragment;
- stores exact redirect URI and requires exact match;
- has no `chatgpt.com` or ChatGPT branding.

- [ ] **Step 2: Verify the relevant failure**

Run focused Python test.
Expected: non-zero because OAuth worker/schema do not exist.

- [ ] **Step 3: Implement the minimum behavior**

Implement the endpoints and fail-closed validation. Use ordinary OAuth redirect response to the exact registered URI. Use shared `api_keys` only for customer credential validation and issued bearer-key enforcement.

- [ ] **Step 4: Verify the focused pass**

Run focused Python test.
Expected: all OAuth static-contract assertions pass.

- [ ] **Step 5: Run the affected integration check**

Run existing frontier runtime/advanced tests.
Expected: pass unchanged.

- [ ] **Step 6: Commit the passing deliverable**

Commit OAuth/schema/test changes.

### Task 3: Add Claude-safe MCP facade

**Files:**
- Create: `frontier_v5/distribution/claude/musitu_axiom_claude_mcp_worker.mjs`
- Modify: `frontier_v5/tests/test_distribution_surface.py`

**Interfaces:**
- Consumes: Claude provider JSON; Axiom service/base with `/health`, `/v1/tools`, `/v1/compute`; bearer token authorized for `axiom.execute`.
- Produces: Streamable HTTP MCP `/mcp`, `initialize`, `ping`, `tools/list`, `tools/call`, protected-resource metadata and health.

- [ ] **Step 1: Add the focused failing test**

Assert:
- no checkout/plans/recommend-plan/generic-execute tools;
- exact 30 tool definitions derived from provider profile;
- title plus `readOnlyHint`, `destructiveHint:false`, `openWorldHint:false`; Monte Carlo may omit/false idempotent hint, deterministic tools use `idempotentHint:true`;
- allowlisted operation must exist upstream or health/tools fail closed;
- `tools/call` rejects unknown/non-allowlisted tool names;
- worker uses `axiom.execute` only;
- no billing-service dependency;
- result body is concise and structured.

- [ ] **Step 2: Verify the relevant failure**

Run focused Python test.
Expected: non-zero because Claude MCP worker is absent.

- [ ] **Step 3: Implement the minimum behavior**

Implement static curated tool profile, registry-coverage verification, bearer pass-through to Axiom compute, and concise MCP responses.

- [ ] **Step 4: Verify the focused pass**

Run focused Python test.
Expected: all Claude worker assertions pass.

- [ ] **Step 5: Run the affected integration check**

Run existing frontier tests.
Expected: pass unchanged.

- [ ] **Step 6: Commit the passing deliverable**

Commit Claude worker/test changes.

### Task 4: Submission packet and universal distribution gate

**Files:**
- Create: `frontier_v5/distribution/claude/SUBMISSION_PACKET.md`
- Modify: `.github/workflows/axiom-universal-distribution-gate.yml`
- Modify: `frontier_v5/tests/test_distribution_surface.py`
- Create: `progress.md`

**Interfaces:**
- Consumes: implemented Claude profile/auth/MCP surface and current Anthropic directory requirements.
- Produces: submission-ready technical packet and CI sentinel `MUSITU_AXIOM_UNIVERSAL_DISTRIBUTION_GATE_PASS`.

- [ ] **Step 1: Add the focused failing test**

Assert submission packet contains:
- connector name/description;
- MCP endpoint and auth endpoint as deploy-time variables rather than fabricated live URLs;
- privacy, support and documentation requirements;
- standard testing account requirement explicitly marked BLOCKED until real credentials exist;
- at least three tested example prompts;
- no transaction execution claims;
- directory-policy boundary;
- deployment/submission checklist.

- [ ] **Step 2: Verify the relevant failure**

Run focused test.
Expected: non-zero because packet is absent.

- [ ] **Step 3: Implement the minimum behavior**

Create packet and finish CI workflow:
- protect frozen paths by git diff against frontier base;
- run distribution test and existing frontier tests;
- output sentinel only on all-pass;
- do not deploy.

- [ ] **Step 4: Verify the focused pass**

Run all gate commands in GitHub Actions.
Expected: all pass and sentinel appears.

- [ ] **Step 5: Run branch isolation verification**

Compare `distribution/claude-remote-mcp-20261003` to `8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3`.
Expected: changes only in `frontier_v5/distribution/**`, `frontier_v5/tests/test_distribution_surface.py`, `.github/workflows/axiom-universal-distribution-gate.yml`, `docs/plans/**`, and `progress.md`.

- [ ] **Step 6: Commit the passing deliverable**

Commit packet/gate/progress.

## External release boundary

Deployment and actual Claude directory submission are **not part of the no-deploy implementation gate**. They begin only after:
1. isolated CI passes;
2. an isolated public distribution hostname/auth hostname are authorized;
3. Cloudflare/DNS deployment is explicitly authorized;
4. a real standard reviewer/testing account exists;
5. the connector is tested inside an authenticated Claude account;
6. the user explicitly authorizes directory submission.

## Unresolved externally observable decisions

- Final public provider-neutral distribution hostname and OAuth issuer hostname.
- Which real MUSITU reviewer/testing account will be supplied to Anthropic.
- Whether the first Claude release is submitted as a single MCP connector only or later expanded into a plugin bundle.

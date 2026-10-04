# Claude Remote MCP Distribution Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated Claude remote-MCP submission candidate for MUSITU Axiom without modifying or deploying the frozen OpenAI reviewer surface.

**Architecture:** Keep `https://mcp.mftintelligence.com/mcp` and `https://auth.mftintelligence.com` as the frozen OpenAI production surface. Add a provider-neutral distribution contract plus Claude-only candidate resource/auth workers using a distinct resource/issuer pair; the Claude MCP gate continues to use the canonical Axiom core through service bindings but tokens are audience-bound to the Claude resource. Submission remains blocked until the isolated endpoints are explicitly deployed and pass a real Claude custom-connector OAuth test.

**Tech Stack:** Python 3.12+ contract tests, Cloudflare Workers JavaScript candidates, GitHub Actions, OAuth 2.1/PKCE/DCR, MCP Streamable HTTP.

## Global Constraints

- Production `main` remains sealed at `d6a846f6bbe0bccac1758713eb4de167caf07113`.
- PR #1 remains open, draft, and unmerged.
- The OpenAI reviewer surface, current OAuth callback policy, DNS, Cloudflare routes, and frozen submission are not modified or deployed by this implementation.
- Claude callback allowlisting is exact and fail-closed: `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`; no wildcard hosts.
- Claude candidate uses a distinct issuer and resource from the OpenAI production surface.
- No global-superiority claims are added.
- Submission status cannot become `ready` until the isolated Claude MCP/auth endpoints are live and a real custom-connector OAuth + tools/list + tool-call verification succeeds.

---

### Task 1: Provider-neutral redirect and provider profile contract

**Files:**
- Create: `frontier_v5/distribution/__init__.py`
- Create: `frontier_v5/distribution/oauth_redirect_policy.py`
- Create: `frontier_v5/distribution/provider_registry.py`
- Create: `frontier_v5/distribution/providers/claude.json`
- Test: `frontier_v5/tests/test_distribution_oauth_policy.py`

**Interfaces:**
- Consumes: OAuth redirect URIs and provider-profile JSON files.
- Produces: `classify_redirect(uri)`, `is_allowed_redirect(uri, provider=...)`, and `load_provider_profile(path)`.

- [x] **Step 1: Add the focused failing test**
- [x] **Step 2: Verify the relevant failure**
- [x] **Step 3: Implement the minimum behavior**
- [x] **Step 4: Verify the focused pass**
- [ ] **Step 5: Run the affected integration check**
- [ ] **Step 6: Commit the passing deliverable**

Focused command: `PYTHONPATH=. python -m pytest -q frontier_v5/tests/test_distribution_oauth_policy.py`
Observed red: missing `frontier_v5.distribution.oauth_redirect_policy`.
Observed green: `5 passed`.

---

### Task 2: Claude-only OAuth and MCP candidate surfaces

**Files:**
- Create: `frontier_v5/distribution/claude/musitu_axiom_oauth_worker_claude_candidate.mjs`
- Create: `frontier_v5/distribution/claude/musitu_axiom_mcp_gate_claude_candidate.mjs`
- Test: `frontier_v5/tests/test_claude_worker_isolation_contract.py`

**Interfaces:**
- Consumes: the canonical OAuth-worker and v4 public MCP-gate behavior as source templates.
- Produces: a Claude-only OAuth issuer candidate and Claude-only MCP resource candidate with distinct defaults.

- [ ] **Step 1: Add the focused failing test**
- [ ] **Step 2: Verify the relevant failure**
- [ ] **Step 3: Implement the minimum behavior**
- [ ] **Step 4: Verify the focused pass**
- [ ] **Step 5: Run the affected integration check**
- [ ] **Step 6: Commit the passing deliverable**

---

### Task 3: Claude submission gate and reviewer package

**Files:**
- Create: `frontier_v5/scripts/claude_distribution_gate.py`
- Create: `frontier_v5/tests/test_claude_distribution_gate.py`
- Create: `.github/workflows/axiom-frontier-v5-claude-distribution-gate.yml`
- Create: `submission/claude/REMOTE_MCP_SUBMISSION.md`
- Create: `submission/claude/review-checks.json`

**Interfaces:**
- Consumes: provider profile, candidate-worker files, exact source hashes, and live-evidence inputs supplied after isolated deployment.
- Produces: `MUSITU_AXIOM_CLAUDE_DISTRIBUTION_CANDIDATE_PASS` for static readiness; live submission remains blocked until explicit live evidence is recorded.

- [ ] **Step 1: Add the focused failing test**
- [ ] **Step 2: Verify the relevant failure**
- [ ] **Step 3: Implement the minimum behavior**
- [ ] **Step 4: Verify the focused pass**
- [ ] **Step 5: Run the affected integration check**
- [ ] **Step 6: Commit the passing deliverable**

## Unresolved externally observable decisions

1. Proposed isolated hosts: `https://claude-mcp.mftintelligence.com/mcp` and `https://claude-auth.mftintelligence.com`. DNS/Cloudflare deployment is intentionally excluded pending explicit infrastructure authorization.
2. Claude offers published identity, automatic registration, or a custom OAuth client. The final portal selection is chosen during the real isolated custom-connector test; published identity is preferred when it interoperates cleanly.
3. Actual directory submission requires an authenticated paid Claude account plus the live remote MCP URL.

# MUSITU Connect Production Runtime Enablement Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the qualified MUSITU Connect runtime on the canonical `connect.musitu.com` production hostname with fail-closed authentication, a real Axiom backend lane, canary-first verification, and automatic rollback.

**Architecture:** Deploy one Cloudflare Worker source first to an ephemeral Workers.dev canary and then, only after exact canary success, to the dedicated `musitu-connect-production` Worker custom domain. The runtime derives a Connect-only internal bearer from the dedicated Axiom account key, keeps the raw key server-side, validates Mining inputs, preserves deterministic planning, and sends provenance-bound risk computation to Axiom `/v1/compute`. The pre-cutover state is no production Connect Worker/domain; rollback therefore removes only resources created by this rollout.

**Tech Stack:** Cloudflare Workers, JavaScript modules, Node.js 24 tests, Python 3.12 rollout orchestration, GitHub Actions, MUSITU Axiom production compute API, Cloudflare D1 readback.

## Global Constraints

- Do not merge PR #9.
- Keep fail-closed controls.
- Perform canary verification before production activation.
- Roll back automatically if any production verification fails.
- Do not expose the raw Axiom account key.
- Do not weaken the public Axiom OAuth-only MCP boundary.
- Production activation must be independently evidenced and must not rely on the AppDeploy frontend.

---

### Task 1: Production Worker Contract

**Files:**
- Create: `connect/production_worker.mjs`
- Create: `tests/connect/test_production_worker.mjs`

**Interfaces:**
- Consumes: `AXIOM_ACCOUNT_KEY`, `PRODUCTION`, `RELEASE` Worker bindings.
- Produces: public `GET /health`; authenticated `POST /api/mining/plan`; authenticated `POST /api/mining/risk`.

- [ ] Add focused tests for health, authentication denial, deterministic planning, input validation, Axiom request-ID propagation, and response sanitization.
- [ ] Verify tests fail before the worker exists.
- [ ] Implement the worker with a domain-separated HMAC-derived Connect bearer.
- [ ] Verify Node tests pass.

### Task 2: Canary-First Production Rollout

**Files:**
- Create: `qualification/production_runtime_enablement.py`
- Create: `.github/workflows/musitu-connect-production-runtime-enablement.yml`
- Create: `qualification/evidence/musitu_connect_production_runtime_authorization_2026-10-05.json`

**Interfaces:**
- Consumes: GitHub Actions `MUSITU_CONNECT_AXIOM_ACCOUNT_KEY`, Cloudflare credentials, current admission gate, sealed main SHA.
- Produces: canary evidence, production custom-domain activation, exact Axiom usage-ledger correlation, rollback evidence on failure.

- [ ] Fail closed unless technical readiness and promotion authorization are already present, PR #9 remains unmerged, and main remains sealed.
- [ ] Refuse any pre-existing `connect.musitu.com` DNS/Worker/route conflict or pre-existing `musitu-connect-production` Worker.
- [ ] Deploy identical source to an ephemeral Workers.dev canary, inject the Axiom key, verify health, auth denial, deterministic plan, Axiom result 3.348, and exact D1 request-ID correlation.
- [ ] Delete the canary before production cutover.
- [ ] Deploy production Worker, install the secret, attach `connect.musitu.com`, add only the scoped machine-transport Cloudflare rule, and verify the same invariants.
- [ ] On any production failure, delete the custom domain, scoped rule, and newly created production Worker.

### Task 3: Admission State and Final Verification

**Files:**
- Modify after successful live rollout: `qualification/musitu_connect_gate.json`
- Create after successful live rollout: `qualification/evidence/musitu_connect_production_runtime_enablement_2026-10-05.json`

**Interfaces:**
- Consumes: successful production rollout evidence.
- Produces: runtime-enabled production gate record while retaining PR #9 and main constraints.

- [ ] Record production runtime and Axiom integration as enabled only after live verification.
- [ ] Run the full Connect qualification and infrastructure qualification.
- [ ] Verify PR #9 remains open/unmerged and main SHA remains unchanged.
- [ ] Verify `connect.musitu.com/health` is live and unauthenticated compute remains denied.

## Unresolved externally observable decisions

None. The user explicitly authorized runtime enablement, required canary-first activation and automatic rollback, and explicitly prohibited merging PR #9.

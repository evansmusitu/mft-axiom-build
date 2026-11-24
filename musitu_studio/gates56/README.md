# MUSITU Studio Gate 5 + Gate 6 — isolated source candidate (NOT RELEASE)

**22 November 2026 | PRIVATE ENGINEERING SCOPE / PUBLIC GITHUB CODE WITHOUT PRIVATE DATA**

This directory is source-only, and no new Studio deployment, paid compute,
Cloudflare Durable Object, R2 bucket, Vercel project, Modal service, Paynow
ledger, Supabase account, QA user or retained Storage object was changed.
Do not merge this branch into `main` or PR38 without separate source/security
review and exact owner authorization. **G5 OPEN; G6 OPEN.**

## Existing authority and what was reused

Source base: commit `d5b500ab46e3045dc2c53345552b477178bf9ed9`,
Studio PR38 (draft, unmerged). Existing real (but locally restricted) renderer:
`musitu_studio/studio/enterprise_worker.py`, which calls the existing
`execute_job.py` Blender scene executor, independently checks .blend/.glb/.png,
uses CPU-only, strict input schema, timeouts and output SHA-256 receipts.
Existing source also has a local `StudioStore` SQLite queue and an isolated
Cloudflare Durable Object ledger + Modal CPU pull API. This new candidate
does **not** alter those historical, reviewed modules or claim their live status.

The protected November Studio QA site is **only Gate 1/2**, NOT the whole
production rendering backend. Do not touch the protected 73-byte QA Storage
evidence or reuse that qualification bucket for user output.

## Implemented in this candidate

- `ledger.py`: new, separately namespaced SQLite reservation prototype.
  Emergency stop ON by default. Every arm/tenant configuration requires a
  trusted, separately supplied operator authorization function.
  Every admission and claim requires a fresh authenticated provider hard-cap
  verifier; absent evidence fails closed. One SQLite `BEGIN IMMEDIATE`
  transaction checks daily/monthly tenant budget, concurrency, credit hold,
  idempotency key and submits the job. Cost cap is reserved **for the entire
  job**, not per attempt. `max_attempts<=2`.
- Per-job fence/lease prevents stale workers settling results. The system
  quarantines ambiguous dispatch, missed heartbeats and attempted cancellation
  as `NEEDS_REVIEW` with funds/credits held. It never auto-retries a potentially
  live or billed provider call. Retrying requires a separate trusted proof that
  the prior call stopped or never began. Unknown actual usage is never treated
  as zero.
- Real terminal cost verification, credit-charge verification and private
  artifact verification are injected **trusted backend interfaces**, absent by
  default. Client-supplied `verified:` strings and fabricated manifests do not
  authorize completion. Only one terminal transition may settle each job.
  These local credits are an offline control model, **not** a funded Paynow
  balance; no real customer credits are issued.
- `blender_bridge.py`: optional actual `enterprise_worker` CPU subprocess
  bridge, gated by independently confirmed rootless/network-denied sandbox
  and provider budget guard. Uses bounded time, sanitized environment, private
  process group, stop on cancellation, digest-checked input and receipts.
  On success it stages three independently checked files into a private local
  adapter, but **does not mark the job COMPLETED or charge credits** without
  trusted provider usage and settlement receipts.
- `LocalPrivateArtifacts`: a single-host local test adapter (mode 0600,
  collision-safe create, no public URL, no paths outside tenant/job, SHA-256
  on read, foreign tenant denied). It is **not** cloud R2/Supabase Storage, an
  authenticated HTTP download route, or globally durable across workers.

## Non-negotiable hosted provider budget controls (not provisioned here)

1. Confirm the *actual* Modal Workspace budget hard cap in its authenticated
   account control plane. Add an Environment budget if the account plan supports
   it. Workspace is the outer limit; Environment is compute-only and does not
   cover all storage/reservation charges. Confirm project budgets for Google
   Gemini separately, plus API-key/model quotas and independent cost reconciliation.
   Modal docs: https://modal.com/docs/guide/budgets
2. Pin a single isolated CPU worker; `min_containers=0`,
   `max_containers=1`, per-call timeout, declared CPU/memory, retry ceiling,
   account-level spend hard stop. GPU disabled. Provider limits must be checked
   with authenticated live evidence, **not a self-attested boolean**.
3. Create a tightly privileged, independently reviewed provider budget adapter.
   It must call the provider's read-only control plane, validate workspace
   identity, actual control ID, hard enforcement, remaining budget and freshness
   before authorizing a chargeable attempt. No adapter is configured in this
   candidate; compute is not armed.
4. Limit combined Gemini + Blender + object storage + API spend under a
   separate owner-approved total envelope. User-supplied credit balances may
   not mint provider quota.
5. Test emergency stop against *actual ongoing* work and independently
   reconcile final provider charges before releasing escrow or credit holds.

## Required Gate 6 production integrations (NOT complete)

- Replace the single-host local SQLite prototype with the existing reviewed
  single-writer Studio Durable Object or separately approved durable managed
  Postgres queue. Apply versioned, reversible schema migration and validate
  genuine cross-worker fencing, restarts, poison queues and crash races.
- Connect an authenticated Modal CPU pull client and independently authenticated
  function call status/cancel receipts. Ambiguous spawn must quarantine rather
  than dispatch again. Real `FunctionCall.cancel` and post-cancel cost readback
  remain to be proven: https://modal.com/docs/sdk/py/latest/FunctionCall
- Use a **different**, approved private object store/bucket, not the protected
  QA evidence bucket. Verify SHA, filename, content type, sizes, tenant/project
  authorization, retention and no-overwrite. Build an auth-checked download
  endpoint that returns bytes without exposing storage credentials or public
  URLs; prove negative foreign-tenant, logged-out, expired-token and replay cases.
- Bridge to the actual Studio-specific payment/credit ledger through idempotent
  reserve/settle/reverse messages and reconciliation; this offline table must
  never mint Paynow credits. Prove exact-once settlement after invoice/webhook
  readback and no double charge after retries.
- Add worker checkpoint/heartbeat evidence from the real provider, meaningful
  progress (not simulated percentage), actual failure/cancel/timeout injection,
  no orphaned workers and exact artifact/queue/billing reconciliation.
- For Studio video launch, independently verify actual MP4 and its provenance;
  existing CPU worker only proves .blend/.glb/.png, so G4 remains open.
- Require separate security, provider-budget, recovery and independent reviewer
  acceptance bound to exact source/deployment/account identifiers.

## Safe offline qualification

From the repository root, standard Python 3.13 only:

```bash
python -m compileall -q musitu_studio/gates56
python -m unittest -v musitu_studio.gates56.test_ledger musitu_studio.gates56.test_blender_bridge
```

These tests use fake cap/verification functions strictly to probe local failure
invariants. They NEVER authenticate with Modal, Google, Cloudflare, Paynow or
Supabase; they do not run Blender, deploy cloud code, move money, allocate GPU,
change tenant enrollment, or touch any existing Studio QA assets.

**No CI success, actual real render, true provider hard cap, cloud object store,
hosted cancellation, paid ledger reconciliation or G5/G6 formal acceptance
may be claimed until fresh independently recorded evidence exists.**

## 24 November 2026 — authenticated Modal observation and offline DO queue schema

The prior local safety suite was expanded with:
- `modal_budget_observer.py`: calls the genuine documented Modal Python SDK
  `Workspace.from_context().billing.summary(cycle="this month")` with explicit
  `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`, verifies the exact configured
  workspace name, rejects invalid/missing/nonfinite summaries, and rounds cost
  observations upward to cents. Tests inject a fake SDK; **no authenticated live
  account call has been performed or claimed by those tests**.
- **Critical API boundary:** Modal billing summary is authenticated USAGE
  observation, not a Workspace/Environment HARD BUDGET readback. The documented
  SDK does not supply the enforceable remaining budget or expiry of usage data.
  `ModalBudgetObserver.__call__` always raises
  `MODAL_HARD_CAP_NOT_ATTESTED` and must never yield `VerifiedProviderCap`.
  Even an authenticated billing result cannot open this Gate 5 control.
- `durable_queue_schema.sql`: an *unapplied* namespaced SQLite schema candidate
  for a NEW, isolated Cloudflare Durable Object; covers fail-closed kill switch,
  tenant-scoped idempotency, queue state, one-writer transaction prerequisites,
  fencing, attempt uniqueness, provider call uniqueness, immutable audit,
  terminal immutability, completion requiring cost+credits+three artifacts, and
  forbidden deletion of completed artifacts.
- `test_modal_budget_observer.py` and `test_durable_queue_schema.py` add
  offline negative and transactional checks to the existing workflow. The SQL
  runs ONLY in ephemeral CI SQLite databases; it has not touched any Vercel,
  Supabase, R2, Cloudflare, Modal or payment account.

### Approved read-only path to real account evidence (NOT yet executed)

On a trusted, private, operator-controlled machine with Modal SDK **1.6.4**
installed and a minimum-privilege Modal API token supplied as runtime secrets:

```python
from musitu_studio.gates56.modal_budget_observer import ModalBudgetObserver

probe = ModalBudgetObserver(expected_workspace="VERIFIED_WORKSPACE_NAME")
observed = probe.read_usage()
# Handle this object only in private authenticated operator logs.
# It is NOT a provider-hard-cap certificate or permission to render.
assert observed.rendering_authorized is False
assert observed.hard_cap_verified is False
```

Do NOT add tokens, costs or customer account identifiers to GitHub source or
public Actions logs. The already existing
`.github/workflows/studio-v03-modal-spend-readonly-20261018.yml` uses a
read-only Modal CLI billing summary, but does not provide the missing hard-cap
attestation either. No new live workflow was triggered here.

**Further prerequisites for a live Gate 5:** An independently trusted provider
control-plane attestation for the exact Workspace enforced budget and actual
remaining dollars; optionally separate Environment compute budget; separately
capped Gemini spend; independent full-stack cost ceiling; unknown/provider-
delayed costs fail closed. Do not substitute workspace included free credit for
an enforced hard spend limit.

**Further prerequisites for a live Gate 6:** An exact new DO namespace and
versioned migration, private authenticated service-only routes, negative
cross-tenant tests on real DO instances, robust lease/recovery and independent
provider-call cancellation, non-QA private cloud artifacts, exact credit
settlement, and independently verified live CPU execution. This source schema
is not a running queue. G5 and G6 remain OPEN.

Official docs:
- https://modal.com/docs/guide/budgets
- https://modal.com/docs/sdk/py/latest/Workspace
- https://modal.com/docs/sdk/py/latest/FunctionCall

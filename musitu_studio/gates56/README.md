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

### Operator-only read-only account observation (independently attempted on 24 Nov)

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
attestation either. The standalone authenticated read-only probe later verified Modal billing access,
but the exact expected Studio workspace variable remained unset; see
`evidence/20261124_MODAL_AUTH_AND_DO_QUEUE_NOT_RELEASE.md`.

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

## 24 November 2026 later — executable unhosted queue controller and financial immutability

The next source-only continuation adds a real, independent implementation of
non-dispatching queue lifecycle operations in
`durable_queue_controller.mjs`, running against the actual SQLite engine in
Node 24 without any Cloudflare, Modal, Gemini, Paynow or R2 request.

**Implemented and unit-tested:** verified-identity-adapter scoped status reads;
tenant-owned cancel; no-charge cancellation only if attempts=0 and no
provider-call/fence ever existed; quarantine of queued retries with unknown
earlier usage; running cancel intent without invented provider refund; no
released reservation on NEEDS_REVIEW; fenced worker progress with active lease
and monotonic values; stale-worker quarantine without implicit retries; and
a maintenance-only emergency stop that switches the queue off and marks
running jobs CANCEL_REQUESTED, retaining all holds.

**Financial integrity:** database-level triggers now freeze the approved
tenant, project, idempotency key, payload hash, cost reservation, credit hold,
attempt ceiling and creation timestamp once admitted. No update to a terminal
job is allowed, including credit charge or cost changes after settlement.
These invariants were verified with real SQLite before any hosted migration.

**Offline TDD evidence:**
- Red financial tests: https://github.com/evansmusitu/mft-axiom-build/actions/runs/45408163345
- Green financial tests: https://github.com/evansmusitu/mft-axiom-build/actions/runs/45408289176 — Python 41/41.
- Red queue-controller tests: https://github.com/evansmusitu/mft-axiom-build/actions/runs/45408629371
- Green controller tests: https://github.com/evansmusitu/mft-axiom-build/actions/runs/45408814831 — Python 41 + Node 8.
- Red emergency-stop tests: https://github.com/evansmusitu/mft-axiom-build/actions/runs/45409017549
- Green full suite: https://github.com/evansmusitu/mft-axiom-build/actions/runs/45409134554 — Python 41 + Node 10 = **51/51, zero failures**.

Execute the same local test boundary from the repository root:

```sh
python -m compileall -q musitu_studio/gates56
python -m unittest -v musitu_studio.gates56.test_ledger \
  musitu_studio.gates56.test_blender_bridge \
  musitu_studio.gates56.test_modal_budget_observer \
  musitu_studio.gates56.test_durable_queue_schema
node --check musitu_studio/gates56/durable_queue_controller.mjs
node --test musitu_studio/gates56/test_durable_queue_controller.mjs
```

**Not implemented / not approved:** a hosted Durable Object class, isolated DO
namespace, remote authenticated routing, real end-user or worker credential
verification, provider attested hard caps, admissions and claims bound to
provider budgets, actual Modal CPU spawn/poll/cancel, private cloud artifacts,
real credits/payments, a genuine Blender output check on this controller, or
cross-worker recovery under real provider failures. The injected test identity
adapters are simulated and MUST NOT be exposed as live authorization.
This controller intentionally contains no `submit`, `claim`, `arm` or paid
dispatch operation. The emergency stop issues local cancellation intent; it
does NOT prove an existing provider call was actually terminated.

**Gate 5 OPEN; Gate 6 OPEN; PUBLIC LAUNCH NO-GO.**

## 24 November 2026 evening — atomic budget reservations and fenced queue claims (SOURCE ONLY)

Source: `durable_queue_controller.mjs` with the independent
`test_durable_queue_controller.mjs` Node 24/real-SQLite contract suite.

The isolated controller now implements:

1. User-scoped **read** status and project-scoped **write** permissions for
   cancellation and job submission. A signed user in the same tenant but a
   different project cannot read or cancel the job; a project viewer cannot
   submit chargeable work or cancel another user's job.
2. `submit` with a single `transactionSync`:
   tenant/project authorization; immutable payload SHA-256 and tenant-scoped
   idempotency key; independently provided worst-case all-attempt quote
   callback; provider Workspace identity+hard-cap+freshness checks; global
   unsettled reservations across tenants; tenant daily/monthly limits;
   outstanding credit holds; concurrency; and one new QUEUED record.
   Identical replay returns the original job without another reservation.
   Changed payload/price/credit/attempt fields with the same key are rejected.
3. `claim` with private worker authorization, fresh provider-cap verification,
   single-fence lease and transactional insertion into `g56_do_attempts`.
   Claims **never spawn or call** a Modal function. A QUEUED record with any
   prior attempt/fence/provider-call evidence is moved to NEEDS_REVIEW, keeping
   spending and credit exposure held; it is not automatically rendered again.
4. Existing cancellation, progress, quarantine, immutable settlement,
   emergency stop, and private-local-artifact invariants remain under test.

**Critical trust boundary:** All successful admission test paths use obviously
fake offline provider attestations, quotes and role-verifier functions. No
trusted, authenticated provider-*enforced* budget readback adapter exists in
this branch. `readProviderCap` is a synchronous injection seam, not a method
for live provider network calls inside a SQLite transaction. Integrating it
requires a separately reviewed, independently verified and sufficiently fresh
attestation sourced outside the transaction and bound to the exact Modal
Workspace. **The existing Modal billing observer CANNOT satisfy it.** The
`expectedWorkspace` binding and the genuine provider hard budget remain
unverified. There is deliberately no `arm` API or HTTP entrypoint. These
methods cannot be reached by a live worker or customer.

**Global budget accounting requires one single-writer ledger for ALL Studio
tenants.** Sharding tenants into independent Durable Object instances would
bypass the global outstanding cap. A hosted routing/identity/migration plan
and Cloudflare transactional worker proof are still missing. Clock/budget
freshness and cross-provider Gemini/storage charges need independent review.
Local fake credits must never be confused with settled Paynow credits.

### Red/green verification

- Same-tenant cross-project unauthorized access RED:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45437731823
  then GREEN: https://github.com/evansmusitu/mft-axiom-build/actions/runs/45437851217
- Admission+claim missing implementation RED:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45438160302
  then GREEN:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45438560912
- Viewer cancellation/submission escalation RED:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45438758717
  then GREEN:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45439006438
- Latest green boundary: **41 Python tests + 18 Node SQLite tests =
  59/59**, zero failures. No deployed Durable Object, real provider hard
  cap, actual CPU render, provider cancel, private cloud download or real
  merchant settlement is evidenced here.

**Formal G5 OPEN; G6 OPEN. NO-GO for public release and paid rendering.**

## 24 November 2026 — provider-neutral continuation without owner UI steps

Per owner direction, use the already connected GitHub Actions repository
credentials for Modal. Read-only proof on 24 Nov is recorded in
`evidence/20261124_MODAL_REPO_SECRETS_READONLY_APP_ASSOCIATION.md`.
Authenticated workspace, billing and existing `musitu-studio-v02/render_cpu_pull`
readback were verified, with no deployment, billed execution or secret leak.

The published Modal CLI `modal workspace settings list` and Python
`Workspace.settings.list()` list the workspace default environment and image
builder version, not the provider-enforced Workspace Budget. As of this source
review the documented SDK does not provide an authenticated hard-cap balance
readback. The billing summary and unused free credits cannot prove a zero-cost
or hard-limited job. Do **not** mint a provider-cap certificate from this data,
infer an unlimited approved limit, or use arbitrary finite limits selected by
the coding agent.

### Cross-tenant single-CPU-lane fail-closed patch

The unhosted global-queue controller now blocks any new `claim` while a
previous job is `RUNNING`, `CANCEL_REQUESTED`, or `NEEDS_REVIEW`, regardless
of tenant or lease expiry. The queue cannot silently start a second billable
CPU attempt while the first external call may still be alive. A stale attempt
must be reconciled independently before new work can proceed; `quarantineStale`
is not a proof of cost or cancellation and keeps the block in force.

- RED CI (18 existing Node tests passed; 2 new tests failed as intended):
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45451679383
- GREEN CI (41 Python plus 20 Node/SQLite, 61/61):
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45451779463
- No Cloudflare DO migration, Modal spawn, Gemini call, paid render, Paynow
  settlement, public route or QA alteration occurred in this step.

**GATE 5 OPEN / GATE 6 OPEN / PAID RENDERING DISABLED.**

## 24 November 2026 — final owner requirement: user-selectable Modal CPU **and** GPU rendering

The owner clarified the permanent Studio product requirement: **both Modal CPU
and Modal GPU rendering must be available as an explicit per-job choice**.
The earlier GPU-only instruction was superseded. Do not permanently disable
CPU and do not silently substitute CPU for GPU, GPU for CPU, or an unapproved
GPU type. A customer's selected rendering mode must be preserved from UI
submission through quote, immutable queue record, worker claim, Modal function,
output proof, cancellation, and billing reconciliation.

**Source-only G5/G6 controller implemented:**
- `device=CPU` with `gpuType=null`: CPU Blender render on Modal.
- `device=GPU` with `gpuType=T4`: CUDA/Cycles render on Modal's T4 GPU
  (the initial approved *technical candidate*, not paid deployment approval).
- Each submitted job persists its device and GPU type; a reused submission key
  cannot change either selection. Worker claims filter exactly by matching
  `device` and NULL-safe `gpu_type` and cannot fall back to another mode.
- Invalid configurations such as CPU+T4, GPU without a type, GPU+A100 or TPU
  fail before ledger reservation. The SQL schema independently rejects those
  values, including NULL on the GPU case (SQLite CHECK rejects only FALSE,
  not UNKNOWN, so the GPU type comparison uses `IS`).
- Both modes still require authenticated project roles, exact Modal workspace,
  genuine hard spending guard, per-mode worst-case quote, global single-worker
  exposure control, credits and provider cancellation reconciliation.
- No cloud renderer, chargeable queue, GPU function registration, billing
  guard or public deployment was activated by this change.

**Existing product boundary:** `musitu_studio/modal/studio_modal.py` already
defines `render_cpu_pull` and an opt-in `render_gpu` function that requires
`STUDIO_REGISTER_GPU_FUNCTIONS=1`; GPU runtime requires
`STUDIO_GPU_GATE_ON_MODAL=1`. Those flags are NOT being switched on.
The existing Studio v0.3 UI (`edge/public_v03/index.html`), scene submission
intent, D1/DO schema and HTTP controller remain CPU-only. They are **not**
connected to the new G5/G6 queue. The user-facing CPU/GPU selection will
require a separately reviewed versioned storage migration, identity-safe
submission API, actual GPU pull or result path, separate budget ceilings,
fresh verified GPU usage and artifact evidence, and new end-to-end tests before
it may be represented as available in a hosted interface.

TDD evidence:
- RED selection tests:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45453787080
  and https://github.com/evansmusitu/mft-axiom-build/actions/runs/45453819454
- GREEN both-mode queue and schema tests:
  https://github.com/evansmusitu/mft-axiom-build/actions/runs/45454010646
  (**43 Python + 22 Node = 65/65 offline tests passed**).

**GATE 5 OPEN; GATE 6 OPEN; paid CPU and GPU rendering disabled.**

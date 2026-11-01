# MUSITU Connect Mining Adapter Production Completeness Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MUSITU Connect Mining Adapter a composed, durable, auditable end-to-end industrial pipeline and qualify it with reproducible evidence against strong current baselines.

**Architecture:** Keep MUSITU Connect as the enterprise integration/runtime layer and MUSITU Axiom as a downstream engine. Normalize first, seal the normalized canonical payload, persist an integrity-bound run ledger and hash-chained audit log, compose MQTT/OPC-UA ingress into that runtime, then qualify Arrow/Parquet, DuckDB/PostGIS, Temporal, OpenTelemetry and Axiom through a single evidence-producing pipeline. Benchmark algorithmic correctness against SciPy MILP and use current Azure IoT Operations and HighByte Intelligence Hub as external capability/scale references without claiming parity from incomparable workloads.

**Tech Stack:** Python 3, Node.js/Cloudflare Worker, SQLite, Paho MQTT/Mosquitto, asyncua/open62541, PyArrow/Parquet, DuckDB, PostgreSQL/PostGIS, Temporal 1.32, OpenTelemetry Collector 0.161, SciPy MILP, GitHub Actions.

## Global Constraints

- PR #9 stays open and unmerged unless the user separately authorizes merge.
- Sealed `main` `d6a846f6bbe0bccac1758713eb4de167caf07113` stays unchanged.
- No credential values may be printed, rotated, requested in chat, or written to source/evidence.
- Do not weaken Cloudflare or Axiom security.
- Do not redeploy the already-enabled production runtime just because this work changes source.
- `connect.musitu.com` remains deferred unless the narrow transport/security permission can be solved without weakening security.
- Superiority claims require reproducible measured evidence. Wins, ties, losses and unmeasured dimensions are reported equally.

---

### Task 1: Correct and scale the deterministic Mining optimizer

**Files:**
- Modify: `connect/mining.py`
- Modify: `connect/production_worker.mjs`
- Modify: `contracts/mining-record.schema.json`
- Test: `tests/connect/test_contract.py`
- Test: `tests/connect/test_production_worker.mjs`

**Interfaces:**
- Consumes: normalized records `{hazard, exposure, severity, likelihood, cost, benefit}` and nonnegative budget.
- Produces: exact selected interventions, spend, baseline risk, absolute risk reduction, residual risk and relative reduction.

- [x] Add failing tests proving per-hazard fractional benefit semantics, `0 <= benefit <= 1`, and exact planning beyond 20 records.
- [x] Observe failures from the old global-risk formula and 20-record ceiling.
- [x] Implement exact fractional-knapsack-bounded branch-and-bound in Python and Worker source; apply each intervention benefit only to that hazard's baseline risk.
- [x] Verify focused Python and Node tests pass.
- [ ] Run the full Connect test suites before commit.

### Task 2: Add durable canonical persistence, replay and tamper-evident audit

**Files:**
- Create: `connect/persistence.py`
- Modify: `connect/fabric.py`
- Modify: `connect/runtime.py`
- Modify: `connect/__init__.py`
- Test: `tests/connect/test_persistence.py`
- Test: `tests/connect/test_runtime.py`

**Interfaces:**
- Consumes: normalized `CanonicalEnvelope`, run identity, protocol, lineage and canonical HMAC signature.
- Produces: SQLite WAL-backed `StoredRun`, canonical SHA-256, deterministic replay, append-only hash-chained `AuditEvent` records.

- [x] Add failing tests for restart persistence, canonical replay, run-ID conflicts, audit tamper detection and signature coverage of normalized content.
- [x] Observe missing module and raw-before-normalization signature failures.
- [x] Implement durable run store and change runtime sealing order to normalize before canonical signing.
- [x] Verify focused persistence/runtime tests pass.
- [ ] Add restart/recovery qualification under GitHub Actions using the composed adapter.

### Task 3: Compose MQTT/OPC-UA ingress through the durable Mining runtime

**Files:**
- Create: `connect/mining_adapter.py`
- Modify: `connect/protocols.py`
- Modify: `connect/persistence.py`
- Modify: `connect/__init__.py`
- Test: `tests/connect/test_mining_adapter.py`

**Interfaces:**
- Consumes: bounded MQTT JSON payloads or explicit OPC-UA field-to-node mappings.
- Produces: normalized/sealed/persisted enterprise run; deterministic plan; verified replay; Axiom execution with audit metadata only.

- [x] Add failing MQTT, OPC-UA, replay, bounds and audited-Axiom tests.
- [x] Observe the missing composed adapter service.
- [x] Implement strict 1 MiB MQTT payload boundary, real transport receive seam, OPC-UA reads, durable plan/replay and sanitized Axiom audit events.
- [x] Verify focused service tests pass.
- [ ] Exercise the same interfaces against live Mosquitto and OPC-UA qualification containers.

### Task 4: Build deterministic production-completeness qualification and benchmark evidence

**Files:**
- Create: `qualification/mining_adapter_matrix.json`
- Create: `qualification/mining_adapter_qualify.py`
- Create: `benchmarks/mining_adapter/benchmark.py`
- Create: `benchmarks/mining_adapter/README.md`
- Create: `benchmarks/mining_adapter/baselines.json`
- Create: `infra/qualification/mining_adapter_e2e.py`
- Modify: `.github/workflows/musitu-connect-infrastructure.yml`
- Test: `tests/connect/test_mining_qualification.py`

**Interfaces:**
- Consumes: pinned `infra/versions.lock`, deterministic seed/workloads, composed infrastructure report and raw benchmark JSON.
- Produces: explicit PASS/FAIL matrix plus raw machine-readable latency p50/p95/p99, throughput, RSS, correctness, durability/recovery, interoperability, observability and operational-evidence records.

- [ ] Pin workload generation, warmups, repetitions, runner metadata and statistical method.
- [ ] Benchmark MUSITU optimizer against SciPy MILP for correctness and performance; benchmark composed pipeline stage latencies/resource use separately.
- [ ] Run composed MQTT → normalize/seal → persist → Parquet/DuckDB → PostGIS → lineage → Temporal → OTel → replay → Axiom-stub qualification in CI, then preserve evidence artifacts.
- [ ] Evaluate every matrix gate strictly from evidence files; missing evidence is FAIL, never PASS-by-assumption.
- [ ] Compare measured results with current external references; mark non-comparable commercial metrics as `NOT_COMPARABLE`, not wins.

### Task 5: Close measured gaps and independently verify the branch

**Files:**
- Modify only files implicated by failing gates/benchmarks.
- Preserve raw rerun evidence under `qualification/evidence/` for stable small reports and GitHub Actions artifacts for full run outputs.

**Interfaces:**
- Consumes: failed gates, raw benchmark/e2e evidence.
- Produces: rerun evidence and a claim ledger classifying each baseline dimension as WIN/TIE/LOSS/NOT_COMPARABLE.

- [ ] Fix only evidenced gaps, adding a failing test before each behavioral change.
- [ ] Rerun focused tests, full repository tests, composed infrastructure qualification and benchmark suite.
- [ ] Push reviewed commits only to `feat/musitu-connect-frontier`; verify current-head PR checks and live runtime guard.
- [ ] Do not merge PR #9 and do not deploy production as part of qualification.

## Unresolved externally observable decisions

- Monetary customer cost cannot be compared defensibly until equivalent licensed Azure IoT Operations/HighByte deployments and identical hardware/workload pricing are available; until then report compute-seconds/RSS and `NOT_COMPARABLE` for monetary cost.
- Mine-specific predictive accuracy and safety certification require real labeled mine data and domain validation; synthetic interoperability/optimization benchmarks cannot establish either claim.

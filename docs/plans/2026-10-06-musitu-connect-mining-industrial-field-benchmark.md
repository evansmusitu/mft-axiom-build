# MUSITU Connect Mining Industrial Field Benchmark Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and execute a reproducible industrial field benchmark for MUSITU Connect Mining Adapter with 1M+ real MQTT events, 1M+ real OPC-UA data points, prolonged soak/fault recovery, and same-workload comparator lanes for EMQX, HighByte and Azure IoT Operations.

**Architecture:** Keep the existing production runtime untouched. Add a benchmark-only workload contract and network runners under `benchmarks/mining_adapter`, execute them in an isolated GitHub Actions workflow, archive raw evidence, and evaluate a fail-closed field qualification report. EMQX runs directly on the same hosted runner; HighByte and Azure lanes require explicit legitimate external deployment authorization/configuration and otherwise report BLOCKED rather than inferred performance.

**Tech Stack:** Python 3.12, Paho MQTT, asyncua OPC-UA, Docker/Compose, Mosquitto 2.1.2, EMQX Enterprise 6.3.1, GitHub Actions, JSON evidence.

## Global Constraints

- PR #9 stays open/unmerged.
- Sealed `main` stays at `d6a846f6bbe0bccac1758713eb4de167caf07113`.
- Do not redeploy or mutate the existing production runtime.
- Do not expose, rotate or request pasted credentials.
- Do not weaken Cloudflare/Axiom security.
- Do not accept HighByte EULA or provision Azure resources on the user's behalf.
- Every named superiority claim requires identical-workload measured evidence.
- Raw per-run/per-phase evidence is archived; missing evidence fails closed.

---

### Task 1: Deterministic industrial workload contract

**Files:**
- Create: `benchmarks/mining_adapter/industrial_field.py`
- Create: `tests/connect/test_mining_field_benchmark.py`

**Interfaces:**
- Produces `IndustrialWorkloadSpec`, deterministic mining telemetry rows, workload fingerprint, comparator metadata, and field-gate evaluation.

- [ ] Add focused tests for default 1M MQTT events, 1M OPC-UA points, >=600s soak, deterministic row generation, current comparator versions and fail-closed comparator status.
- [ ] Observe tests fail before implementation.
- [ ] Implement the pure workload/evaluation layer.
- [ ] Verify focused and full Connect suites.

### Task 2: Real network load + recovery runners

**Files:**
- Create: `benchmarks/mining_adapter/mqtt_field_runner.py`
- Create: `benchmarks/mining_adapter/opcua_field_runner.py`
- Modify: `connect/protocols.py`
- Test: `tests/connect/test_platform_boundaries.py`

**Interfaces:**
- MQTT runner emits exact sent/received/duplicate/loss, p50/p95/p99 latency, throughput, disconnect/reconnect and broker-restart recovery evidence.
- OPC-UA runner emits actual batched service-read data-point count, throughput, p50/p95/p99 service latency and server-restart recovery evidence.
- `OpcUaTransport.read_many` uses one OPC-UA batch service call per requested node set.

- [ ] Add failing batch-transport test before changing production transport behavior.
- [ ] Implement minimum batching change and network runners.
- [ ] Verify focused tests and no production API regressions.

### Task 3: Same-workload comparator execution

**Files:**
- Create: `infra/qualification/docker-compose-field.yml`
- Create: `.github/workflows/musitu-connect-industrial-field-benchmark.yml`
- Modify: `benchmarks/mining_adapter/baselines.json`

**Interfaces:**
- MUSITU MQTT lane runs against pinned Mosquitto 2.1.2.
- EMQX lane runs the exact same MQTT workload against EMQX Enterprise 6.3.1 on the same runner.
- HighByte 4.5.2 and Azure IoT Operations 1.4.73 lanes consume the same benchmark contract when legitimate external endpoints/evidence are available; otherwise remain BLOCKED_EXTERNAL_DEPLOYMENT.

- [ ] Pin current versions and identical workload settings.
- [ ] Run 1M-event MQTT stress/fault test on MUSITU and EMQX.
- [ ] Run 1M-data-point OPC-UA stress/fault test.
- [ ] Run >=600-second Mining Adapter soak.
- [ ] Archive raw machine-readable evidence.

### Task 4: Field qualification and claim gate

**Files:**
- Create: `qualification/mining_adapter_field_qualify.py`
- Create: `qualification/mining_adapter_field_matrix.json`
- Test: `tests/connect/test_mining_field_benchmark.py`

**Interfaces:**
- Produces `MINING_ADAPTER_FIELD_LOAD_QUALIFIED`, `INDUSTRIAL_FIELD_BENCHMARK_PARTIAL`, or `INDUSTRIAL_FIELD_BENCHMARK_COMPLETE`.
- COMPLETE is impossible unless Azure, HighByte, EMQX and MUSITU all have same-workload measured evidence.

- [ ] Fail on <1M protocol events, insufficient soak, unrecovered fault or missing raw metrics.
- [ ] Report wins/ties/losses/blocked comparators equally.
- [ ] Seal final artifact digest and PR #9 evidence without merging.

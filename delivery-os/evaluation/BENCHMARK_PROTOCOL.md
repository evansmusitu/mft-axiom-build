# MUSITU Delivery OS — reproducible competitive benchmark protocol v2

This evaluation layer is outside operational authority. It creates no second store, dispatcher, API authority, order model, or synchronization bridge. MUSITU Delivery Core remains the single runtime authority.

## Evidence and claim policy

`internal_controlled` evidence prevents regressions but cannot support an external superiority claim. `live_external` evidence must come from real test/sandbox execution for MUSITU and every named competitor on an identical scenario and workload fingerprint.

The report gate returns only `NOT_CERTIFIED` or `EVIDENCE_READY_FOR_REVIEW`; it never emits `MUSITU_SUPERIOR`. Any later comparative claim must name the exact benchmark version, date, competitors and measured dimensions. The internal `projected_improvement=0.451` regression remains non-comparative.

## Scenario versioning

Standard-v1 is immutable for audit reproducibility. Its SHA-256 is `bb64c1d425bf5e8245a0daad8acffa01f849da79f3b9a9d83fbdd86aec012554`, but its 100-order workload has aggregate demand 250 against fleet capacity 200. The VROOM preflight therefore rejects v1 with `BENCHMARK_FLEET_CAPACITY_INFEASIBLE`. It must not be used for head-to-head results.

`scenario.standard-v2.json` is the current executable benchmark candidate. It preserves 100 orders, 10 drivers, one depot, 10 deterministic disruptions, time windows, skills, service durations, route continuity and photo+signature POD, while declaring capacity 30 per driver (aggregate 300).

Canonical standard-v2 workload SHA-256: `fb80db552b55efb60c5372629c606cdd6879f796950ec44e1d854f46e8dfabdc`.

Every provider run must use this exact workload fingerprint.

## Metrics

- assignment decision latency — lower is better
- total route distance — lower is better
- on-time completion rate — higher is better
- operator interventions — lower is better
- proof completeness rate — higher is better

## Provider access boundary

Onfleet live execution remains blocked until a dedicated test API key, test team/worker bindings and compatible Route Optimization access/default schedule are available. The dry-run adapter emits 100 documented task requests without credentials.

Bringg Own Fleet remains blocked until the real Sandbox token URL/client credentials, exact Create Order service URL and sandbox-specific order schema are supplied. Service UUIDs are never guessed.

No production credentials or customer data are required.

## Constrained MUSITU planning

`vroom-standard.mjs` maps standard-v2 into 10 VROOM vehicles and 100 jobs with capacity, deterministic numeric skill IDs, demand, service durations, time windows, depot continuity and priority.

Competitive benchmarking fails closed if the runtime optimizer degrades to `heuristic-fallback`, if aggregate fleet capacity is insufficient, or if VROOM leaves any job unassigned. CI publishes `standard-v2-vroom-request.json` with `LIVE_VROOM_REQUIRED` and `NOT_CERTIFIED`.

## Runtime disruption evidence

Driver offline/online changes are now represented by idempotent canonical `DRIVER_AVAILABILITY` events in the same DeliveryStore tamper-evident chain. This allows standard-v2 driver-offline disruptions without mutating internal maps outside the canonical authority.

## Commands

```bash
node --test evaluation/benchmark.test.mjs evaluation/external-access.test.mjs evaluation/standard-workload.test.mjs evaluation/provider-adapters.test.mjs evaluation/vroom-standard.test.mjs
node evaluation/materialize-standard-v2.mjs --output /tmp/standard-v2-workload.json
node evaluation/materialize-provider-plans.mjs --output-dir /tmp/provider-plans
node evaluation/materialize-vroom-standard.mjs --output /tmp/standard-v2-vroom-request.json
node evaluation/run-controlled.mjs --output /tmp/musitu-benchmark-controlled.json
```

The next evidence step is real VROOM-backed standard-v2 planning followed by the same dispatch, disruption, replan, completion and evidence-verification flow. External Onfleet/Bringg comparison remains `NOT_CERTIFIED` until their dedicated test/sandbox access is obtained.

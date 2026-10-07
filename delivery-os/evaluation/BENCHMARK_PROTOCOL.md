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

Competitive benchmarking fails closed if the runtime optimizer degrades to `heuristic-fallback`, if aggregate fleet capacity is insufficient, or if VROOM leaves any job unassigned. The exact request now includes deterministic per-profile travel-time and distance matrices (`haversine-30kmh-v1`). This makes the request self-contained for VROOM: no OSRM, Valhalla or ORS call is required. CI publishes `standard-v2-vroom-request.json` with `EXECUTION_INPUT_READY` and `NOT_CERTIFIED`, then executes the same workload against pinned real VROOM.

## Runtime disruption evidence

Driver registration, driver location continuity, driver offline/online changes, and traffic-delay disruptions are represented by canonical tamper-evident DeliveryStore events (`DRIVER_REGISTERED`, `DRIVER_LOCATION`, `DRIVER_AVAILABILITY`, `TRAFFIC_DELAY`). The standard-v2 harness creates/assigns/transitions/completes all 100 orders only through DeliveryStore public paths, applies all 10 deterministic disruptions, replans after every disruption, requires photo+signature proof, and verifies the complete event chain before emitting evidence.

## Commands

```bash
node --test evaluation/benchmark.test.mjs evaluation/external-access.test.mjs evaluation/standard-workload.test.mjs evaluation/provider-adapters.test.mjs evaluation/vroom-standard.test.mjs evaluation/standard-v2-harness.test.mjs
node evaluation/materialize-standard-v2.mjs --output /tmp/standard-v2-workload.json
node evaluation/materialize-provider-plans.mjs --output-dir /tmp/provider-plans
node evaluation/materialize-vroom-standard.mjs --output /tmp/standard-v2-vroom-request.json
node evaluation/run-controlled.mjs --output /tmp/musitu-benchmark-controlled.json
VROOM_URL=http://127.0.0.1:3000 node evaluation/run-standard-v2-harness.mjs --product-head <git-sha> --output /tmp/standard-v2-internal-evidence.json
```

The internal standard-v2 evidence step is implemented and remains `internal_controlled` / `NOT_CERTIFIED`. External Onfleet/Bringg comparison remains `NOT_CERTIFIED` until dedicated test/sandbox access produces matching `live_external` runs on the identical workload fingerprint.

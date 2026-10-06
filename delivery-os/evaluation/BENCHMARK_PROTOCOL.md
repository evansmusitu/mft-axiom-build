# MUSITU Delivery OS — reproducible competitive benchmark protocol v1

This evaluation layer is outside the operational authority. It does not create orders, dispatchers, stores, or synchronization bridges. MUSITU Delivery Core remains the only runtime authority.

## Purpose

The unified architecture requires the sequence: relevant Onfleet/Bringg baseline parity -> reproducible benchmark -> measured superiority only where evidence supports it. This protocol implements the reproducibility and claim-safety gate without pretending that competitor access exists.

## Evidence classes

- `internal_controlled`: deterministic MUSITU-only regression evidence. Useful for preventing regressions, but never sufficient for an external superiority claim.
- `live_external`: evidence captured from a real sandbox/test environment or equivalent live vendor API execution. This is required for MUSITU and every competitor named in a head-to-head comparison.

Marketing pages, screenshots, hand-entered claims, documentation feature lists, and synthetic competitor numbers are not accepted as live benchmark evidence.

## Standard scenario

`scenario.standard-v1.json` defines the versioned common workload and metric directions. Every compared run must use exactly the same scenario id, version, and metric contract. A mismatch fails closed.

The v1 workload fixes 100 orders, 10 drivers, one depot, 10 disruption events, time windows, capacity/service constraints, and photo+signature proof requirements. The common flow is ingest -> plan -> dispatch -> disrupt -> replan/recommend -> complete -> verify evidence.

## Exact standard-v1 workload

The abstract scenario is materialized by `standard-workload.mjs` into a vendor-neutral JSON workload. The generated workload contains the exact 100 orders, 10 drivers, 10 disruptions, time windows, capacity demands, skills, coordinates and proof requirements that every provider must receive. CI materializes and publishes the workload together with its checksum.

Canonical workload SHA-256: `bb64c1d425bf5e8245a0daad8acffa01f849da79f3b9a9d83fbdd86aec012554`.

A provider run over a different workload is not comparable, even if the order/driver counts match.

## Metrics

- assignment decision latency — lower is better
- total route distance — lower is better
- on-time completion rate — higher is better
- operator interventions — lower is better
- proof completeness rate — higher is better

Additional metrics require a new scenario version so historical comparisons remain reproducible.

## Targets and access boundary

`targets.json` records official documentation entry points and the current access blocker. Onfleet requires real API credentials for live execution. Bringg requires sandbox credentials plus sandbox-specific service identifiers. No production credential is requested by this protocol.

## Live access preflight

`BENCHMARK_ACCESS.md` and `run-access-preflight.mjs` define a secret-safe preflight for dedicated Onfleet test access and Bringg Own Fleet Sandbox access. Preflight readiness is necessary but not sufficient for a comparison: it never upgrades the claim state by itself.

## Claim policy

The executable validator returns only:

- `NOT_CERTIFIED` when required live evidence is absent or incompatible; or
- `EVIDENCE_READY_FOR_REVIEW` when matching live external runs are present.

It intentionally does not emit `MUSITU_SUPERIOR`. A superiority statement requires review of the resulting metric evidence and must name the exact benchmark version, competitors, date, and measured dimensions. Dimensions not measured remain unclaimed.

## Current controlled evidence

The existing unified CI gate reported `projected_improvement=0.451` in the internal controlled optimization regression. The fixture preserves that evidence as `internal_controlled`, so the validator demonstrably refuses to convert it into an Onfleet/Bringg superiority claim.

## Commands

```bash
node --test evaluation/benchmark.test.mjs evaluation/external-access.test.mjs evaluation/standard-workload.test.mjs evaluation/provider-adapters.test.mjs evaluation/vroom-standard.test.mjs
node evaluation/materialize-standard-v1.mjs --output /tmp/standard-v1-workload.json
node evaluation/materialize-vroom-standard.mjs --output /tmp/standard-v1-vroom-request.json
node evaluation/run-controlled.mjs --output /tmp/musitu-benchmark-controlled.json
```

When real sandbox runs become available, serialize each provider result with schema `musitu-delivery-benchmark-run.v1` and pass them through the same `buildBenchmarkReport` contract. Do not modify the benchmark rules to fit a desired result; version the scenario instead.

## Provider dry-run plans

`provider-adapters.mjs` converts the exact standard-v1 workload into provider-facing dry-run plans without embedding credentials.

For Onfleet, the adapter maps all 100 orders to documented `POST /api/v2/tasks` requests with explicit coordinates, parsed city/country context, time windows, quantity, service time, photo/signature completion requirements, benchmark provenance, and ROv3 refrigeration capability metadata. It deliberately does not attach authentication headers or perform live mutation. Live execution remains blocked until a dedicated test API key, test team/worker bindings, and compatible Route Optimization entitlement/default schedule are available.

For Bringg Own Fleet, the adapter fails closed and emits no order requests until the exact Sandbox Create Order service URL is supplied. Even after that URL is supplied it remains blocked pending confirmation of the sandbox-specific order schema; service UUIDs are never guessed from public examples.

CI publishes both dry-run plans as evidence artifacts tied to the same workload SHA-256 `bb64c1d425bf5e8245a0daad8acffa01f849da79f3b9a9d83fbdd86aec012554`.

## MUSITU constrained planning preflight

`vroom-standard.mjs` maps the exact standard-v1 workload into a VROOM request with 10 vehicles and 100 jobs. The mapping carries driver capacity, deterministic numeric skill IDs, job demands, service durations, job time windows, depot start/end continuity and priority.

The normal runtime optimizer is allowed to degrade safely to a deterministic heuristic when VROOM is unavailable. The competitive benchmark is stricter: `runStandardVroomPlanning` rejects `heuristic-fallback` with `BENCHMARK_VROOM_REQUIRED`, and rejects any real VROOM result with unassigned standard-v1 jobs. This prevents a degraded unconstrained plan from being presented as constrained benchmark evidence.

CI publishes `standard-v1-vroom-request.json` with status `LIVE_VROOM_REQUIRED` and claim status `NOT_CERTIFIED`. The request remains internal controlled evidence until executed against real VROOM and then carried through the rest of the standard-v1 dispatch/disruption/completion/evidence flow.

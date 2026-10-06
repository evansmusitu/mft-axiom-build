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

## Metrics

- assignment decision latency — lower is better
- total route distance — lower is better
- on-time completion rate — higher is better
- operator interventions — lower is better
- proof completeness rate — higher is better

Additional metrics require a new scenario version so historical comparisons remain reproducible.

## Targets and access boundary

`targets.json` records official documentation entry points and the current access blocker. Onfleet requires real API credentials for live execution. Bringg requires sandbox credentials plus sandbox-specific service identifiers. No production credential is requested by this protocol.

## Claim policy

The executable validator returns only:

- `NOT_CERTIFIED` when required live evidence is absent or incompatible; or
- `EVIDENCE_READY_FOR_REVIEW` when matching live external runs are present.

It intentionally does not emit `MUSITU_SUPERIOR`. A superiority statement requires review of the resulting metric evidence and must name the exact benchmark version, competitors, date, and measured dimensions. Dimensions not measured remain unclaimed.

## Current controlled evidence

The existing unified CI gate reported `projected_improvement=0.451` in the internal controlled optimization regression. The fixture preserves that evidence as `internal_controlled`, so the validator demonstrably refuses to convert it into an Onfleet/Bringg superiority claim.

## Commands

```bash
node --test evaluation/benchmark.test.mjs
node evaluation/run-controlled.mjs --output /tmp/musitu-benchmark-controlled.json
```

When real sandbox runs become available, serialize each provider result with schema `musitu-delivery-benchmark-run.v1` and pass them through the same `buildBenchmarkReport` contract. Do not modify the benchmark rules to fit a desired result; version the scenario instead.

# MUSITU Connect Mining Adapter benchmark

This harness compares the exact MUSITU Mining intervention optimizer with SciPy 1.18.1 MILP on the same deterministic workload, process and machine. It reports correctness, p50/p95/p99 latency, throughput, runtime metadata and peak RSS. Default methodology is seed `20261006`, 5 warmups and 30 measured repetitions at 16/32/64/128/256 records with a budget equal to 25% of total intervention cost.

The harness does **not** treat Azure IoT Operations or HighByte Intelligence Hub as runnable performance baselines unless identical licensed deployments, workload and hardware are available. Those products are external capability/scale references in `baselines.json`. Monetary cost is therefore explicitly `NOT_COMPARABLE` in normal CI evidence rather than guessed.

Run:

```bash
python benchmarks/mining_adapter/benchmark.py --output qualification/evidence/mining_adapter_benchmark.json
```

Current external reference set is pinned in `baselines.json`; commercial products remain `NOT_COMPARABLE` unless the same workload, topology and hardware are exercised.

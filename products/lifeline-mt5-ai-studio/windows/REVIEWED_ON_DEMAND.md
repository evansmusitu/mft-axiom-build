# LIFELINE Reviewed On-Demand MetaEditor Compiler (Windows)

For a project owner who cannot host a permanent Windows MT5 terminal, this GitHub Actions workflow provides **one native, signed MetaEditor compilation job per explicit dispatch**, using the existing public repo's hosted Windows runners.

## How to run from Android

1. In GitHub Actions find **LIFELINE Reviewed On-Demand Native EX5 Build** on the isolated development branch.
2. Choose **Run workflow**, then `reviewed/ExampleSafeEA.mq5` and SHA256 `f86164f62333736f22f7a4bea73f3fdb49f9870de36b9370c10ff03e640e6026`.
3. Wait for Windows CI. Only a passing native MetaEditor process produces the downloadable artifact `lifeline-reviewed-native-ex5-proof`. The artifact includes EX5, compile log and categorical no-trade proof; it expires after 3 days.

Only source under `windows/reviewed/` is accepted. Input must be pinned to the *exact SHA256*, and a vendor-authenticated installer/binary is mandatory. Source content changes require an authorized GitHub review and corresponding SHA update. The default reviewed EA contains **no order sending**. Remote input does not include raw code, credentials or trading commands.

**Limitations:** one-shot Windows runner is not a persistent MetaTrader host. This workflow compiles native EX5 only; it does not run historical strategy tests, place orders, publish a public plugin, or access Cloudflare/Modal/Neon. GitHub Actions service availability and free-use policies apply. The user requested $0 out-of-pocket; this does not authorize buying additional minutes, hosting or brokers.

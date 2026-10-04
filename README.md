# mft-axiom-build
Good news always


## MUSITU Connect

This branch contains the general-purpose MUSITU Connect enterprise adapter platform and its first Mining Adapter. MUSITU Connect is the enterprise interoperability layer; MUSITU Axiom remains a downstream quantitative engine.

Infrastructure lock: `infra/versions.lock`

Current controlled state:
- Infrastructure qualification: **QUALIFIED**
- Controlled Connect → Axiom bridge: **QUALIFIED**
- Credentialed live request-ID E2E: **QUALIFIED**
- Production admission policy: **ENFORCED / BLOCKED**
- Production Axiom runtime enablement: **BLOCKED**

Production admission is intentionally separate from runtime enablement. Technical readiness requires non-fixture production identity, full OAuth authorization-code/PKCE qualification, credential rotation/recovery, rollback rehearsal, production observability/alerting/SLO verification, and canary verification. Even after those controls pass, an explicit promotion authorization is still required, and the admission policy itself never enables the runtime.

Gate record: `qualification/musitu_connect_gate.json`

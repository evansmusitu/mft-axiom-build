# mft-axiom-build
Good news always


## MUSITU Connect

This branch contains the general-purpose MUSITU Connect enterprise adapter platform and its first Mining Adapter. MUSITU Connect is the enterprise interoperability layer; MUSITU Axiom remains a downstream quantitative engine.

Infrastructure lock: `infra/versions.lock`

Current controlled state:
- Infrastructure qualification: **QUALIFIED**
- Controlled Connect → Axiom bridge: **QUALIFIED**
- Credentialed live request-ID E2E: **QUALIFIED**
- OAuth authorization-code / S256 PKCE admission control: **QUALIFIED (composed evidence)**
- Secret rotation/recovery rehearsal: **QUALIFIED on isolated canary**
- Rollback rehearsal: **QUALIFIED on isolated canary**
- Canary + bounded SLO + synthetic alert signal: **QUALIFIED on isolated canary**
- Non-fixture production Axiom identity: **BLOCKED — no dedicated Connect credential assigned**
- Production Axiom runtime enablement: **BLOCKED**

Production admission is intentionally separate from runtime enablement. All current technical admission controls except the non-fixture production identity are qualified. A read-only preflight confirms active non-fixture Axiom identities exist, but CI has no dedicated MUSITU Connect account key/bearer and neither the successor `MUSITU_CONTROL_SECRET` nor legacy `MFT_CONTROL_SECRET` is available to validate the supported admin provisioning path.

Direct production D1 identity insertion is intentionally prohibited. Latest identity preflight: run `37187531468`, evidence SHA-256 `e8de53ca35803612f1b9ff7073e93487c34c640182e8003c1e86d83994725654`. Once an authorized dedicated Connect credential is assigned, the preflight is designed to execute a canonical Connect → Axiom request and require exact Axiom usage-ledger request-ID correlation before the final technical identity control can qualify.

Even after technical readiness becomes green, an explicit promotion authorization is still required, and the admission policy itself never enables the production runtime.

Gate record: `qualification/musitu_connect_gate.json`

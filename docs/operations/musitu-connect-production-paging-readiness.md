# MUSITU Connect production on-call delivery: readiness boundary

The existing `qualification/verify_live_production_runtime.py` independently
probes the previously enabled production Workers.dev endpoint and rejects
unauthenticated planning. Every branch Connect CI run includes this guard.

This change adds a separate **read-only operational-readiness audit**:

- `qualification/production_paging.py` provides a fail-closed PagerDuty Events
  API v2 escalation adapter for **explicitly authorized** future operation.
- The adapter never uses customer data, Axiom credentials, or a model outcome.
  The request contains fixed, sanitized production-runtime health metadata.
- The routing key is read only when `--enable-external-page` is supplied, and
  is never printed or saved in output evidence.
- HTTP 202 plus the expected event deduplication acknowledgement means only
  `PROVIDER_ACKNOWLEDGED_ONLY`. It is **not** proof that a human was paged,
  acknowledged, or responded.
- Failed responses, invalid evidence, and missing configuration all fail closed.
- The feature-branch workflow `musitu-connect-production-paging-readiness.yml`
  deliberately does **not** pass `--enable-external-page`: it executes the
  existing live read-only guard and saves a JSON evidence record that explicitly
  states `external_paging_verified=false`.

## How to qualify real delivery later

Require approved on-call contacts, authorized PagerDuty service and routing
key securely injected by the platform (never supplied in chat or committed),
a controlled synthetic escalation and verified receipt/human acknowledgement.
The provider transport proof and human receipt are **separate** requirements.
Only after explicit authorization should a dedicated isolated delivery test
be performed. Do not wire the research methane warning gate into production.

This branch work **does not** modify the existing Worker, customer data,
Cloudflare security, Axiom production integration, PR #9, or sealed `main`.
`connect.musitu.com` remains deferred.

To run contract tests locally:

```bash
python -m unittest discover -s tests/connect -p 'test_production_paging.py' -v
```

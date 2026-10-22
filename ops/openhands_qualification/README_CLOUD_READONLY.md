# OpenHands Cloud S2 provider repository admission preflight

Purpose: resolve the **current** availability of a provider-side OpenHands GitHub repository binding without invoking model inference or modifying any repository. A read-only metadata result alone never passes S3 engineering, human approval, cost, antirollback or release gates.

- Restricted branch: `frontier/axiom-openhands-cloud-s2-readonly-20261022`; do not modify main or PR #1.
- Exact provider: `app.all-hands.dev`; single `GET /api/user/repositories?per_page=100`, with short-lived in-memory repo-scoped credential from existing GitHub secret `OPENHANDS_API_KEY` if present.
- Provider access evidence accepted only as `PROVIDER_READONLY_REPOSITORY_ACCESS_CONFIRMED`; STILL `runtime_activation_authorized=false`, `live_s3_mutation_qualified=false`, `production_authority=false`.
- Missing credential remains `BLOCKED_CREDENTIAL_NOT_AVAILABLE`; 401/403/404/429 or malformed response remains explicitly BLOCKED.
- Does not print API token, raw response, credentials, user email, or repository inventory. No uploads, model calls, write permissions, new paid infra or production side effects.
- Read-only result does not prove an operation-scoped S3 grant; S3 work must wait for exact human approval, account-wide $0 guarantee, independent OpenHands native operation evidence, GitHub readback and rollback.
- On a compromised/self-administered witness, preserve B27 majority rollback failure. This preflight makes no independent security claim.

Provider reference: https://docs.openhands.dev/api-reference/get-user-repositories (provider GET endpoint). API versions may drift; auth/endpoint drift yields BLOCKED, not inferred success.

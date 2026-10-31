# MUSITU Connect — Cloudflare staging qualification and credential-use boundary

Status: 31 October 2026. **Phase 1: NOT_DEMONSTRATED. Commercial GA: NO-GO.** This is an operator handoff for explicitly authorized, isolated staging. It is not an instruction to operate on live production data.

## Authenticated evidence (read-only)

- GitHub Actions run [41179878070](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41179878070) demonstrated that the repository's five dedicated staging-secret references were empty to its feature-branch runner. The pinned source preflight refused with `STAGING_PRODUCTION_ACCOUNT_ISOLATION_UNPROVEN` before any D1 query. This outcome does not establish a staging database.
- GitHub Actions run [41180195195](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41180195195) verified that the existing `CLOUDFLARE_API_TOKEN` is an active *account-owned* token for the established production Axiom account. The user-token endpoint had returned HTTP 401; that alone was not evidence of a bad account token.
- GitHub Actions run [41180311824](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41180311824) authenticated a bounded GET of D1 inventory metadata for that existing account. No database rows or SQL were queried; no production D1 writes or credentials were disclosed. Successful account metadata access does not prove independent staging, a read-only token's permissions, quota concurrency, or customer isolation.
- Feature-branch push-triggered workflows created solely for these observations are retired in the same review branch after evidence capture, along with their matching one-off policy tests. A production-account token must **never** become a silent fallback for a missing Connect staging credential.

## Next manual, reviewed-main operator gate

The repository already contains `.github/workflows/musitu-connect-hosted-d1-readonly.yml`, a manual (`workflow_dispatch`) workflow restricted to `refs/heads/main`. It checks a pinned staging database's identity, source schema parity and empty customer tables. It performs only fixed SELECT queries, not customer admission or transactional GA qualification.

An authorized Cloudflare administrator must first establish a **distinct, independently managed staging account** and an isolated staged D1 resource with reviewed schema. Configure the following as GitHub Actions secrets (never paste values in public issues, CI logs, chat, or the repository):

- `MUSITU_CF_STAGING_ACCOUNT_ID` — independently verified isolated staging account, distinct from existing production.
- `MUSITU_CF_PRODUCTION_ACCOUNT_ID` — verified established production account identifier, for inequality validation.
- `MUSITU_CF_STAGING_DATABASE_NAME` — the exact reviewed staging D1 name matching the `musitu-connect-stage-...` constraint.
- `MUSITU_CF_STAGING_DATABASE_ID` — actual provider-issued staging D1 UUID (version 4).
- `MUSITU_CF_STAGING_READ_TOKEN` — staging-only, database-read-scoped token, not the production `CLOUDFLARE_API_TOKEN` and not a broad global API key.

Before dispatch, a second authorized reviewer must confirm source account ownership and permissions **in Cloudflare's control plane**, not from matching environment-variable strings. Check that the mainline workflow remains manual-only, that its source matches the reviewed commit and that it cannot use a production fallback. Do not use a temporary feature-branch workflow for further secrets exploration.

## After the staged read-only probe

A green schema/zero-row probe is **not** a completed Phase 1 gate. Separately authorized, *staging-only* provider-backed tests must exercise tenant A/B isolation, disallowed cross-tenant read/write, duplicate and concurrent request IDs, daily/minute quotas, atomic rollback, revocation while in flight, zero residual test data, and verified recovery after interruption. Independently attest original Cloudflare account identity, D1 UUID, scoped token permissions, provider transaction/negative-case traces, cleanup, source-commit hash, and evidence SHA-256. Keep all raw credentials and customer records in controlled private custody.

No production D1 writes, production schema migrations, token rotations, customer registrations, live billing, or customer-specific secrets are authorized by this record. Leave all 13 Connect commercial-GA requirements `NOT_DEMONSTRATED` until each independent release-control owner certifies original provider evidence. Keep the frozen methane predictor research-only and the existing Axiom arithmetic runtime unchanged.

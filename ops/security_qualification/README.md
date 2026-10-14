# AXIOM — B27 external-provenance preflight, isolated S0 candidate

**Not a new sealed product phase. No model calls, production writes, or external signature publication.**

Authority inherited: exact live B27 parent `c57cf8505ceee91a6b9b93ae6368f54c6b9ae127`.
The source B27 15-case suite reproduces the destructive majority-voter plus witness journal deletion attack. Its existence is a **security FAILURE**; it is not an earned antirollback PASS.

## Scope

`security_state.py` creates a deterministic, constrained *statement of what is still unearned* after the B26/B27 regressions actually run. The record is hash-bound to the transcript and exact B27 source SHA; it cannot be changed into an authority certificate by passing different flags, claiming Sigstore PASS, or using a different repository/ref. The output always says `production_authority=false`, `provider_dispatch_allowed=false`, `global_antirollback=FAILED_IN_SYNTHETIC_ATTACK`, `independent_witness=NOT_CERTIFIED`, `provider_zero_cost=NOT_VERIFIED`, and `sigstore_provenance_status=NOT_PUBLISHED_APPROVAL_REQUIRED`.

This is not an immutable release gate by itself. Developers with repo write access can change source or forge test logs. GitHub Actions can attest **who built an artifact** and the exact digest; it cannot certify that such assertions are objectively true, and GitHub-controlled OIDC does not establish separate witness administration.

## What GitHub Actions preflight qualifies

Run inherited exact B26 and B27 suites on a nonproduction GitHub-hosted runner, preserve the real observed stdout/stderr, verify context and no credential availability, generate the S0 fact record, and pass the new 12-case local adversarial test suite. The preflight job has `contents:read` permissions only. It does **not** request OIDC tokens, publish Sigstore Rekor entries, send provider requests, or deploy anything.

Only after explicit **user authorization for public irreversible publication**, add a *separate* pinned `actions/attest` signing step with `id-token:write` and `attestations:write`; verify the Sigstore bundle and public log inclusion using a trusted verifier. The attestation may establish external transparency of the **failure record**, not external authorization to dispatch.

## Unresolved critical gates

1. User-designated independent security operator with separate credential and storage deletion authority.
2. True atomic monotonic witness, destructive restore/retention proofs, independent revocation and key rotation.
3. Fresh provider account/billing evidence and a guaranteed $0 operational gate before any live inference.
4. Independent verifier and human approval for any S4/S5 or production release.

All these remain NOT CERTIFIED. Preserve existing main, PR #1, frozen OpenAI submission, other product branches and production rollback origin.

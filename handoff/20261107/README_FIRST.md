# MUSITU AXIOM — whole-product new-chat handoff
**Snapshot date:** 2026-11-07 (Africa/Harare, UTC+02:00).
**Classification:** PUBLIC-SAFE ENGINEERING CONTINUATION. The source repository and this handoff are public. Confidential accounts, GitLab-only branch names, credentials, private artifacts, provider responses and secrets MUST remain exclusively in authorized private systems.

## Read order (before changes)
1. `HANDOFF/README_FIRST.md` — this file.
2. `HANDOFF/CONTINUATION_STATE.md` — authoritative narrative checkpoint and prohibitions.
3. `HANDOFF/CONTINUATION_STATE.json` — machine-readable pins, gate statuses and sequence.
4. `HANDOFF/VERIFICATION_MATRIX.md` — exact already-checked results and remaining proofs.
5. `HANDOFF/NEW_CHAT_COMMAND.txt` — complete portable restart prompt.
6. `HANDOFF/CONTINUATION_TIMELINE.md` and `HANDOFF/SOURCE_MANIFEST.md`.
7. `HANDOFF/SHA256SUMS.txt` — file integrity list generated at packaging time.
8. Inspect `PRODUCT/main/`, `PRODUCT/draft-76-phase210a/`, `PRODUCT/draft-81-phase210b/`, `PRODUCT/draft-87-evidence/`, and `PRODUCT/draft-99-hyperdrive/` as distinct immutable source snapshots.
9. `SOURCE_HISTORY/public-github-all-refs.bundle` is a Git bundle of public GitHub branch/tag history. Check `SOURCE_HISTORY/REFS.tsv` and `SOURCE_HISTORY/VERIFY.txt`; restore with `git clone public-github-all-refs.bundle local-repo` if needed. Branches are under the packed remotes/origin refs. The original public GitHub repository remains the live canonical platform.

## Authority and safety
- **Canonical public product:** https://github.com/evansmusitu/mft-axiom-build — main SHA `b10a74b435feb25654d4cf67ba67d09602698a3e` at checkpoint. Do not assume it remains current; re-read at start.
- **Original private GitLab history:** project ID 86647955 (private), main `e43980a377a36bd8cc33d2a088a92021b82729c4`; the historic backup was mirror-verified to a private GitHub archive and the temporary token/mirror disconnected. Private repo URL must be obtained via user's private instructions/connected GitHub, NOT placed in public files.
- **Production release decision:** NO-GO. Code/test success alone does not establish production database metering, invoice reconciliation, authorized real evidence source access, independent penetration test, key/identity operations or privacy/DR acceptance.
- **Critical restriction:** user has Workers-only Cloudflare. Neon PostgreSQL 17 staging is currently network-blocked, has no approved runtime role or installed schema, no Hyperdrive origin binding, and no live SQL connectivity. Do not silently enable public network access, create credential spills or execute paid AI calls.
- **Standing owner delegation:** proceed with routine reviews, tests, non-destructive implementation, CI, draft PRs and evidence documentation; no silent external authorization bypass or dangerous production/destructive changes. Preserve source branches and ancestry; do not squash or force-push main.
- **Profit guarantees:** none. AXIOM must not be presented as guaranteed-profit trading software.

## About this ZIP
This is a pinned, offline **public-source Git bundle plus working-tree snapshots, manifests and handoff**. It does not include confidential GitLab metadata, private GitHub archive internals, Neon passwords, vendor credentials, historical CI artifacts, or the user's complete chat transcript. Those remain reachable in authenticated connected systems; independent re-verification is required in the new chat.

Never use this ZIP as an authorization to merge, deploy or turn a blocked gate into PASS.

# Private GitLab history archive — fail-closed operator procedure

**Status:** NOT EXECUTED. Source GitLab project `86647955` is **private**, while the existing GitHub product repository is **public**. Do not import unreviewed GitLab history into the public destination.

## Read-only reconciliation, 2026-11-06

| Ref category | Count |
|---|---:|
| GitLab branches | 180 |
| GitHub public branches | 323 |
| Shared names | 135 |
| Matching tips among shared names | 128 |
| Divergent tips | 7 |
| GitLab-private-only branches | 45 |
| GitHub-only branches | 188 |
| Matching tag name and SHA | 1 |
| Historical GitLab issues / merge requests visible to audit | 23 / 35 |

These figures are **tip inventory**, not a proof of full Git object ancestry or migrated issue/MR/CI history. Do not publish the 45 private-only names or private issue contents in a public issue/PR. Private diff/tip inventory is maintained inside the isolated operator reviewer; it is not an external production or archival mirror.

## Preconditions (fail closed)

1. An owner with **GitHub administration** must approve a new, dedicated, **empty private** archive repository and grant access to the minimum named custodians. An existing unrelated private staging or qualification repository is NOT automatically an approved archival target. Verify organization policy, retention, encryption, backup and audit logging.
2. Confirm the source GitLab project remains private. Complete security/license/privacy scan of Git history, metadata, usernames, embedded credentials and internal addresses in the source; agree written scope for transfer. Rotate/revoke leaked secrets before import and keep the destination private even after remediation.
3. Use operator-managed short-lived credentials with repository-read rights on source and repository-write rights ONLY on the empty private destination. Do not print tokens, embed them into Git remote URLs, or run from untrusted public PR workflows. Avoid shared public build artifacts.
4. Freeze a source ref manifest and record each name/tip in a protected audit vault. During mirror import, source changes require repeat inventory. Do not rewrite existing public GitHub history or update any existing public branch, including `main`.

## Archive commit ancestry to the *empty PRIVATE repo* only

The example below is **not run or verified** in this review. It must be executed by the credentialed repository custodian after the preconditions. Use authenticated credential helpers rather than storing access tokens in clone URLs.

```bash
set -euo pipefail
SRC='https://gitlab.com/evansmusitu/mft-axiom-build.git'
DST='https://github.com/evansmusitu/APPROVED-PRIVATE-AXIOM-ARCHIVE.git'

# Independent owner check: verify destination is PRIVATE using an
# authenticated GitHub admin readback. Never rely on its name alone.
# STOP unless the target is approved, private and truly EMPTY.
test -z "$(git ls-remote --heads --tags "$DST")" || {
  echo 'ARCHIVE_BLOCKED: destination not empty' >&2; exit 1;
}

git clone --mirror "$SRC" axiom-source-private.git
git -C axiom-source-private.git fsck --full
git -C axiom-source-private.git remote add private-archive "$DST"

# Explicitly push only source heads/tags to the empty PRIVATE archive.
# No --force, --mirror push, --prune or public GitHub ref modification.
git -C axiom-source-private.git push private-archive \
  'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'

git -C axiom-source-private.git for-each-ref --format='%(refname) %(objectname)' \
  refs/heads refs/tags > source-private-refs.txt
git ls-remote --heads --tags "$DST" > archive-private-refs.txt

# Compare normalized source and destination ref/tip pairs, validate all
# 180 branch tips + tags and separately prove reachable object ancestry.
# Store the resulting manifest/hash and log in a PRIVATE evidence vault.
```

GitHub may enforce default-branch or branch protection restrictions; resolve through approved private-repo configuration **without** pushing to the existing public product repository or bypassing its controls. A source change after the inventory invalidates acceptance until rescanned.

## Historic issues, merge requests and pipelines

Git transport does **not** migrate GitLab issues, MRs, comments, approvals, attachments, CI variables, pipeline results or audit logs. Export those separately using credentialed GitLab native export/APIs into an encrypted **private** evidence vault. Review each record for PII, secrets, legal retention, project tokens, vendor pricing and internal endpoints. Keep original source IDs, timestamps, authors, references and content digests. Do **not** recreate a GitLab passing pipeline as a GitHub green check; it is archival evidence only. Sanitize any public summary.

## Acceptance

- Confirm source and destination are still private, with restricted audited access.
- Independently compare every source ref name/tip to private destination and walk commit ancestry for all source refs; verify signed tags and Git object identity without inventing omissions.
- Reconcile 23 issues, 35 MRs, notes/approvals and CI provenance, including attachments and exception log. Capture source change freeze and final dates.
- Keep the public GitHub repository and its 188 current GitHub-only refs unchanged; namespace collisions only **if** a separate, explicitly reviewed import into the public product repo is ever approved. Public `main` must never be force-pushed.
- Obtain data-owner/security auditor sign-off, record private destination ID and manifest digest in issue #75 **without public private-path or secret disclosure**.

**Current blocker:** the reviewer has no production/public submission power, and a separate authenticated browser attempt to create a private repository was blocked by unavailable Browser Use credits. The GitHub connector exposes no private repository creation action. No repository was created, no mirror was pushed and no private source content was disclosed to the public product repository by this procedure.

# GitLab → GitHub migration provenance

Migration date: 2026-10-10

This GitHub snapshot imports the canonical GitLab repository tree from:

- GitLab project: `evansmusitu/mft-axiom-build` (project ID `86647955`)
- GitLab source ref: `main`
- GitLab source commit: `1d1bbbdcada5faaa2d706f7572c17263464402b4`
- Previous GitHub main: `d6a846f6bbe0bccac1758713eb4de167caf07113`

The connected forge APIs do not expose a cross-forge credentialed `git clone --mirror`, so the migration is an audited snapshot commit. The pre-existing 208 GitHub files were byte-identical to GitLab and are retained unchanged; the newer GitLab-only files are added with their Git modes preserved. GitLab is left untouched.

GitHub Actions verification is defined in `.github/workflows/axiom-reasoning-verification.yml`.

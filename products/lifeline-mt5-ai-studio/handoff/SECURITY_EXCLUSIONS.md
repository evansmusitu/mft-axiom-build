# Clean Package: Security and Exclusions

Included: complete currently tracked first-party LIFELINE MT5 AI Studio source/infra/tests/docs/chronological validation, all `lifeline*.yml` workflow definitions, dependency manifests/lockfiles, and ciphertext-only Neon envelope. Proven sample EX5/log/proof is included only if the short-lived verified GitHub Actions artifact is still available at build time. This archive is not a copy of running cloud secrets or a configured Windows installation.

Excluded by design:
- `node_modules/`: vendored install cache; redeploy with `npm ci` from `package-lock.json`.
- `__pycache__/`, `*.pyc`, `.pytest_cache/`, build/runtime caches.
- old `launch-packages/v0.4-stage-source.zip`: nested obsolete ZIP; original unchanged in GitHub and Drive. Current source is included in full.
- untracked or secret files such as `.env`, `*.pem`, `*.key`, `id_rsa`, `*.p12`, `*.pfx`, runtime databases, browser profiles and credential exports.
- Git internals, unrelated MUSITU projects, non-LIFELINE workflows, provider runtime data, passwords, private RSA key, API tokens, MFA codes, Access JWT, HMAC keys and Cloudflare/Modal/GitHub operational credentials.

All included files are SHA256-indexed; every omission under the selected product/workflow prefix appears in `handoff/SOURCE_MANIFEST.json` with a reason. No externally purchased hosting, trading account login or deployment is created by this packaging process. If an artifact or nonsecret evidence cannot be retrieved, report that explicitly; do not fabricate it.

**Security reminder:** public GitHub source may contain local synthetic test fixtures. Never replace fake placeholders with live credentials in code or ZIP. Use provider-encrypted secrets and owner-only UI.

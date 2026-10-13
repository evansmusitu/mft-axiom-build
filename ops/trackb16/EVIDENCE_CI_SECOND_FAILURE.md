# B16 second real CI attempt — FAILED (preserved, 2026-10-13)

GitHub public standard-runner Actions run **38387065885**, head `7a29c8fd1b4b65fdc7dedc88492f6cc2c2545083`.

- S0 read-only/secret-free contract: PASS.
- All 27-file checks and 54 local Node tests: PASS.
- `npm install --global npm@11.19.1`: **FAILED** with `EACCES mkdir /usr/local/share/man/man7` because GitHub-hosted runner is non-root.
- Actual `npm run test:workers`: SKIPPED, cannot claim runtime.

Repair: install npm 11.19.1 into `$RUNNER_TEMP/axiom-b16-npm` using an overridden `NPM_CONFIG_PREFIX`, then add only its temporary bin directory to PATH. No sudo/root, no provider secrets, no production changes. Preserve this original log in GitHub Actions.

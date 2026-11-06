# Independent workerd runtime software review

Bounded verdict: no unresolved P0-P2 finding in the reviewed transport changes, runtime harness, locked install or CI wiring. This is local emulated D1/workerd software evidence. Hosted D1, provider customer authentication, canonical ownership, human custody/security, independent anti-rollback and release remain unearned.

The review baseline is local HEAD3d9585477b7386be21b60b7d366a821e8a6610a7. All original repository files remained read-only for this reviewer. Copies, dependency installation, scripts and logs were written only under workerd-review/ (the initial runtime log was moved here after creation). Root owns all implementation changes. The runtime qualification is synthetic: fixture grants and local account links cannot become live authority.

## Changes and regression review

Five server modules change unsupported workerd Request options: provider token transport, identity assertion caller, login broker, read-only billing truth and customer worker private verifier/checkout. They use manual redirects and retain exact status acceptance (200, or201 for checkout). The provider uses a fresh Request with explicit headers; removing the unsupported credentials field does not forward browser Cookie or Authorization headers. Existing browser adapter options remain unchanged.

No issuer, client, redirect URI, named entrypoint, canonical account requirement, tenant check, SQL trigger, revocation rule, real payment or release gate changes. Workflow remains contents:read, checkout persist-credentials:false, isolated tests only, no deployment or hosted credentials. npm ci disables install scripts, then npm test boots the local runtime. Test ingress/header reconstruction is confined to never-deploy fixtures; product Origin checks remain active. Root supplied provenance for the previously used Miniflare pin from exact remote PR79 source; the partial local checkout omitted that workflow, so this reviewer did not independently retrieve that historical file.

## Independent baseline demonstration

baseline/ contains current runtime harness and collaborator copies, replacing exactly these five modules with git show HEAD:<path> bytes: zitadel_provider_tokens_candidate.mjs, identity_session.mjs, login_broker.mjs, live_billing_truth.mjs and worker.mjs. baseline-construction.json records both baseline and current hashes. No git restore or other mutation was applied to the original repository.

The unchanged current harness against this baseline copy ran13 tests:3 passed,10 failed, exit1. The output contains workerd's explicit Invalid redirect value diagnostic for redirect:error; callback attempts fail400 before any outbound provider request. These coupled failures prove the baseline defect without treating later blocked assertions as independently exercised behavior. The original baseline log is preserved in baseline-runtime.log. Running the same harness against the current original repository passed13/13 (current-runtime-initial.log).

## Fresh checks

| Check | Direct result | Raw evidence |
|---|---|---|
| Clean locked install | npm ci --ignore-scripts --offline --no-audit --no-fund succeeded;31 platform packages installed with scripts disabled | clean-install.log |
| Runtime after clean install |13 passed,0 failed/skipped; actual workerd1.20260730.1 via Miniflare4.20260730.0 | clean-current-runtime.log |
| Independent provider redirect challenge |307 at token, JWKS and UserInfo each gives400; no Location destination visited; no session; flow failed | adversarial-runtime.log |
| Header isolation | Browser Cookie absent on every provider request; provider Bearer appears only at pinned UserInfo; login/billing/checkout receive no browser Cookie or Authorization | adversarial-runtime.log |
| Private verifier302 | Consumer returns401 and does not visit redirect destination | adversarial-runtime.log |
| Full Node suite |197 passed,0 failed/skipped | full-node.log |
| Python reference/upgrade suite |54 passed | full-python.log |
| Syntax | All customer_control_plane modules, portal.js, runtime test and fixtures passed node --check | command exit0 |
| Lock review | Exact pinned Miniflare/Undici/workerd versions; all56 package entries use HTTPS registry.npmjs.org URLs and SHA512 integrity fields | package-lock.json and executed JSON assertions |
| Diff whitespace | git diff --check passed | command exit0 |

Independent added workerd tests live in current/customer_frontier/runtime_acceptance/adversarial_runtime.test.mjs and pass3/3. The first test challenges all3 provider stages. It adds instrumentation only in a copied harness; current product modules are copied unchanged. All egress remains synthetic/loopback, with no provider account or network writes. current/ is also an exact current product source snapshot for reproducing these checks; node_modules is an install artifact and must not be committed. baseline/node_modules is a local symlink and should likewise be omitted when persisting evidence. Reproduction can run npm ci --ignore-scripts --no-audit --no-fund in each copied runtime_acceptance directory before npm test; the adversarial check uses node --test adversarial_runtime.test.mjs in current's runtime directory.

## Limits

Execution environment was Node v24.22.1 and Python3.12.14 on Linux. Workflow targets current Node22; this local review did not execute that separate Node major. Native workerd execution and local D1 persistence/transactions are exercised; hosted D1 endpoints, remote replication behavior, hosted schema rollout, owner/customer callback, real provider revocation, recovery, custody and anti-rollback are not qualified by this run. Named service binding works only under the local explicit fixture configuration. Tests use their intended Origin reconstructed after Miniflare's loopback CSRF guard; they do not establish public browser cookie delivery or a production route.

No broader release verdict follows. B27 remains FAILED_IN_SYNTHETIC_ATTACK; parity/superiority remain NOT_CERTIFIED; unavailable final usage remains UNKNOWN. Frozen reviewed bytes are listed in final-source-sha256.json.

Final test-only integration followup: the coordinator adopted the exact independent adversarial test bytes as runtime_acceptance/review_adversarial.test.mjs. An independent byte comparison passed. package.json differs only by adding review_adversarial.test.mjs to its test command; all previously frozen product modules, existing runtime harness, workflow, lock and tests retained their reviewed hashes. The expected selected runtime suite is now16 tests (13 original plus3 independent checks). The earlier raw13/3 logs remain separate evidence; the coordinator owns the fresh integrated16-test execution. final-source-sha256.json was refreshed for the new test and manifest. No full-suite rerun was needed for this manifest-only test selection.

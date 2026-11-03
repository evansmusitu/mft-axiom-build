# Phase 2.6 Test-First Implementation Plan
1. Commit failing tests for source-anchored `compatibilityMatrix()` and `verifyCompatibility(expected,observed)`: exact match, version/hash/protocol drift, missing/unknown fields, deterministic identity.
2. Implement minimal strict matrix module using actual Phase-1 compiler/runtime/registry/policy manifests and fixed protocol contract versions. Verify focused and existing suites.
3. Commit failing tests for deterministic offline `evaluateCorpus()`: stale/conflicting/future/superseded/missing policy, model authority injection, constraint compliance, repair budget and bounded resource accounting; require stable sort/hash with explicit expected results.
4. Implement core evaluation runner and fixed offline corpus, fail closed on test failure; no provider network, no stochastic generation or external prices.
5. Wire Phase-2.6 gate into package scripts and GitLab pipeline. Add design review and adversarial security regressions, run full exact-head feature CI, MR-native CI, merge without squash and retain source branch; verify new main CI.
6. Update roadmap #4 and issue #13 with actual verified evidence and remaining production gaps. No claims of guaranteed return or commercial outcome.

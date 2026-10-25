# MUSITU Studio V0.3 — immutable GitHub Actions dependency qualification

**25 October 2026. Source-only, isolated development branch.** All three externally supplied GitHub Actions used by the Studio offline qualification workflow are now pinned to full 40-hex upstream commit identities. Previous mutable `@v4` and `@v5` references could change which code the CI runner executes without any source change in this repository.

- `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` — upstream checkout v4.2.2; https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` — setup-node v4.4.0; https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020
- `actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065` — setup-python v5.6.0; https://github.com/actions/setup-python/commit/a26af69be951a213d495a4c3e4e4022e16d87065

Each exact full GitHub upstream commit URL was independently inspected, not inferred from a truncated release badge. Checkout also uses `persist-credentials: false` so the read-only workflow does not store its GitHub token in checkout's git configuration. A source contract now fails on any non-SHA `uses:` action or missing credential isolation. This change does not grant extra permissions or enable paid GPU, deploy, Cloudflare, R2, Neon migration or production traffic.

**Caveat:** Pinning a commit does not prove the workflow executed, does not eliminate upstream code vulnerabilities, and does not constitute hosted CI qualification. Exact commit GitHub Actions results remain independently unverified.

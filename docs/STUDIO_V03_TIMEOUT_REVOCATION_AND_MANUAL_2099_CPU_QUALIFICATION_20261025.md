# MUSITU Studio V0.3: bounded R2 cancellation, provider error isolation and owner-controlled God Mode CPU workflows

25 October 2026. Source-only development on `experiments/studio-enterprise-v03-sqlite-do-20261018`.

## Verified regression repairs

1. **R2 timeout-after-return race:** A provider can ignore `AbortSignal` and resolve `readObject()` only after `Promise.race` has already timed out. The earlier verifier would still begin consuming the returned stream in a detached coroutine. It likewise could consume a delayed `next()` and request subsequent chunks. New regression tests first failed, then passed when signal checks were added immediately after `readObject`, at every delivered chunk, and before final hash validation. A cooperative provider must still cancel and close the underlying R2 transport: JavaScript cannot force a noncooperating network request to stop. No customer R2 data was accessed.
2. **Provider callback exception secrecy:** `guardedStudioNeonPromotion` previously surfaced secret-bearing exception messages from the independent R2 receipt and signed-version verifiers. New tests failed before the fix, including a post-CAS callback error. All checked provider-bool calls now translate exceptions to fixed local error codes; the post-CAS failure still enters the fenced SQLite rollback path. Other external callback contracts are outside this scoped repair and remain a future audit item.
3. **Unexpected compute launch and mutable actions:** Two God Mode 2099 Blender workflows previously responded to `push` and depended on floating `actions/*@v4` references. Both now require intentional `workflow_dispatch`, retain read-only contents permissions and nonpersistent checkout credentials, and pin checkout at `11bd71901bbe5b1630ceea73d27597364c9af683` and upload-artifact at `ea165f8d65b6e75b540449e92b4886f43607fa02` (upstream v4.6.2). Their existing 20-minute and 75-minute job limits and one-day artifact retention are unchanged. **Manual GitHub Actions jobs can still consume metered runner minutes**; the absence of a `push` trigger is not an account-level spending hard stop. No workflow was dispatched during this session. GitHub requires a `workflow_dispatch` workflow to be registered on the repository default branch before the Dispatch UI/API can trigger it; this isolated branch may therefore remain deliberately **not directly dispatchable** until an independently authorized workflow integration is designed. Do not merge or modify the protected default branch just to trigger rendering.

## Local test qualification

- Neon Node 22 security/migration suites: 212 passing.
- Pure GLB/editor tests: 23 passing.
- Pure Edge tests: 41 passing.
- Python Studio operations and CI contracts: 42 passing.
- God Mode Python mock tests: 24 passing in four independently completed six-test groups.
- Combined offline count: 342 passing, zero failures. Full hosted GitHub Actions execution and real Blender footage are **not verified**.

## Non-authorizations

Production SQLite DO remains authoritative. This does NOT establish actual Cloudflare provenance, real R2 version signatures, a hosted Neon restore, private Cloudflare-Neon connectivity, durable provider CAS fencing, signed Android owner consent, Modal spend hard stops or a real Blender rendering. Continue all production and paid-usage gates as NO-GO until independently verified with owner authority. The isolated Neon project's public connections must remain blocked. There were no live customer mutations, provider database swaps, paid GPU executions, or production deployments.

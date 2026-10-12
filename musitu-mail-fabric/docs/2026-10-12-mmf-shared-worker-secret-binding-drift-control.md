# MMF shared Paynow — independent legacy secret binding preservation guard

**Date:** 12 October 2026. **Scope:** strictly GET-only inspection of the *existing* shared Cloudflare payment Workers on the isolated MMF development branch. This neither deploys a Worker nor activates merchant permissions.

## What this closes

The earlier source-drift audit checked that normalized executable JS did not change. It did **not** guarantee preservation of Cloudflare Worker binding names or types, which matter for existing FMI, Chemistry and Axiom payment continuity. Existing `secret_text` values are non-exportable, and a source/settings backup cannot restore them automatically.

The separate new baseline is derived from the owner-recoverable authenticated sealed snapshot captured by GitHub Actions run `38157318020`. The two pinned worker-specific SHA-256 values cover JSON arrays of `{name,type}` metadata sorted by binding name. Values and full binding names are not included in the output or source-code baseline. The observed original inventories had 13 bindings in the authority Worker and 7 in the transport Worker; the transport's bindings included `durable_object_namespace`, `ratelimit` and `secret_text` types, while authority bindings were `secret_text`.

The isolated workflow `mmf-shared-paynow-binding-drift-getonly-20261012.yml` issues exactly two Cloudflare `GET /settings` requests, with `no-store` caching and a scoped secret supplied by GitHub Actions. It validates API responses, rejects duplicate/invalid bindings and secret-value fields, compares both count and digest to the sealed baseline, and uploads only sanitized metadata digests. Missing/changed names or types, addition/removal, HTTP error or account mismatch fail closed. It never exports or reads raw secret values, never calls Paynow, and never makes a Cloudflare write. This is a complementary gate to the existing six-GET source hash check, not a substitute for it.

**Neither successful audit grants deployment.** Existing secret values remain unavailable for automatic rollback. Production release additionally requires fresh same-window source+binding checks, controlled restoration procedure, separately held current existing secret recovery arrangements, explicit MMF-specific secret provisioning, independent second-person signed review of exact patch and rollback hashes, merchant product permission, and separate authorization before initiating payments. The prepared product routes still return synthetic stage-only probes.

### Qualification

From `musitu-mail-fabric/`, run `node --test test/mmf-shared-binding-drift-readonly.test.mjs` and `node --check src/staging/mmf-shared-binding-drift-readonly.mjs`. The main `npm test` command automatically runs the focused test because it includes `test/*.test.mjs`. Production activation must remain blocked.
# Shared Paynow Workers: reproducible GET-only source inventory

### Proven observation and scope

The existing read-only Cloudflare inventory returned nonidentical raw Workers script representations on two adjacent GETs. This does **not** prove a production deployment changed. Cloudflare can return a multipart form whose random boundary and metadata vary while its JavaScript modules remain identical. Prior raw-byte SHA-256 comparisons may therefore produce false drift alarms.

This change introduces `canonicalCloudflareWorkerSource`: for recognized `multipart/form-data` responses it parses unique named JavaScript module parts, ignores only the bounded `metadata` part, sorts modules by name, and SHA-256 hashes stable `[moduleName,sourceBody]` pairs. Routes are extracted from JavaScript source bodies **only**, never from metadata. Unknown/malformed or oversized formats fail closed. Plain JavaScript response bodies retain their original SHA-256 representation. No source code, provider key or merchant binding secret value is exported.

A stable canonical hash is **not** proof of the historical raw baseline (which was computed using a different representation). The auditor explicitly reports `historicalRawHashBaselineComparable=false` and `sourceCodeSemanticallyStableButBaselineUncomparable=true` for multipart. For such responses it suppresses production drift claims and never labels the older merchant stack verified on that basis. New independent rebaselining must review authentic module payloads and deployment history before using a canonical code fingerprint as an authoritative baseline.

### Security limits

The audit issues three GET calls for each of exactly three preselected live MUSITU Workers (two source reads and one binding-name inventory). It must never call the provider, initiate checkout, mutate Cloudflare services, inspect customer orders or disclose source/keys. Route references discovered as code text remain **inventory hints**, not independently verified reachable operations or authorization. Dedicated MMF authority and transport scopes remain absent until independently provisioned in the pre-existing shared merchant services under a **separate explicit production-change authorization**. This change does not authorize or enable real payments or customer messages.

Local checks: `node --test test/mmf-cloudflare-source-canonicalization.test.mjs test/mmf-cloudflare-paynow-readonly-inspection.test.mjs`, `npm test`, `npm run check`; the isolated GitHub read-only audit workflow reruns the live nine GETs and retains sanitized evidence only. Commercial release stays blocked.

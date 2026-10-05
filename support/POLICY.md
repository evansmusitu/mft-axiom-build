# MUSITU Axiom support policy

Status: implementation policy for the isolated official-support branch. Publication and response-capacity claims require live verification.

## Scope

The support control plane covers the MUSITU Axiom web application, OAuth and account access, OpenAI/Claude/other MCP integrations, quantitative-result disputes, evidence and reproducibility, API/runtime behavior, billing and commerce, privacy and data rights, security disclosures, reviewer access, accessibility, and incidents.

## Safe intake

- Do not submit passwords, access or refresh tokens, OAuth authorization codes, API keys, client secrets, session cookies, private keys, payment-card numbers, or raw authentication headers.
- High-confidence secret patterns are rejected before case persistence. Rejection records only finding types and field paths, never matched values.
- Anonymous users receive a high-entropy recovery code once. Only its SHA-256 hash is stored.
- Case narrative is encrypted with AES-256-GCM and case-bound additional authenticated data before persistence.
- Raw email or phone fields are not accepted by this intake contract. Authenticated product users may be represented by an opaque identity reference.

## Authority and human control

Support triage may recommend actions but cannot execute sensitive changes. Account recovery, identity and entitlement changes, refunds, data exports or deletions, security disclosure, public incident updates, case purge, and production changes require operation-specific authorization. Customer verification, evidence, and an independent human approver are mandatory where applicable.

## Evidence and transparency

Case history is append-only and hash chained. Customer-visible events and internal analysis are separate. Quantitative disputes should bind sanitized inputs, the actual Axiom operation, version/provenance references, returned result, and independent reproduction evidence. Credentials and unrestricted customer datasets never belong in an evidence package.

## Priority

Priority is derived from impact and safety, not plan or payment tier. P0/P1/P2/P3 acknowledgement figures are internal operating objectives, not contractual guarantees, until staffing and live performance prove them.

## Retention

The schema distinguishes standard, privacy-restricted, and security-restricted cases. Final retention durations, legal holds, regional residency, and verified erasure across processors require a designated privacy owner and a deployed lifecycle service. The software must not claim those controls before they are verified.

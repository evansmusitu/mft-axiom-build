# Gate 4 canonical MCP admission — isolated source work, NOT_RELEASE

Objective: canonical website identity, tenant or membership revocation must deny
subsequent MCP execution even while an OAuth token remains active in the separate
OAuth database. The public gateway currently validates only the OAuth ledger.

Branch: `build/axiom-gate4-canonical-mcp-20261123`, parent PR245
`8dac0f2207e46348dcca5f0f0bc8187cfd527744`. Actor: assistant. Authorized scope:
Gate4 source engineering and isolated synthetic/local runtime checks. No hosted
activation, production migration, identity grant, key access, payment or release.

Add an opt-in service-boundary wrapper for a separately supplied reviewed MCP
gateway. It must recheck token/key/customer/link coherence and the canonical
CUSTOMER_DB membership immediately before forwarding protected calls to MCP_CORE.
Missing qualification, either database, a valid mapping, or authoritative reads
must deny. Never trust browser identity headers, accept unlinked legacy users
as canonical, cache positive authorization, or alter the delegated gateway's
numeric checker, tool contracts, OAuth, metering or billing. Public discovery
remains public.

Tests use actual candidate OAuth minting with two separate SQLite/D1 databases
and synthetic IdP/ownership principals, then exercise the exact recorded published
gateway bundle as a byte-preserved test dependency. The source fixture is not an
integration or a current-deployment attestation. PR243's newer checker and all
production source remain separate and unchanged.

Acceptance: authorized dispatch still works; canonical revocation, missing or
inconsistent mapping, unknown qualification, outage, forged browser identity,
malformed/private RPC forwarding and revocation during the gateway's earlier
OAuth read cannot reach the executor. Preserve every row and negative result.
Add local workerd/D1 checks for the actual module/service-binding boundary.

Cross-database reads are NOT a distributed atomic transaction. Revocation after
the final canonical read can race an already admitted call; no cancellation or
global serialization claim is earned here. Hosted admission, independent review,
genuine IdP/ownership/account continuity and direct hosted MCP acceptance remain
required. The wrapper must not be enabled for unmigrated legacy customers.

Rollback: discard this isolated source candidate; the production gateway and
databases are unchanged. Gate2 retains its recorded recovery scope; Gate3 remains
OPEN/HOLD with owner signing deferred. B27 remains FAILED_IN_SYNTHETIC_ATTACK;
parity/superiority NOT_CERTIFIED; missing final usage UNKNOWN; NOT_RELEASE.

## Integration decision and evidence

`withCanonicalMCPAdmission(reviewedGateway)` wraps the private `MCP_CORE.fetch`
dispatch. It supplies no public default Worker and cannot select or replace a
gateway by itself. The separately reviewed caller must deliberately install it
with correctly scoped bindings. `MCP_CANONICAL_QUALIFIED` and
`OAUTH_KEYLESS_QUALIFIED` are admission predicates, not qualification evidence;
do not set them from source tests or this document.

Protected dispatch reads one joined OAuth token/key/customer/identity view,
checks the canonical identity/membership/tenant using the shared existing
contract, and repeats the joined OAuth read to detect changes during the
canonical read. Public catalog discovery remains public; unknown private RPC
forwarding is protected and malformed batch forwarding is rejected. Browser
identity headers cannot supply any of the required linkage. No authorization
record is written or repaired automatically.

The exact published test dependency is source commit
`6ab9961906329722d19fbb1f614ca14f89e8e224`, Git blob
`7ccb2ed4ef8cac5a297396ea0c2acda168e9a8aa`, 101122 bytes, SHA-256
`cf3e999deab721532ef584715fbdccc3699849ba40365bedccd961982779ece9`.
It preserves that gateway's original 4.0.3 schemas, protocol and independent
checker. This fixture is never imported by a product entry point. A future
integration must freshly qualify the exact selected live gateway source; the
fixture does not override newer production or draft source. The supplied gateway
must dispatch protected work through `MCP_CORE.fetch`; raw kernel/direct API
paths remain separate authorization boundaries.

Baseline: the unchanged published bundle passed 3 positive/control checks and
failed 13 of the 16 requested canonical-admission checks. These include new
staging-admission policy expectations, not 13 claims of current production
exploitation. With the wrapper, the final 19/19 focused checks pass, including
OAuth revocation during the canonical read, missing keyless admission and modern
MCP OAuth challenge preservation. The 8 new actual local
workerd/D1 checks also pass, including persisted revocation after runtime restart.
Raw baseline failures and passing logs are retained unchanged under the evidence
directory. Broader local checks: 520/520 Node, 344/344 Python and 24/24 actual
local workerd/D1 PASS, no Node/workerd skips. Local runtime outbound networking
is blocked and the executor is a clearly marked synthetic private fixture.

Independent source/security review and exact remote CI readback remain required.
This does not qualify a real IdP, production ownership, browser logout/global
OAuth revocation, hosted MCP admission, execution receipts or Gate4 completion.

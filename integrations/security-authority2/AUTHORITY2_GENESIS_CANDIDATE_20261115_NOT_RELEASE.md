# Authority 2 pre-genesis candidate — separate review required

This is an additive engineering candidate on draft PR192. The serving Worker,
R2 continuity module, Wrangler deployment configuration and compiled review
bundle remain unchanged. The serving Worker does not import this module and
still exposes no initialization or reset endpoint. No hosted authority has
been initialized by these tests.

## Resolved engineering gap and remaining operator boundary

The prior candidate deliberately refused an empty Durable Object but supplied
no provisioning algorithm. `authority2-genesis-candidate.mjs` now supplies a
reviewable one-shot function for an independently controlled, temporary
initializer. It has no HTTP handler, CLI, deployment script, secret generator,
GitHub publication, reset or automatic recovery path. An actual initializer
controller and its removal procedure still require separate review and
provider acceptance. Do not deploy the qualification harness.

The existing owner review archive was checked in the assistant Linux
environment, without claiming execution on the owner's unavailable Windows PC.
Earlier native Windows CI remains attributed to its actual runner. Owner R2
dashboard readback confirms the reported enabled `b27/` indefinite retention
rule and disabled public development URL; it is not independent live API
or administrator-separation evidence.

## Inputs and binding

The operator must independently approve the commitment's canonical JSON
SHA-256, all five public Authority 2 identity fields, the reviewed runtime
bundle hash and a new genesis nonce. These inputs are not generated or
approved by this module. Do not reuse the backup X25519 key as an Ed25519
authority signer.

The commitment schema is
`musitu.axiom.authority2.pre-genesis-commitment.v1`, with exact fields:

| Field | Required value |
| --- | --- |
| `schema` | Schema above |
| `kind` | `AUTHORITY2_PREGENESIS` |
| `ledger_sequence` | `0`, only in the separate genesis commitment namespace |
| `account_id` | `67469478aa9349fa0a57fe3a72da200a` |
| `ledger_id`, `namespace`, `key_id`, `public_key_jwk` | Exact operator and consumer approved public pins |
| `reviewed_bundle_sha256` | `d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210` |
| `genesis_nonce` | Operator-approved 64-character lowercase hexadecimal nonce |
| `initial_sequence` | `-1` |
| `initial_head` | 64 zero characters |

The immutable GitHub commitment uses a separately approved, distinct checkpoint
namespace. It must not consume the ledger's own sequence-zero checkpoint tag.
The existing verifier reads original private repository identity, immutable
release/asset digest and pinned commit/tag before any DO write, then repeats
that readback after the conditional R2 write. Only read credentials are used.

## One-shot state transition

1. Validate exact fields, public pins, external commitment hash and immutable
   GitHub proof. Snapshot caller-provided public objects before awaiting I/O.
2. In a SQLite transaction, reject any existing stored key or scheduled alarm.
   Write `highwater/pending`, then await durable synchronization. The serving
   Worker already refuses admissions when this key exists.
3. Reject any object in the exact R2 account/ledger/namespace prefix. Attempt
   exactly one conditional `If-None-Match: *` PUT to `genesis.json` in that
   prefix. Require exact byte readback and no other namespace history. R2
   ambiguity is bounded and leaves pending; late completion cannot promote DO
   state. No R2 operation occurs inside a retryable DO transaction.
4. Independently re-read the immutable proof and original GitHub repository
   identity. In a final SQLite transaction, require the unchanged sole pending
   key and no alarm. Store genesis evidence and tip at sequence `-1`, remove
   pending, then synchronize. Uncertain final synchronization is not a reason
   to retry or reset: operator acceptance must inspect actual retained state.
5. The function returns `dispatch_allowed:false` and `NOT_RELEASE`. The real
   ledger still needs its own sequence-zero immutable bootstrap and ordinary
   signed Authority 2 append/readback. This candidate never issues a permit.

Existing DO state, orphan R2 history, a consumed barrier, lost acknowledgement,
changed proof or incomplete operation cannot be repaired by calling this
function again. Recovery remains a separately reviewed protocol. The retained
barrier prevents a fresh initialization after a DO-only erase, while it
survives. It does not establish protection against erasing all authorities.

## Verification and release limits

`node --test integrations/security-authority2/*.test.mjs` includes adversarial
commitment/proof checks, concurrent initializers, ambiguous and late writes,
pending preservation, DO-only restoration and the explicit all-state reset
counterexample. These are synthetic boundary tests.

`node --test qualification/whole-system-20261029/authority2-genesis-workerd.test.mjs`
uses actual local workerd, SQLite Durable Object transactions and R2 conditional
writes, including process restart and the first signed sequence-zero append.
Only the GitHub provider boundary and custody are synthetic. Temporary routes
and DO deletion exist solely in the test's generated in-memory harness.

The candidate cannot self-certify operator MFA, administrator separation,
signer custody, deployed bytes, live retention enforcement, independent source
approval or genuine disposable hosted destructive acceptance. The global
rollback counterexample and mandatory B27/PR83 security vetoes remain intact.
The original operator ceremony remains the deployment/review boundary. No
public activation, production data change, payment, merge or release follows
from a passing test result.

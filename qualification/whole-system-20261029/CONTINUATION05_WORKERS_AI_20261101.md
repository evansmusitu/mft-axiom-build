# Workers AI alternative — bounded acceptance

The owner authorized using the existing Cloudflare account after its paid
Workers plan was observed. No subscription, billing setting, secret, production
deployment or existing database was changed. OpenAI inference remains disabled.

Runtime source: `5273169f6f5ba8f9e595b6a2024022198ea660ea`.
Exact tree: `9b8182318fdc4b258c4d8f9abc1f6e0eda7e02fa`.

## Actual provider acceptance

[Workflow 41322607931](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41322607931)
made exactly three native Workers AI requests to
`@cf/google/gemma-4-26b-a4b-it`: planning, synthesis and a streaming cancellation
control. An immutable Actions artifact acknowledged the dispatch claim before
any inference; uncertain or repeated input was not resent.

The actual model summary was: “This is a short acknowledgement containing marker
52ad40f32213daa102f6d677.” The random marker was generated immediately before
submission. This checks that real output was received; it is not an intelligence
benchmark or an evaluation of the 18 skill packages.

| Requirement | Actual result |
|---|---|
| Output and completion receipt | Confirmed; one Artifact, contract Evidence and completion Evidence persisted |
| Interrupted observer | Deliberately disconnected after ACCEPTED; durable submission readback returned COMPLETED |
| Fresh-process recovery | A different Node process reopened SQLite and read the identical verified receipt |
| Replay | Repeated submission returned the same receipt with zero extra inference calls |
| Tenant scope | Unrelated tenant readback returned no task |
| Provider-call budget | Zero-call Work rejected reservation without dispatch |
| Active stream control | Actual content delta observed; client stream aborted and Work revoked |
| Revocation fencing | Subsequent model entry denied; control stored FAILED with no successful Artifact or Evidence |
| Provider-terminal cancellation | Unattested; no queryable Cloudflare session/turn cancellation readback was available |

Receipt SHA256:
`37cdf138bab206bc62f4676164fe9a881fec8c4d67cd9db3515c176d22b1c21a`.
Artifact SHA256:
`46db2034a8c69806ce37cadf47f2edfc1a277bd0161fd101d6339498804995d9`.
Root downloaded the raw acceptance ZIP, verified its SHA256 and independently
recomputed the recovered task and Artifact commitments.

Acceptance artifact `13089544814`, ZIP SHA256:
`52f4e67808a1f2b85c2e2cd74fd66dd3b72a7025d43ba6ea7c3bba973533cc50`.

## Free-allowance and scope limits

Admission required account-wide current-day analytics of at most 500 neurons,
leaving substantial headroom below the 10,000-neuron daily free allowance.
The transport enforced one model, three calls, at most 8,000 request bytes and
1,800 output tokens per call, with no retry, paid-model fallback or gateway.
The two completed responses directly reported **52.20908737182617 neurons**.
The aborted stream has no final usage record. Immediate account analytics showed
zero and no rows, so they did not yet reconcile with those nonzero response
metrics. A separate delayed read-only reconciliation is recorded subsequently.
This is not an atomic spend lock or a zero-invoice attestation on a paid account.

Governance was real local SQLite running the canonical contract and lifecycle
migrations. The protected runtime catalogue was a clearly labeled qualification
fixture; no protected compute operation was dispatched. This acceptance does
not qualify hosted D1, live protected compute, multi-host recovery, OpenAI hosted
session semantics, provider-terminal cancellation or independent security custody.
No cloud resources were created; the temporary local database was removed.

## Adapter repair and verification

The existing adapter treated Gemma's chat-completion envelope as an arbitrary
structured plan and could accept empty or incomplete model output. It now reads
the actual choice content, requires complete text and validates stage fields.
It also requires admitted governance, refuses hosted processing for Private Work,
rejects oversized input instead of truncating JSON, and rechecks authority after
the response. Five regression tests failed before these fixes and now pass.

All **20 verification groups pass** at the exact runtime tree in
[CI 41322607849](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41322607849).
The CI merge `966f585f0df59c7e411075e1680306d774c80fb1` has that same tree,
verified through GitHub Git-data readback. Includes 495 application tests,
73 public SDK tests, 11 local D1 tests, nine isolated workerd tests and eight
Workers AI admission/protocol tests. These counts overlap.

CI artifact `13090505207`, ZIP SHA256:
`26219e9ff1fc2f59050bb6b401890f4e5165427a8ba99a18a5a1b217693a8634`.
Root verified the downloaded hash and all 20 zero exit statuses.

The live workflow is pinned to its already-executed source and first run attempt.
Future pushes and reruns cannot automatically make further model calls.

## Release decision

PR #55 remains draft and unmerged. Main remains
`06cc5f74fb066c11f8d81390f424e58a2f9c261a`.
OpenAI successful hosted-turn recovery and active cancellation, isolated hosted
D1, unseen skill behavior, independent custody and the external monotonic ledger
remain open. The historical rollback counterexample is preserved. Production
deployment, full public reviewer acceptance and publication remain conditional
on those gates; this alternative-provider check does not waive them.

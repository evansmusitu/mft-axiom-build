# Independent-ledger candidate: continuation 07

The repair candidate now includes a deployable SQLite Durable Object authority,
a server-owned HTTPS client, atomic D1 consumption records and signed completion
evidence. No hosted resource or key was provisioned and no inference was sent.
The operator package is `integrations/independent-ledger/README.md`.

Specification verdict: **partial** for the user's release objective. The builder
restore fence works in the actual local storage components, but there is no
authenticated independent acceptance or independently anchored authority recovery.
Engineering verdict: the tested component behavior passes its bounded contract;
the authority-admin restore counterexample remains a release blocker.

## Requirement and evidence

| Requirement/risk | Direct local observation | Verdict and limit |
| --- | --- | --- |
| Atomic external consumption | Eight concurrent clients receive one permit; slot and call counters are durable | Component pass; no hosted custody proof |
| Restore builder storage | Delete all current builder D1 state and restore a pre-Run snapshot; restart authority separately and rebuild clients | Replay denied; two initial model callbacks, zero additional callbacks |
| Lost acknowledgement | Drop the response after the authority commits | No model callback; local and authority budgets retained; Work holds without retry |
| Network partition | Stall headers/body even when the transport ignores abort | Bounded deadline, one send, no permit/retry |
| Recovery | Restart both stores and run a new Node process over actual local HTTP | Signed receipt readback succeeds; spent permits stay denied |
| Tenant/role isolation | Consumer cannot grant/revoke/read; another tenant cannot consume the grant | Component pass with synthetic role credentials |
| Revocation/epoch | Revoke grant or advance global epoch; recheck local revocation after a response | New consumption/dispatch denied; already issued permits have a 15-second lifetime |
| Immutable authority | Reuse Work under a replacement grant or rebind its contract | Denied; operator cannot accidentally reset the Work through a new grant ID |
| Evidence integrity | Alter signature/receipt; mutate proof after verification but before atomic completion | Readback rejected; no success Artifact/Evidence committed |
| Analytical/decision tasks | Consume all pipeline stages and preserve signed evidence in deterministic results | Actual D1 component pass; no paid/provider work |
| Lifecycle | Active/unresolved authority blocks erasure; verify revocation, export, erase payloads | Consumption fence retained and checked; external erasure remains unverified |
| Missing authority state | Remove the authority store without a new bootstrap request | HOLD; no automatic initialization |
| **Authority-admin restore** | **Restore its own older pre-consumption store, then use a fresh client** | **Counterexample reproduced: same action receives another permit. Security gate FAIL without external high-water anchor.** |

The final focused suite contains **22 passing regression tests**: 21 positive
guard/failure checks and one deliberately reproduced authority-admin restore
counterexample. A green counterexample test is not anti-rollback acceptance.
All 21 integrated groups passed locally before the final deadline improvement;
the final focused tests then passed on that improvement and the added explicit
counterexample. Final committed source `f2a0de932118c9c87720bf846aea885177e32ca5`
passed all **21 groups** in
[CI 41339624792](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41339624792).
Source tree `0590dc387a6991d8adfc1fce1657e5f6451f6f7b` equals the tested PR merge
tree (`6c9c2c23121deaf73ec6792c9def15525a1df657`). Root downloaded artifact
`13096837258`, verified ZIP SHA-256
`9559d4654612fe629f001a29dec493d0b0f6431e638fe412739640158530ba84`, checked
all 21 zero exits and the raw 495 application/22 ledger regression results.
The explicit root-restore counterexample still reproduces in CI.

The earlier B27 destructive failure and all previous evidence remain intact.
The new component protects builder-controlled state only while the independent
authority's own monotonic history is preserved. A signature and separate local
directory do not establish separate signing keys, account ownership, recovery
administration, verifier veto or revocation authority.

## Concrete operator material

- Worker, HTTPS client and versioned canonical/signature protocol are source
  controlled. The app receives consumer/read credentials and public pins only.
- Example Wrangler configuration uses one SQLite Durable Object namespace.
  There is no reset/delete/refund endpoint and no automatic deployment/bootstrap.
- The build emits a reviewable bundle and a source-hash manifest without keys.
  Two local builds matched: bundle SHA-256
  `4a09b367553353b6f99f5b773e278b7b27a9c3aee9b49caeeca77617379f6522`;
  manifest SHA-256
  `a64ece5e7f4b0fe047ebdf8dbcd67ca1880f1c97a25546e8be3488c787a4e9b6`.
  The build check used the explicitly synthetic `aaaa…` execution pin. It is not
  an approved production runtime digest or an independently signed acceptance.
- Apply the execution schema and reapply the lifecycle migration before the new
  server code. Activation requires an independently approved Work grant. Required
  but missing/inconsistent configuration holds execution. Historical unguarded
  contracts preserve their existing hashes; this remains migration-dependent code.

No broader gate changed: isolated hosted D1 still lacks capacity (attempt05
HTTP403/CF7406), the visible security account is the production account, protected
PR #62 lacks independent review, and the saved aborted Workers AI stream still has
no provider-terminal cancellation/final-usage record. That call's usage is
unknown, its one reservation stays retained, and no refund is inferred. The 18
skill goals retain local component scope, with unseen host-model behavior untested.

PR #55 remains draft/unmerged. Main, deployment, billing, publication, protected
secrets and automatic live-inference/D1 retry pins remain unchanged.

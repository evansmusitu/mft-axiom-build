# External gates — fresh provider findings, still blocked

This continuation made **zero inference calls** and changed no existing database,
subscription, billing setting, production deployment or independent credential.
It did not obtain independent acceptance or close the external gates.

## Saved aborted inference

Read-only workflow
[41329030634](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41329030634)
queried account-wide usage, introspected the provider's current inference schema
and read individual inference records for the saved request's time window.
At 16:58:32 UTC, more than an hour after the abort, Cloudflare still showed only
the two completed requests, totaling **52.20908737182617 neurons**. Both individual
records had sampleInterval 1 and errorCode 0 and matched the completed responses.

There was no record for saved Ray `a53c044b0eda9b36-IAD`. The exposed individual
inference schema has no requestId/rayId or terminal-cancellation field. Neither
absence nor the difference between aggregate and completed usage proves zero
consumption or successful provider cancellation. Actual final usage remains
**unknown**; a fresh request would not recover this request's missing record.

Accounting remains fail-closed: the cancelled Work is REVOKED, its Run is FAILED,
and provider-call reservation
`reservation_db8f45a1306a4699a9f2f1ac9ab0bd39` retains one consumed call. It was
not refunded, converted to zero usage or reused. There is no successful Artifact.
The new regression tests require exact provider identity and an actual abort
record to confirm cancellation and distinguish missing usage from explicit zero.

The concrete [provider reconciliation draft](PROVIDER_RECONCILIATION_REQUEST_20261101.md)
contains the saved account, endpoint, UTC timestamp, Ray ID, bounded request
settings and evidence hashes. It requests the provider's terminal outcome and
final accounting. It has **not been submitted**; no message was sent to others.

## D1 capacity and hosted storage

A fifth isolated storage-only attempt ran in
[41330823895](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41330823895).
Fresh creation of `axiom-acceptance-20261101-05` again returned **HTTP403 / CF7406**.
The account still lists the same 11 databases. Creation failed before migration,
Worker deployment or any tenant fixture execution. No existing database was
deleted or repurposed, and no new database or Worker was created.

The migration, real budgets, isolation, revocation, restart and lifecycle suite
is prepared behind that creation gate; its hosted acceptance remains not reached.
An additional regression check prevents attempt05 from authorizing inference.
The creation workflow is pinned to its executed source and run attempt one.
Further automatic retries are disabled.

## Custody and separate administration

The existing credential sees exactly one provider account. Its current name is
**MUSITU AXIOM Security Authority**, but its ID is
`93f395f5121954671f92fffa453d6b61`, identical to the known production account.
This is direct evidence that this visible account is not a separate authority.
It does not establish that another account cannot exist outside this credential's
visibility. The earlier owner assertion of a separate account is not substituted
for provider evidence.

No independent verifier acceptance, private-key separation, independent recovery
administrator, or authenticated independent readback/revocation control was found.
GitHub returned zero review submissions for draft PR #62. Its staging-secret job
is expressly manual and main-only and requires independent review and merge;
this continuation did not bypass it or use that credential on an editable branch.

The [authority activation request](INDEPENDENT_AUTHORITY_ACTIVATION_20261101.md)
sets out the exact account, role, MFA/recovery, trust-pin, readback and revocation
evidence required from the actual independent operator/verifier.

## Anti-rollback

Pinned source `c57cf8505ceee91a6b9b93ae6368f54c6b9ae127` was fetched directly from
GitHub and extracted into a separate test directory. The original B27 verifier
checked its inherited source hashes and manifest and passed all 15 local socket
tests. Its permanent destructive test freshly reproduced replay after deletion
of the witness SQLite store and majority local voter journals.

**Outcome: GLOBAL_ROLLBACK_COUNTEREXAMPLE_REPRODUCED_NOT_FIXED.**
The green test verifies attack reproduction. It is not rollback protection,
independent custody or successful external destructive qualification.
An independently administered consume/high-water ledger and cross-host destructive
challenge still require the external authority described in the activation request.

## Source, verification and evidence

- Runtime/runner source: `6601f2a8eb86a1d82a0002246696e27f8895ed39`.
- Exact tree: `5682c74e2e7b0cc2ab2ada2c6380aafa48362da7`.
- All **20 integrated groups pass** in CI
  [41330823629](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41330823629).
  Includes 495 application tests, 73 SDK tests, 11 local D1 tests, nine local
  workerd tests, six hosted-protocol tests and ten Workers AI/readback checks.
- CI merge `56c171e9bd003b345969dde1506b52144e8555c0` has the same exact tree;
  root read it through GitHub's Git-data API.
- CI artifact `13093625859`: ZIP SHA256
  `ebc5fd3f38b76797897f0718fc4add9be38e321fcaf9f45c254cf48182299141`.
- Provider readback artifact `13092925262`: ZIP SHA256
  `259350925a35915e8cae630de4a06bfe6626e787986c74b894d17cc7a4404ca2`.
- D1 attempt05 artifact `13093245882`: ZIP SHA256
  `2179ce317f629c98dd9916bc4a37e79ec4e6350485618dbf3d63652204885e02`.

Downloaded archive hashes and all 20 CI exit statuses were independently checked.
The destructive local replay log and its SHA256 are retained with the current
machine-readable gate record. Historical failures and scoped successes remain.

PR #55 is draft and unmerged. Main remains
`06cc5f74fb066c11f8d81390f424e58a2f9c261a`.
Provider reconciliation, isolated D1 capacity, independent authority and the real
external monotonic-ledger challenge remain necessary before merge, deployment,
public reviewer acceptance and publication.

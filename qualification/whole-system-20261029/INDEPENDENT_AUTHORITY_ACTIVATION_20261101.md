# Independent authority activation — pending external acceptance

The currently visible account named MUSITU AXIOM Security Authority has ID
`93f395f5121954671f92fffa453d6b61`, identical to protected production. Its name
does not supply administrative or key separation. A genuinely separate account
may exist outside this credential's visibility; authenticate that account rather
than assuming this observation proves none exists or creating a duplicate.

No independent verifier acceptance, exclusive key custody, separate recovery
administration or independently administered monotonic ledger was obtained.
Builder-run tests and builder-generated keys cannot supply those properties.

## Required operator and verifier evidence

The independent operator must authenticate a distinct existing provider account
and establish the exact account identifier, members and administrative roles.
Provider-authenticated evidence must show that product builders, their CI
identities and production administrators cannot reset the authority's signer,
recovery administration, revocation state or monotonic store.

The verifier must explicitly accept the role under their own authenticated
identity and supply an independently controlled public-key fingerprint and
evidence of separate MFA/recovery administration. The builder must never create,
retrieve or retain the verifier's private key or recovery material. The verifier
must exercise independent readback, veto, revocation and kill authority.

The dedicated metadata workflow is already prepared in draft
[PR #62](https://github.com/evansmusitu/mft-axiom-build/pull/62). Its credentialed
job is manual and main-only. The workflow states that an editable branch must
not receive the staging credential and that independent review and merge must
precede execution. GitHub currently records no review submissions for PR #62.
This continuation did not bypass that restriction or access its protected secret.

## External monotonic ledger and destructive challenge

Provision the atomic consume/high-water ledger under that independent authority,
outside builder-controlled restore and reset paths. Bind its authority epoch,
revocation policy, immutable client trust pin and exact proposal/receipt digests.
Do not replace it with an additional local SQLite journal.

After the verifier has accepted and authenticated the endpoint, execute and
retain this challenge against the exact tested artifact:

1. Consume one admitted request; verify one winner under concurrent requests
   from separate client hosts and store its signed receipt outside the builder.
2. Lose the acknowledgement after consume; retry/reconcile without regaining
   execution authority or authorizing another provider dispatch.
3. Destroy the builder's primary store, witness cache, voter journals and all
   builder-controlled backups; restore older snapshots and replay the consumed
   request concurrently. Every replay must DENY/HOLD.
4. Partition the independent authority and present stale cached state; require
   DENY/HOLD with no local fallback.
5. Revoke the old client/key/epoch and verify stale signatures and restored old
   credentials remain denied. Exercise authorized independent recovery and verify
   that it preserves high-water/consume history.
6. Read the results through two authenticated independent evidence origins and
   obtain the verifier's signature over the exact artifact and challenge report
   digests. Retain raw denied and ambiguous outcomes as well as successes.

The pinned B27 source remains
`c57cf8505ceee91a6b9b93ae6368f54c6b9ae127`.
Its 15 local socket tests were freshly rerun in an isolated source extraction.
The permanent destructive test again demonstrated that deleting the witness
store plus majority voter journals enables replay. The green regression test
means **counterexample reproduced, not fixed**. No external destructive challenge
or independent signature was executed in this continuation.

Release remains blocked until authentic external acceptance is obtained. This
document is a concrete activation/challenge request, not a custody attestation.

# Independent authority activation — pending external acceptance

The currently visible account named MUSITU AXIOM Security Authority has ID
`93f395f5121954671f92fffa453d6b61`, identical to protected production. Its name
does not supply administrative or key separation. A genuinely separate account
may exist outside this credential's visibility; authenticate that account rather
than assuming this observation proves none exists or creating a duplicate.

No independent verifier acceptance, exclusive key custody, separate recovery
administration or independently administered monotonic ledger was obtained.
Builder-run tests and builder-generated keys cannot supply those properties.

Latest provider-origin observation: workflow `41348310191`, source
`f90e089aa8dbebd87df231805b36ea2fdb572551`, at
**1 November 2026, 20:43:41 UTC (22:43:41 CAT)**. This visible account has one
accepted member, role `Super Administrator - All Privileges`, with member MFA
enabled. Account-wide `enforce_twofactor` is false. No second member is listed.
This proves the observed member's MFA only; separate signer custody, recovery
administration and independent acceptance remain unestablished. Token actor
lookup returned HTTP403/code9109; no extra privileges were requested.

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

## Acceptance response required from the actual independent person

The owner must identify the intended custodian/verifier by name and an
authenticated GitHub identity or equivalent controlled channel. No appointment
or acceptance is inferred from this draft. The identified person must return:

| Evidence | Required concrete value or action |
| --- | --- |
| Role acceptance | Authenticated acceptance naming this project, duties and reviewed source/artifact digests |
| Provider authority | Distinct account ID, accepted role and provider-origin membership/MFA evidence |
| Key custody | Their independently generated public key and fingerprint; proof that builder/production admins cannot export, rotate or reset its private key |
| Recovery control | Named recovery administrator, separate recovery/MFA control and an authenticated recovery exercise preserving consumption history |
| Readback | Two authenticated independently controlled evidence origins with fresh challenge responses |
| Veto and revocation | Exercise deny, credential/key/epoch revocation and kill authority without builder approval; retain denied stale-client results |
| Monotonic anchor | Exact service/account/storage identity and recovery policy outside both builder and ledger-root reset paths |
| Final decision | Their signed statement over the exact tested execution artifact and destructive-challenge report digests |

Private keys, recovery codes and administrator tokens must never be posted in
this repository, this chat or builder CI. This request contains public identity
and evidence requirements only. It has not been sent to another person.

## External monotonic ledger and destructive challenge

Continuation 07 provides concrete reviewable software at source
`f2a0de932118c9c87720bf846aea885177e32ca5`:
`integrations/independent-ledger/{worker.mjs,client.mjs,protocol.mjs,build.mjs,wrangler.example.toml,README.md}`.
The local review bundle SHA-256 is
`4a09b367553353b6f99f5b773e278b7b27a9c3aee9b49caeeca77617379f6522`.
Its test manifest deliberately uses a synthetic execution-artifact pin and is
not an approved production runtime identity. The operator must independently
review and bind the actual runtime digest, produce its own keys, and accept its
own account/namespace, recovery and revocation controls. No deployment or send
of this request occurred.

Twenty-one local guard checks pass against actual D1 and SQLite Durable Object
components, including builder restore, separate process readback, lost responses
and revocation. A separate explicit regression restores the **authority's own**
old snapshot and demonstrates replay is re-enabled. That is an unresolved
counterexample, not acceptance; an independent high-water anchor/recovery
mechanism must defeat it before the global anti-rollback gate can close.

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
6. Restore the authority administrator's own pre-consume store, then repeat with
   a replacement namespace, old genesis and old signer configuration. The
   independently administered anchor must prevent a second authorization in
   every case. A local counter, another same-admin journal or a removable lock
   does not meet this criterion. Missing/unreachable anchor state must HOLD;
   neither bootstrap nor recovery may reset its high-water value.
7. Read the results through two authenticated independent evidence origins and
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

# Phase 1 acceptance — 21 October 2026, 21:48 UTC

Phase 1 is **INCOMPLETE**. This register reconciles current results with the
historical 13 October matrix; it does not grant public-release permission or
independent approval. PR 29 remains open, draft and unmerged.

| Acceptance area | Current result | Evidence still needed to close |
| --- | --- | --- |
| One live WhatsApp self-test | Open. Live ledger at 21:48 UTC: 0 attempts, 0 consent records, 0 status events. No message sent. | Restore approved browser availability; verify current owner session; recheck all send guards; submit exactly the previously approved single reply; correlate actual Meta signed receipts with that attempt and verify delivery. |
| Native concurrency | **Confirmed for the prepared six-check scope.** Actual PostgreSQL 17.10, migrations 001–015, actual sender/runtime role, fixed fake HTTP. | No remaining execution gap for these six tests. This does not qualify Meta delivery or owner authentication. |
| Authenticated AI workflow | Partial. Earlier real Groq synthetic workflow evidence remains; local regression passed. | Owner-authenticated approved-knowledge/review workflow and runtime AXIOM service identity/transport. The connected operator AXIOM tool is not SaaS application authentication. |
| Security acceptance | Partial. Existing token/key/revocation regression checks pass. At 21:47 UTC there are 0 unrevoked, unexpired application sessions and 1 active QA membership. | Actual mobile/staff session and old-token revocation tests; provider signing-key acceptance; remediation of the exposed QA factor. Earlier no-password/MFA-reset restriction remains; no credentials were reset here. |
| Privacy operations | Partial. Existing suppression tests pass. At 21:47 UTC: 0 expired retained messages and 0 expired retained development replies. | Approved retention/disposition rules, qualified scoped export/deletion, monitored complaint/request handling and actual processor/transfer review. A zero expired count is not evidence of a working retention job. |
| Recovery and operations | Partial. Current-schema encrypted synthetic restore passed for all 22 tables, privileges/policies and tenant boundaries; uncertainty and suppression survived. | Fresh hosted-state backup, independent offsite retrieval/restore, actual scheduled backup and alert delivery, accepted recovery targets, named second custodian and tested key access. Snapshot schedule is empty; the sole preserved snapshot is from 14 October. |
| Independent approval | Open. GitHub PR review submissions were empty in this readback. | A named independent reviewer must review current evidence and record acceptance. Agent implementation/testing is not that approval. |

## Verification completed

`npm run verify` exited 0: **318 passed, 0 failed, 0 skipped**; **142 MJS** files
passed syntax checks. Before this register was added, the complete source manifest
contained 415 verified files. The final documentation refresh adds this register.

Native evidence is in
`evidence/20261021/native-sender-and-current-schema-recovery.json`. Tested source
is `84729e6cd368d24a0abb3d5db3d4d1039a52ccf1`. Each ten-request contention case
reached transport once. New-pool replay made no new request; daily contention
allowed only one additional attempt after four completed attempts.

The backup bug was reproduced by a failing current-schema test: the old payload
validator accepted only fourteen migrations. Version 2 now requires all fifteen
ordered migration names/digests and the exact 22-table inventory. Version 1 remains
readable for the previously tested 18 October archive. Hashes inside an archive
establish internal consistency; restoration also compares SQL to reviewed source.
No archive is an authorization to execute arbitrary recovered SQL.

The native recovery extension exported only disposable synthetic fixtures,
restored an empty database, compared row/schema/security fingerprints, checked
restricted runtime reads and recovered 16 encrypted messages. It does not
replace the still-outstanding hosted-state recovery exercise or external escrow.

## Live boundaries preserved

The stable private alias still resolves to `dpl_3sc6CwbE9kw5P5aHh8PxGr2KVAHe`,
source `3a5ebbb7780f1b9db0dd81cb6fc13390af08e43a`, READY. Project live=false and
SSO protection applies to all deployments. Qualification builds deliberately
terminate after reporting results, preventing application promotion. The project
default build command was not changed. Main remains
`bc48ab8aed137e61b76e25f113bb29e1efd7b11a`.

The existing inbound window ends **22 October 17:35:36 UTC / 19:35:36 Zimbabwe**.
No additional inbound is required before that deadline solely to reopen the
window. No owner session was minted or copied. No browser retry, workaround,
live database mutation, paid upgrade, public launch or unrelated product change
was performed during this qualification work.

Automatic approval review previously blocked browser observation after a usage
limit and rejected reconnection as a retry of that unresolved gate. Generic user
approval does not resolve the tool-side restriction. The live-send, authenticated
AI and provider UI acceptance steps cannot be certified while it remains blocked.

## Role nominations — 22 October 2026

The owner subsequently nominated **Praise Karimatsenga** as independent reviewer,
replacing the earlier Evans Musitu nomination. **Munerudo Kudangirana** remains
the nominated second recovery custodian. Evans Musitu retains owner acceptance.

The owner supplied contact addresses for both nominees. Those addresses are kept
in the private contact record rather than this public repository. The mapping is
owner-supplied; account control and the nominees' acceptance have not been verified.

Independent approval remains open pending Praise's actual review, an assessment
of independence and a recorded evidence-based decision. Custodian qualification
remains open pending Munerudo's acceptance, verified individual account access,
controlled recovery-key access and a successful recovery exercise. Nomination is
not a completed acceptance check. No message, invitation, access grant or key
material was sent as part of recording these roles.

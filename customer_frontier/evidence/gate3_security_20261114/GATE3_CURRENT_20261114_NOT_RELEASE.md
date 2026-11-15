# MUSITU AXIOM Gate 3 — security, custody and anti-rollback

**Gate 2 CLOSED. Gate 3 OPEN / HOLD. Whole-product NOT_RELEASE.**

Gate 2 was accepted at recovery commit `5c03cf457fa0e2bdee7103e2d9f0e4bfd32d9e50`
after matching the complete owner-terminal production backup proof. Its candidate
CI [43636844294](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43636844294)
passed. No backup, import, migration or owner-key ceremony was repeated here.

## Current source and actual observations

| Surface | Exact inspected head | Observation |
| --- | --- | --- |
| B27 runtime baseline PR192 | `14b5c520bd7cd53ccd4978f575dfcbe9b250ed0c` | 95/95 fresh local candidate checks pass; full-authority rollback still reissues a permit in two explicit counterexamples |
| Frontier PR83 | `fdc89d48f7aa888c67afc4ece3465328cc2a77f6` | Latest hosted full-stack run fails at its retained live-adapter security veto |
| Sandbox and direct-invocation repairs PR190 | `c22bf1930b8576bc6b3bcc25ffcd40bd08c93ddb` | Five fresh direct adapter-denial checks and static workflow security contract pass; hosted full-stack still fails at the veto |
| Owner proposal/local nonce candidate PR241 | `5c03cf457fa0e2bdee7103e2d9f0e4bfd32d9e50` | Nine Node and 18 Python checks pass; local snapshot rollback is explicitly reproducible and remains unqualified globally |

The inspected snapshots remain separate. No product source, workflow gate,
credential, Cloudflare setting, historical checkpoint or runtime policy was
changed by this inspection. `source_manifest_20261114.json` identifies every
materialized file by immutable Git blob and SHA-256. Logs and exact commands are
retained with `local_regression_results_20261114.json`.

The initial partial source materialization omitted two import dependencies and
produced setup errors. Those failures are retained as setup results in the record.
The missing original files were fetched at their pinned heads and blob-verified;
the complete subsequent checks passed without source edits.

## Controller identified by owner declaration

Evans Musitu has stated directly in this conversation: "i am controller of
**Security Authority 2**". Use Evans as the owner-operator for the next controlled
authority steps; the controller-name question is resolved. The declaration is
retained in `authority2_owner_controller_declaration_20261114.json` with its exact
attribution. It does not constitute provider-origin control, signer custody,
independent administration, reviewer approval or global nonrollback evidence.

The next qualification concerns the separation of owner-held Authority 2
administrator, signing and recovery credentials from the AXIOM build pipeline.
No separate-controller identity should be inferred or requested again solely
because the operator is the owner. Existing independent security acceptance and
unproven administrator-separation requirements remain recorded as OPEN; this
statement does not activate a runtime governance amendment or waive a veto.

Existing 14 November rehearsal [43630591859](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43630591859)
used the builder GitHub Actions secret `AXIOM_D1_RECOVERY_CF_API_TOKEN` to upload
Worker previews in account `67469478aa9349fa0a57fe3a72da200a`, which is also the
pinned Authority 2 account. This is a historical observed write capability;
subsequent revocation has not been verified. It must be included in the custody
review alongside previously observed builder administration. Preserve working
owner-held recovery access before revoking or restricting build credentials.
No credential value was read and no token was probed or revoked for this update.

## Owner confirms direct recovery access

In response to "Can you administer and recover that Cloudflare account directly,
outside GitHub Actions?", Evans replied "I can". The attributed response is
retained in `authority2_owner_direct_access_confirmation_20261114.json`. The
outside-GitHub recovery question is resolved by owner confirmation and must not
be repeated. Provider-origin custody and administrator isolation remain separate
acceptance requirements.

The Cloudflare account UI was opened for read-only token-policy inspection. It
showed a sign-in screen. A secure authentication request timed out with its
outcome unknown. Automatic approval review then denied page observation because
the unresolved sign-in had reached Google without confirmed authorization for
that provider. No credential or token-policy change was performed in that
browser attempt. The owner subsequently selected manual work in his own browser;
that is now the working path. Preserve the rejection and do not retry agent
browser authentication or use an alternate surface to evade it.

The scoped restriction plan is retained in
`AUTHORITY2_BUILD_CREDENTIAL_RESTRICTIONS_20261114_NOT_RELEASE.md`. Applying it
requires actual token IDs and provider policy inspection. Nothing in this
confirmation earns global nonrollback or waives the existing security vetoes.

## 15 November — owner saved recovery-token readback

The owner is completing the Cloudflare steps in his own browser. He identified
the recovery token aloud as "Axiom D1 Recovery CF API token", reported its account
scope limited to `67469478aa9349fa0a57fe3a72da200a`, removed the Edit rows for
Pages, D1 and Workers Scripts, saved, reopened the token, and reported:
"It's only read permissions for pages , D1,and workers scripts".

`authority2_recovery_token_owner_saved_readback_20261115.json` retains that
attributed manual edit/readback. Accept it as owner dashboard evidence for this
recovery token. No bearer value was supplied. No raw provider policy or actual
write-denial result was independently obtained; do not label the whole account,
all build credentials or global anti-rollback qualified from this readback.

The next credential to review is the token saved in GitHub as
`MUSITU_CLOUDFLARE_ADMIN_TOKEN`. Historical inventory run 43374326568 used it for
GET-only Worker inventory in the same Authority 2 account. Its source was read at
`92764fa5768b4a1fa6d8ac176ec6fc4dfec1d7bf`, workflow blob
`475f03865e4bd3821e031f2d58ef2d4e7e9f78b8`. This identifies a separate build
credential to review; the secret name is not proof of its current privileges.
Continue manual browser guidance. Do not retry agent browser authentication or
repeat the completed recovery-token readback.

## 15 November — remaining owner reports and compiled review packet

The owner reports that the separate token saved as
`MUSITU_CLOUDFLARE_ADMIN_TOKEN` does not grant Authority 2 write access. He reports
that `CLOUDFLARE_API_TOKEN` has Account Resources limited to another specific
account, excluding Authority 2; that account ID was not supplied or inferred.
These are owner statements, not independently obtained full provider policies.
In particular, all user-level, zone-level and alternate credentials have not
been exhaustively qualified.

The pasted account dashboard identifies account
`67469478aa9349fa0a57fe3a72da200a`, subdomain
`axiom-recovery-704a7351.workers.dev`, and "No projects found" / "You have not
created any projects yet". Record the Authority 2 Worker as absent in the owner
readback. No Worker was uploaded for this inspection. The attributed details are
retained in `authority2_owner_remaining_scopes_and_empty_projects_20261115.json`.

A real downloadable review build is now retained from unchanged runtime source
`14b5c520bd7cd53ccd4978f575dfcbe9b250ed0c`, with build/verification-only child
`a2ebd98bef2be6ea61ffe3b37bee2aeb4bf7633e`. Its 15,548-byte bundle SHA-256 is
`d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210`, exactly
matching the separately recorded 13 November build. The original module files,
SQLite Durable Object configuration and existing R2 binding remain unchanged.
No public route, credential, authority state or deployment was created.

[Build and native Windows run 43676166219](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43676166219)
passed the exact build, PowerShell 5.1.20348.5773 and PowerShell 7.6.10 verification,
and four hostile packet cases, for six checks total. Changed bundle/source,
altered deployment claim, wrong expected manifest hash and stale PASS-proof
retention are rejected. The first Windows run 43675820102 stopped before verifier
execution on a source/artifact byte mismatch. That failure remains retained.
The following controlled run observed CRLF conversion in the Windows checkout,
verified the exact pinned Git object against the downloaded file, and restored
only exact Git bytes before execution; the equality guard was preserved.

[Current B27 candidate run 43676166225](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43676166225)
passed 95 synthetic and 22 genuine workerd/SQLite regressions, with its mandatory
independent-custody/global rollback veto still FAILURE. The synthetic two-host
run 43676166257 also passed without earning real provider destructive acceptance.
No passing test has relabelled the global counterexample or security veto.

The owner review ZIP is 68,098 bytes, SHA-256
`c9dee791478ba5927f4636ce50eaee59b52d032f4d1438a111d5f17a28e4df08`. It includes
the exact compiled code, original sources, optional offline Windows verifier,
original CI archives, native verifier receipts and the existing operator
ceremony. It includes no private keys or tokens and performs no deployment or
initialization. Its integrity check is separate from provider/security approval.
See `authority2_private_review_build_receipt_20261115.json` and the byte-preserved
build/native Windows receipts. Gate 2 remains complete.

## What genuinely remains

1. **Authority and recovery control:** qualify independent administration,
   recovery and signer custody for Security Authority 2. Verify revocation of
   builder-held administrative authority only after working replacement/recovery
   control exists. The 13 November provider evidence proved an R2 indefinite lock
   and an empty Worker catalog, with builder-held credentials used for readback;
   it did not prove administrator separation. The 14 November Gate 2 rehearsal
   again left the recovery account Worker catalog empty. A different account ID
   or the owner's successful backup decryption cannot establish this separation.
2. **Once-only genesis:** obtain independent review of a safe initialization and
   recovery protocol tied to immutable GitHub and conditional R2 continuity.
   The current Worker has no bootstrap/reset API. An empty Durable Object holds
   with `HIGHWATER_GENESIS_OR_CONTINUITY_MISSING_HOLD`; deployment alone cannot
   make it an admitted authority. Do not improvise a permanent reset endpoint.
3. **Real destructive acceptance:** after approved independent staging, test
   consumed-sequence replay, stale-authority restore, lost R2 acknowledgement,
   revoked credentials, abort after external commit and independent recovery on
   disposable authority resources. Preserve provider-origin receipts and prove
   that no second permit can be issued. Synthetic passing tests cannot earn this.
4. **Full-stack security acceptance:** independently review the existing safe
   adapter boundaries and qualify an approved isolated staging replacement for
   the disabled legacy production-writing adapter. Keep PR83's fatal veto until
   actual separate staging and reviewer acceptance exist. Gate 2's D1 restoration
   is supporting evidence and does not qualify this distinct adapter surface.

The bounded owner-controlled recovery policy did not activate a production
governance transition or establish global anti-rollback. This inspection records
that distinction without repeating Gate 1 or requesting another owner key.

## Evidence references and next dependency

- B27 exact-head CI [43377585634](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43377585634): candidate SUCCESS, independent-custody/global rollback release-veto FAILURE.
- PR83 exact-head CI [42292436148](https://github.com/evansmusitu/mft-axiom-build/actions/runs/42292436148): full-stack security veto FAILURE, isolated Chromium SUCCESS.
- PR190 exact-head CI [42702983241](https://github.com/evansmusitu/mft-axiom-build/actions/runs/42702983241): OCI and Chromium SUCCESS; direct legacy denial checks SUCCESS; full-stack security veto FAILURE.
- [Existing independent operator ceremony](https://github.com/evansmusitu/mft-axiom-build/blob/14b5c520bd7cd53ccd4978f575dfcbe9b250ed0c/integrations/security-authority2/B27_INDEPENDENT_OPERATOR_CEREMONY_20261113.md).
- Live PR discussion/review timelines for PR192, PR83 and PR190 were read. No independent review submission was returned; all discussion entries with authors were from the repository owner.

**Next required action:** in the owner's browser, open the existing R2 bucket
`musitu-axiom-b27-highwater-a2`, then Settings > Bucket lock rules. Read enabled
status, prefix and retention without changing the bucket or rules. The expected
retained protection covers `b27/` indefinitely. Then qualify the remaining
custody/source/signer requirements before controlled private staging and safe
once-only genesis. The owner/controller and recovery readbacks are already
recorded. Gate 3 remains HOLD; the prepared review packet is not a deployment or
an independent security approval.

Main `c3c5aaab90e94f1ca84ac9903f9d481c23c4f350` and separate draft/unmerged PR1
`8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3` remain preserved. PR192, PR83 and PR190
remain draft/unmerged. No deployment, customer mutation, charge, merge or release.

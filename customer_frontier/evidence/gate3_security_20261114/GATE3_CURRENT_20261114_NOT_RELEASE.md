# MUSITU AXIOM Gate 3 — security, custody and anti-rollback

**Gate 2 CLOSED. Gate 3 OPEN / HOLD. Whole-product NOT_RELEASE.**

Gate 2 was accepted at recovery commit `5c03cf457fa0e2bdee7103e2d9f0e4bfd32d9e50`
after matching the complete owner-terminal production backup proof. Its candidate
CI [43636844294](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43636844294)
passed. No backup, import, migration or owner-key ceremony was repeated here.

## Current source and actual observations

| Surface | Exact inspected head | Observation |
| --- | --- | --- |
| B27 PR192 | `14b5c520bd7cd53ccd4978f575dfcbe9b250ed0c` | 95/95 fresh local candidate checks pass; full-authority rollback still reissues a permit in two explicit counterexamples |
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

**Next required qualification:** with Evans identified as the owner-operator,
establish which Authority 2 administrator, signer and recovery credentials remain
accessible to the AXIOM build pipeline. Verify the owner-operated custody boundary
using public control/recovery and signer evidence. Credentials, private keys and
MFA secrets stay with the operator. Then follow the existing reviewed-order
ceremony for safe initialization and real disposable destructive acceptance.
Independent review and administrator separation remain unqualified; Gate 3 stays
in HOLD before real-customer identity acceptance or production cutover.

Main `c3c5aaab90e94f1ca84ac9903f9d481c23c4f350` and separate draft/unmerged PR1
`8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3` remain preserved. PR192, PR83 and PR190
remain draft/unmerged. No deployment, customer mutation, charge, merge or release.

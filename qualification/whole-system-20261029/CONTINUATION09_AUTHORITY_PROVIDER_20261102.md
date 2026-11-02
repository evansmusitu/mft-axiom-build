# Custody, rollback and saved-request reconciliation: continuation 09

The latest provider metadata read ran on 1 November 2026 at 20:43:42 UTC
(22:43:42 CAT). This 2 November continuation verifies and preserves that result;
it does not turn it into a later provider observation.

| Gate | Verified observation | Remaining evidence |
| --- | --- | --- |
| Custody | One accepted Super Administrator has MFA enabled; visible Security Authority account ID equals production; PR #62 has no independent review submission | Actual independent person's acceptance, distinct administrative/key/recovery control, readback and revocation exercises |
| Anti-rollback | 21 local guard checks pass; one explicit authority-admin snapshot restore still re-enables replay | Independent monotonic anchor, accepted custody and destructive cross-host/root-restore challenges |
| Provider cancellation | Client abort and Work revocation are verified; the wider provider query still contains only the two known completed responses | Cloudflare's saved-Ray terminal state, stop time and exact final usage |
| Hosted D1 | Seven real checks passed in the owner-selected staging namespace; original tables/settings preserved; temporary Worker absent | No promotion to physical database or independent account isolation |

Read-only workflow [41348310191](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41348310191)
ran source `f90e089aa8dbebd87df231805b36ea2fdb572551`.
Artifact `13100545422` has verified ZIP SHA256
`c76c3f05c51915de42a76b613e65bc24c50a084c30280d26ebfff8c119e25530`.
The earlier read at source `1a53205de55799bd99914bb129b957626c59a8b1`
is preserved separately (run `41347725292`, artifact `13100246199`, ZIP
`6c900da6cd272abb9350e7bbd7aca16b1ae99f2baa4494b33920e5583a7f6b4c`).

The corrected reader recognizes Cloudflare's `Time` scalar and retains safe
timestamps, inference duration and byte counts. It excludes arbitrary tags,
prompts, model output and private account identity values. The row window is
15:40:00–20:43:39 UTC, exhausted at two rows, both errorCode 0/sampleInterval 1.
Their token/neuron tuples exactly match the saved planning and synthesis
responses. The 15:43:43 row matches synthesis completed at 15:43:43.747 UTC;
time proximity to the aborted request start at 15:43:43.842 UTC is not identity
proof. The saved aborted Ray remains `a53c044b0eda9b36-IAD`, with final usage
null/UNKNOWN. One provider-call reservation remains retained without refund.

All 21 integrated offline groups passed in
[CI 41348310406](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41348310406).
The source tree `d66680cf3a3db9da3a9b261247f28dd9c043921b` matches the tested
merge tree at `26e397fa3a27070c2391be30506d0181fd0f4da9`. CI artifact
`13100466515` ZIP SHA256 is
`b9cd5f914c9d3155fb8b288d6bedc248c43e22f309da898bc176b5a8d7ffe1f9`;
all 21 exit codes were independently inspected. Counts include 495 application,
73 SDK, 11 local D1, 12 storage, 14 free-provider protocol/readback and 22 ledger
regressions. The last count includes one expected attack reproduction, not an
anti-rollback security pass.

The exact requests are updated in `INDEPENDENT_AUTHORITY_ACTIVATION_20261101.md`
and `PROVIDER_RECONCILIATION_REQUEST_20261101.md`. The latter no longer requests
D1 capacity; the owner's successful reuse choice supersedes that request.
No independent identity was invented, private key created, invitation sent or
support ticket submitted. No staging-secret boundary was bypassed.

The read-only workflow is now sealed to the executed source; future repair
heads skip it. This continuation made zero inference calls, zero Cloudflare
resource writes and zero billing changes. PR #55 remains draft and unmerged;
main, production deployment and publication remain unchanged and blocked.

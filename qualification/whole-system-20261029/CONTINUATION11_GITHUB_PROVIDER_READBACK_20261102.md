# Fresh provider readback through GitHub Secrets: continuation 11

The owner's instruction to use the existing GitHub Cloudflare secret was
executed in [workflow 41389928351](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41389928351).
Source: `83e30800fc1f60a993e7684d30403fe2725ff23f`; observation:
**2 November 2026, 04:42:28 UTC / 06:42:28 CAT**.
The credential remained in the GitHub Actions process environment. No key was
retrieved locally, printed, placed in an artifact or passed to a browser.

Artifact `13116971492`, verified ZIP SHA256:
`e1b0dda507247a80c2461a94a6f2527f5516544cbfc1b33676e083072e76f6ce`.

| Provider query | Direct result |
| --- | --- |
| Full incident day, 1 November UTC | Two completed records, 847 input tokens, 1632 output tokens, 52.20908737182617 neurons |
| Incident request rows, 15:40 UTC through midnight | Two errorCode 0/sampleInterval 1 rows, exactly matching the saved planning/synthesis usage tuples |
| Current day, 2 November through 04:42:23 UTC | No recorded rows, zero account-wide neurons in that window; no attribution to the prior day's aborted call |
| Saved abort `a53c044b0eda9b36-IAD` | UNRESOLVED: PER_REQUEST_JOIN_KEY_UNAVAILABLE; final usage null |
| Visible authority account | Same known production ID; one accepted Super Administrator with member MFA enabled; account-wide enforcement false |

The current inference schema supplies no requestId/rayId field. A missing join
key is now distinguished from a failed exact-ID search. The Track B proposed
fail-closed correction was adapted to the actual source, and a regression
requires UNKNOWN even when a test row carries an identity not exposed by the
declared schema. Missing final usage never becomes zero; one provider-call
reservation remains retained with no refund.

All 21 offline groups passed on this source in
[CI 41389928197](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41389928197).
The source tree `5ca9c2c14ccf4608259101c68b4265f5ec47f92c` matches tested merge
commit `d2816829d2049ce240ce7a9bd9d50f63213d4359`. CI artifact `13116599646`
has verified ZIP SHA256
`619c95277d8f0b368fefd6d6c0a771e2f88a82e502703e09493f354229434747`.
The provider protocol/readback group now contains 15 tests. The 22 ledger
regressions still include the expected authority-admin restore attack; that
counterexample remains unresolved.

The owner has also authorized paid TinyFish automation for the prepared
dashboard lookup. That allowance applies to this browser task, not a Cloudflare
plan upgrade, new model calls or release. No TinyFish browser run has started;
its wallet-funding and Cloudflare sign-in prerequisites remain unmet. No payment
was initiated. The API readback above succeeded independently of that route.

The one-shot readback workflow is sealed to its executed source. This
continuation made zero inference calls, zero Cloudflare resource mutations,
zero billing changes and sent no external support/reviewer messages. The seven
hosted D1 component checks and the existing owner-custodian appointment remain
preserved. Separate verifier acceptance, independent custody/anchor controls
and provider-terminal cancellation/final usage are still required. PR #55 stays
draft and unmerged; deployment and publication remain blocked.

# MUSITU AXIOM Gate 3 — security, custody and anti-rollback

**Gate 2 CLOSED. Gate 3 OPEN / HOLD. Whole-product NOT_RELEASE.**

Gate 2 was accepted at recovery commit `5c03cf457fa0e2bdee7103e2d9f0e4bfd32d9e50`
after matching the complete owner-terminal production backup proof. Its candidate
CI [43636844294](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43636844294)
passed. No backup, import, migration or owner-key ceremony was repeated here.

## Historical 14 November source inspection

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

**Current next dependency:** the owner has supplied the required R2 readback.
The public review archive was verified in the assistant environment, and fresh
native Windows CI passed without using the owner's laptop. Do not request the
same R2 readback, controller identification, recovery confirmation or Windows
packet-integrity execution again. Obtain the actual operator-approved public
signer/client pins, independently qualify custody, and independently review the
concrete genesis candidate and a temporary private initializer/removal procedure
before hosted destructive acceptance. No private key is requested in chat.


Main `c3c5aaab90e94f1ca84ac9903f9d481c23c4f350` and separate draft/unmerged PR1
`8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3` remain preserved. PR192, PR83 and PR190
remain draft/unmerged. No deployment, customer mutation, charge, merge or release.

## 15 November — environment continuation without an owner laptop

The owner instructed the assistant to perform verification in its environment.
The exact saved 68,098-byte review ZIP matched its original SHA-256; archive CRC,
25 members, all 24 manifest-listed file hashes, original build/source pins and
both nested original CI archives passed. This is attributed to actual Linux
archive inspection, not execution on the owner's Windows PC. The original
owner-facing packet and its manifest were not rewritten.

The owner-pasted R2 settings show enabled rule `b27-indefinite`, prefix `b27/`,
indefinite duration, no custom domain and a disabled public development URL in
the exact Authority 2 account/bucket. This is retained as owner-dashboard
readback, not fresh independent provider or administrator-isolation evidence.
No setting was changed and the paid event-notification offer was not enabled.

Draft PR192 candidate `96319259bbca599420c6648d41cfb5c991c58d05` adds a separate
one-shot pre-genesis function, adversarial tests and an in-memory qualification
harness. It does not change the serving Worker, R2 module, Wrangler configuration
or pinned compiled runtime bytes, and is not imported by the serving Worker.
It requires an independently approved commitment hash and immutable GitHub
readback; persists a durable pending record before one conditional R2 barrier
write; and requires exact readback and unchanged pending before a sequence -1
tip. Ambiguous results, late completion, prior history and retries HOLD. There
is no production initializer/reset endpoint or deployment command.

Fresh hosted [candidate run 43722237949](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43722237949)
passed **135 synthetic checks** and **30 local workerd/SQLite integration checks**.
The additional genesis coverage is 40 synthetic and eight genuine local
workerd/SQLite/R2 cases; the GitHub boundary and custody in these tests remain
synthetic. The independent-custody/global rollback veto still FAILED as required.
The two-host run 43722237955 passed synthetically.

Fresh [build/native Windows run 43722237957](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43722237957)
passed the unchanged runtime build, PowerShell 5.1.20348.5773 and 7.6.10 verification,
and four hostile cases, for six checks total. Original CI artifact archives
14165170225 and 14164689083 were downloaded and matched GitHub SHA-256 digests;
archive CRC, sources, compiled bytes and proof/manifest cross-bindings passed.
These are actual hosted Windows runner receipts, not owner-PC or custody proofs.
The new CI manifest binds the new candidate commit; it does not replace the
original owner ZIP's distinct manifest pin.

The first local genesis workerd harness attempt failed because two original
import dependencies were absent in the partial workspace. Its failure log is
retained. Exact Git blob-verified dependencies were restored, without modifying
runtime logic or weakening assertions; subsequent local and hosted checks pass.
The all-state rollback counterexample remains explicitly reproducible.

Current receipts: `authority2_owner_r2_retention_readback_20261115.json`,
`authority2_environment_packet_integrity_20261115.json`,
`authority2_genesis_candidate_local_qualification_20261115.json`, and
`authority2_environment_hosted_ci_qualification_20261115.json`. The
`environment_ci_20261115/` receipts retain their original runner attribution.
Gate 3 remains OPEN/HOLD, Gate 2 remains CLOSED, and overall status NOT_RELEASE.

## 15 November — private initializer and isolated persistence bridge candidates

The next authority implementation gap now has a concrete separately reviewable
controller and retirement checker at PR192 commit
`68799a41a367865649b833de649edcb26f77c0d3`. HTTP ingress always returns 404; the
review config enables no cron, route or preview. The private scheduled path
requires an approved short window, private control capability, an actual
Ed25519 key/public-pin match and the exact commitment. Deadline checks retain
pending after expiry or ambiguity. Actual local workerd tests retire the
controller/private settings, restart on the unchanged serving code and prove
an ordinary signed append plus replay denial. The six-GET retirement checker
rejects leftover temporary bindings/handlers/cron, preview exposure, version/ETag
drift and deployment changes; its tests use synthetic metadata and it makes
no source-byte or independent-custody claim.

[Fresh B27 CI 43726748255](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43726748255)
passed **190 synthetic + 35 local workerd/SQLite checks**. Its mandatory
independent-custody/global rollback veto remains FAILURE. Build run
43726748283 passed the unchanged serving bundle, new dormant initializer build
and native Windows 5.1/7 verification (six checks). Two-host run 43726748267
passed synthetically. Original CI archives, member hashes and manifest/source
cross-bindings were independently checked after download.

[Draft PR242](https://github.com/evansmusitu/mft-axiom-build/pull/242), source
`f6d34d3663e3140665fdc740a529211019a0f46a`, is stacked on unchanged PR190. It adds
only an isolated typed fixture D1 bridge/client/schema and standalone review CI.
It is not a silent integration into PR83, PR190 or production. The bridge has no
SQL/provision/migration/customer/OAuth route or administrator credential. It
requires a pre-existing matching disposable identity marker, fixture-only tenant
IDs, distinct tenant/role credentials and atomic identity/revocation predicates.
Known source, production and accepted recovery-copy UUIDs are rejected.

[Staging CI 43728658569](https://github.com/evansmusitu/mft-axiom-build/actions/runs/43728658569)
passed **20 checks: 15 actual local workerd/D1 and five client/static checks**.
These include identity and revocation races after preflight, concurrent CAS,
restart, tenant separation, corruption, and a genuine local D1 commit with a
lost acknowledgement and no automatic retry. They do not qualify hosted D1,
OAuth/MCP, the whole product or independent security acceptance. The legacy
adapter/scripts and PR83 full-stack veto remain unchanged.

The owner-held Authority 2 Ed25519 public pin and ledger/namespace/key identities
have not been supplied. A question about an existing separate signer received
no answer, so neither key existence nor new authority is inferred. Current
GitHub review lists for PR192 and PR242 are empty, and no independent acceptance
record was supplied in chat. The connected operator router reports UNAVAILABLE
and no external/production authority. It cannot supply independent custody or
review acceptance. These are genuine remaining external dependencies, not a
Windows/laptop verification task. No private key or token is requested.

See `gate3_private_controller_and_staging_progress_20261115.json` and
`gate3_remaining_external_acceptance_inputs_20261115.json` for exact evidence and
next inputs. Gate 2 remains CLOSED; Gate 3 remains OPEN/HOLD and NOT_RELEASE.
No Cloudflare mutation, actual authority deployment/genesis, production change,
paid upgrade, merge, publication or private operator key transfer occurred.


## 15 November — owner names the Gate 3 reviewer

Evans Musitu instructed: "Reviewer is Me". Record Evans as the assigned human
reviewer for the Gate 3 candidates, PR192 `68799a41a367865649b833de649edcb26f77c0d3` and PR242
`f6d34d3663e3140665fdc740a529211019a0f46a`. The reviewer-identity question is resolved; do not ask the owner
to identify another reviewer merely because the earlier record lacked a name.

This is a reviewer-role assignment. It does not express a review disposition
on either candidate, qualify private signer custody or attest to hosted
provider/destructive/full-stack acceptance. Capture the actual human review
decision and its scope separately when supplied. The existing independent
custody/provider requirements and runtime vetoes remain unchanged.

The Authority 2 Ed25519 public JWK and matching ledger/namespace/key identity
have not been supplied. The backup X25519 decryption proof, R2 readback,
controller/recovery declarations and native Windows/file-integrity checks
remain accepted at their existing scopes and must not be repeated. No private
key or token is requested. Gate 3 remains OPEN/HOLD and NOT_RELEASE.


## 15 November — exact Drive original public signing key received

The owner supplied the exact Google Drive file ID `1X7AM5RrOg5s1X-zziRVTT9YHEUkZ004q`.
The authenticated original `owner_ed25519_spki.der` was downloaded without export
or byte changes. Its 44 bytes parse as a public Ed25519 SubjectPublicKeyInfo,
round-trip to identical canonical DER, and yield a public-only OKP/Ed25519 JWK.
The SPKI SHA-256 is `6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a`.
The Drive response supplied the size but no provider checksum; this SHA-256
was computed from the actual downloaded bytes.

The byte-original DER, derived public JWK and validation receipt are retained in
`owner_public_key_20261115/`. The public-file/JWK acquisition step is complete; do not ask for
this same public file again. This updates earlier statements that public
material had not been supplied.

The Authority 2 role is not inferred from the filename or format. The inspected
Step1 key tools accept separately reviewed external owner pins; those source
files provide no prior literal pin establishing this candidate's relationship
to the owner-governance key or a separate Authority 2 signer. Actual ledger,
namespace and key binding, matching private possession and separate custody
remain unqualified. The named human review decision and disposable hosted
destructive/full-stack acceptance remain pending. No runtime trust root,
private key or Cloudflare resource was changed. Gate 2 stays CLOSED;
Gate 3 stays OPEN/HOLD and NOT_RELEASE.


## 16 November — owner confirms a separate Authority 2 signer

Evans replied exactly: "separate key created specifically for Security Authority 2".
This declaration binds the already downloaded public Ed25519 key to its intended
Authority 2 role. The key-purpose question is resolved; do not ask for a new key,
repeat public upload or repeat completed controller/recovery/Windows steps.
The original download receipt is preserved at its historical observation scope.

`authority2_public_role_20261116/` retains the attributed declaration, a complete proposed disposable
public Worker/consumer identity and a pinned review request. Original source-byte
checks, serving config parsing and R2 path construction pass with the actual
public key. These are offline checks with synthetic dispatch, not provider or
custody acceptance. The initial newline materialization failure and exact Git
blob correction remain recorded without weakening the byte guard.

The new qualification IDs are proposed, not installed or discovered production
identity. The owner's scoped source/config review disposition is still pending.
The freshly queried private operator service remains UNAVAILABLE with no external
or production authority. Actual key correspondence, custody, private hosted
genesis/retirement, destructive recovery and full-stack acceptance remain open.
Gate 2 stays CLOSED; Gate 3 remains OPEN/HOLD and NOT_RELEASE.


## 16 November — scoped Authority 2 source/configuration approval received

Evans replied exactly: "Approve" to the pinned review request at `12727c659b1337ee487d8a4924bc7505e41956c2`.
`authority2_owner_source_config_approval_20261116.json` records approval of PR192 `68799a41a367865649b833de649edcb26f77c0d3`,
the temporary initializer/retirement design and the exact disposable public
configuration SHA-256 `bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3`. This source/configuration review
step is complete; do not request it again for unchanged pins. The original
review request, proposal, public key and earlier receipts remain preserved.

`AUTHORITY2_APPROVED_OPERATOR_NEXT_STEP_20261116_NOT_RELEASE.md` identifies the next real dependency: owner access to the
matching private signer and an operator-controlled Cloudflare execution path.
The owner is on a phone; private-key availability on that phone versus only the
Windows PC has not been established. Ask about access only, never private data.
Actual custody, namespace non-use, fresh commitment, hosted genesis/retirement,
destructive recovery and full-stack acceptance remain unqualified. No provider
resource was changed. Gate 2 stays CLOSED; Gate 3 stays OPEN/HOLD and NOT_RELEASE.


## 16 November — signer location reported by owner

Evans answered exactly: "Windows PC and recovery USB drive". The location
question is resolved and retained in `authority2_owner_signer_location_20261116.json`. This is an owner
report of where the existing matching signer is kept, not a fresh private-key,
physical-media, cryptographic-possession or provider-custody verification.
No private file/passphrase was requested, retrieved or uploaded. No completed
owner-key recovery or backup proof was repeated.

The approved Authority 2 source and disposable public configuration remain
unchanged. The next real dependency is an owner-controlled signer/operator
session on the Windows PC with private Cloudflare administration outside builder
custody. No live session is established here. Actual hosted genesis/retirement,
destructive recovery and full-stack acceptance remain open. Gate 2 stays CLOSED;
Gate 3 stays OPEN/HOLD and NOT_RELEASE.

# Authority 2 build credential restrictions — prepared scope, NOT_RELEASE

**Owner/operator:** Evans Musitu. The owner has confirmed direct administration
and recovery outside GitHub Actions. **State:** PREPARED SCOPE; token IDs and
provider policies await authenticated inspection; no restrictions applied.

## Boundary to establish

For account `67469478aa9349fa0a57fe3a72da200a`, account administration, authority
signing, continuity storage and recovery must remain outside the build pipeline's
ability to replace the authority or erase its trusted history. Preserve the
owner's direct recovery access and unrelated accounts. This control must be
demonstrated before claiming administrator separation or destructive recovery.

| Build credential reference | Existing observation | Required review |
| --- | --- | --- |
| `AXIOM_D1_RECOVERY_CF_API_TOKEN` | Used for recovery Worker preview uploads in this account in run 43630591859 | Identify its provider token ID and exact scopes; remove or retire Authority 2 write capability after accounting for remaining consumers |
| `MUSITU_CLOUDFLARE_ADMIN_TOKEN` | Used for Authority 2 account/retention readback in the 13 November evidence | Inspect the actual current policy and cross-account consumers; its name or a successful GET does not prove its full permissions |
| Other tokens held by the build pipeline | Not exhaustively enumerated | Inspect all relevant provider policies and build references; absence from this table cannot establish revocation |

## Controlled sequence

1. In the owner-authorized Cloudflare session, inspect token metadata, IDs,
   account resources and permission groups without revealing bearer values.
   Record the exact account-scoped access and services using each token.
2. Verify the owner retains an administration/recovery path independent of the
   affected build credential. The owner's confirmation is retained separately;
   provider-side evidence of the resulting custody boundary is still required.
3. Prepare the actual token-policy diff from observed provider policies. An
   Authority 2-only recovery token can be retired once its consumers are covered.
   For shared credentials, preserve every unrelated account's required access;
   do not blindly revoke a universal token or substitute guessed account lists.
4. Preserve a separately issued, least-privileged diagnostic read path if it is
   needed and approved. Authority signing keys, append roles and administrator
   recovery material stay with the operator. Never copy them into builder CI.
5. Apply only the reviewed restrictions. If credential replacement or entry is
   required through the browser, the owner completes the protected credential
   steps. Do not infer permission for a broader access grant from this plan.
6. Independently read back the changed provider policies and perform bounded
   denial checks appropriate to the observed credentials. Missing credentials
   or a failed network request alone cannot prove that provider privileges were
   revoked. Never make a real destructive probe against the retained bucket or
   checkpoint history to test access denial.
7. Retain signed/public custody evidence and exact sanitized policy hashes.
   Proceed to separately reviewed initialization and disposable destructive
   acceptance only after their prerequisites pass. The current authority Worker
   deliberately has no bootstrap/reset route; do not improvise one.

## Preserved resources and acceptance limits

Preserve source account `93f395f5121954671f92fffa453d6b61`, its databases and
customers; both recovered databases; bucket `musitu-axiom-b27-highwater-a2` and its
retention/history; the existing GitHub checkpoint records; original encrypted
backups, owner keys and Gate 2 acceptance. No paid upgrade, new authority
deployment, token creation, customer mutation, release or merge is authorized by
this evidence document itself. The user's controlling instructions remain in
effect. PR1 stays separate and draft/unmerged; B27 and PR83 vetoes remain intact.

The account UI showed a sign-in screen. The secure sign-in request timed out,
then automatic approval review denied observation of an unconfirmed Google
authentication origin. Its outcome remains UNKNOWN. This is the current browser
access blocker; it is not evidence that a token was changed, that Cloudflare is
unavailable, or that the owner cannot administer the account. Continue that
authentication only after the user explicitly authorizes the method.

Gate 2 stays CLOSED. Gate 3 stays OPEN. Confirming the owner/operator and direct
recovery access does not itself pass global rollback, safe initialization,
real provider destructive acceptance or independent security review.

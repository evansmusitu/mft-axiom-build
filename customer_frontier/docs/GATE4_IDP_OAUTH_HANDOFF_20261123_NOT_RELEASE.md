# Gate 4: separate IdP to OAuth handoff candidate

Status: source qualification in progress; NOT_RELEASE. Parent PR246 ce6a8cb96450a43949c66c8186c1e476fe312a84. No production entrypoint, route, database, admission flag or account record is activated by this work.

## Security decision

The portal verifier remains limited to customer-control-plane. Its host-only cookie never goes to the OAuth origin. A separate named service redeems a five-minute, single-use handoff grant bound to the original OAuth browser's new __Host-axiom_oauth_flow cookie, the exact persisted OAuth flow, and the verified portal session version. Grants travel in a form POST body, never a URL. Both origins are pinned. The portal requires explicit consent and its own host-only CSRF cookie; duplicate credentials and parameters fail closed.

An independently imported per-account ownership decision must match the active canonical link, active OAuth identity link, existing production customer UUID, tenant and both recorded proof digests. The service cannot create, select by email or repair customer mappings. Qualification flags are necessary admission predicates, not evidence or certification. No public ownership-decision write route exists.

A new isolated D1 namespace stores hashes, immutable flow context and terminal state transitions. Requested -> consent -> approved -> redeemed; approval and redemption are never reset or retried after ambiguous outcomes. Reads use primary D1 bindings. Cross-database reads do not provide distributed atomicity or cancellation of previously admitted work. B27 remains FAILED_IN_SYNTHETIC_ATTACK; destructive recovery and global rollback resistance remain unqualified.

## Qualification and activation boundary

Local tests use synthetic identities, ownership decisions, provider responses and execution; passing them is not real ownership or ChatGPT acceptance. Gate3 is OPEN/HOLD. Before any hosted application: independent source/schema review, backup and rollback rehearsal, actual ownership/consent evidence, independently admitted service bindings and actual IdP MFA are required. The owner's Windows signer is deferred while the PC is off. No signer, private key or cookie is copied into CI.

Real acceptance must prove the same existing customer UUID on the website and ChatGPT, no tenant selection by browser, unauthenticated and cross-tenant denial, logout/revocation/reconnect and recovery. Provider execution/payment/device/final usage evidence remain separate. Existing Paynow authority and production rollback origin remain unchanged. Parity/superiority NOT_CERTIFIED; unavailable final usage UNKNOWN. PR1 remains separate, draft and unmerged with its recorded rejection preserved.

## Rollback

This change is an unactivated candidate. Source rollback is the parent tree. The new namespace has no data-deletion downgrade and no mutation of existing customer tables. Disabling the independently admitted handoff bindings denies pending handoffs; never erase or reactivate consumed grants. Reviewed schema changes require a backup and failed-transaction restoration test before hosted application.

## Implemented candidate and verified scope

- Named entrypoints: OAuthSessionHandoffService (create/redeem only), OAuthHandoffInspector (pending request metadata only), OAuthHandoffBrowserService (bounded portal browser contract). Default worker ingress always 404.
- Public staging adapter admits only /auth/oauth/authorize; it constructs fixed HTML and filters private fields. IdP login seals an optional, privately inspected handoff id in the existing encrypted state; callback resumes only the fixed portal path.
- OAuth handoff mode uses the host-only __Host-axiom_oauth_flow cookie and cannot downgrade into legacy-key or generic-session consent. Legacy behavior remains when handoff mode is not admitted. Authorization flow creation and expiry now use the same timestamp; actual workerd testing exposed and corrected a one-millisecond excess lifetime from separate clock reads.
- New oauth_handoff_ownership_v1 decisions bind issuer/subject digest, existing customer UUID, tenant, canonical proof digest, OAuth witness digest, acceptance evidence digest and bounded validity. No public route imports them. These record the applicable existing authority's actual accepted evidence; the table introduces no replacement controller or signer. Synthetic test rows must never be imported into hosted D1.
- Local qualification: 559 Node tests, 348 Python tests, 33 actual local workerd/D1 tests, no failures or Node/workerd skips. New coverage: 39 handoff cases, four independent SQLite migration/rollback cases, nine workerd/D1 cases. Full logs and hashes are adjacent in evidence/gate4_idp_oauth_handoff_20261123_not_release. GitHub CI must be separately observed at the exact submitted tree.

## Reviewed binding requirements (not activated)

| Caller | Named binding | Target capability |
| --- | --- | --- |
| OAuth candidate | OAUTH_SESSION_VERIFIER | OAuthSessionHandoffService |
| IdP browser broker | OAUTH_HANDOFF_INSPECTOR | OAuthHandoffInspector |
| Staging customer ingress | CUSTOMER_OAUTH_HANDOFF_BROWSER | OAuthHandoffBrowserService |
| Staging customer ingress | CUSTOMER_IDP_BROWSER | Existing IdP browser broker |
| Staging customer API | IDENTITY_VERIFIER | Existing CustomerIdentityService; no OAuth audience |

The handoff service requires separately reviewed primary IDP_SESSION_DB, CUSTOMER_DB, AXIOM_DB and new OAUTH_HANDOFF_DB bindings; exact ZITADEL issuer; OAUTH_HANDOFF_QUALIFIED and OAUTH_OWNERSHIP_QUALIFIED admission predicates. OAuth additionally retains OAUTH_KEYLESS_QUALIFIED. Ingress requires CUSTOMER_OAUTH_HANDOFF_ROUTE_ADMITTED, and existing IdP staging/binding predicates remain mandatory. No deployment configuration or secrets are supplied here.

## Actual acceptance still required

| Evidence | Local observation | Hosted state |
| --- | --- | --- |
| IdP MFA, nonce, PKCE, signed JWT | Synthetic provider, real RSA verification | NOT_ACCEPTED |
| Existing production UUID ownership | Synthetic independently imported decision, matching active rows | NOT_ACCEPTED |
| Website -> OAuth -> ChatGPT continuity | Local browser contract and OAuth callback, canonical token/MCP checks | NOT_RUN with real ChatGPT |
| Single-use grant and recovery | Real D1 concurrency and restart, lost-response denial | Hosted recovery NOT_RUN |
| Revocation | IdP/canonical/ownership before redemption; OAuth revoke after mint | Real account acceptance NOT_RUN |
| Migration rollback | SQLite collision rollback and actual D1 failed-batch rollback | New namespace NOT_APPLIED |

Portal logout revokes its portal session and prevents redemption of that session's pending handoffs. Established ChatGPT OAuth grants remain independently revocable at /oauth/revoke; canonical revocation also denies MCP. Portal logout alone does not implement global OAuth signout. Actual customer acceptance must explicitly validate these semantics; global signout/cancellation is not claimed.

Remaining release blockers are unchanged: Gate3 possession/custody/anti-rollback acceptance, applicable ownership evidence and private operator bindings, real account MFA and ChatGPT/website/device acceptance, independently admitted execution/payment/final-usage evidence, integration review/canary/rollback and public reviewer checks. No merge, hosted application or publication is certified by this source candidate.

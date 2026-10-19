# Sign-in recovery and operations — 19 October 2026

Phase 1 remains incomplete. This change improves the failed SaaS callback path; it does not resolve the separate ZITADEL provider error or qualify a staff session.

## Actual failure boundaries

Existing QA password and authenticator secure submissions previously advanced to the SaaS callback. The actual runtime diagnostic at 2026-10-19T10:00:35.721Z was FLOW_VALIDATION / ERR_JWE_INVALID, before token exchange. The elapsed login exceeded the unchanged 600-second flow lifetime; expiry remains an inference because cookie values were not inspected.

After the later direct handoff, ZITADEL itself displayed Could not create session for user at its password step for musitu-phase1-staff-qa. Initial targeted headings/alert reads missed that separate message; an exact visible text read confirmed it. Automatic approval review rejected one proposed password retry before prompt/submission because the generic failure needed diagnosis first. No retry through another surface was made. Official ZITADEL issue12098 reports that this generic message can mask an invalid password; it does not prove this instance's cause. The user explicitly instructed no reset; no factor/password/security-policy change occurred. The administrator console session has now expired too, so fresh account event diagnostics are blocked by sign-in. Older password-success events are not current acceptance evidence.

## Small recovery change

Browser GET /auth/callback failures previously returned raw error JSON on the callback URL. They now return a 303 to the fixed local /sign-in-help page, with no-store and no-referrer. No callback query, provider error, token, cookie, claim value or external destination is forwarded. The page uses existing styles, a clear heading and ordinary links to start a new sign-in or return to overview. It does not retry automatically, select an account, fill credentials, extend freshness or admit a session. New sign-in is an explicit user choice; provider errors should be diagnosed before another attempt.

API callback requests, POST/logout and login failures retain the 503 denied JSON contract, now also no-store/no-referrer. Provider validation, state/nonce/PKCE, token/client binding, MFA, membership, encrypted sessions and revocation code are unchanged.

## Verification and scope

Two regression cases failed on the old route: browser callback returned503 instead of303, and denied JSON lacked no-store. With the patch, 23 focused authentication cases passed; final full suite280/280, syntax125 MJS and optimized Next build passed. A valid synthetic provider configuration with a missing flow proves rejection before provider transport and no sensitive diagnostic output. The built standalone Next server additionally returned303/fixed recovery URL,200 help page/manual same-origin sign-in link, no-referrer, no forwarded query and503 JSON callback. These are LOCAL SYNTHETIC tests, not genuine staff/provider acceptance.

The first separate-process local HTTP probe could not connect to its server. The standalone child-process probe then exposed Next's private,no-store cache header, causing an overly exact header assertion to fail. The final check required the actual no-store invariant and passed. Neither failure was reclassified as provider acceptance. See dated logs and signin-recovery-local-http.json. Private staging deployment and genuine staff acceptance must be recorded separately.

## Recovery operations checked read-only

Current Neon project jolly-scene-02112141 reports free_v3, history retention21600seconds and fixed0.25-CU defaults. The original branch br-jolly-fire-b4klddds has an empty snapshot schedule. Its only snapshot snap-little-smoke-b4sdrjky remains preserved and expires2026-10-21T03:15:00Z (05:15 Africa/Harare). No snapshot, branch, endpoint or schedule was mutated.

The official Update backup schedule API documentation explicitly requires a paid plan: https://api-docs.neon.tech/reference/setsnapshotschedule. The user's no-charge/no-upgrade instruction blocks that provider-native scheduling path; no schedule write or upgrade was attempted. The existing manual encrypted offsite export/restore remains qualified only within its recorded scope. Scheduled independent exports, actual alert delivery/on-call, second custodian and full SaaS recovery remain open. Do not count a reminder, empty schedule, preserved snapshot or source code as working scheduled backup acceptance.

Before deployment, independent Vercel project readback still showed live=false, SSO enabled on all deployments and the prior READY staging deployment dpl_EXTsUtoBdMdjVDFsoYs1M3ftrw53. Preserve these protections and deploy only the pinned reviewed candidate to the same isolated project. No production AXIOM, MAIL FABRIC, FMI, main, receiver/subscription, public launch, send, customer import or paid change is authorized here.

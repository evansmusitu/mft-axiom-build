# MUSITU Store V2 — restricted Neon→Vercel Preview credential stage (2026-10-21)

## Important live finding / correction

After the owner reported saving `STORE_NEON_DATABASE_URL`, an authenticated
Vercel metadata read showed the sensitive variable was attached to
**Production**, despite the owner instruction to use **Preview only**.
The assistant used the authorized Vercel edit-project-env connector to
move this **same existing secret record** (ID `7AFyV7xJXSs7mBrQ`)
from `target:["production"]` to `target:["preview"]`.
No password or connection string was displayed, logged, committed, or
copied between providers in this remediation.

A subsequent independent Vercel listing confirmed:
- `STORE_NEON_DATABASE_URL`: **Sensitive; Preview only**;
- `STORE_NEON_STAGING_ONLY`: **true; Preview only**;
- `STORE_CHECKOUT_ENABLED`: **false; Preview only**;
- `STORE_CALLBACKS_CERTIFIED`: **false; Preview only**;
- `STORE_FIRST_PARTY_ONLY`: **true; Preview only**.

The Vercel Sensitive variable is opaque to the connected app. **Its actual
URL content, password encoding, and ability to authenticate were NOT
verified**. A prior owner-visible Neon password may have been exposed
in chat and must not be reused; a fresh secret rotation remains necessary
if the owner did not rotate it.

## Independent Neon role readback

Read-only Neon SQL in project `twilight-recipe-57687554`,
branch `br-lively-moon-b5tru1gb`,
database `musitu_store_v2_staging` verified:
- `musitu_store_v2_gateway` LOGIN **true**;
- `neon_superuser` membership **false**;
- CREATEDB/CREATEROLE/BYPASSRLS **false**;
- inherited Store-limited role membership **true**;
- public schema usage + product SELECT **true**;
- product INSERT and checkout-amount UPDATE **false**;
- checkout status UPDATE **true**.

This proves role configuration, not that the chosen password in Vercel
matches Neon's currently installed password.

## Isolated protected Vercel Preview deployment

- Project: `prj_a9Let6yYukgDv0WyXhIoXXrfFe9h`, name
  `musitu-store-v2-neon-stage-20261021`.
- Vercel project protection: `ssoProtection.enabled=true`,
  `deploymentType="all"` independently read back.
- New deployment ID: `dpl_GEdVE2VxLGzYwMSHUYko9bLaNSGo`.
- Deployment URL:
  `https://musitu-store-v2-neon-stage-20261021-rh9vyzm1y-evansmusitu.vercel.app/api/stage`
- New deployment target: `null` (Vercel Preview; unlike the prior
  initial deployment explicitly tagged Production), **no production aliases**.
- Deployment status: **READY**; Vercel build logs show build complete;
  no runtime Neon query/canary response was obtainable without an
  authenticated Vercel browser session.

Staging route `/api/stage` is strictly read-only. It checks both the
Store-only database identity and role and zero Store rows. All
checkout/real payment/refund/payout/entitlement flags are hardcoded off.
Production remains without the Neon database URL and no Store checkout
functionality is permitted.

## Acceptance result

- Neon gateway privilege grant: **VERIFIED**.
- Sensitive connection secret *exists in Preview*: **VERIFIED**.
- Private Preview build: **READY**.
- Authenticated Preview endpoint returning
  `stage_db_connected_disabled`: **NOT YET TESTED**.
- Anonymous request blocked by Vercel SSO: setting **VERIFIED**,
  actual request **NOT YET TESTED**.
- Paynow Store-specific merchant authority, real publisher identities,
  genuine external apps and physical-device acceptance: **UNQUALIFIED**.
- Axiom Work: `PHASE_1 RUNNING`, `PHASE_2 PENDING`.
- PR #27 stays **OPEN/DRAFT/UNMERGED**, protected main and PR #1 unchanged.

## Next owner-only browser check (no secret disclosure)

While signed into the correct Vercel account, open the *exact*
preview URL above, authenticate through Vercel if required, and share
only the resulting JSON `code` and HTTP status—not credentials.

Expected only after a successful real Neon query:
`{"ok":true,"code":"stage_db_connected_disabled", ...}`.
Possible fail-closed codes:
`stage_gate_closed`, `stage_database_not_attached`,
`stage_db_identity_rejected`, `stage_database_unreachable`,
`stage_database_not_qualified`.

Do not disable Vercel Authentication, add Production env secrets, copy
Neon keys into GitHub/chat, create checkout/payment routes, or merge
restricted branches to get a green response.

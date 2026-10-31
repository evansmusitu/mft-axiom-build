# MUSITU Store V2 — owner-observed protected Neon HTTP canary

**Date:** 29 October 2026. **Environment:** private Store-only Vercel Preview.
**Classification:** owner-reported endpoint success response, independently
cross-checked against exact source handler and restricted Neon read-only query.
**Not** a Store developer login, transaction, migration or release acceptance.

## Owner-provided response (exact sanitized values)

```json
{"ok":true,"code":"stage_db_connected_disabled","checkout_enabled":false,"callbacks_certified":false,"payments_enabled":false,"entitlement_granted":false,"payout_authorized":false}
```

The owner supplied only the JSON body, not HTTP status headers, a timestamped
raw capture, SSO cookie provenance or a negative anonymous-browser result.
The versioned handler `store/phase1/neon-stage/api/stage.js` returns this body
with HTTP 200 only after its strict environment/URL checks and one read-only
query to the Store-specific gateway. The source-derived HTTP 200 is not an
independently observed header. The source never returns credentials or customer
records in this witness.

## Independent read-only restricted-role observation

Connected Neon staging project `twilight-recipe-57687554`, branch
`br-lively-moon-b5tru1gb`, database `musitu_store_v2_staging` was queried
using **explicit role** `musitu_store_v2_gateway` with SELECT only.
Observed: `current_database=musitu_store_v2_staging`, `current_user=musitu_store_v2_gateway`,
`elevated=false`, exactly four Store tables; zero products, checkouts, payment
reviews, customer tokens; no gateway `TRUNCATE`, payment-review `INSERT`, or
amount-column `UPDATE` privileges. This corroborates the canary's database
identity/privilege claims independently of its owner-supplied response.

A Vercel project read confirms protected READY Preview, SSO protection across
all deployments and no live Store project. No independent Vercel owner-login
or unauthenticated denial was captured in the connected session.

## Strict evidence ledger

- **Owner-reported connected stage canary:** **OBSERVED**. No further merchant
  signup or Neon URL binding steps are required merely to repeat this canary.
- **Read-only restricted Neon gateway identity and empty schema:**
  **INDEPENDENTLY CONFIRMED**. No write SQL or migration executed.
- **Complete authenticated Vercel SSO HTTP acceptance:** **PARTIAL**;
  one owner-provided JSON witness, no negative anonymous access test.
- **Live Store OIDC/PKCE and MFA with trust anchors:** **NOT ACCEPTED**;
  Store authentication modules remain undeployed candidates.
- **Private Paynow 27721 no-money Testing callback + poll:** **NOT ACCEPTED**;
  existing Preview gate is deliberately deny-all.
- **Written Paynow third-party marketplace terms:** **PENDING** after follow-up
  sent 29 October; a sent message is not an approval.
- **Third-party publisher opt-in and verified signed APK rights:** **PENDING**
  for Fossify Gallery, Open Camera and Material Files. No rights inferred.
- **Financial/launch gates:** **DISABLED**; customer charges, entitlement,
  refunds, publisher payouts and public launch remain prohibited.

## Remaining external acceptance evidence

For Vercel, owner and independent reviewer capture the actual protected HTTP
status/header and denial from an unauthenticated private browser without
recording cookies/keys. For Store OIDC/MFA, enroll an owner-controlled issuer,
real app callback and revocable session (not Vercel SSO). For Paynow, certify a
separately authorized Store-only, Testing-only worker with real provider-hosted
fake Success/Cancelled outcomes and independent signed callback + status poll.
For publishing, obtain signed, scope-specific permissions and independent APK
provenance/security review. Do not alter main, signed V1 or draft PR #32.

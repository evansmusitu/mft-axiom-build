# MUSITU Store V2 — Paynow 27721 private TESTING callback/poll acceptance

**31 October 2026 | Private, NOT DEPLOYED, NO RELEASE authority.**

This complements existing `paynow-provider-poll.mjs` and review-ledger logic. It **does not** initiate a Paynow payment, offer checkout to customers, qualify marketplace rights, grant APK access, release funds or turn on callbacks. The existing Vercel Store Paynow preview remains `store_paynow_27721_private_disabled`.

## Authority and Paynow preconditions

- Only the account owning test integration **27721** can fake a hosted Paynow TESTING payment. The separate existing live MFT Paynow integration and credentials must never be used for the Store. Paynow's official test guide: https://developers.paynow.co.zw/docs/paynow/test_mode/.
- Owner or authorized operator must create the **genuine test transaction** inside the correct Store-only merchant integration and retain its actual reference, source order, result URL/callback, poll URL and redacted Paynow test receipt. This isolated review runner is **not** the initiation path; no test transaction has been created by this change.
- An approved first-party, noncustomer testing-only initiation boundary and safe callback inbox are needed for an automated hosted test; no such production/live boundary is enabled by this change. Do **not** flip checkout, callback certification, entitlement or payout flags just to make a test pass.
- Only the authoritative owner-held integration key may verify Paynow SHA-512 statuses; it must be loaded into the operator's secret-managed environment, never put in a CLI argument, GitHub issue, log, handoff or chat. Never paste genuine callback bodies containing customer data into chat.

## Private evidence preparation (Linux operator host)

1. Establish a 0700 owner-only working folder, with a separate 0700 journal folder. Save the **genuine, independently obtained** Paynow callback body to a 0600 `callback.txt` file. No sample callback qualifies.
2. From the actual durable initiation record create `order.json`, chmod 0600, with **only** these keys: `integration_id` exactly `"27721"`, `testing` exactly `true`, `reference` an actual `STORE-` prefixed 16–48 character uppercase-alphanumeric suffix, `amount` an exact USD two-decimal string between `0.01` and `10.00`, and the exact Paynow HTTPS `pollurl` received from the genuine transaction. This is an intentionally **capped TESTING-only** reviewer, not an arbitrary merchant payment client.
3. The environment must be explicitly marked `STORE_PAYNOW_ID=27721`, `STORE_PAYNOW_MODE=testing`, `STORE_FIRST_PARTY_ONLY=true`, `STORE_TEST_REVIEW_APPROVED=true`, and **all four** flags `STORE_CHECKOUT_ENABLED`, `STORE_CALLBACKS_CERTIFIED`, `STORE_ENTITLEMENTS_ENABLED`, `STORE_PUBLISHER_PAYOUTS_ENABLED` must equal the string `false`. The secret-managed `STORE_PAYNOW_INTEGRATION_KEY` must be present and never logged.
4. The reviewed command, on the authorized private Linux host from repository root, is:

```sh
node store/phase1/payments/paynow-testing-review-cli.mjs \
  --order /absolute/private/dir/order.json \
  --callback /absolute/private/dir/callback.txt \
  --ledger /absolute/private/dir/ledger
```

5. The runner fails before network access for absent/incorrect review flags, keys, malformed order, invalid amount, unsafe file permissions, symlinks or duplicate arguments. For an accepted genuine callback it invokes the **existing** pinned HTTPS empty-POST independent Paynow poll, validates both SHA-512 messages against the exact order, and commits a local REVIEW_ONLY journal. Never assume a success message certifies payment settlement, refunds, entitlements, payouts, marketplace permission or Phase 1 acceptance.
6. Independently review the redacted receipt, HTTP status/headers from the authenticated owner run, both provider status timestamps, zero customer funding in test mode, immutable ledger, security signoff and any unresolved hold. Preserve Paynow's unique provider reference privately; do not copy confidential raw values into public handoffs.

## Unavailable evidence / explicit outstanding blockers

- No authenticated owner merchant session, true Paynow-hosted 27721 callback, or independently polled provider response supplied to this runner yet.
- No written Paynow permission to collect or distribute funds for third-party software publishers.
- No three independently verified publishers, two signed authorized app releases, real-device and independent launch acceptance.
- The operator runner is **isolated and undeployed**; its 8 tests and the existing payment test suite are offline evidence only. CI uses synthetic signed examples and may inject a fake reviewer only when `CI=true`.
- GitHub PR #32 remains draft/unmerged. Protected Store V1, production data, existing merchant integrations and live payment boundaries unchanged.

Source of provider status procedure: https://developers.paynow.co.zw/docs/paynow/polling_status/. Important callbacks must be independently polled; Paynow recommends polling when important state changes, and the poll is an empty POST to the previously supplied `pollurl`.

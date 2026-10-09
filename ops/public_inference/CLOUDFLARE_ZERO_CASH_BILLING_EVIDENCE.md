# MUSITU AXIOM: Cloudflare established credential route, supplemental read-only billing audit

**Date:** 2026-10-09. **Account status:** unverified live. **Customer-serving inference:** NOT PROVEN. **Cash budget:** USD 0.

The connected Drive's established Cloudflare record names a prior successful Global API Key with `cfk_` format and `X-Auth-Email` + `X-Auth-Key`; AXIOM's main GitHub workflows confirm existing encrypted secrets `CLOUDFLARE_EMAIL` and `CLOUDFLARE_GLOBAL_API_KEY`.

The original Drive record was made for Education Nexus. The AXIOM code uses its **own existing protected GitHub secret names**, and it does not copy or expose the Education Nexus credential anywhere.

## Supplemental native read-only checks

On an operator-authorized no-charge GitHub Actions runner, the manual, cost-gated workflow is wired to issue the following authenticated GET requests and nothing else:

1. `/zones?name=mftintelligence.com&status=active`
2. `/accounts/{AXIOM_ACCOUNT_ID}`
3. `/accounts/{AXIOM_ACCOUNT_ID}/subscriptions`
4. `/accounts/{AXIOM_ACCOUNT_ID}/workers/account-settings`

No Worker upload, Workers AI inference request, AI Gateway credit purchase, D1 provision, billing change or secret update occurs. Responses are sanitized: only success/failure, subscription count, whether a positive-price subscription appeared and the bounded Workers usage-model enum are emitted. Subscription pages with incomplete results fail closed. API failures never print exception bodies, header values, key material or customer data.

The Cloudflare subscriptions API requires Billing Read or Billing Write; lacking permission is a legitimate fail-closed `NOT PROVEN` result, not proof of a bad credential. The Workers account settings API can return a default usage model but is **not sufficient** to certify the Workers plan or Workers AI billing account state. The returned receipt therefore *always* states `workers_ai_free_plan_qualified=false` and `billing_overage_hard_stop_verified=false`.

## Stop boundaries

- No automatic GitHub Actions events. Manually triggered CI is gated by `AXIOM_TRACK_B_ZERO_COST_CI_ALLOWED=true` and requires independently verified zero-overage Actions allowance. Not run here.
- Never use Global API Keys in Wolfram requests or agent prompts, even though an earlier project used that relay.
- Worker Free eligibility requires independent evidence from the **actual AXIOM account's dashboard and billing controls**. On Workers Free, Workers AI's included allowance is 10,000 Neurons/day and usage beyond that fails; Workers Paid can generate usage charges above the allowance. Never change plans or enable unified AI Gateway billing.
- Any gateway deployment or public customer serving remains S3/S4 and subject to exact independent authorization and release approval.

## Verification

The source was tested locally using synthetic HTTP fixtures: 16 read-only security tests passed (7 established-auth tests plus 9 billing tests). No live Cloudflare account authentication, real billing read or free-plan certification took place.

Official account read endpoints:
- https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/account_settings/methods/get/
- https://developers.cloudflare.com/workers-ai/platform/pricing/

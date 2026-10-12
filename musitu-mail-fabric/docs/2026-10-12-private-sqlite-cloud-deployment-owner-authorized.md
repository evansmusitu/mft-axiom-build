# MMF isolated Cloudflare commercial SQLite Worker: one-time deployment qualification

This internal operational decision authorizes creating only a new, uniquely named, non-public staging Worker with its own SQLite-backed Durable Object namespace. **It is not authority to enable a customer platform, copy merchant credentials, operate an email service, modify existing Paynow Workers, or create paid accounts.**

Target: `mmf-commercial-private-sqlite-stage-20261012`; class `MmfCommercialPrivateStageDO`; migration `mmf-commercial-private-sqlite-v1`. Uses private Cloudflare account-scoped GitHub Actions secret; no secret is copied to source, stored in the evidence artifact or generated as a customer credential. The HTTP entry point responds 503 even if accidentally routed. Workers.dev and preview URLs are disabled and no routes/triggers/service bindings exist.

The intentionally disabled `MMF_STAGE_ONLY=false` setting prevents the customer data kernel from being used until a separate reviewed identity/secret/tenant qualification is authorized. The first deployment independently proves only that the real Cloudflare Worker and Durable Object **namespace binding** can be provisioned. **It does not demonstrate SQL storage execution, a stateful instance restart, identity federation or disaster recovery**. Those remain distinct release gates.

All Cloudflare writes are limited to the new, absent name, and the workflow runs only on the exact pre-authorized branch transition. The existing payment authority/transport Worker bindings are compared before and after using GET-only reads. Any Cloudflare timeout or mismatch fails closed and must be inspected before retry, since a timed-out deployment may have partially succeeded.

Evidence: successful GH workflow for this commit, sanitized attachment, and same-run GET of target settings/subdomain/secrets. No changes to protected main, PR #1, shared merchant integration or frozen OpenAI surface are authorized.
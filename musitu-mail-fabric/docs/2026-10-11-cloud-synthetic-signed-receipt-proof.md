# MUSITU Mail Fabric — Private Cloudflare signed synthetic receipt qualification

**Authority:** October 11 staging-only authorization. **Target:** Existing isolated `musitu-mail-fabric-payment-private-stage-20261011`. This is *not* a Paynow merchant connection, bank settlement, verified real customer payment, customer invoice, or mail entitlement.

## Boundaries and release controls

- Works only inside the verified owner account, isolated branch `product/musitu-mail-fabric-isolated-20261009` and preexisting, non-public MMF payment Worker.
- No changes to FMI billing, shared Paynow merchant/transport/authority, Axiom, Chemistry, Cloudflare production routes, protected GitHub `main` or PR #1.
- Starts from receipt intake **off** and verifies private Workers.dev/previews are disabled and dedicated SQLite Durable Object binding exists before any mutation.
- The staged Worker can be briefly armed for **synthetic** MMF receipts only if `MMF_STAGE_RECEIPT_EXPIRES_MS` is within 20 minutes of the server clock, with a separate receipt bearer, Ed25519 public key, SHA-256 fingerprint, and non-commerce/non-sending flags. The underlying stage order path is never a checkout or payment initiation path.
- Generates an **ephemeral synthetic** signer and two independent bearer credentials on GitHub's ephemeral runner. Private signer never leaves runner; a SHA-256 hash of random fake provider reference is recorded. The word `paynow` in the signed schema is a simulated integration *contract*, not a verified Paynow operation.
- Only `127.0.0.1:8793` local probe with private remote Cloudflare service binding can call the staged Worker. The probe has no public route, deployment, Paynow service binding or global payment API.
- Creates a synthetic pending order, verifies signed `Paid` -> `PAID_SANDBOX`, rejects an invalid signature and unrelated operator bearer, proves idempotence, then verifies signed `Refunded` -> `REVERSED_SANDBOX` and rejects reactivation from an old signed Paid event.
- **Always** restores the original receipt-disabled stage deployment, rotates stage operator and receipt bearer secrets, securely drops signer private key, and independently reads back Cloudflare's locked flags.
- If cleanup fails, treat qualification as failed and investigate Cloudflare's actual deployed flags immediately. The temporary receipt arm is also bounded by a short expiry that fails closed at the Worker level.

## Evidence levels

- Local red-green evidence: new expiry test initially failed (`expected: 201, actual: 503`); after the expiry gate implementation, focused and full suites passed.
- Cloudflare runtime evidence: must come from the actual CI workflow log and sanitized CI artifact. **Never** infer remote success from local tests alone.
- Commerce gate remains BLOCKED; no customer money, Paynow initiation, merchant credentials or sending permissions are used.

## Not included

The live FMI authority currently has only FMI/Chemistry product paths. MMF-specific merchant-scoped authority routing, real Paynow callback and independently authenticated poll, approved legal invoicing entity, final price agreement, bank settlement/refund qualification and external security approval remain independent **unmet** release gates. No simulation can satisfy those gates.

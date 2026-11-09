# AXIOM first-customer enrollment contract (S1 only / not production qualified)

## Purpose

Provide a safe starting point for *keyless* browser customer enrollment and a binding contract for ChatGPT identity continuity. The existing live `auth/musitu_axiom_oauth_worker.mjs` **still requires an account key**; this candidate must not be represented as having cut it over.

## User flow

1. Customer opens the independent portal, selects **Create account** (`/auth/start?intent=register`).
2. Only a private qualified `IDENTITY_LOGIN_SERVICE` may provide the provider authorization URL. The broker rejects unknown origins, usernames/passwords in URLs, non-PKCE flows, short state, or missing S256 challenge. IdP owns sign-up, verified email, MFA, PKCE state, cookie binding, recovery, logout/revocation and consent.
3. After the IdP returns a verified same-origin session, the customer explicitly chooses **Finish account setup**, calling `POST /v1/customer/enroll` with same-site cookie, Origin and `x-axiom-intent`. The browser supplies **no user id, tenant id, account key, role or verified flag**.
4. An independent, privately bound `IDENTITY_ENROLLMENT_VERIFIER` reads and validates that session, returns a fresh attestation for `customer-control-plane`, including issuer, subject, verified email, MFA, proof id, expiry, and verifier identity. Rejected/unqualified sessions cannot create a tenant.
5. The control plane creates a unique personal tenant and owner membership atomically, plus immutable proof metadata (no raw email or account key in the evidence). Retries for the same active subject are idempotent; revoked identities cannot self-provision a replacement tenant.
6. A separate `IDENTITY_VERIFIER` provides subsequent session verification on all protected customer routes. It authorizes memberships from the database; it cannot add members via a client-supplied `tenant_id`.
7. The **existing** ChatGPT OAuth provider needs independently reviewed migration to this IdP `issuer + subject` continuity; dynamic client registration, resource audience, PKCE, refresh revocation and safe legacy-key migration remain dedicated, separately qualified work.

## Security conditions and flag ownership

- `IDENTITY_LOGIN_QUALIFIED=qualified_private_binding` and `IDENTITY_ENROLLMENT_QUALIFIED=qualified_private_binding` are *admission predicates*, **not certificates**. Never set without provider-bound staged proof signed by independent authorization authority.
- Login redirect must be `https://auth.mftintelligence.com/oauth/authorize` with adequate `state` and an S256 `code_challenge`. The provider independently owns the returned state/nonce/PKCE and actual cookie issuance.
- The caller must not be able to set or override `issuer`, `subject`, `role`, `proof_id`, `email_verified`, `mfa_verified` or `production_qualified` in the verifier result.
- Verifier should be a private Cloudflare service binding inaccessible from public ingress and must derive assurance from independently validated IdP records. A JSON field alone is not independent proof.
- Real D1 cross-tenant foreign keys, transactional isolation, journal immutability, crash recovery, policy gate, revocation propagation and independent verifier proof are all **NOT PROVEN**.
- Canonical mapping to existing production customer UUID, entitlement state and legacy account-key migration is **NOT IMPLEMENTED**.

## Test commands

```sh
node --test tests/customer.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
```

## Negative demonstrations

- No identity binding -> login returns 503.
- No qualified enrollment binding -> enrollment returns 403 and creates zero rows.
- Cross-origin attempt -> 403.
- Browser-supplied self-asserted identity does not affect principal.
- Stale, non-MFA, unverified-email and wrong-audience attestations -> deny.
- Replayed subject -> same existing tenant; revoked subject -> deny.
- Replayed proof across different subjects -> uniqueness error and no new tenant.

Do not expose the private verifier endpoints, manufacture identity attestations or mark any system live from these tests.

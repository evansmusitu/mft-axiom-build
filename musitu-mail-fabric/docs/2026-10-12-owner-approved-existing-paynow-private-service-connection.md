# MMF → existing MUSITU Paynow Workers, internal service binding (payments OFF)

**Owner direction (2026-10-12):** Connect MMF to the existing MUSITU merchant infrastructure as other MUSITU products already are, rather than requiring a second merchant account. The initial integration is an internal infrastructure connection, not a real-payment launch.

## Real Cloudflare connection performed only on the isolated MMF canary

- Source/target account: `93f395f5121954671f92fffa453d6b61`.
- Caller (ONLY Worker eligible for modification): `mmf-paynow-isolated-deny-canary-20261012`.
- Caller service bindings (new):
  - `MMF_PAYNOW_AUTHORITY` → `mft-phase8-external-authority`.
  - `MMF_PAYNOW_TRANSPORT` → `mft-paynow-transport-gateway`.
- A separate same-run GET-only audit must match BOTH source hashes and legacy binding metadata of the targets before and after this operation. The script refuses a canary source mismatch, any preexisting secret bindings, unexpected non-service bindings, or an enabled public subdomain.
- The existing caller module remains byte-for-byte unchanged and returns HTTP 503 to all requests; no payment, mail, merchant secret, billing or authenticated provider operation can run.
- Upload only the known original deny-all canary source with exactly two `service` bindings. Read back bindings/source/subdomain; refuse success on any mismatch. Idempotent reruns do not write.
- **Never write to the two shared payment Workers** with this procedure. No `PAYNOW_INTEGRATION_KEY` is transferred or copied.

## Limits

The two Cloudflare service bindings create a real private infrastructure relationship from MMF to the existing Workers. They are NOT equivalent to new MMF-specific routes on the target Workers, which do not exist yet. Dedicated `MMF_AUTHORITY_BRIDGE_TOKEN` and `MMF_TRANSPORT_BRIDGE_TOKEN` bindings have not been installed; MMF service cannot sign, initiate, poll or reconcile a provider transaction. The dual-release and canary rollback requirements for shared Worker edits remain separate. The owner asserts that MMF belongs on the existing Paynow merchant; do not falsely report that provider eligibility has been independently verified.

The only permitted write is the isolated canary script's bindings. All real-money, public endpoints and customer email capabilities remain deliberately disabled. No rollback of existing merchant bindings, provider transactions or production routes is permitted by this workflow.
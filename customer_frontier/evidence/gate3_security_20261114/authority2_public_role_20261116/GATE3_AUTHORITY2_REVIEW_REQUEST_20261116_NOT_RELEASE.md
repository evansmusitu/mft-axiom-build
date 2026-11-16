# Authority 2 — scoped source and public-configuration review

**Prepared 16 November 2026 · Gate 3 OPEN/HOLD · NOT_RELEASE.**

Evans Musitu is the named human reviewer and Authority 2 controller. He confirmed that the downloaded Ed25519 public key is from a separate key created specifically for Security Authority 2. That resolves its purpose; private possession and custody remain separate evidence.

## Concrete candidate

- Authority source: [PR192 at `68799a41a367865649b833de649edcb26f77c0d3`](https://github.com/evansmusitu/mft-axiom-build/pull/192).
- [Private initializer and retirement contract](https://github.com/evansmusitu/mft-axiom-build/blob/68799a41a367865649b833de649edcb26f77c0d3/integrations/security-authority2/AUTHORITY2_PRIVATE_INITIALIZER_REVIEW_20261115_NOT_RELEASE.md).
- [Existing independent operator ceremony](https://github.com/evansmusitu/mft-axiom-build/blob/68799a41a367865649b833de649edcb26f77c0d3/integrations/security-authority2/B27_INDEPENDENT_OPERATOR_CEREMONY_20261113.md).
- Public config: `AUTHORITY2_PUBLIC_QUALIFICATION_CONFIG_PROPOSED_20261116.json`, SHA-256 `bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3`. The same five fields are the proposed consumer pin.

| Field | Proposed value |
| --- | --- |
| Account | `67469478aa9349fa0a57fe3a72da200a` |
| Worker | `axiom-security-authority2-highwater` |
| Existing R2 bucket | `musitu-axiom-b27-highwater-a2` |
| Disposable qualification ledger | `axiom-b27-a2-qualification-20261116-6792c82b245cd450` |
| Disposable qualification namespace | `ax-a2-qualification-20261116-6792c82b245cd450` |
| Signer ID | `a2-ed25519-6792c82b245cd450` |
| Public SPKI SHA-256 | `6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a` |

These new public ledger/namespace/key identifiers are proposals for a disposable qualification. They are not discovered production state, and namespace non-use has not been provider-verified. The config is not installed in any Worker or product consumer.

## Behavior and existing evidence

The temporary initializer exposes no public HTTP entry, enables no route/preview/cron in the review configuration, requires a short independently approved schedule, checks private/public key correspondence before state access and leaves ambiguous or expired attempts on HOLD. After genesis, retirement must restore the exact original serving bundle, preserve state and remove all temporary bindings and triggers.

Existing CI at this source passed 190 synthetic and 35 genuine local workerd/SQLite checks. Build/native Windows CI passed both review builds and six PowerShell checks. The required custody/global rollback veto remains FAILURE. These results do not prove actual provider custody or destructive recovery.

The proposed public config was checked against the actual downloaded DER, exact Git-blob-verified original serving parser, deterministic DO object name and original R2 key function. Dispatch in that check was a local synthetic stub: no Durable Object, R2 object or network request was invoked. An initial local materialization added a final newline and failed the byte guard before execution. Exact base64 Git blobs corrected only those bytes; the guard stayed in place, and the correction record is retained.

## Decision requested

Record **APPROVE**, **REJECT**, or requested changes for the pinned PR192 source, temporary initializer/retirement design and this exact disposable public-identity proposal. A reviewer role assignment or the key-purpose declaration is not this source/configuration decision. A decision can be recorded directly in chat or in the draft PR; no private key or token should accompany it.

Source/config approval alone does not authorize a production identity or establish signer custody. Actual operator-held key correspondence, administrator/recovery separation, restricted build credentials, private provider access, unused namespace readback and a fresh independently approved immutable genesis commitment are still prerequisites to a private hosted run.

The freshly queried connected operator service reports `UNAVAILABLE`, external execution authority false and production authority false. This environment cannot substitute builder credentials or builder custody and label that independent operator acceptance. The owner continues private Cloudflare actions in his own browser; no agent-browser authentication retry is planned.

Once those prerequisites pass, the next run is disposable hosted genesis/retirement, signed bootstrap and separate-role readback, consumed-sequence replay, stale DO restore, ambiguous/lost acknowledgements, abort after external commit, revoked credentials and independent recovery. Preserve actual provider-origin receipts and verify that no second permit issues. Full-stack staging/OAuth/MCP acceptance and PR83's retained veto remain a later dependency within Gate 3.

Gate 2 stays CLOSED. Main, separate draft PR1 and the other candidate branches are preserved. No Cloudflare mutation, live identity activation, private-key transfer, payment, paid upgrade, merge or release has occurred.

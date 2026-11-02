# Owner-selected staging D1 reuse: continuation 08

The owner selected inventory database #1: **mft-axiom-claude-staging-20260927**,
UUID `a7384b8a-0751-4705-ac77-0616b0885e7c`. Its existing Claude staging Worker
remains bound to it. The acceptance uses the same physical database, with all
new objects under `axiom_q06_`. No database was created or deleted.

**Seven live Cloudflare D1 checks passed** at source
`168dbaa3a04433b553847e149cc670b0efdf0317`,
[workflow 41343885986](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41343885986).
This confirms the owner's selected staging namespace, not a separately isolated
database or independent security authority.

| Live behavior | Actual observation |
| --- | --- |
| Migrations and Work execution | Canonical execution/lifecycle schemas applied in the namespace; actual decision returned expected utility 28 with verified receipt |
| Observer interruption | Creation response cancelled; authenticated GET recovered COMPLETED with one durable reservation |
| Tenant isolation and replay | Equal inputs under alpha/beta produced distinct tasks; cross-tenant GET returned 404; same-tenant replay returned the original receipt |
| Atomic batch rollback | Second duplicate insert failed; first insert was rolled back; zero fixture rows remained |
| Concurrent call budgets and Work revocation | Exactly one provider reservation and one compute reservation won under their one-call caps; revoked Work refused further admission |
| Credential revocation and restart | Redeployed Worker rejected old alpha credential; expired lease was fenced; one contender reclaimed it; saved beta receipt survived and matched a fresh Node process |
| Evidence lifecycle | Legal hold blocked erasure; owner release preceded verified export; logical erasure retained commitments and returned HTTP 410; repeat returned the same receipt |

The budgets above are durable **call reservations**, not currency/token limits.
No model inference, hosted Agents session or protected compute dispatch occurred.
The decision result replays declared inputs; it is not factual or source attestation.

## Original data and cleanup

Before writes, the runner checked the exact selected UUID/name and existing
Worker binding. It hashed original SQL object definitions, every row of each of
the six original user tables, and the original Worker settings. All six original
tables were empty; their definitions, records and Worker settings matched after
acceptance. Original legacy values were never logged or exported.

The before/after legacy commitment is
`29f40dc6a0afb5fe06b55ce7fbd42783ec3d271421e5c8a88d6cd8c27779a2fb`.
Namespace collisions hold rather than silently replaying the one-shot acceptance.
The qualification Worker rejects attempts to access legacy tables or mutate
unowned table names. This is an authenticated qualification transport, not a
general-purpose SQL sandbox or production authorization service.

The temporary `axiom-acceptance-20261101-06` Worker was deleted. The runner and a
separate workflow cleanup step both obtained provider readback of absence (404).
The selected DB, its original staging Worker and the namespaced acceptance
records remain. Global edge revocation is not independently attested.

## Exact evidence verification

Root downloaded artifact `13097459233` and checked ZIP SHA-256
`d9df2b87cfc62798a742879173b13212a9a5d1891fb28124e36f1c1246cbcc86`
and every manifest entry. It independently verified output/result commitments,
the numerical decision result, the lifecycle export and the fresh-process
receipt against the original exported beta completion.

The rebuilt Worker bundle matches the live report:
`c3792654f689fd1eda5527695be53ebf2005f867169c41934f3d4b11a34d1e34`.
The alpha decision receipt is
`16908122e19e7c11bec4afcb039f2908ab9e93693b845e01b47d29a1bfc05129`;
the recovered observer receipt is
`83c27d4c6bbebca24d0c4fbca278353102c4cb1cd2ea76239bf1bc197be0065d`;
the fresh-process beta receipt is
`c5c8cc7cf4d575cf396424ad0fdf17aae339684d9cb17b309a50ada409ecf3de`.

All **21 integrated groups** also passed on the live source in
[CI 41343886169](https://github.com/evansmusitu/mft-axiom-build/actions/runs/41343886169),
including 495 application, 73 SDK, 11 local D1, 12 storage transport and six hosted
protocol tests. The 22 ledger regressions still include the deliberately
reproduced authority-admin backup rollback counterexample. Root verified the
downloaded CI ZIP hash
`863e45cefa40eb90d02e5b5139b5ac110852bca65d20d08e1e66a0a476804640`
and all 21 zero exits. Source tree
`b2be0d2095e0104493d630b59fc9577d7c60be62` matches the tested merge tree at
`78c0d240b6a184d6f85bc391ae6c4a3859fc38a8`.

The earlier CF7406 fresh-database capacity failure remains historical evidence;
it was bypassed through the owner's explicit reuse choice, not deletion or a
plan upgrade. No billing setting changed and no zero-invoice claim is made.
Provider-confirmed cancellation/final usage, independent custody and an
independently anchored authority recovery remain unresolved. PR #55 remains
draft; merge, production deployment and publication remain blocked.

# Actual customer/IdP staging schema operation passed

Actual hosted run42298449469/job128169687556 succeeded from reviewed source
60d1de79a220017e008b3002982de71bbf660c0b. On selectedccc473f1 it proved the
complete73-statement forced DDL rollback, then applied all20 customer/IdP tables
and receipt atomically. The original three user tables/index and zero user rows
were preserved. Application outcome is APPLIED_AND_VERIFIED, not an inference
from local tests. No production OAuth binding or data was modified.

After a real redeployment and operator-secret rotation, old-token requests
returned401 and the persisted schema/receipt verified at the new epoch. The
driver deleted only its newly owned temporary Worker and read404. A separate
admission-gated cleanup also confirmed absence without deleting the database.
All actual results, transport statuses, ownership hash and exact decoded logs
are retained. No secret/token/private customer values were published.

Source CI42298449482/job128169689271 passed222 Node,134 Python and17 real local
workerd tests. Independent admission additionally passed18 adversarial methods.
The original rollback-classification, uncertainty and cleanup-gate defects,
earlier holds and runtime failure remain preserved with their repairs.

This closes the controlled hosted customer schema application, atomic DDL
rollback, schema redeployment persistence and temporary operator rotation/cleanup
checks. It does not qualify full hosted backup/restore, real tenant/session
acceptance, budgets, the production OAuth89-statement upgrade, real IdP login/
production ownership/continuity, execution/cancellation/final usage, Paynow/device
acceptance, custody/anti-rollback/destructive recovery, integration or release.

Fresh execution router remainsUNAVAILABLE and authorityfalse. Separate PR83
advanced tofdc89d4; fullstack42292436148 still fails at the deliberate legacy
production-writing adapter guard. Mainb10a74b, PR1 separately/rejection and PR55
stay unchanged. No product merge, deployment or publication is implied by the
temporary qualifier. Preserve $0, Paynow authority, existing customer/q06 data,
full breadth and rollback origin. B27=FAILED_IN_SYNTHETIC_ATTACK;
parity/superiority=NOT_CERTIFIED; unavailable final usage=UNKNOWN.

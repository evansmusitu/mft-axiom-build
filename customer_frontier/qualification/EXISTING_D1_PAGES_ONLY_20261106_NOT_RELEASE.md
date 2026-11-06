# Pages-only follow-up before existing D1 reuse

The user authorized reuse of an existing D1 database. PR90's actual catalog and
Worker audit confirmed zero database writes and inspected67 scripts and67
service environments. Its first Pages request returned HTTP400. That result
remains sealed as PARTIAL_OBSERVATION; this follow-up does not rerun those
catalogs or Workers and does not assert a cause for the400.

Current official Wrangler66bc0d6f353904f8a203bcea9298d9f45fbd234a,
pages/projects.ts blobc27086db0a592871e8f34fc8fe5142a0a2bab7ca,
and its list tests explicitly use per_page10 and page1. This follow-up matches
that query, validates optional pagination counters and totals when present,
rejects duplicate/injected names, and requires an empty terminal page. It then
reads current production/preview D1 maps through validated project-detail GETs.
No SQL, customer rows, Worker calls or resource mutations are admitted.

All calls remain in the fixed account, with no redirects, maximum200 GETs,
240seconds,2MB responses,160 projects and4096 safe reference projections.
Only matched candidate IDs and hashes of consumer/environment/binding names
are emitted. No private labels, error messages, env_vars, raw config or token
are logged. Actual integer error codes include valid seven-digit Pages codes,
which the prior narrow numeric filter could have discarded. If this request
also fails, retain its real status/codes and UNKNOWN scope without a retry.

Independent review verified sourcefe3b6712312062fdf4c9cd81a74d3504443632df
and the exact workflow9b4a89d5d03f6b8f22c373d0781f5ba099c048bab342f61f960a2015d5c432eb.
11 supplied and10 independent adversarial test methods passed offline with
sockets denied; no remaining P0–P2 blocker was found for this bounded GET-only
observation. Published bytes must match the reviewed workflow before execution.

Current Pages configuration coverage does not cover historical deployments or
external D1 callers. No target, private exposure, backup/restore, migration or
release admission is implied. The offline object-name hash comparison is an
assessment against retained catalogs, not a fresh write preflight. Existing
customer data, q06, production rollback origin, Paynow authority and$0 persist.
PR1 remains separate with its recorded safety rejection. B27 remains
FAILED_IN_SYNTHETIC_ATTACK; parity/superiority NOT_CERTIFIED; final usage UNKNOWN.

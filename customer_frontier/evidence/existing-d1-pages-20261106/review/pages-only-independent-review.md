# Independent review: Pages-only current D1 bindings

**PASS for the bounded Pages-only GET observation. No remaining P0–P2 blocker found.** No target, restore, migration or release qualification is granted.

Reviewed immutable source `fe3b6712312062fdf4c9cd81a74d3504443632df`, tree `95fe9712005471af8427be74ce78e1b4e5b5b871`, parent `8c969eb4848fe8fa43ed16935a27a85639bcccb2`. Independent exact-ref GitHub source/test reads matched local bytes, SHA-256 and Git blob identities.

| Artifact | SHA-256 |
| --- | --- |
| Reader | `ee37d5ccc05314dbd6c2160491d9ea216ecd1730a294e2aaa58af9558b92e650` |
| Supplied tests | `4a7773f5c66c3e579c697960382af847792bfe7325664b73b455683e5606f4ab` |
| Reviewed local workflow | `9b4a89d5d03f6b8f22c373d0781f5ba099c048bab342f61f960a2015d5c432eb` |

Confirm the published immutable workflow matches that exact hash before opening the credentialed PR. Its source checkout is fixed; checkout identity and reader/test hashes are checked and offline tests run before the sole Cloudflare token step. Admission requires opened event, first attempt, same repository, exact Pages/audit branches and base SHA `8c969eb4848fe8fa43ed16935a27a85639bcccb2`. Checkout and artifact actions are pinned, checkout credentials are not persisted, and repository contents permission is read only.

11 supplied test methods and10 independent adversarial test methods passed with sockets denied. Raw logs: `pages-only-existing-tests.log` and `pages-only-adversarial.log`; independent harness: `pages-only-adversarial.py`. Static identity and workflow checks passed in `pages-only-static-verification.log`.

Independent probes exercised160 projects with17 list requests and160 detail GETs (177 total),161 projects blocked before any detail calls, optional totals present on only one page, counter type/stability/aggregate contradictions, seven-digit error-code retention and type/range filtering, production and preview candidate references, private-label/token/config/error-message non-disclosure, path injection, wrong detail identity, invalid/oversized JSON, null/wrong-key bindings, deadline, missing token and redirect refusal.

Only fixed-account GETs are admitted: literal `per_page=10&page=1..17`, matching current Wrangler's page size, and detail paths for validated listed names. The implementation performs no SQL, Worker/catalog rerun, export, creation, mutation, migration, deployment, grant, deletion or billing operation. It bounds requests at200, request-start time at240 seconds, response size at2MB, projects at160 and references at4096. It requires an empty terminal list and coherent optional pagination metadata. Unknown, malformed, denied and partial responses do not become successful observation. Actual integer provider codes1000..2147483647 are retained (at most20), with no raw messages or bodies.

This review made zero provider calls and no root-source edits. The prior actual HTTP400 remains evidence until a new hosted observation changes the Pages result. A successful current-config scan does not cover historical deployment snapshots or external D1 clients and cannot prove globally unused/private status. All target-admission, global-absence, backup/restore, migration, release and historical-coverage flags remain false. Root retains live drift checks and PR1/$0/Paynow/customer-data/q06/rollback authority preservation.

B27 remains `FAILED_IN_SYNTHETIC_ATTACK`; parity/superiority remains `NOT_CERTIFIED`; unavailable final usage remains `UNKNOWN`.

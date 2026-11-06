# Fresh hosted preflight — not release acceptance

Main remains b10a74b435feb25654d4cf67ba67d09602698a3e. Customer source is
PR82 head 94ae644cd8d57f188dea10222907bc092165025f, tree
275b7db6b108a83b92124fa9a149aa68d6a9ca0f. PR1 remains separate, draft and
unmerged. This new isolated readback does not alter any original sealed job,
the q06 namespace, production rollback origin or release decision.

Concurrent Frontier PR80 remains draft/unmerged at
253cd98581de7c56b302efec52b802626cd08659. Fresh readback found its Full-Stack
run 42163693874 completed as cancelled, not passed. Its other listed checks
passed, but those do not supply the missing full-stack/release qualification.

The actual main-branch read-only legacy schema audit, run 42166378062,
job 127723705761, failed at its first database-list GET with HTTP401,
Cloudflare code10000 Authentication error. The saved legacy email/global-key
pair was present but did not authenticate. No table read, SQL, migration or
resource mutation was reached. This failure does not establish whether the
separate API token works. The original decoded GitHub job log is retained in
the adjacent evidence directory with a hash/provenance receipt.

The new workflow uses the existing CLOUDFLARE_API_TOKEN with the unchanged,
previously reviewed metadata script and its 13 unchanged offline tests.
It checks out the fixed PR82 commit, verifies the checkout and both SHA256
hashes before injecting the token into one step, and admits only a first
opened PR event from this repository's exact isolated branch onto the exact
PR82 base. No arbitrary head source executes with the token. Actions are
commit-pinned, checkout credentials do not persist and job permissions are
contents:read. The script confines authorization to four fixed GET paths on
Cloudflare's API, rejects redirects, bounds response size/time and emits only
allowlisted metadata. No provider response body or credential is logged by
the script. The selected resources remain:

- Account: 93f395f5121954671f92fffa453d6b61.
- D1 UUID: a7384b8a-0751-4705-ac77-0616b0885e7c.
- D1 name: mft-axiom-claude-staging-20260927.

METADATA_OBSERVED means only that these fixed metadata observations completed
and agreed. It does not prove schema, customer identity, ownership, backup,
restore, tenant isolation, OAuth migration, provider execution or release.
The earlier real q06 acceptance concerns a different component/table scope;
its hashes/counts snapshot is not a restorable backup. Preserve that namespace.
The existing q06 RPC intentionally rejects new customer/session tables and
DROP/ALTER; do not expand it silently or use it to evade migration gates.

After actual access and schema readback, the customer migration requires a
real restorable backup and verified restore, an owned isolated target/marker,
exact parent table/trigger validation, and the exact OAuth upgrade plan in one
actual D1Database.batch. Local rollback tests and metadata are prerequisites,
not hosted acceptance. No migration is executed by this readback.

Existing Paynow authority and the $0 constraint persist. B27 remains
FAILED_IN_SYNTHETIC_ATTACK; parity/superiority remain NOT_CERTIFIED;
unavailable aborted-provider final usage remains UNKNOWN.

Independent software review fetched the fixed script/test from GitHub and
matched both blobs and SHA256 pins, parsed the workflow, and reproduced all
13 offline tests. Its bounded recommendation is no blocker for this exact
read-only run; it is not custody or hosted acceptance. The reviewed workflow
SHA256 is bb0734da5006a7e8389ea5b653dc52723cdb7aefd1bcd4c0b3f47e0c6d6b2ad0.
The receipt and independent raw test log are retained beside the legacy failure.

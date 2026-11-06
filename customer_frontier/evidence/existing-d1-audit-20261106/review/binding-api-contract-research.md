# Current binding/exposure API contracts for existing D1 reuse

Read-only primary-source research; no Cloudflare calls, account changes or root
source edits. The live inventory was independently read through GitHub job
127957034670 (run42236980431):11 databases, all reported nonempty, no metadata
candidates. The three IDs supplied by the coordinator match the retained
observation. This is not target admission or restore qualification.

## Cloudflare Pages

Fresh official cloudflare/cloudflare-typescript main:
`0eb9ef0ea40c1fe38e4b19be92f41bd7466bc1d6`.

- `src/resources/pages/projects/projects.ts`, blob
  `36c6106329fe10162e3412622d7fd35f48bffa46`.
- `src/core/pagination.ts`, blob
  `1411fafbf806422090fd43277079b4bd35ba3411`.
- Deployment API source, blob
  `609e5eea26ea6c77add966fceac25af0a15a4c00`.

Supported metadata GETs:

- `/accounts/{account}/pages/projects?page={page}&per_page={per_page}`.
- `/accounts/{account}/pages/projects/{projectName}` for exact project detail.

List returns `result: Project[]`. Each Project has `id`, `name`, and required
`deployment_configs` containing `preview` and `production` configurations.
Each configuration has optional
`d1_databases: { [bindingAlias: string]: { id: string } }`.
The UUID field is **id**, not database_id. In the response Project type, the map
values are objects; null values occur in create/edit input types, not the
response D1 binding type. Malformed/null response shapes should stay unknown.
The configurations also include env_vars which may hold private plain-text
values. Never print/save raw configurations or env_vars; emit only safe D1
reference projections and redacted labels needed for the selected IDs.

Pagination uses `V4PagePaginationArray`. Its generated TypeScript result_info
type declares only optional page/per_page. However, the canonical REST API
reference explicitly documents optional count/page/per_page/total_count/
total_pages. The SDK
increments page and stops when the result array is empty. A bounded equivalent
should request increasing pages, validate echoed page/per_page when present,
reject duplicate projects/repeated pages and stop only on a witnessed empty
terminal page. Reaching a page/request/time cap is incomplete, not a terminal
page. Do not require optional totals when absent, but validate their types,
cross-page consistency and agreement with the observed aggregate/terminal when
they are present. Ignore no contradictory provider totals. The stronger REST
source is https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/ .
This corrects the earlier SDK-only research, which did not cover those optional
REST fields. Initial audit source9ac accepted contradictory totals as a fully
observed current scope; its reproduction is retained in audit-pagination-counter-repro.py/.log.

Current project configs do not prove bindings of every historical deployment
that may remain reachable. The generated Deployment response type does not
expose d1_databases/deployment_configs. Project canonical_deployment and
latest_deployment identify deployments but do not supply those binding maps.
Therefore label this a current-project-configuration scan, not global unused
database proof.

## Worker service environments

Fresh official cloudflare/workers-sdk main:
`66bc0d6f353904f8a203bcea9298d9f45fbd234a`.
The two relevant blobs are unchanged from the earlier c64fdfba snapshot:

- `packages/deploy-helpers/src/deploy/helpers/download-worker-config.ts`, blob
  `9ea30bb026ed71a727f195fe091257f97a01649b`.
- `packages/workers-utils/src/types.ts`, blob
  `641764b7fb8f25e3c2a179b374025aa154de562f`.

Current init.ts and deployments.ts independently use the service metadata GET:

- `/accounts/{account}/workers/services/{workerName}`.
- `/accounts/{account}/workers/services/{workerName}/environments/{environment}/bindings`.

ServiceMetadataRes is an object with id, default_environment.environment and an
environments array whose entries have environment plus creation/modification
timestamps. Audit the default environment as well as enumerated names; do not
assume the default is always in that array or hardcode production on malformed
metadata. Binding GET is typed as WorkerMetadata['bindings'], an array. A D1
entry is `{type:'d1', name:string, id:string}`. Other entries may contain private
plain-text values and must never be logged or saved. Keep only target-matching
D1 references or safe counts/hash projections.

These service paths are used by current Wrangler even though current generated
Cloudflare TypeScript resources/public reference do not enumerate Services.
This proves supported caller paths/shapes; it does not prove listWorkerScripts
is a complete enumeration of all service namespaces, environments or external
D1 callers. A service metadata403/404 or unknown shape is uninspected/unknown,
not proof of no bindings. Script settings only describe inspected scripts;
Pages only describes inspected current project configurations.

## Safe interpretation

Keep source-specific completeness fields, not one global unused flag. An audit
can establish observed script settings, environments of those services, and
current Pages references. It cannot prove no external D1 HTTP consumer or
historical deployed consumer exists. Actual target reservation, private-data
exposure, table-name collision checks, preservation of all foreign objects,
private backup, restore and migration require their own evidence. Additive
reuse must not be relabelled as a destructive whole-target-database restore.

The parent-reported three small targets are correctly treated as read-only
audit candidates, not empty or disposable:

| ID | Reported tables | Bytes |
| --- | ---: | ---: |
| 2571795a-80fe-4f63-9b95-07948b4cefdb |1 |24576 |
| 8cb4d319-6008-4ba8-aba1-563c6d836ce8 |2 |20480 |
| ccc473f1-fbb5-4b8d-8a24-45f3696ac10f |3 |40960 |

Exact SDK snapshots are retained in binding-primary-*.json. The Pages and
Worker source commits above override prior moving-main assumptions; no current
Cloudflare provider response was inferred from SDK types.

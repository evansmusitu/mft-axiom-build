# Pages HTTP400: bounded primary-source diagnosis

The parent reports run42243560034/job127979820881 returned confirmed read-only catalogs for all three candidates and observed67 listed Worker/script/service scopes, while the first Pages request `?page=1&per_page=100` returned HTTP400. This researcher made no provider calls and did not independently retrieve that job; preserve the root's actual raw log as the evidence. Pages remains UNKNOWN and every reuse/qualification flag remains false.

## Current primary implementation

Fresh official Workers SDK main is still `66bc0d6f353904f8a203bcea9298d9f45fbd234a` (tree `383effa29979328c19e0ea3da8067ff1b985416a`). In `packages/wrangler/src/pages/projects.ts`, blob `c27086db0a592871e8f34fc8fe5142a0a2bab7ca`, `listProjects` lines78–103 sends a GET to `/accounts/{accountId}/pages/projects` with URLSearchParams in this order: `per_page=10&page=1`, incrementing page thereafter. It uses a page size of10 and stops when a page contains fewer than10 results. Its fetchResult call supplies empty init options, so it is a GET with no body.

The official `project-list.test.ts`, blob `da22c071296e0b3f3a729fef011a26d18064c768`, lines181–193 explicitly checks page size10, sequential page values, matching account and empty request body.

The current REST reference describes optional page/per_page but supplies no maximum in that query section. It also demonstrates the no-query GET. Thus HTTP400 with100 is consistent with unsupported list options, but that cause remains an inference until actual safe provider evidence establishes it. No claim that100 is a documented valid value or that10 will certainly succeed is justified.

## Lost provider-code detail

The reviewed audit retains integer error codes only through999999. Official Wrangler's same projects.ts handles seven-digit Pages error code8000007 as project-not-found (lines135–136). The audit can therefore output an empty code list even when a valid seven-digit Pages code exists. HTTP400 with `provider_error_codes=[]` does not prove the body contained no code. This loses diagnostic detail while keeping the scope fail closed; it does not turn the partial result into permission or absence evidence.

## Minimal follow-up

1. Run a fixed-account Pages-only GET `/pages/projects?per_page=10&page=1`, matching current Wrangler. No catalogs or Worker requests need repetition. If this still returns400, an independently bounded no-query `/pages/projects` request matches the REST example and can distinguish query sensitivity; a lone unpaged response must not certify completeness.
2. On successful paginated response, enumerate only admitted page numbers with10 per page to an empty terminal page under explicit project/request/time/response bounds. Empty-terminal completion is stronger than Wrangler's short-page stopping rule. Keep duplicate identity checks and optional echo/total coherence; recompute total_pages using10. If the bound is exhausted or a scope fails, retain UNKNOWN.
3. Read only admitted project details and inspect current production/preview `d1_databases[alias].id` maps. Missing optional maps can be empty; null/malformed maps or IDs remain UNKNOWN.
4. Emit request variant, HTTP status, success/result shape flags, bounded pagination counts, hashed project/environment/binding labels and candidate UUID references. Retain only actual integer provider error codes (e.g.1000..999999999, at most20); the seven-digit Pages range must not be discarded. Never emit raw response bodies, error messages, env_vars, settings, source/deployment metadata or private labels.

The source snapshots and independently checked Git blob/content hashes are retained in `audit-pages-primary-*.json` and `audit-pages-diagnosis-manifest.json`. Current config observations still omit historical deployment binding snapshots and external D1 users; this follow-up cannot admit a restore target or prove globally unused/private status. Two candidate Worker references reported by the parent remain material; absence for the third applies only to the observed Worker scope.

Primary URLs: https://github.com/cloudflare/workers-sdk/blob/66bc0d6f353904f8a203bcea9298d9f45fbd234a/packages/wrangler/src/pages/projects.ts and https://github.com/cloudflare/workers-sdk/blob/66bc0d6f353904f8a203bcea9298d9f45fbd234a/packages/wrangler/src/__tests__/pages/project-list.test.ts ; REST: https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/ .

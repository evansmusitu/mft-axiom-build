# Approved Axiom OpenAI EWMA naming correction

The title-only deployment succeeded in run 40571922853, but the fresh OpenAI rescan still flagged the unchanged action name `ewma_forecast`. The user's request to complete the remaining review items now proceeds with the narrow public action correction to `ewma_smoothing`. Existing authenticated `ewma_forecast` calls and legacy `tool:ewma_forecast` fetches remain supported. The new public name forwards to the same original core action and `timeseries.ewma` operation; arguments, authentication, metering, output pruning, titles and other tool metadata remain unchanged.

The current exact-message trigger is `Deploy approved Axiom EWMA action name 20261027`; it runs `deploy_ewma_name_only.py`. Its baseline live SHA-256 is `180d7c32754e656309616836fb564438a5c4a9843759e8838c333dd99c43ad30`; its reference candidate is `f101e0af1dadb52424733a3ecd276d7ab8baa850ba1edf127950087a22504593`. The patch changes three exact source seams, with complete reversal verification. It retains the content-only write, source/settings guards and rollback protections from the prior deployment. A gateway/core contract check verifies canonical and legacy lookup, both authenticated call paths, exact input forwarding, unauthenticated denial and response pruning. A further eight deployment checks cover drift, ambiguous responses, rollback and metadata preservation. No Worker configuration, credentials, ledger or other service is changed.

## Prior completed title correction

The user requested completion of the remaining review items on 27 October 2026, after the exact display-title correction had been proposed. This authorizes the prepared change from `Ewma Forecast` to `Exponentially Weighted Moving Average`. The action name `ewma_forecast`, its operation mapping, all descriptions, schemas, safety annotations, scopes and behavior remain unchanged.

The current workflow runs only for the exact message `Deploy approved Axiom EWMA title 20261027`. It invokes `deploy_ewma_title_only.py`, with the previously tested content-only Cloudflare client. The live source must match SHA-256 `4396cfd20d63f781b914eae260bca1e1fb033bf2ba4a879b3fb6e4a0d8463042`, or the mechanically verifiable already-patched equivalent. Only one exact source seam is changed, and reversing it must recover the original bytes. The prepared reference candidate has SHA-256 `4a2e37c1b2e162dfa878c46333fb582b4c3aa977e467a8ca9326b89cf1a3536e`.

Fresh source and settings are checked immediately before writing. Readback, unchanged settings/resource metadata, all 108 tool definitions except the one title, search/fetch propagation, OAuth enforcement and hidden-commerce denial must pass. A failed verification rolls back only this job's exact candidate, never another operator's code. No additional live wrapper code is exported. The workflow runs the existing 20 checks, the public title comparison, and eight title-deployment safety checks.

The description-only deployment below is historical and completed successfully in run 40526638623. Do not rerun its original deployment command. OpenAI review notices, private reviewer access, actual prompt routing and the walkthrough requirement remain separate from this title correction.

## Prior completed description correction

This isolated branch is an execution package, not an integration branch and not a whole-product release. It must not be merged into main. Its intentionally small tree contains only the approved candidate, pinned baseline collaborators, tests, and the one deployment workflow; unrelated historical workflows cannot run on this branch.

The user explicitly approved deploying the prepared description-only fix on 27 October 2026. The frozen candidate SHA-256 is `0567a2849ce6a2cfe9798d79984efb1f1cf375f0af5915781083029b95e5d56f`; the approved baseline SHA-256 is `eaaa24b56d58c71cc5afba8d88e7773e9e399b77a7d73b5c5bef0bee624b50ae` from repository commit `8662e6f496477347ea14b4fe6936c495d3606bd5`.

The prior description job ran on this exact branch with commit message `Deploy approved Axiom tool descriptions 20261027`. It used existing repository Cloudflare secrets without exposing them, and permitted only the content-only PUT for the existing `musitu-axiom-mcp` Worker. It did not create a Worker, alter bindings, secrets, routes, OAuth ledgers or accounts, or deploy a core or authentication worker.

Source drift stops the job before any write. The previous source is retained when it matches the pinned baseline. Readback must match the approved candidate. All 108 public tool definitions must remain identical except descriptions, settings and protected-resource metadata must match their prior values, hidden commerce and unauthenticated execution must remain denied, and the reviewer's time-series search phrase must work. A verification failure rolls back only if the live source is still this job's exact candidate.

The scoped token readback found an existing module with SHA-256 `48c87d308255a2c91fa4280ab007e743b8621174a8f9c10f7b25315895e054de`. The exact approved publicDescription function occurs once in that module. The deployer recognizes only that precise additional baseline, prepends the same approved description map, and replaces only that byte-identical function. Reversing those two changes must recover every original byte. All additional current code is preserved. The effective candidate hash is recorded at deployment; current module bytes remain in memory for guarded in-job rollback, and only public patch material is retained in the rollback recipe.

GitHub Actions evidence establishes the deployment result. Do not infer success from a queued job or a source commit. OpenAI's separate rescan and review requirements still apply.

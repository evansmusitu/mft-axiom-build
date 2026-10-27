# Approved Axiom OpenAI description deployment

This isolated branch is an execution package, not an integration branch and not a whole-product release. It must not be merged into main. Its intentionally small tree contains only the approved candidate, pinned baseline collaborators, tests, and the one deployment workflow; unrelated historical workflows cannot run on this branch.

The user explicitly approved deploying the prepared description-only fix on 27 October 2026. The frozen candidate SHA-256 is `0567a2849ce6a2cfe9798d79984efb1f1cf375f0af5915781083029b95e5d56f`; the approved baseline SHA-256 is `eaaa24b56d58c71cc5afba8d88e7773e9e399b77a7d73b5c5bef0bee624b50ae` from repository commit `8662e6f496477347ea14b4fe6936c495d3606bd5`.

Only a push to this exact branch with commit message `Deploy approved Axiom tool descriptions 20261027` runs the deploy job. It uses the existing repository Cloudflare secrets without exposing them, and permits only the content-only PUT for the existing `musitu-axiom-mcp` Worker. It does not create a Worker, alter bindings, secrets, routes, OAuth ledgers or accounts, or deploy a core or authentication worker.

Source drift stops the job before any write. The previous source is retained when it matches the pinned baseline. Readback must match the approved candidate. All 108 public tool definitions must remain identical except descriptions, settings and protected-resource metadata must match their prior values, hidden commerce and unauthenticated execution must remain denied, and the reviewer's time-series search phrase must work. A verification failure rolls back only if the live source is still this job's exact candidate.

The scoped token readback found an existing module with SHA-256 `48c87d308255a2c91fa4280ab007e743b8621174a8f9c10f7b25315895e054de`. The exact approved publicDescription function occurs once in that module. The deployer recognizes only that precise additional baseline, prepends the same approved description map, and replaces only that byte-identical function. Reversing those two changes must recover every original byte. All additional current code is preserved. The effective candidate hash is recorded at deployment; current module bytes remain in memory for guarded in-job rollback, and only public patch material is retained in the rollback recipe.

GitHub Actions evidence establishes the deployment result. Do not infer success from a queued job or a source commit. OpenAI's separate rescan and review requirements still apply.

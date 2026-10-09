# Track B — Binding $0 cash-spend constraint (2026-10-09)

The user's budget is **USD $0**. This supersedes prior $25/$50/$100 pilot proposals.

## Prohibited without a new explicit user budget decision
- Billable Modal cloud provisioning, GPUs, Shared Endpoints, and other metered cloud services.
- Paid or unverified-free LLM inference, even under promotional credits.
- Automatic push-triggered private-repository GitHub Actions CI that could consume finite allowance.
- Public deployments, paid hosting, domain purchases, production promotion or customer traffic admission.
- S3/S4/S5 risk actions absent independent authorization; the budget rule never waives governance gates.

Track B GitHub Actions workflows are **manual-dispatch only** and their jobs are gated by repository variable `AXIOM_TRACK_B_ZERO_COST_CI_ALLOWED=true`. This variable must remain unset until the account owner independently verifies sufficient no-charge included minutes, no-overage billing protection and bounded execution. Setting the variable alone is not certification of free usage.

## Permitted non-production work
- Offline regressions and local read/compute under existing non-metered resources.
- Ephemeral local sandbox operations with isolated scope, no external writes, and verified $0 incremental cash charge.
- Locally running open-weight models only when compatible hardware and absence of incremental fees are verified. Availability is **NOT PROVEN**.
- Repo/source changes in the isolated branch; main, PR #1, frozen OpenAI submission and production remain protected.

The `zero_cost_policy.py` module denies operations outside a narrow S0/S1 local-only allowlist. It is a policy seam, **not** evidence that all existing code paths or provider accounts are independently secured against charging. All external paid pathways remain disallowed by this project's runtime authorization scope.

## Outstanding evidence
- Local open-weight model hardware compatibility: NOT PROVEN.
- Model-driven autonomous OpenHands work: NOT PROVEN.
- Ten independent workers, mass concurrency, public multitenancy: NOT PROVEN.
- External security review, rollback and production qualification: NOT PROVEN.

Zero-cash development must not be represented as zero-resource global production hosting.

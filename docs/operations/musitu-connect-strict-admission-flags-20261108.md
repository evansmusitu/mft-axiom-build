# MUSITU Connect — strict production admission evidence flags (2026-11-08)

**Scope:** source-only fail-closed Python policy correction. This is not customer admission, commercial enablement, a production deployment, or authorization to modify hosted D1/Neon data.

## Problem and resolution

`ProductionAdmissionPolicy.assess()` previously applied `bool(value)` to readiness flags. Truthy **non-boolean** inputs (notably string `"false"`, integer `1`, bytes, or dictionaries) could wrongly qualify a control. `ProductionPromotionAuthorization.is_valid()` likewise treated truthy non-boolean approval as genuine authorization and raised exceptions for malformed authorization identities.

Every required readiness control now qualifies **only when its value is the boolean `True`**, not a truthy coercion. Promotion approval likewise requires actual boolean `True`; authorization ID and authorizing identity must be nonempty strings after trimming whitespace. The safety invariant `enablement_permitted=False` remains unchanged in all states. Missing or malformed evidence continues to block technical readiness or promotion as appropriate.

## TDD and verification

The three new tests in `tests/connect/test_production_admission.py` cover all seven named controls across five truthy non-boolean values, five invalid approval values, and ten malformed authorization identity values. Before changing the policy, the seven-test suite **failed (40 assertions and 10 errors)** for precisely these missing validations. After the policy change, the same suite **passed all 7**.

Related Python suites (`test_production_admission`, `test_runtime_activation`, `test_runtime`, `test_runtime_record_selection`, `test_mining_adapter`) **passed 25/25**. Node customer admission and Neon admission suites **passed 24/24**. `qualification/validate_production_admission.py` returned `MUSITU_CONNECT_PRODUCTION_ADMISSION_GUARD=PASS`; its existing `runtime_enabled=true` refers to previously authorized **general Connect-to-Axiom arithmetic** and must not be interpreted as customer beta authorization or production mine methane prediction.

These local results are from the verified 2026-11-07 source-only product snapshot, with the two edited files proven blob-identical to the live pre-change feature baseline. Independent CI must be checked against the exact new feature commit before claiming broader qualification.

## Preserved restrictions

The feature changes neither live production code nor the deployed runtime. Hosted credentials, D1 and Neon mutation, Connect publication, new tenant/customer admission, methane research model retraining and promotion, and merger of closed PR #9 remain out of scope. The frozen LightGBM qualification thresholds and independent mine-evidence gates remain unchanged.

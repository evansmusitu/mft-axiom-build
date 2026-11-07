# RevenueGuard V4.1 — Postgate Decision and Build-Only Successor Contract
Date: 2026-11-07
Scope: development research only; no production candidate mutation.

## Decision: NOT_ADMITTED

Both specialist training pipelines completed and the locked development evaluations executed successfully. Their gates FAILED. Successful CI execution is not successful model admission. Neither checkpoint may be promoted, used to open sealed benchmarks, or described as certified.

The sovereign frozen V4 ZIP remains identified by SHA-256 `16ce77c048bc39990b9fe338f3090e430b2c8d7f2767efef11369bd3013be85d`. ContractNLI test, official CUAD test, and MAUD remain unopened. Real permissioned companies: 0; verified recovered cash: $0; certification: NOT_CERTIFIED.

## Evidence inventory (verified from GitHub Actions)

| Item | Run | Exact artifact ZIP SHA-256 or model identity |
|---|---|---|
| ContractNLI adapted encoder | 41330633559 | `ea7e9a0cf451ea998cd2b055df93b3a7cbde52654cc1268446e5682f7adb6916` |
| ContractNLI V3 trained checkpoint | 41336589127 | `503d654bbb2aa7a384888f7c2959caaee15a63c6cfde6f4693f1fa08d4f75369` |
| ContractNLI locked-dev evaluation | 41386143344 | report ZIP `edf94dc02ad691df7bf6a831dad9a126f173b2b489cef4ada0becafc0c488340`; internal report `4770d2cad2cdc1faa43706f93a9aa78e80e602d8921c79e5e92560a8f57e3a9f` |
| CUAD source model | 41330640096 | `56588ea336fab987c8246564dfd7ef791ead0e6e459c2bbb76af653e5b00bf19` |
| CUAD matched-window checkpoint | 41386175423 | `adf1b32462a21d1227209de4a55115ea8789ed69bad41b700d5f6f14ce232c07` |
| CUAD heldout evaluation | 41437056573 | report ZIP `6ff7165cbdc688c589256e0e31fb71ca3b18bd4d84a4bbd37696c74c63211dff`; internal report `af27de092b4454ed197ee20eeb00653bcbe0ad0f09ec31892f7810f968fb56e5` |
| Postgate failure mining | 42398144716 | ContractNLI diagnostic ZIP `a32c40898cdd7852b2e62bf05880cdd1cfe3e024f3acb0184106bafd01c1ce23`; CUAD diagnostic ZIP `e4e50b312683a53b6dc114b8dc172f1c76e61efeb26460450c0e578a957ddfcc` |

## Locked gates (all eight criteria failed)

ContractNLI: dev n=1,037; accuracy 0.7531340405 vs >=0.90; macro-F1 0.6803224801 vs >=0.88; false grounding 0.390070922 vs <=0.02; exact evidence recall 0.7931596091 vs >=0.85. Hash-held training calibration n=595, duplicate-equivalent document 548 excluded. Selected K=32 and relevance threshold=0.91 **before** exposed dev scoring.

CUAD: evaluation n=1,160 of 2,461 title-hash heldout questions, calibration n=1,301; no-answer FP rate 0.0315955766 vs <=0.02; answer detection F1 0.5736636245 vs >=0.85; localization overlap recall 0.1233396584 vs >=0.85; answerable token F1 0.1360050794 vs >=0.80. Frozen calibration threshold 2.1496779918670654.

## Observed failure categories (postgate, not independent counts)

ContractNLI: NotMentioned false grounding 165; wrong evidence selection 127; positive abstention 50; semantic polarity flip 41; semantic correctness despite wrong evidence 85. Categories may overlap and do not sum to the number of observations.

CUAD: missed answer by abstention 307; wrong localization among detected answers 155; no-answer false grounding 20; localization with low semantic match 16; partial boundaries/semantics 5. There were 527 actual answerable questions and 633 no-answer questions in the evaluation partition. 307 answerable questions were missed, with only 220 positively detected.

These are measured development errors, *not* permission to train on development or heldout documents. The postgate miner does not change thresholds, predictions, model weights, or the protected archive.

## Next candidate must use build-only evidence and a new identity

1. **Build-only correctness audits:** test ContractNLI training/calibration text-duplicate exclusion and negative-evidence construction; for CUAD verify start/end token mapping, context-offset containment, positive/negative window labels and CLS loss behavior on *build contracts only*. Produce counts and SHAs before any new weight optimization. Keep 45 title-hash heldout CUAD contracts completely outside training/audit sampling.
2. **ContractNLI successor hypothesis:** investigate separating relevance (especially NotMentioned abstention) from semantic polarity, and stronger same-hypothesis confusing negatives. Quantify evidence-candidate coverage and false-relevance on a new internal build-only split. Do not tune K, loss weights, thresholds or training strategy on the already exposed 1,037 dev labels.
3. **CUAD successor hypothesis:** investigate answerable-window selection separately from span localization, positive and no-answer loss balance, and offset alignment. Pre-register window selection and localization scoring, and test against a new build-only validation partition before touching the locked heldout again.
4. **Freeze a new complete candidate:** exact pinned training data, executable code, optimizer checkpoint ancestry, evaluation scoring implementation, calibration protocol and artifact SHA-256. Neither the September nor November checkpoint hash may be reused to label new weights.
5. **Re-run unchanged development gates only after design freeze.** An earlier failed candidate must stay failed in the record. A passing new model (if ever attained) does not itself authorize opening ContractNLI test, official CUAD test or MAUD: all program admission prerequisites must also hold.

This document is a research decision, not an assertion that any proposed successor model has been trained, that the issues are fully solved, or that certification has occurred.

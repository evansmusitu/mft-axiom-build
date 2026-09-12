---
name: musitu-data-quality
description: "Inspect data quality before quantitative analysis. Use for missingness, duplicates, schema drift, invalid ranges, inconsistent units, date errors, outliers, reconciliation, and analysis-readiness."
---
# MUSITU Data Quality
Read `../../shared/QUALITY.md`.

## Workflow
1. Inventory schema and expected semantics.
2. Measure completeness, uniqueness and validity.
3. Check unit, date, currency and category consistency.
4. Detect duplicates, outliers and schema/distribution drift.
5. Reconcile totals and identities where applicable.
6. Classify defects by impact and confidence.
7. Block downstream analysis when defects invalidate results.
8. Return remediation steps and residual data risk.

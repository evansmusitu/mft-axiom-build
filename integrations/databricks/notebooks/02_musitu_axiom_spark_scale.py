# Databricks notebook source
# MUSITU Axiom x Databricks: synthetic Spark numeric validation, no production data.
# One-shot serverless notebook. Jobs timeout is enforced by the submitting workflow.
from __future__ import annotations

import hashlib
import json
import time
from decimal import Decimal

from pyspark.sql import functions as F

SIZES = (100_000, 1_000_000)
CORRUPTION_MODULUS = 17


def _calculate_spark_verdicts(n: int) -> dict:
    started = time.perf_counter()
    # Generate synthetic values in the Spark engine; no personal or proprietary data.
    rows = spark.range(0, n)
    values = rows.withColumn(
        "expected",
        ((F.col("id") * F.lit(37) + F.lit(11)) % F.lit(100003)).cast("decimal(20,4)"),
    )
    values = values.withColumn(
        "observed",
        F.when(F.col("id") % CORRUPTION_MODULUS == 0,
               F.col("expected") + F.lit(1).cast("decimal(20,4)"))
         .otherwise(F.col("expected")),
    )
    observed_bad = F.abs(F.col("observed") - F.col("expected")) > F.lit("0.0001").cast("decimal(20,4)")
    planted_bad = (F.col("id") % CORRUPTION_MODULUS == 0)
    summary = values.agg(
        F.count("*").alias("rows"),
        F.sum(F.when(planted_bad, 1).otherwise(0)).alias("planted_anomalies"),
        F.sum(F.when(observed_bad, 1).otherwise(0)).alias("detected_anomalies"),
        F.sum(F.when(planted_bad & (~observed_bad), 1).otherwise(0)).alias("false_negatives"),
        F.sum(F.when((~planted_bad) & observed_bad, 1).otherwise(0)).alias("false_positives"),
    ).collect()[0].asDict()
    result = {k: int(v) for k, v in summary.items()}
    expected_count = (n - 1) // CORRUPTION_MODULUS + 1
    assert result["rows"] == n, result
    assert result["planted_anomalies"] == expected_count, result
    assert result["detected_anomalies"] == expected_count, result
    assert result["false_negatives"] == 0 and result["false_positives"] == 0, result
    result["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    result["throughput_rows_per_sec"] = round(n / max(result["elapsed_seconds"], 0.001), 1)
    return result


results = [_calculate_spark_verdicts(n) for n in SIZES]
assert Decimal("0.1") + Decimal("0.2") == Decimal("0.3")
assert (0.1 + 0.2) != 0.3

evidence = {
    "schema": "musitu.axiom.databricks.spark-verification.v1",
    "mode": "synthetic-only",
    "spark_runtime": spark.version,
    "results": results,
    "decimal_control_passed": True,
    "floating_point_drift_detected": True,
    "axiom_production_called": False,
}
canonical = json.dumps(evidence, sort_keys=True, separators=(",", ":"), default=str)
evidence["evidence_sha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

# Record real results in the Databricks MLflow tracking service from Databricks serverless.
# The Spark benchmark remains independently valid if MLflow is unavailable.
try:
    import mlflow
    mlflow.set_tracking_uri("databricks")
    with mlflow.start_run(run_name="MUSITU_AXIOM_SPARK_1M_SYNTHETIC_20261027") as run:
        mlflow.log_param("verification_source", "deterministic-synthetic-spark")
        mlflow.log_param("axiom_production_called", "false")
        for record in results:
            prefix = "scale_" + str(record["rows"])
            for metric in ("rows", "planted_anomalies", "detected_anomalies",
                           "false_negatives", "false_positives",
                           "elapsed_seconds", "throughput_rows_per_sec"):
                mlflow.log_metric(prefix + "_" + metric, record[metric])
        mlflow.set_tag("musitu.pilot.evidence_sha256", evidence["evidence_sha256"])
        evidence["mlflow_run_id"] = run.info.run_id
    evidence["mlflow_status"] = "RECORDED"
except Exception as exc:
    evidence["mlflow_status"] = "UNAVAILABLE"
    evidence["mlflow_error_type"] = type(exc).__name__

print("MUSITU_AXIOM_SPARK_SCALE_SYNTHETIC_PASS")
print("MUSITU_AXIOM_SPARK_VERDICT=" + json.dumps(evidence, sort_keys=True))
dbutils.notebook.exit(json.dumps(evidence, sort_keys=True))

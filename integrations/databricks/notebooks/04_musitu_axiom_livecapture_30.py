# Databricks notebook source
# MUSITU Axiom x Databricks - 30 live Axiom results versus independent oracles
# Captured on 2026-10-28 through connected MUSITU Axiom tools.
# No live Axiom service credentials are present in this notebook; NOT a production MCP integration.
from __future__ import annotations

import hashlib
import json
import math
import statistics
from decimal import Decimal, localcontext

RECORDS = json.loads('''[{"id":"npv_01","operation":"finance.npv","args":{"rate":0,"cashflows":[-1000,120,240,360,520]},"axiom_value":240,"verified":null},{"id":"npv_02","operation":"finance.npv","args":{"rate":0.005,"cashflows":[-1500,200,300,450,800]},"axiom_value":223.54228510674318,"verified":null},{"id":"npv_03","operation":"finance.npv","args":{"rate":0.035,"cashflows":[-500,40,40,40,40,450]},"axiom_value":25.811093430824876,"verified":null},{"id":"npv_04","operation":"finance.npv","args":{"rate":0.075,"cashflows":[-10000,2600,2600,2600,2600,2600]},"axiom_value":519.3007451959763,"verified":null},{"id":"npv_05","operation":"finance.npv","args":{"rate":0.15,"cashflows":[-100,50,55,60]},"axiom_value":24.517136516807774,"verified":null},{"id":"npv_06","operation":"finance.npv","args":{"rate":0.325,"cashflows":[-250,110,80,65,50]},"axiom_value":-77.24870638431294,"verified":null},{"id":"npv_07","operation":"finance.npv","args":{"rate":0.8,"cashflows":[-3500,1500,2300,2700]},"axiom_value":-1493.8271604938275,"verified":null},{"id":"npv_08","operation":"finance.npv","args":{"rate":1,"cashflows":[-100,80,90,100]},"axiom_value":-25,"verified":null},{"id":"npv_09","operation":"finance.npv","args":{"rate":0.0001,"cashflows":[-900,100,200,300,350]},"axiom_value":49.7200599891019,"verified":null},{"id":"npv_10","operation":"finance.npv","args":{"rate":-0.2,"cashflows":[-2000,500,600,700,800]},"axiom_value":2882.812499999999,"verified":null},{"id":"bs_01","operation":"finance.black_scholes","args":{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"kind":"call"},"axiom_value":10.450583572185565,"verified":null},{"id":"bs_02","operation":"finance.black_scholes","args":{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"kind":"put"},"axiom_value":5.573526022256971,"verified":null},{"id":"bs_03","operation":"finance.black_scholes","args":{"S":100,"K":90,"T":0.5,"r":0.03,"sigma":0.35,"kind":"call"},"axiom_value":16.030097120837247,"verified":null},{"id":"bs_04","operation":"finance.black_scholes","args":{"S":100,"K":110,"T":0.5,"r":0.03,"sigma":0.35,"kind":"put"},"axiom_value":14.97352100828929,"verified":null},{"id":"bs_05","operation":"finance.black_scholes","args":{"S":70,"K":100,"T":1,"r":0,"sigma":0.3,"kind":"put"},"axiom_value":31.42963214105302,"verified":null},{"id":"bs_06","operation":"finance.black_scholes","args":{"S":70,"K":100,"T":1,"r":0,"sigma":0.3,"kind":"call"},"axiom_value":1.4296321410530268,"verified":null},{"id":"bs_07","operation":"finance.black_scholes","args":{"S":150,"K":100,"T":0.25,"r":0.08,"sigma":0.45,"kind":"call"},"axiom_value":52.28737414795225,"verified":null},{"id":"bs_08","operation":"finance.black_scholes","args":{"S":150,"K":100,"T":0.25,"r":0.08,"sigma":0.45,"kind":"put"},"axiom_value":0.3072414786277511,"verified":null},{"id":"bs_09","operation":"finance.black_scholes","args":{"S":100,"K":100,"T":0.02,"r":0.015,"sigma":0.1,"kind":"call"},"axiom_value":0.5792249328729397,"verified":null},{"id":"bs_10","operation":"finance.black_scholes","args":{"S":100,"K":100,"T":0.02,"r":0.015,"sigma":0.1,"kind":"put"},"axiom_value":0.549229432422969,"verified":null},{"id":"var_01","operation":"finance.var_historical","args":{"returns":[-0.02,-0.01,0,0.005,0.01,0.02,-0.03,0.015,-0.005,0.025,-0.012,0.008],"alpha":0.95},"axiom_value":0.024499999999999994,"verified":null},{"id":"var_02","operation":"finance.var_historical","args":{"returns":[-0.02,-0.01,0,0.005,0.01,0.02,-0.03,0.015,-0.005,0.025,-0.012,0.008],"alpha":0.99},"axiom_value":0.0289,"verified":null},{"id":"var_03","operation":"finance.var_historical","args":{"returns":[-0.15,-0.1,-0.075,0.005,0.02,0.04,-0.03,0.04,-0.045,0.025,-0.06,0.08],"alpha":0.95},"axiom_value":0.12249999999999997,"verified":null},{"id":"var_04","operation":"finance.var_historical","args":{"returns":[-0.15,-0.1,-0.075,0.005,0.02,0.04,-0.03,0.04,-0.045,0.025,-0.06,0.08],"alpha":0.99},"axiom_value":0.1445,"verified":null},{"id":"var_05","operation":"finance.var_historical","args":{"returns":[0.03,0.01,0.025,0.04,0.02,0.01,0.07,0.05,0.015,0.023,0.025,0.005],"alpha":0.95},"axiom_value":-0.0077500000000000025,"verified":null},{"id":"var_06","operation":"finance.var_historical","args":{"returns":[0.03,0.01,0.025,0.04,0.02,0.01,0.07,0.05,0.015,0.023,0.025,0.005],"alpha":0.99},"axiom_value":-0.00555,"verified":null},{"id":"var_07","operation":"finance.var_historical","args":{"returns":[-0.005,-0.01,-0.006,0,0.002,-0.008,0.002,-0.003,0.001,0.008,-0.009,0.006],"alpha":0.95},"axiom_value":0.00945,"verified":null},{"id":"var_08","operation":"finance.var_historical","args":{"returns":[-0.005,-0.01,-0.006,0,0.002,-0.008,0.002,-0.003,0.001,0.008,-0.009,0.006],"alpha":0.99},"axiom_value":0.00989,"verified":null},{"id":"var_09","operation":"finance.var_historical","args":{"returns":[-0.04,-0.03,-0.02,-0.01,0,0.01,0.02,0.03,0.04,0.05],"alpha":0.95},"axiom_value":0.0355,"verified":null},{"id":"var_10","operation":"finance.var_historical","args":{"returns":[-0.04,-0.03,-0.02,-0.01,0,0.01,0.02,0.03,0.04,0.05],"alpha":0.99},"axiom_value":0.0391,"verified":null}]''')
assert len(RECORDS) == 30 and len({rec["id"] for rec in RECORDS}) == 30
ALLOWED = {"finance.npv", "finance.black_scholes", "finance.var_historical"}


def independent_reference(record):
    op = record["operation"]
    args = record["args"]
    if op == "finance.npv":
        assert set(args) == {"rate", "cashflows"}
        with localcontext() as context:
            context.prec = 45
            rate = Decimal(str(args["rate"]))
            cashflows = [Decimal(str(cf)) for cf in args["cashflows"]]
            assert rate > Decimal(-1)
            return float(sum((cf / ((1 + rate) ** i) for i, cf in enumerate(cashflows)), Decimal(0)))
    if op == "finance.black_scholes":
        assert set(args) == {"S", "K", "T", "r", "sigma", "kind"}
        S, K, T, r, sigma = [float(args[x]) for x in ("S", "K", "T", "r", "sigma")]
        assert min(S, K, T, sigma) > 0
        d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        normal_cdf = statistics.NormalDist().cdf
        if args["kind"] == "call":
            return S * normal_cdf(d1) - K * math.exp(-r * T) * normal_cdf(d2)
        assert args["kind"] == "put"
        return K * math.exp(-r * T) * normal_cdf(-d2) - S * normal_cdf(-d1)
    if op == "finance.var_historical":
        assert set(args) == {"returns", "alpha"}
        ordered = sorted(Decimal(str(x)) for x in args["returns"])
        alpha = Decimal(str(args["alpha"]))
        assert 0 < alpha < 1 and len(ordered) > 1
        t = (len(ordered) - 1) * (Decimal(1) - alpha)
        lo = int(t)
        hi = min(lo + 1, len(ordered) - 1)
        w = t - Decimal(lo)
        return float(-(ordered[lo] * (Decimal(1) - w) + ordered[hi] * w))
    raise AssertionError("Unapproved numerical operation")


DIFFERENCES = []
for item in RECORDS:
    assert item["operation"] in ALLOWED
    assert item["verified"] is None  # source Axiom outputs remain unverified by Axiom itself
    expected = independent_reference(item)
    actual = float(item["axiom_value"])
    assert math.isfinite(expected) and math.isfinite(actual)
    delta = abs(expected - actual)
    DIFFERENCES.append({
        "id": item["id"],
        "operation": item["operation"],
        "absolute_error": delta,
        "matched": delta <= 1e-8,
    })
assert all(item["matched"] for item in DIFFERENCES), [x for x in DIFFERENCES if not x["matched"]]

# Intentionally incorrect option parameter is rejected by the independent reference.
try:
    independent_reference({"operation": "finance.black_scholes", "args": {
        "S": 100, "K": 100, "T": 1, "r": 0.05, "sigma": 0.2, "option_type": "put"
    }})
except (AssertionError, ValueError, KeyError):
    CONTRACT_REJECTION = True
else:
    raise AssertionError("Wrong Black-Scholes argument was admitted")

canonical = json.dumps({"fixtures": RECORDS, "verdicts": DIFFERENCES}, separators=(",", ":"), sort_keys=True)
result = {
    "schema": "musitu.axiom.databricks.live-service-snapshot-30.v1",
    "snapshot_date": "2026-10-28",
    "live_axiom_called_from_databricks": False,
    "source_axiom_verified_field": "null",
    "total": len(DIFFERENCES),
    "passed": sum(int(item["matched"]) for item in DIFFERENCES),
    "failed": sum(int(not item["matched"]) for item in DIFFERENCES),
    "max_abs_error": max(x["absolute_error"] for x in DIFFERENCES),
    "invalid_option_parameter_rejected": CONTRACT_REJECTION,
    "operations": {
        op: sum(int(row["operation"] == op) for row in DIFFERENCES)
        for op in sorted(ALLOWED)
    },
    "fixture_result_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
}

try:
    from pyspark.sql import functions as F
    rows = [(x["operation"], bool(x["matched"]), float(x["absolute_error"])) for x in DIFFERENCES]
    data = spark.createDataFrame(rows, ["operation", "matched", "absolute_error"])
    agg = data.agg(
        F.count("*").alias("total"),
        F.sum(F.when(F.col("matched"), 1).otherwise(0)).alias("matched"),
        F.max("absolute_error").alias("max_abs_error"),
    ).collect()[0]
    assert agg["total"] == 30 and agg["matched"] == 30
    result["spark_aggregation"] = "VERIFIED"
except ImportError:
    result["spark_aggregation"] = "OFFLINE_STD_LIB_ONLY"

print("MUSITU_AXIOM_DATABRICKS_LIVE_CAPTURE_30_OF_30_PASS")
print("MUSITU_AXIOM_30_CASE_PARITY=" + json.dumps(result, sort_keys=True))
if result["spark_aggregation"] == "VERIFIED":
    dbutils.notebook.exit(json.dumps(result, sort_keys=True))

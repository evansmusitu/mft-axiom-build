# Databricks notebook source
# MUSITU Axiom x Databricks: point-in-time Axiom parity fixtures, no production calls.
# Axiom plugin outputs captured on 2026-10-27. Kernel result fields reported verified=null.
# This is a cross-system reproducibility pilot, NOT certification of financial correctness.
from __future__ import annotations

import hashlib
import json
import math
import statistics
from decimal import Decimal, localcontext

# Only synthetic numeric inputs; these are point-in-time outputs from the existing
# MUSITU Axiom quantitative connector. All identifiers contain no user/customer data.
CASES = [
    {"id":"npv_01","operation":"finance.npv","args":{"rate":0.1,"cashflows":[-100,60,60]},"axiom":4.132231404958667},
    {"id":"npv_02","operation":"finance.npv","args":{"rate":0.01,"cashflows":[-1000,300,300,300,300]},"axiom":170.58966551551146},
    {"id":"npv_03","operation":"finance.npv","args":{"rate":0.07,"cashflows":[-1000,200,300,400,500]},"axiom":156.9142631125341},
    {"id":"npv_04","operation":"finance.npv","args":{"rate":0.12,"cashflows":[-2500,450,650,750,1050,1200]},"axiom":302.00312974132714},
    {"id":"npv_05","operation":"finance.npv","args":{"rate":0.025,"cashflows":[-900,100,-50,150,400,500]},"axiom":93.56756916274206},
    {"id":"bs_call_atm","operation":"finance.black_scholes","args":{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"kind":"call"},"axiom":10.450583572185565},
    {"id":"bs_put_atm","operation":"finance.black_scholes","args":{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"kind":"put"},"axiom":5.573526022256971},
    {"id":"bs_call_otm","operation":"finance.black_scholes","args":{"S":100,"K":110,"T":1,"r":0.05,"sigma":0.2,"kind":"call"},"axiom":6.040088129724239},
    {"id":"bs_call_itm","operation":"finance.black_scholes","args":{"S":130,"K":100,"T":0.5,"r":0.02,"sigma":0.35,"kind":"call"},"axiom":32.910060780678435},
    {"id":"bs_put_itm","operation":"finance.black_scholes","args":{"S":130,"K":100,"T":0.5,"r":0.02,"sigma":0.35,"kind":"put"},"axiom":1.9150441555952398},
    {"id":"bs_put_otm","operation":"finance.black_scholes","args":{"S":80,"K":100,"T":2,"r":0.03,"sigma":0.3,"kind":"put"},"axiom":22.768397748731168},
    {"id":"bs_call_deep_otm","operation":"finance.black_scholes","args":{"S":80,"K":100,"T":2,"r":0.03,"sigma":0.3,"kind":"call"},"axiom":8.591944390306296},
    {"id":"var_95","operation":"finance.var_historical","args":{"returns":[0.01,-0.02,0.015,-0.03,0.02,-0.01],"alpha":0.95},"axiom":0.027499999999999997},
    {"id":"var_99","operation":"finance.var_historical","args":{"returns":[-0.01,-0.04,0.03,-0.025,0.015,0.012,-0.02],"alpha":0.99},"axiom":0.0391},
]


def independent_oracle(case):
    op=case["operation"]
    a=case["args"]
    if op == "finance.npv":
        assert set(a)=={"rate","cashflows"} and len(a["cashflows"])>=2
        with localcontext() as context:
            context.prec=34
            rate=Decimal(str(a["rate"]))
            values=[Decimal(str(x)) for x in a["cashflows"]]
            result=sum(cf/(Decimal(1)+rate)**i for i,cf in enumerate(values))
        return float(result)
    if op == "finance.black_scholes":
        # Axiom expects 'kind', NOT 'option_type'; never allow silent ignored keys.
        assert set(a)=={"S","K","T","r","sigma","kind"}
        assert a["kind"] in ("call","put")
        S,K,T,r,v=(float(a[k]) for k in ("S","K","T","r","sigma"))
        assert min(S,K,T,v)>0
        d1=(math.log(S/K)+(r+0.5*v*v)*T)/(v*math.sqrt(T))
        d2=d1-v*math.sqrt(T)
        N=statistics.NormalDist().cdf
        if a["kind"]=="call":
            return S*N(d1)-K*math.exp(-r*T)*N(d2)
        return K*math.exp(-r*T)*N(-d2)-S*N(-d1)
    if op == "finance.var_historical":
        assert set(a)=={"returns","alpha"}
        returns=sorted(Decimal(str(x)) for x in a["returns"])
        alpha=Decimal(str(a["alpha"]))
        assert Decimal(0)<alpha<Decimal(1)
        quantile=(len(returns)-1)*(Decimal(1)-alpha)
        lower=int(quantile)
        upper=min(lower+1,len(returns)-1)
        weight=quantile-Decimal(lower)
        return float(-(returns[lower]*(Decimal(1)-weight)+returns[upper]*weight))
    raise ValueError("Unapproved Axiom operation")


def build_verdicts(records):
    assert isinstance(records,list) and len(records)==14
    assert len({x["id"] for x in records})==len(records)
    result=[]
    for row in records:
        value=independent_oracle(row)
        error=abs(value-float(row["axiom"]))
        success=math.isfinite(value) and error<=1e-9
        result.append({"id":row["id"],"operation":row["operation"],"absolute_error":error,"match":success})
    assert all(x["match"] for x in result), [x for x in result if not x["match"]]
    return result


VERDICTS=build_verdicts(CASES)
# Negative control: the incorrectly named parameter must be rejected, not silently accepted.
try:
    independent_oracle({"operation":"finance.black_scholes","args":{"S":100,"K":100,"T":1,"r":0.05,"sigma":0.2,"option_type":"put"}})
except (AssertionError,ValueError):
    CONTRACT_REJECTION=True
else:
    raise AssertionError("Invalid option-type parameter was silently admitted")

# Put-call parity sanity check at ATM.
call=next(x["axiom"] for x in CASES if x["id"]=="bs_call_atm")
put=next(x["axiom"] for x in CASES if x["id"]=="bs_put_atm")
assert abs((call-put)-(100-100*math.exp(-0.05))) < 1e-8

summary={
    "schema":"musitu.axiom.databricks.point-in-time-parity.v1",
    "axiom_kernel_verified_field":"null",
    "source":"MUSITU Axiom plugin outputs captured 2026-10-27",
    "live_axiom_mcp_called_from_databricks":False,
    "oracle":"Independent Decimal, NormalDist and quantile implementations",
    "total":len(VERDICTS),
    "passed":sum(1 for x in VERDICTS if x["match"]),
    "failed":sum(1 for x in VERDICTS if not x["match"]),
    "invalid_option_parameter_rejected":CONTRACT_REJECTION,
    "put_call_parity_passed":True,
    "max_abs_error":max(x["absolute_error"] for x in VERDICTS),
    "by_operation":{
        op:sum(1 for x in VERDICTS if x["operation"]==op)
        for op in sorted({x["operation"] for x in VERDICTS})
    },
}
digest=hashlib.sha256(json.dumps({"cases":CASES,"verdicts":VERDICTS},sort_keys=True,separators=(",",":")).encode()).hexdigest()
summary["fixture_and_result_sha256"]=digest

# Spark-side aggregation confirms that Databricks independently ingested the test results.
try:
    from pyspark.sql import functions as F
    df=spark.createDataFrame([(x["operation"],bool(x["match"]),float(x["absolute_error"])) for x in VERDICTS],
                             ["operation","passed","absolute_error"])
    confirmed=df.agg(F.count("*").alias("n"),F.sum(F.when(F.col("passed"),1).otherwise(0)).alias("pass_n")).collect()[0]
    assert confirmed["n"]==14 and confirmed["pass_n"]==14
    summary["databricks_spark_aggregation"]="VERIFIED"
except ImportError:
    summary["databricks_spark_aggregation"]="OFFLINE_STD_LIB_ONLY"

print("MUSITU_AXIOM_DATABRICKS_PARITY_14_OF_14_PASS")
print("MUSITU_AXIOM_PARITY_METRICS="+json.dumps(summary,sort_keys=True))
if summary["databricks_spark_aggregation"]=="VERIFIED":
    dbutils.notebook.exit(json.dumps(summary,sort_keys=True))

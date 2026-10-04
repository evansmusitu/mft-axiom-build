from __future__ import annotations
import argparse, importlib, math, pathlib, sys
import numpy as np

Q_PORTFOLIO = [
    [0.04, 0.006, 0.012, 0.0],
    [0.006, 0.09, 0.018, 0.009],
    [0.012, 0.018, 0.16, 0.03],
    [0.0, 0.009, 0.03, 0.0625],
]
RETURNS = [0.06, 0.09, 0.14, 0.07]
EXPECTED_X = np.array([0.30418737, 0.25477424, 0.25637699, 0.18466141])
EXPECTED_FUN = 0.015515771304726308

def load(runtime: pathlib.Path):
    sys.path.insert(0, str(runtime.resolve()))
    return importlib.import_module("kernel.app.main")

def require_raises_value_error(fn, contains: str):
    try:
        fn()
    except ValueError as e:
        if contains not in str(e):
            raise AssertionError(f"expected ValueError containing {contains!r}, got {e!r}")
        return
    raise AssertionError("expected ValueError")

def main() -> int:
    ap=argparse.ArgumentParser()
    ap.add_argument("--runtime",required=True)
    ns=ap.parse_args()
    m=load(pathlib.Path(ns.runtime))

    portfolio={
        "Q":Q_PORTFOLIO,
        "c":[0,0,0,0],
        "A_eq":[[1,1,1,1],RETURNS],
        "b_eq":[1,0.09],
        "bounds":[[0,1],[0,1],[0,1],[0,1]],
    }
    r=m.dispatch("optimization.quadratic",portfolio,50)
    x=np.asarray(r["x"],float)
    assert r["success"] is True, r
    assert np.allclose(x,EXPECTED_X,atol=2e-6), (x,r)
    assert abs(float(r["fun"])-EXPECTED_FUN) < 2e-8, r
    assert abs(float(x.sum())-1.0) < 1e-8, x
    assert abs(float(np.asarray(RETURNS)@x)-0.09) < 1e-8, x
    assert np.all(x >= -1e-10) and np.all(x <= 1+1e-10), x

    v=m._verify_operation("optimization.quadratic",portfolio,r,50)
    assert v.get("verified") is True, v
    assert v.get("method") == "constraint-and-stationarity-residual", v

    bounded=m.dispatch("optimization.quadratic",{
        "Q":[[2.0]],"c":[-4.0],"bounds":[[0.0,1.0]]
    },50)
    assert bounded["success"] is True and abs(float(bounded["x"][0])-1.0)<1e-7, bounded

    inequality=m.dispatch("optimization.quadratic",{
        "Q":[[2.0]],"c":[0.0],
        "A_ub":[[-1.0]],"b_ub":[-1.0],
        "bounds":[[0.0,2.0]]
    },50)
    assert inequality["success"] is True and abs(float(inequality["x"][0])-1.0)<2e-6, inequality
    assert m._verify_operation("optimization.quadratic",{
        "Q":[[2.0]],"c":[0.0],
        "A_ub":[[-1.0]],"b_ub":[-1.0],
        "bounds":[[0.0,2.0]]
    },inequality,50).get("verified") is True

    require_raises_value_error(
        lambda: m.dispatch("optimization.quadratic",{
            "Q":[[2.0]],"c":[0.0],"Aeq":[[1.0]],"beq":[1.0]
        },50),
        "unsupported arguments",
    )
    require_raises_value_error(
        lambda: m.dispatch("optimization.quadratic",{
            "Q":[[2.0]],"c":[0.0],"A_eq":[[1.0]]
        },50),
        "A_eq and b_eq must be provided together",
    )
    require_raises_value_error(
        lambda: m.dispatch("optimization.quadratic",{
            "Q":[[2.0,0.0]],"c":[0.0]
        },50),
        "Q must be square",
    )
    print("MUSITU_AXIOM_QUADRATIC_CONSTRAINT_REGRESSION_PASS")
    return 0

if __name__=="__main__":
    raise SystemExit(main())

from __future__ import annotations
import argparse, hashlib, pathlib

EXPECTED_MAIN_SHA256 = "9389e4a501cd2385afe3820da685e97790e723da3bc5871a6dc2565b19f8fa3f"

OLD_DISPATCH = """    if op=='optimization.quadratic':
        Q=np.asarray(a['Q'],float); c=np.asarray(a['c'],float); x0=np.asarray(a.get('x0',[0.0]*len(c)),float); fun=lambda z:0.5*z@Q@z+c@z; jac=lambda z:Q@z+c; res=sci_optimize.minimize(fun,x0,jac=jac,method='BFGS')
        return {'x':res.x,'fun':float(res.fun),'success':bool(res.success),'message':str(res.message)}
"""

NEW_DISPATCH = """    if op=='optimization.quadratic':
        Q,c,x0,Aeq,beq,Aub,bub,bounds=_quadratic_problem(a)
        fun=lambda z:0.5*z@Q@z+c@z
        jac=lambda z:Q@z+c
        constraints=[]
        if Aeq is not None:
            constraints.append({'type':'eq','fun':lambda z,A=Aeq,b=beq:A@z-b,'jac':lambda z,A=Aeq:A})
        if Aub is not None:
            constraints.append({'type':'ineq','fun':lambda z,A=Aub,b=bub:b-A@z,'jac':lambda z,A=Aub:-A})
        res=sci_optimize.minimize(fun,x0,jac=jac,method='SLSQP',bounds=bounds,constraints=constraints,options={'ftol':1e-12,'maxiter':1000})
        out={'x':res.x,'fun':float(res.fun) if np.isfinite(res.fun) else None,'success':bool(res.success),'status':int(res.status),'message':str(res.message),'nit':int(getattr(res,'nit',0)),'multipliers':np.asarray(getattr(res,'multipliers',[]),float)}
        qv=_quadratic_verify(a,out)
        out['verification']=qv
        if out['success'] and not qv.get('verified'):
            out['success']=False
            out['message']='Post-solve verification failed: '+str(qv)
        return out
"""

VERIFY_ANCHOR = """        if op=='optimization.linear_program':
            xv=np.asarray(result['x'],float); ok=True
            if 'A_ub' in a: ok=ok and bool(np.all(np.asarray(a['A_ub'],float)@xv <= np.asarray(a['b_ub'],float)+1e-7))
            if 'A_eq' in a: ok=ok and bool(np.allclose(np.asarray(a['A_eq'],float)@xv,np.asarray(a['b_eq'],float),atol=1e-7))
            return {'verified':ok and bool(result.get('success')),'method':'constraint-residual'}
"""

VERIFY_REPLACEMENT = """        if op=='optimization.linear_program':
            xv=np.asarray(result['x'],float); ok=True
            if 'A_ub' in a: ok=ok and bool(np.all(np.asarray(a['A_ub'],float)@xv <= np.asarray(a['b_ub'],float)+1e-7))
            if 'A_eq' in a: ok=ok and bool(np.allclose(np.asarray(a['A_eq'],float)@xv,np.asarray(a['b_eq'],float),atol=1e-7))
            return {'verified':ok and bool(result.get('success')),'method':'constraint-residual'}
        if op=='optimization.quadratic':
            return _quadratic_verify(a,result)
"""

HELPER_ANCHOR = "_v2_dispatch = dispatch\n\n"
HELPERS = r"""_QUADRATIC_ALLOWED={'Q','c','x0','A_eq','b_eq','A_ub','b_ub','bounds'}

def _quadratic_problem(a):
    unknown=sorted(set(a)-_QUADRATIC_ALLOWED)
    if unknown: raise ValueError('optimization.quadratic unsupported arguments: '+','.join(unknown))
    if 'Q' not in a or 'c' not in a: raise ValueError('optimization.quadratic requires Q and c')
    Q=np.asarray(a['Q'],float); c=np.asarray(a['c'],float)
    if Q.ndim!=2 or Q.shape[0]!=Q.shape[1]: raise ValueError('Q must be square')
    n=Q.shape[0]
    if c.ndim!=1 or c.shape[0]!=n: raise ValueError('c dimension must match Q')
    if not np.all(np.isfinite(Q)) or not np.all(np.isfinite(c)): raise ValueError('Q and c must be finite')
    if not np.allclose(Q,Q.T,rtol=1e-10,atol=1e-12): raise ValueError('Q must be symmetric')
    x0=np.asarray(a.get('x0',[0.0]*n),float)
    if x0.ndim!=1 or x0.shape[0]!=n or not np.all(np.isfinite(x0)): raise ValueError('x0 dimension must match Q and be finite')

    def pair(Akey,bkey,label):
        if (Akey in a)!=(bkey in a): raise ValueError(f'{Akey} and {bkey} must be provided together')
        if Akey not in a: return None,None
        A=np.asarray(a[Akey],float); b=np.asarray(a[bkey],float)
        if A.ndim!=2 or A.shape[1]!=n: raise ValueError(f'{Akey} must have {n} columns')
        if b.ndim!=1 or b.shape[0]!=A.shape[0]: raise ValueError(f'{bkey} length must match {Akey} rows')
        if not np.all(np.isfinite(A)) or not np.all(np.isfinite(b)): raise ValueError(f'{label} constraints must be finite')
        return A,b

    Aeq,beq=pair('A_eq','b_eq','equality')
    Aub,bub=pair('A_ub','b_ub','inequality')

    bounds=None
    if 'bounds' in a:
        raw=a['bounds']
        if not isinstance(raw,(list,tuple)) or len(raw)!=n: raise ValueError(f'bounds must contain {n} [lower,upper] pairs')
        bounds=[]
        for i,item in enumerate(raw):
            if not isinstance(item,(list,tuple)) or len(item)!=2: raise ValueError(f'bounds[{i}] must be [lower,upper]')
            lo=None if item[0] is None else float(item[0]); hi=None if item[1] is None else float(item[1])
            if lo is not None and not math.isfinite(lo): raise ValueError(f'bounds[{i}] lower must be finite or null')
            if hi is not None and not math.isfinite(hi): raise ValueError(f'bounds[{i}] upper must be finite or null')
            if lo is not None and hi is not None and lo>hi: raise ValueError(f'bounds[{i}] lower exceeds upper')
            bounds.append((lo,hi))
        for i,(lo,hi) in enumerate(bounds):
            if lo is not None and x0[i]<lo: x0[i]=lo
            if hi is not None and x0[i]>hi: x0[i]=hi
    return Q,c,x0,Aeq,beq,Aub,bub,bounds

def _quadratic_verify(a,result):
    try:
        Q,c,_,Aeq,beq,Aub,bub,bounds=_quadratic_problem(a)
        x=np.asarray(result.get('x',[]),float)
        n=len(c)
        if x.ndim!=1 or x.shape[0]!=n or not np.all(np.isfinite(x)):
            return {'verified':False,'method':'constraint-and-stationarity-residual','error':'invalid-solution-vector'}
        eq_res=float(np.max(np.abs(Aeq@x-beq))) if Aeq is not None and Aeq.shape[0] else 0.0
        ub_violation=float(np.max(np.maximum(Aub@x-bub,0.0))) if Aub is not None and Aub.shape[0] else 0.0
        bound_violation=0.0
        if bounds is not None:
            for i,(lo,hi) in enumerate(bounds):
                if lo is not None: bound_violation=max(bound_violation,float(max(lo-x[i],0.0)))
                if hi is not None: bound_violation=max(bound_violation,float(max(x[i]-hi,0.0)))

        grad=Q@x+c
        meq=0 if Aeq is None else Aeq.shape[0]
        mineq=0 if Aub is None else Aub.shape[0]
        mult=np.asarray(result.get('multipliers',[]),float)
        if mult.ndim!=1 or mult.shape[0] < meq+mineq:
            if meq+mineq:
                return {'verified':False,'method':'constraint-and-stationarity-residual','error':'missing-kkt-multipliers','equality_residual':eq_res,'inequality_violation':ub_violation,'bounds_violation':bound_violation}
            mult=np.asarray([],float)
        reduced=grad.copy()
        if meq: reduced=reduced-Aeq.T@mult[:meq]
        imult=mult[meq:meq+mineq] if mineq else np.asarray([],float)
        if mineq: reduced=reduced-(-Aub).T@imult

        station=0.0
        active_tol=2e-7
        if bounds is None:
            station=float(np.max(np.abs(reduced))) if reduced.size else 0.0
        else:
            for i,g in enumerate(reduced):
                lo,hi=bounds[i]
                at_lo=lo is not None and abs(x[i]-lo)<=active_tol
                at_hi=hi is not None and abs(x[i]-hi)<=active_tol
                if at_lo and at_hi: rr=0.0
                elif at_lo: rr=max(0.0,-float(g))
                elif at_hi: rr=max(0.0,float(g))
                else: rr=abs(float(g))
                station=max(station,rr)

        dual_violation=float(np.max(np.maximum(-imult,0.0))) if imult.size else 0.0
        complementarity=0.0
        if mineq:
            slack=bub-Aub@x
            complementarity=float(np.max(np.abs(imult*slack))) if slack.size else 0.0

        solver_success=bool(result.get('success'))
        ok=(solver_success and eq_res<=1e-7 and ub_violation<=1e-7 and bound_violation<=1e-7 and station<=1e-5 and dual_violation<=1e-7 and complementarity<=1e-6)
        return {'verified':bool(ok),'method':'constraint-and-stationarity-residual','equality_residual':eq_res,'inequality_violation':ub_violation,'bounds_violation':bound_violation,'stationarity_residual':station,'dual_violation':dual_violation,'complementarity_residual':complementarity}
    except Exception as e:
        return {'verified':False,'method':'constraint-and-stationarity-residual','error':type(e).__name__}

"""

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("path")
    ns=ap.parse_args()
    p=pathlib.Path(ns.path)
    raw=p.read_bytes()
    got=hashlib.sha256(raw).hexdigest()
    if got!=EXPECTED_MAIN_SHA256:
        raise SystemExit(f"Fail-closed runtime main.py digest mismatch: {got}")
    s=raw.decode()
    if s.count(OLD_DISPATCH)!=1: raise SystemExit("Fail-closed quadratic dispatch anchor mismatch")
    if s.count(VERIFY_ANCHOR)!=1: raise SystemExit("Fail-closed verification anchor mismatch")
    if s.count(HELPER_ANCHOR)!=1: raise SystemExit("Fail-closed helper anchor mismatch")
    s=s.replace(VERIFY_ANCHOR,VERIFY_REPLACEMENT,1)
    s=s.replace(HELPER_ANCHOR,HELPER_ANCHOR+HELPERS,1)
    s=s.replace(OLD_DISPATCH,NEW_DISPATCH,1)
    p.write_text(s)
    out=hashlib.sha256(p.read_bytes()).hexdigest()
    print(f"MUSITU_AXIOM_QUADRATIC_PATCH_PASS before={got} after={out}")

if __name__=="__main__":
    main()

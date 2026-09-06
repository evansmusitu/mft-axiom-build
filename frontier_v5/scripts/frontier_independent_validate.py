#!/usr/bin/env python3
from __future__ import annotations

import csv, io, json, hashlib, statistics, urllib.request
from pathlib import Path
import numpy as np
from sklearn.linear_model import LinearRegression
from frontier_v5.runtime.fullstack import DomainTwinCalibrator


def get(url, ua='MUSITU-Axiom-Independent-Validation/5.0'):
    req=urllib.request.Request(url,headers={'User-Agent':ua,'Accept':'application/json,text/csv,*/*'})
    with urllib.request.urlopen(req,timeout=45) as r: return r.read()

def rel_close(a,b,tol=1e-10):
    a=float(a); b=float(b); return abs(a-b)<=tol*(1+abs(b))

def annual_company(raw):
    obj=json.loads(raw); us=((obj.get('facts') or {}).get('us-gaap') or {})
    def annual(tag):
        rows=((us.get(tag) or {}).get('units') or {}).get('USD') or []; by={}
        for r in rows:
            if r.get('form')!='10-K' or not isinstance(r.get('fy'),int) or not isinstance(r.get('val'),(int,float)): continue
            fy=int(r['fy']); filed=str(r.get('filed') or ''); val=float(r['val'])
            if fy not in by or filed>by[fy][0]: by[fy]=(filed,val)
        return {k:v for k,(_,v) in by.items()}
    rev={}
    for tag in ('RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet'):
        rev=annual(tag)
        if len(rev)>=6: break
    op=annual('OperatingIncomeLoss'); years=sorted(set(rev)&set(op))[-10:]
    return years,[rev[y] for y in years],[op[y] for y in years]

def wb(raw):
    rows=json.loads(raw)[1] or []; return {int(r['date']):float(r['value']) for r in rows if r.get('value') is not None and str(r.get('date','')).isdigit()}

def returns(raw):
    rows=list(csv.DictReader(io.StringIO(raw.decode('utf-8','replace')))); c=[float(r['Close']) for r in rows if r.get('Close')]
    return [c[i]/c[i-1]-1 for i in range(1,len(c))][-120:]

sec=get('https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json','MUSITU Axiom independent validation support@mftintelligence.com')
years,x,y=annual_company(sec)
if len(years)<6: raise SystemExit('insufficient SEC history')
ours=DomainTwinCalibrator.company('apple-independent',x,y)['calibration']
mdl=LinearRegression().fit(np.array(x).reshape(-1,1),np.array(y))
if not rel_close(ours['slope'],mdl.coef_[0],1e-12) or not rel_close(ours['intercept'],mdl.intercept_,1e-12): raise SystemExit('company calibration disagrees with sklearn')

rawg=get('https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=80')
rawp=get('https://api.worldbank.org/v2/country/USA/indicator/SP.POP.TOTL?format=json&per_page=80')
g=wb(rawg); p=wb(rawp); yrs=sorted(set(g)&set(p))[-20:]
ox=[p[z] for z in yrs]; oy=[g[z] for z in yrs]
eours=DomainTwinCalibrator.economy('usa-independent',ox,oy,'population','gdp')['calibration']
emdl=LinearRegression().fit(np.array(ox).reshape(-1,1),np.array(oy))
if not rel_close(eours['slope'],emdl.coef_[0],1e-12) or not rel_close(eours['intercept'],emdl.intercept_,1e-12): raise SystemExit('economy calibration disagrees with sklearn')

ra=returns(get('https://stooq.com/q/d/l/?s=aapl.us&d1=20240101&i=d')); rm=returns(get('https://stooq.com/q/d/l/?s=msft.us&d1=20240101&i=d')); n=min(len(ra),len(rm)); ra=ra[-n:]; rm=rm[-n:]
pours=DomainTwinCalibrator.portfolio('portfolio-independent',{'AAPL':ra,'MSFT':rm},{'AAPL':.5,'MSFT':.5})
series=np.array(ra)*.5+np.array(rm)*.5
if not rel_close(pours['mean_return'],float(np.mean(series)),1e-12) or not rel_close(pours['volatility'],float(np.std(series,ddof=1)),1e-12): raise SystemExit('portfolio metrics disagree with numpy')

rows={
 'company':{'years':years,'slope':ours['slope'],'intercept':ours['intercept'],'sklearn_slope':float(mdl.coef_[0]),'source_sha256':hashlib.sha256(sec).hexdigest()},
 'economy':{'years':yrs,'slope':eours['slope'],'intercept':eours['intercept'],'sklearn_slope':float(emdl.coef_[0]),'sources':[hashlib.sha256(rawg).hexdigest(),hashlib.sha256(rawp).hexdigest()]},
 'portfolio':{'observations':n,'mean':pours['mean_return'],'volatility':pours['volatility'],'numpy_mean':float(np.mean(series)),'numpy_volatility':float(np.std(series,ddof=1))},
}
body=json.dumps(rows,sort_keys=True,separators=(',',':')).encode(); evidence={'schema':'musitu.axiom.frontier.independent-validation.v1','status':'PASS','validators':['scikit-learn','NumPy'],'external_sources':['SEC companyfacts','World Bank Indicators','Stooq historical prices'],'results':rows,'evidence_sha256':hashlib.sha256(body).hexdigest()}
Path('/tmp/musitu-frontier-independent-validation.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
print('MUSITU_AXIOM_FRONTIER_INDEPENDENT_IMPLEMENTATION_VALIDATION_PASS')
print('evidence_sha256='+evidence['evidence_sha256'])

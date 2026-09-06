#!/usr/bin/env python3
from __future__ import annotations

import csv, datetime, io, json, hashlib, urllib.parse, urllib.request
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
    rows=json.loads(raw)[1] or []
    return {int(r['date']):float(r['value']) for r in rows if r.get('value') is not None and str(r.get('date','')).isdigit()}


def stooq_prices(raw):
    out={}
    for r in csv.DictReader(io.StringIO(raw.decode('utf-8','replace'))):
        try:
            date=str(r.get('Date') or '').strip(); close=float(r.get('Close'))
        except (TypeError,ValueError):
            continue
        if date: out[date]=close
    return out


def yahoo_prices(symbol):
    url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(symbol)+'?range=2y&interval=1d&events=history'
    raw=get(url)
    obj=json.loads(raw); result=(((obj.get('chart') or {}).get('result') or [None])[0] or {})
    ts=result.get('timestamp') or []
    q=(((result.get('indicators') or {}).get('quote') or [{}])[0] or {})
    closes=q.get('close') or []
    out={}
    for t,c in zip(ts,closes):
        if c is None: continue
        date=datetime.datetime.fromtimestamp(int(t),datetime.timezone.utc).date().isoformat()
        out[date]=float(c)
    return raw,out


def market_prices(symbol,stooq_symbol):
    stooq_url='https://stooq.com/q/d/l/?s='+urllib.parse.quote(stooq_symbol)+'&d1=20240101&i=d'
    try:
        raw=get(stooq_url); prices=stooq_prices(raw)
    except Exception:
        raw=b''; prices={}
    if len(prices)>=30:
        return 'Stooq',raw,prices
    raw,prices=yahoo_prices(symbol)
    if len(prices)<30: raise SystemExit('insufficient external market history for '+symbol)
    return 'Yahoo Finance chart API',raw,prices


def aligned_returns(a,b,limit=120):
    dates=sorted(set(a)&set(b))
    if len(dates)<31: raise SystemExit('insufficient aligned external market history')
    ra=[]; rb=[]; used=[]
    for prev,cur in zip(dates,dates[1:]):
        pa,ca=a[prev],a[cur]; pb,cb=b[prev],b[cur]
        if pa<=0 or pb<=0: continue
        ra.append(ca/pa-1); rb.append(cb/pb-1); used.append(cur)
    if len(ra)<30: raise SystemExit('insufficient aligned external returns')
    return used[-limit:],ra[-limit:],rb[-limit:]


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

provider_a,rawa,pa=market_prices('AAPL','aapl.us'); provider_m,rawm,pm=market_prices('MSFT','msft.us')
dates,ra,rm=aligned_returns(pa,pm)
pours=DomainTwinCalibrator.portfolio('portfolio-independent',{'AAPL':ra,'MSFT':rm},{'AAPL':.5,'MSFT':.5})
series=np.array(ra)*.5+np.array(rm)*.5
if not rel_close(pours['mean_return'],float(np.mean(series)),1e-12) or not rel_close(pours['volatility'],float(np.std(series,ddof=1)),1e-12): raise SystemExit('portfolio metrics disagree with numpy')

market_cache={
 'schema':'musitu.axiom.frontier.market-cache.v1',
 'status':'PASS',
 'dates':dates,
 'returns':{'AAPL':ra,'MSFT':rm},
 'providers':{'AAPL':provider_a,'MSFT':provider_m},
 'source_sha256':{'AAPL':hashlib.sha256(rawa).hexdigest(),'MSFT':hashlib.sha256(rawm).hexdigest()},
 'observations':len(ra),
}
market_cache['cache_sha256']=hashlib.sha256(json.dumps(market_cache,sort_keys=True,separators=(',',':')).encode()).hexdigest()
Path('/tmp/musitu-frontier-market-cache.json').write_text(json.dumps(market_cache,indent=2),encoding='utf-8')

rows={
 'company':{'years':years,'slope':ours['slope'],'intercept':ours['intercept'],'sklearn_slope':float(mdl.coef_[0]),'source_sha256':hashlib.sha256(sec).hexdigest()},
 'economy':{'years':yrs,'slope':eours['slope'],'intercept':eours['intercept'],'sklearn_slope':float(emdl.coef_[0]),'sources':[hashlib.sha256(rawg).hexdigest(),hashlib.sha256(rawp).hexdigest()]},
 'portfolio':{'observations':len(ra),'start_date':dates[0],'end_date':dates[-1],'providers':[provider_a,provider_m],'source_sha256':[hashlib.sha256(rawa).hexdigest(),hashlib.sha256(rawm).hexdigest()],'mean':pours['mean_return'],'volatility':pours['volatility'],'numpy_mean':float(np.mean(series)),'numpy_volatility':float(np.std(series,ddof=1)),'market_cache_sha256':market_cache['cache_sha256']},
}
body=json.dumps(rows,sort_keys=True,separators=(',',':')).encode()
evidence={'schema':'musitu.axiom.frontier.independent-validation.v3','status':'PASS','validators':['scikit-learn','NumPy'],'external_sources':['SEC companyfacts','World Bank Indicators',provider_a,provider_m],'results':rows,'evidence_sha256':hashlib.sha256(body).hexdigest()}
Path('/tmp/musitu-frontier-independent-validation.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
print('MUSITU_AXIOM_FRONTIER_INDEPENDENT_IMPLEMENTATION_VALIDATION_PASS')
print('market_cache_sha256='+market_cache['cache_sha256'])
print('evidence_sha256='+evidence['evidence_sha256'])

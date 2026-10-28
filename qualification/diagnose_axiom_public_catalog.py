"""Anonymous fixed tools/list discovery only. No tools/call, credentials or release."""
import argparse
import json
import re
from pathlib import Path
import urllib.request
import urllib.error

URL='https://mcp.mftintelligence.com/mcp'
BODY=b'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
HIDDEN={'musitu_axiom_plans','musitu_axiom_recommend_plan','musitu_axiom_start_checkout','musitu_axiom_checkout_status'}
LIMIT=1048576
PROMOTIONAL=re.compile(r'\b(subscribe|upgrade|checkout|monthly plan|subscription plan)\b',re.I)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_args,**_kwargs):return None

def unique(pairs):
    result={}
    for k,v in pairs:
        if k in result:raise ValueError('duplicate_json_key')
        result[k]=v
    return result

def reject_constant(_):raise ValueError('nonfinite')

def assess(status,doc):
    issues=[]
    counts={'tools':0,'operations':0,'business':0,'output_schemas':0}
    if status!=200 or not isinstance(doc,dict):issues.append('BAD_RESPONSE')
    else:
        data=doc.get('result')
        rows=data.get('tools') if isinstance(data,dict) else None
        if not isinstance(rows,list) or len(rows)>150 or not all(isinstance(t,dict) and isinstance(t.get('name'),str) for t in rows):
            issues.append('BAD_TOOLS_COLLECTION')
        else:
            names=[t['name'] for t in rows]
            counts['tools']=len(rows)
            ops={t.get('_meta',{}).get('musitu/operation') for t in rows if isinstance(t.get('_meta'),dict)}
            ops.discard(None)
            counts['operations']=len(ops)
            counts['business']=sum(t.get('_meta',{}).get('musitu/business_product') is True for t in rows if isinstance(t.get('_meta'),dict))
            counts['output_schemas']=sum(isinstance(t.get('outputSchema'),dict) for t in rows)
            if len(set(names))!=len(names):issues.append('DUPLICATE_NAMES')
            for key,expect in (('tools',108),('operations',74),('business',30),('output_schemas',108)):
                if counts[key]!=expect:issues.append(key.upper()+'_DRIFT')
            if HIDDEN.intersection(names):issues.append('PRIVATE_COMMERCE_EXPOSED')
            if any(isinstance(t.get('description'),str) and PROMOTIONAL.search(t['description']) for t in rows):
                issues.append('PROMOTIONAL_COMMERCE_DESCRIPTION')
    return {'schema':'musitu.axiom.public_catalog_readonly.v1','failed_checks':issues,'counts':counts,
            'catalog_metadata_observed':not issues,'oauth_e2e_qualified':False,
            'openai_submission_approved':False,'commercial_ga_qualified':False}

def probe(transport=None):
    transport=transport or urllib.request.build_opener(NoRedirect()).open
    req=urllib.request.Request(URL,data=BODY,method='POST',headers={'Accept':'application/json','Content-Type':'application/json'})
    try:
        with transport(req,timeout=15) as response:
            raw=response.read(LIMIT+1)
            if not isinstance(raw,bytes) or not 0<len(raw)<=LIMIT:raise ValueError('invalid_response_size')
            doc=json.loads(raw.decode('utf-8'),object_pairs_hook=unique,parse_constant=reject_constant)
            return assess(response.status,doc)
    except (urllib.error.HTTPError,urllib.error.URLError,ValueError,UnicodeError,OSError,TypeError,RecursionError):
        return assess(None,None)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    report=probe()
    try:
        with args.output.open('x',encoding='utf-8') as f:f.write(json.dumps(report,sort_keys=True,indent=2)+'\n')
    except OSError:return 2
    print(json.dumps(report,sort_keys=True))
    print('PUBLIC_MCP_AND_COMMERCIAL_GA=NOT_APPROVED_BY_CATALOG')
    return 0

if __name__=='__main__':raise SystemExit(main())

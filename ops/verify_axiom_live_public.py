"""Read-only current public plugin checks; no credential provisioning or claims."""
import json
from pathlib import Path
import urllib.request
from jsonschema import Draft202012Validator
ROOT=Path(__file__).resolve().parents[1]
def get(url,body=None):
    h={'User-Agent':'MUSITU-Axiom-Public-Readiness/2.0.5','Accept':'application/json'}
    if body is not None:h['Content-Type']='application/json'
    with urllib.request.urlopen(urllib.request.Request(url,headers=h,data=json.dumps(body).encode() if body is not None else None),timeout=40) as r:return r.status,dict(r.headers),r.read()
def rpc(method,params=None):return json.loads(get('https://mcp.mftintelligence.com/mcp',{'jsonrpc':'2.0','id':1,'method':method,'params':params or {}})[2])
def main():
    health=json.loads(get('https://mcp.mftintelligence.com/health')[2]);assert health['ok'] is True and health['server_version']=='4.0.2' and health['oauth_enforced'] is True
    tools=rpc('tools/list')['result']['tools'];assert len(tools)==108 and len({t['name'] for t in tools})==108
    hidden={'musitu_axiom_plans','musitu_axiom_recommend_plan','musitu_axiom_start_checkout','musitu_axiom_checkout_status'};assert not (hidden & {t['name'] for t in tools})
    examples=json.loads((ROOT/'mcp/tests/fixtures/operation-examples.json').read_text());count=0
    for t in tools:
        schema=t['inputSchema'];Draft202012Validator.check_schema(schema);op=t.get('_meta',{}).get('musitu/operation')
        if op:Draft202012Validator(schema).validate({'args':examples[op]});count+=1
        if t['name']=='musitu_axiom_execute':
            for op,args in examples.items():Draft202012Validator(schema).validate({'operation':op,'args':args})
            count+=1
    assert count==105
    denied=rpc('tools/call',{'name':'moving_average','arguments':{'args':{'data':[1,2,3],'window':2}}})['result'];assert denied['isError'] is True and denied['structuredContent']['authenticated'] is False and denied['_meta']['mcp/www_authenticate']
    modern=rpc('server/discover')['result'];assert modern['resultType']=='complete' and '2026-07-28' in modern['supportedVersions']
    for path in ['/docs','/privacy','/terms']:
        status,headers,body=get('https://mcp.mftintelligence.com'+path);assert status==200 and b'<html' in body.lower()
    status,headers,body=get('https://support.mftintelligence.com/');assert status==200 and headers.get('cf-mitigated')!='challenge' and b'mailto:support@mftintelligence.com' in body
    result={'gate':'MUSITU_AXIOM_V205_PUBLIC_READINESS_PASS','server_version':health['server_version'],'tool_count':108,'operation_count':74,'business_alias_count':30,'computation_schemas':count,'oauth_enforced':True,'support_accessible':True,'authenticated_calculation_checks':'separate exact-reviewer acceptance evidence','portal_submission_status':'not asserted by this check'}
    (ROOT/'axiom-v205-public-readiness.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()

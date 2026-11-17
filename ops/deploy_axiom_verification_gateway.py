"""One-use verification repair through the established guarded upload path.

The mission of 17 November authorizes this gateway-only correction after
acceptance. Source pins below come from fresh provider GET readback, with the
old gateway byte-identical to PR47. No kernel, auth, D1, metering, pricing,
route, domain, secret, protected branch or other Worker is writable here.
"""
import hashlib
import deploy_axiom_reviewer_gateway as guarded

guarded.SOURCE_PIN='56fe9fb18959144d759c9b64b89e0fe2af78fe348003804f3af5d0e4b518dd24'

def verify_public():
    health=guarded.public('/health')
    expected=hashlib.sha256((guarded.ROOT/'mcp/independent_verification.mjs').read_bytes()).hexdigest()
    assert health.get('ok') is True and health.get('server_version')=='4.0.3' and health.get('oauth_enforced') is True
    checker=health.get('independent_verification') or {}
    assert checker.get('version')=='axiom-independent-v1' and checker.get('source_sha256')==expected
    assert checker.get('scope')==['arithmetic.evaluate','finance.npv','optimization.linear_program']
    listed=guarded.public('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/list','params':{}})['result']['tools']
    assert len(listed)==108
    count=0
    for tool in listed:
        if tool['name'] in ['search','fetch','musitu_axiom_capabilities']:continue
        schema=tool['inputSchema'];assert schema['properties']['args']['type']=='object'
        assert schema.get('oneOf') or schema['properties']['args'].get('properties');count+=1
    assert count==105
    blocked=guarded.public('/mcp',{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'investment_npv','arguments':{'args':{'cashflows':[-1,2],'rate':.1}}}})['result']
    assert blocked.get('isError') is True and blocked['structuredContent'].get('authenticated') is False and blocked.get('_meta',{}).get('mcp/www_authenticate')
    discovery=guarded.public('/mcp',{'jsonrpc':'2.0','id':3,'method':'server/discover','params':{}})['result']
    assert discovery['resultType']=='complete' and '2026-07-28' in discovery['supportedVersions']
    return {'tool_count':108,'computation_schema_count':count,'oauth_enforced':True,'modern_discover':True,'checker_source_sha256':expected}

if __name__=='__main__':
    # Retain the original source/settings/core guards and race-aware rollback.
    guarded.verify_public=verify_public
    guarded.main()

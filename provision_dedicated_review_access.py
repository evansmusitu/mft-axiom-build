import base64, datetime, hashlib, http.cookiejar, json, os, pathlib, re, secrets, subprocess, urllib.error, urllib.parse, urllib.request
from html.parser import HTMLParser
class OAuthPage(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.fields={};self.urls=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='input' and a.get('type')=='hidden' and a.get('name'):self.fields[a['name']]=a.get('value','')
        if tag in ('a','form'):
            u=a.get('href') or a.get('action')
            if u:self.urls.append(u)
        if tag=='meta' and a.get('http-equiv','').lower()=='refresh':
            value=a.get('content','');match=re.search(r'url=(.*)',value,re.I)
            if match:self.urls.append(match.group(1).strip().strip('\"\''))
CF_BASE='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/d1/database/504029cc-f9a5-495e-818f-63c6144b4ea4/query'
MCP='https://mcp.mftintelligence.com/mcp'
AUTH='https://auth.mftintelligence.com'
CUSTOMER='openai_reviewer_20261027_private_v3'
KEY_ID='openai_reviewer_key_20261027_private_v3'
EMAIL='openai-review-20261027-v3@invalid.example'
UNIT_LIMIT=1000
OUTPUT=pathlib.Path('reviewer-access-evidence')
PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAmzMTaZWwhS6lKmq4/vlF\nKjmLbNU76ACViOztfy11mXmfMQBVbbr8cAJiS+dKOYFuRqB8ss1sFFsxF2CYYko/\niyWPDjGBRlcPVBJ4xmxZGPJxdlwtcxGxVFTzUdqsRn0gpSmvrfDpmTT30XxU1m0u\nqKLpSyAAZzSd55oAM6XbZUJllqSJxHumwz9LwZ/o8lODmLhivM4Q15aXFaH7hxmJ\nNeEXTumQPjsUIsl51pCeza1ORWzaTzx87BgZ4ef026pPC52e6YgTBhAzXOtlyUAT\noz37oyGb4jfjvlzAKSr5FZ7aoXeN0pvdOihTiIbSa4JtOQkFXs1Pio3ubj2bPw1e\nB/GZ0CEZcqZZHBcNOJqY42IiPkUFblpSmvT3jScUqGtAvD1SyVKBuuCLb60oXVq1\nW8o1J4ctBiAZOGJJb6Yb1TbIi/EE4oSajaLgLUHO32oyInldGLiTqHgkrWZpKILM\nPrNgNEzMXL+TExQ9wQDkdNfEfKmllpMNB5+nvKneU6EDXM0OKurgxU01nsBcwsjx\ntcPIjZMGcPjbSzHLB/8WwwyeF4etN2Xoze6cyc7tSuYHVCNbNTHRajIo0fWW4bYz\nvQ0XgOFNaoxp1T2tU1H/U10cpv72jIv3L4crhVZc3QLXNX2L3vkVwHnzKhqItlB/\nLeXuMWZhwRO2p1UFYWbZohECAwEAAQ==\n-----END PUBLIC KEY-----"
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
def d1(sql,params=None):
    body={'sql':sql}
    if params is not None:body['params']=params
    request=urllib.request.Request(CF_BASE,method='POST',headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json'},data=json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request,timeout=45) as r: obj=json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError('D1 operation rejected HTTP '+str(e.code)) from None
    if not obj.get('success') or not obj.get('result') or not all(r.get('success') for r in obj['result']):
        raise RuntimeError('D1 operation unsuccessful')
    return [row for r in obj['result'] for row in r.get('results',[])]
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),NoRedirect())
def http(url,body=None,headers=None):
    req=urllib.request.Request(url,data=body,headers=headers or {})
    try:
        with opener.open(req,timeout=45) as r:return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def post_json(url,obj):
    c,h,b=http(url,json.dumps(obj).encode(),{'Content-Type':'application/json','Accept':'application/json'})
    if c not in (200,201):raise RuntimeError('JSON endpoint rejected HTTP '+str(c))
    return json.loads(b)
def mcp(name,args,token=None):
    h={'Content-Type':'application/json','Accept':'application/json, text/event-stream'}
    if token:h['Authorization']='Bearer '+token
    c,_,b=http(MCP,json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}}).encode(),h)
    if c!=200:raise RuntimeError('MCP call rejected HTTP '+str(c))
    try:return json.loads(b)['result']
    except (ValueError,KeyError):raise RuntimeError('Invalid MCP response') from None
def decode_result(result):
    if result.get('isError'):raise RuntimeError('Axiom returned a tool error')
    structured=result.get('structuredContent')
    return structured if isinstance(structured,dict) else result
def main():
    OUTPUT.mkdir(mode=0o700,exist_ok=True)
    if not os.environ.get('CLOUDFLARE_API_TOKEN'):raise RuntimeError('Scoped token absent')
    if len(d1('PRAGMA table_info(customers)'))!=8 or len(d1('PRAGMA table_info(api_keys)'))!=10:raise RuntimeError('Identity schema drift')
    # Never reuse, update, or read an unrelated account.
    existing=d1('SELECT (SELECT count(*) FROM customers WHERE id=?1 OR email=?3)+(SELECT count(*) FROM api_keys WHERE id=?2) AS n',[CUSTOMER,KEY_ID,EMAIL])
    if int(existing[0]['n'])!=0:raise RuntimeError('Dedicated reviewer identity already exists; no mutation performed')
    c,_,metadata_raw=http('https://mcp.mftintelligence.com/.well-known/oauth-protected-resource')
    if c!=200:raise RuntimeError('Protected-resource discovery rejected HTTP '+str(c))
    resource=json.loads(metadata_raw).get('resource')
    if not isinstance(resource,str) or urllib.parse.urlparse(resource).scheme!='https' or urllib.parse.urlparse(resource).netloc!='mcp.mftintelligence.com':raise RuntimeError('Unexpected OAuth resource identifier')
    account_key='musitu_axiom_review_'+secrets.token_urlsafe(42)
    print('::add-mask::'+account_key)
    key_hash=hashlib.sha256(account_key.encode()).hexdigest()
    created=now()
    expires=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=90)).isoformat().replace('+00:00','Z')
    payload={'account_key':account_key,'customer_id':CUSTOMER,'email':EMAIL,'expires_at':expires,'monthly_units':UNIT_LIMIT}
    pub=OUTPUT/'transport-public.pem';pub.write_text(PUBLIC_KEY)
    subprocess.run(['openssl','pkeyutl','-encrypt','-pubin','-inkey',str(pub),'-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256','-out',str(OUTPUT/'reviewer-credential.enc')],input=json.dumps(payload,separators=(',',':')).encode(),check=True,capture_output=True)
    evidence={'schema':'musitu.axiom.dedicated_openai_review_access.v1','customer_id':CUSTOMER,'sample_email':EMAIL,'monthly_compute_units':UNIT_LIMIT,'key_expires_at':expires,'admin_access_granted':False,'payment_setup':False,'credential_values_published':False,'new_account_created':False,'oauth_pkce_verified':False,'exact_reviewer_account_tests':[],'independent_chatgpt_routing_same_identity':False}
    access=refresh=None
    mutation_attempted=False
    try:
        mutation_attempted=True
        d1('INSERT INTO customers(id,email,name,plan,status,monthly_unit_override,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)',[CUSTOMER,EMAIL,'OpenAI dedicated synthetic review account','developer','active',UNIT_LIMIT,created])
        d1('INSERT INTO api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,NULL)',[KEY_ID,CUSTOMER,key_hash,account_key[:16],'openai-private-review-only','active',created,expires])
        evidence['new_account_created']=True
        # Genuine DCR + consent + PKCE exchange; no session is fabricated in the database.
        redirect='https://chatgpt.com/connector_platform_oauth_redirect'
        registered=post_json(AUTH+'/oauth/register',{'redirect_uris':[redirect],'client_name':'MUSITU dedicated OpenAI reviewer verification'})
        client=registered['client_id']
        verifier=secrets.token_urlsafe(48)
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        state=secrets.token_urlsafe(24)
        query=urllib.parse.urlencode({'response_type':'code','client_id':client,'redirect_uri':redirect,'resource':resource,'scope':'axiom.execute','code_challenge':challenge,'code_challenge_method':'S256','state':state})
        c,h,b=http(AUTH+'/oauth/authorize?'+query)
        if c!=200:raise RuntimeError('OAuth consent page rejected HTTP '+str(c))
        consent=OAuthPage();consent.feed(b.decode('utf-8','strict'))
        if not consent.fields.get('flow_id'):raise RuntimeError('OAuth consent contract differs')
        consent.fields['musitu_account_key']=account_key
        c,h,b=http(AUTH+'/oauth/authorize',urllib.parse.urlencode(consent.fields).encode(),{'Content-Type':'application/x-www-form-urlencoded','Accept':'text/html'})
        if c not in (200,302):raise RuntimeError('Dedicated reviewer OAuth authentication rejected HTTP '+str(c))
        location=h.get('Location') or h.get('location') or ''
        if c==200:
            completed=OAuthPage();completed.feed(b.decode('utf-8','strict'))
            callbacks=[u for u in completed.urls if urllib.parse.urlparse(u).scheme=='https' and urllib.parse.urlparse(u).netloc=='chatgpt.com' and urllib.parse.urlparse(u).path=='/connector_platform_oauth_redirect' and urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get('state')==[state] and urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get('code')]
            if not callbacks or len(set(callbacks))!=1:raise RuntimeError('OAuth consent did not return a valid ChatGPT callback')
            location=callbacks[0]
        target=urllib.parse.urlparse(location)
        q=urllib.parse.parse_qs(target.query)
        if target.scheme!='https' or target.netloc!='chatgpt.com' or target.path!='/connector_platform_oauth_redirect' or q.get('state')!=[state] or len(q.get('code',[]))!=1:raise RuntimeError('OAuth callback or state mismatch')
        c,_,b=http(AUTH+'/oauth/token',urllib.parse.urlencode({'grant_type':'authorization_code','client_id':client,'redirect_uri':redirect,'resource':resource,'code':q['code'][0],'code_verifier':verifier}).encode(),{'Content-Type':'application/x-www-form-urlencoded'})
        if c!=200:raise RuntimeError('PKCE token exchange rejected HTTP '+str(c))
        token=json.loads(b);access=token['access_token'];refresh=token['refresh_token']
        print('::add-mask::'+access);print('::add-mask::'+refresh)
        evidence['oauth_pkce_verified']=True
        search=mcp('search',{'query':'time-series analysis'},access)
        decoded=decode_result(search)
        serialized=json.dumps(decoded)
        if not any(x in serialized for x in ['moving_average','timeseries.moving_average']):raise RuntimeError('Review search result missing expected time-series capability')
        evidence['exact_reviewer_account_tests'].append({'case':1,'prompt':'Use MUSITU Axiom to find tools for time-series analysis.','tool':'search','passed':True})
        fetched=decode_result(mcp('fetch',{'id':'tool:moving_average'},access))
        if 'moving_average' not in json.dumps(fetched):raise RuntimeError('Selected capability fetch failed')
        evidence['exact_reviewer_account_tests'].append({'case':2,'tool':'fetch','selected_capability':'tool:moving_average','passed':True})
        capabilities=decode_result(mcp('musitu_axiom_capabilities',{},access))
        if not any(x in json.dumps(capabilities) for x in ['74','operations']):raise RuntimeError('Capability inventory missing')
        evidence['exact_reviewer_account_tests'].append({'case':3,'tool':'musitu_axiom_capabilities','passed':True})
        for case,expression,expected in [(4,'40+2',42),(5,'(12*8)-5',91)]:
            result=decode_result(mcp('musitu_axiom_execute',{'operation':'arithmetic.evaluate','args':{'expression':expression}},access))
            if not re.search(r'(?<![0-9])'+str(expected)+r'(?:\.0+)?(?![0-9])',json.dumps(result)):raise RuntimeError('Arithmetic result mismatch for review case '+str(case))
            evidence['exact_reviewer_account_tests'].append({'case':case,'tool':'musitu_axiom_execute','expression':expression,'observed_result':expected,'passed':True})
        # The actual account's usage ledger proves its identity and metering.
        ledger=d1('SELECT operation,compute_units,http_status FROM usage_events WHERE customer_id=?1 ORDER BY created_at',[CUSTOMER])
        if len(ledger)!=2 or any(x['operation']!='arithmetic.evaluate' or int(x['http_status'])!=200 for x in ledger):raise RuntimeError('Dedicated review-account usage mismatch')
        evidence['metered_compute_events']=len(ledger)
        evidence['compute_units_used']=sum(int(x['compute_units']) for x in ledger)
        evidence['gate']='DEDICATED_REVIEWER_OAUTH_AND_FIVE_POSITIVE_PROTOCOL_CASES_PASS'
        evidence['reviewer_key_remains_active']=True
    except Exception:
        evidence['gate']='FAILED_NOT_REVIEWER_READY'
        if mutation_attempted:
            # Reconcile ambiguous writes and disable only the exact new identity from this job.
            try:
                d1("UPDATE api_keys SET status='revoked',revoked_at=?4 WHERE id=?1 AND customer_id=?2 AND key_hash=?3",[KEY_ID,CUSTOMER,key_hash,now()])
                d1("UPDATE customers SET status='suspended',updated_at=?3 WHERE id=?1 AND email=?2 AND created_at=?4",[CUSTOMER,EMAIL,now(),created])
                evidence['failed_account_disabled']=True
            except Exception:evidence['failed_account_disabled']=False
        raise
    finally:
        if access or refresh:
            for tok in [access,refresh]:
                if not tok:continue
                try:
                    c,_,_=http(AUTH+'/oauth/revoke',urllib.parse.urlencode({'token':tok}).encode(),{'Content-Type':'application/x-www-form-urlencoded'})
                    if c!=200:evidence['oauth_test_session_cleanup_failed']=True
                except Exception:evidence['oauth_test_session_cleanup_failed']=True
        evidence['completed_at']=now()
        (OUTPUT/'evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n')
        print(json.dumps(evidence,sort_keys=True))
if __name__=='__main__':
    main()

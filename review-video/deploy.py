import email,hashlib,json,os,pathlib,urllib.error,urllib.request,uuid
META={"video_sha256":"e86d25e667cc279f8823e70d4d7c7fb378da4e02aeb3a0f3a9e2b53154833a22","source_sha256":"c080aa2035fa45d668e4070b35cac12caff60da6d8b19db93b9f913f499e67af","video_bytes":1372231,"source_bytes":1831262,"asset_path":"/review/c7314d6d94510b5174f53db8/walkthrough.mp4","worker_name":"musitu-axiom-review-video-20261027-c7314d"}
ROOT='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61'
NAME=META['worker_name']
if not NAME.startswith('musitu-axiom-review-video-20261027-'):raise RuntimeError('Unexpected asset target')
TOKEN=os.environ.get('CLOUDFLARE_API_TOKEN','')
if not TOKEN:raise RuntimeError('Scoped token unavailable')
def api(path,method='GET',body=None,content_type='application/json'):
    allowed={'/workers/scripts','/workers/subdomain','/workers/scripts/'+NAME,'/workers/scripts/'+NAME+'/settings','/workers/scripts/'+NAME+'/subdomain'}
    if path not in allowed:raise RuntimeError('API target outside static review asset scope')
    h={'Authorization':'Bearer '+TOKEN}
    if body is not None:h['Content-Type']=content_type
    req=urllib.request.Request(ROOT+path,data=body,headers=h,method=method)
    try:
        with urllib.request.urlopen(req,timeout=60) as r:return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:raise RuntimeError('Asset API request rejected HTTP '+str(e.code)) from None
def json_api(path,method='GET',obj=None):
    _,_,raw=api(path,method,None if obj is None else json.dumps(obj).encode())
    parsed=json.loads(raw)
    if not parsed.get('success'):raise RuntimeError('Asset API result unsuccessful')
    return parsed.get('result')
source=pathlib.Path('review-video/asset.mjs').read_bytes()
if hashlib.sha256(source).hexdigest()!=META['source_sha256']:raise RuntimeError('Asset source hash mismatch')
current=json_api('/workers/scripts')
if any(x.get('id')==NAME for x in current):raise RuntimeError('Target already exists; refusing to overwrite')
subdomain=json_api('/workers/subdomain').get('subdomain')
if not subdomain:raise RuntimeError('Existing account workers.dev subdomain unavailable; no mutation')
boundary='review_asset_'+uuid.uuid4().hex
meta={'main_module':'index.mjs','compatibility_date':'2026-10-27','bindings':[]}
body=(('--'+boundary+'\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'+json.dumps(meta)+'\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n').encode()+source+('\r\n--'+boundary+'--\r\n').encode())
enabled=False
try:
    c,_,r=api('/workers/scripts/'+NAME,'PUT',body,'multipart/form-data; boundary='+boundary)
    if c not in (200,201) or not json.loads(r).get('success'):raise RuntimeError('Static asset upload unsuccessful')
    _,h,raw=api('/workers/scripts/'+NAME)
    ct=h.get('Content-Type') or h.get('content-type') or ''
    if 'multipart/' in ct:
        msg=email.message_from_bytes(('Content-Type: '+ct+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
        candidates=[p.get_payload(decode=True) or b'' for p in msg.walk() if not p.is_multipart()]
        if not any(hashlib.sha256(x).hexdigest()==META['source_sha256'] for x in candidates):raise RuntimeError('Static asset source readback mismatch')
    elif hashlib.sha256(raw).hexdigest()!=META['source_sha256']:raise RuntimeError('Static asset source readback mismatch')
    settings=json_api('/workers/scripts/'+NAME+'/settings')
    if settings.get('bindings'):raise RuntimeError('Static review asset unexpectedly has bindings')
    json_api('/workers/scripts/'+NAME+'/subdomain','POST',{'enabled':True,'previews_enabled':False});enabled=True
    url='https://'+NAME+'.'+subdomain+'.workers.dev'+META['asset_path']
    with urllib.request.urlopen(urllib.request.Request(url),timeout=60) as r:
        remote=r.read()
        if r.status!=200 or r.headers.get('content-type','').split(';')[0]!='video/mp4':raise RuntimeError('Public recording HTTP/content-type mismatch')
    if hashlib.sha256(remote).hexdigest()!=META['video_sha256']:raise RuntimeError('Public recording byte hash mismatch')
    with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-1023'}),timeout=60) as r:
        if r.status!=206 or len(r.read())!=1024:raise RuntimeError('Public range playback request failed')
    evidence={**META,'walkthrough_url':url,'gate':'REVIEW_VIDEO_PUBLIC_READ_ONLY_LINK_PASS','public_video_sha256_verified':True,'range_playback_verified':True,'asset_has_bindings':False,'product_workers_modified':False,'dns_routes_modified':False,'new_paid_subscription_created':False,'revoke_link':'Disable the workers.dev subdomain for '+NAME}
    pathlib.Path('review-video/link-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence,sort_keys=True))
except Exception:
    if enabled:
        try:json_api('/workers/scripts/'+NAME+'/subdomain','POST',{'enabled':False,'previews_enabled':False})
        except Exception:print('Static review link disable reconciliation required')
    raise

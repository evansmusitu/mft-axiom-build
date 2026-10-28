import email,hashlib,json,os,pathlib,re,urllib.error,urllib.request
META={"video_sha256":"e86d25e667cc279f8823e70d4d7c7fb378da4e02aeb3a0f3a9e2b53154833a22","source_sha256":"c080aa2035fa45d668e4070b35cac12caff60da6d8b19db93b9f913f499e67af","video_bytes":1372231,"asset_path":"/review/c7314d6d94510b5174f53db8/walkthrough.mp4","worker_name":"musitu-axiom-review-video-20261027-c7314d"}
ROOT='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61'
NAME=META['worker_name']
TOKEN=os.environ['CLOUDFLARE_API_TOKEN']
def api(path,method='GET',obj=None):
    allowed={'/workers/subdomain','/workers/scripts/'+NAME,'/workers/scripts/'+NAME+'/settings','/workers/scripts/'+NAME+'/subdomain'}
    if path not in allowed or method not in ('GET','POST') or (method=='POST' and path!='/workers/scripts/'+NAME+'/subdomain'):raise RuntimeError('Out of review asset scope')
    req=urllib.request.Request(ROOT+path,data=None if obj is None else json.dumps(obj).encode(),headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},method=method)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:return dict(r.headers),r.read()
    except urllib.error.HTTPError as e:raise RuntimeError('Cloudflare API HTTP '+str(e.code)) from None
def ja(path,method='GET',obj=None):
    _,raw=api(path,method,obj);data=json.loads(raw)
    if not data.get('success'):raise RuntimeError('Cloudflare API unsuccessful')
    return data['result']
h,raw=api('/workers/scripts/'+NAME)
ct=h.get('Content-Type') or h.get('content-type') or ''
if 'multipart/' in ct:
    msg=email.message_from_bytes(('Content-Type: '+ct+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
    candidates=[p.get_payload(decode=True) or b'' for p in msg.walk() if not p.is_multipart()]
    matches=sum(hashlib.sha256(x).hexdigest()==META['source_sha256'] for x in candidates)
else:matches=int(hashlib.sha256(raw).hexdigest()==META['source_sha256'])
if matches!=1:raise RuntimeError('Existing asset source is not the pinned credential-free recording')
settings=ja('/workers/scripts/'+NAME+'/settings')
if settings.get('bindings'):raise RuntimeError('Unexpected binding; no change made')
subdomain=ja('/workers/subdomain')['subdomain']
state=ja('/workers/scripts/'+NAME+'/subdomain')
url='https://'+NAME+'.'+subdomain+'.workers.dev'+META['asset_path']
print(json.dumps({'gate':'REVIEW_VIDEO_EXISTING_ASSET_PIN_VERIFIED','url':url,'subdomain_before':state,'has_bindings':False}))
ja('/workers/scripts/'+NAME+'/subdomain','POST',{'enabled':True,'previews_enabled':False})
state_after=ja('/workers/scripts/'+NAME+'/subdomain')
print(json.dumps({'gate':'REVIEW_VIDEO_ENDPOINT_ENABLED','subdomain_after':state_after}))
req=urllib.request.Request(url)
try:
    with urllib.request.urlopen(req,timeout=45) as r:
        data=r.read()
        result={'http_status':r.status,'content_type':r.headers.get('content-type'),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        if r.status==200 and result['sha256']==META['video_sha256']:result['gate']='REVIEW_VIDEO_FULL_PUBLIC_HASH_PASS'
except urllib.error.HTTPError as e:
    raw=e.read(65536).decode('utf-8','replace')
    title=re.search(r'<title[^>]*>(.*?)</title>',raw,re.I|re.S)
    text=re.sub(r'<[^>]+>',' ',raw)
    text=re.sub(r'\s+',' ',text).strip()
    result={'http_status':e.code,'content_type':e.headers.get('content-type'),'title':title.group(1).strip() if title else None,'body_excerpt':text[:1800],'cf_mitigated':e.headers.get('cf-mitigated'),'server':e.headers.get('server')}
print(json.dumps(result,sort_keys=True))
pathlib.Path('review-video/endpoint-diagnostic.json').write_text(json.dumps({'meta':META,'url':url,'state':state_after,'observation':result},indent=2)+'\n')

"""Read-only current Axiom sources and sealed kernel contract capture."""
import base64,email,hashlib,hmac,io,json,os,pathlib,secrets,subprocess,tarfile,urllib.error,urllib.parse,urllib.request

ACCOUNT='93f395f5121954671f92fffa453d6b61'
API='https://api.cloudflare.com/client/v4'
DEST=pathlib.Path('verification-readback');DEST.mkdir(mode=0o700,exist_ok=True)
PRIVATE=pathlib.Path('.private-review-readback');PRIVATE.mkdir(mode=0o700,exist_ok=True)
TOKEN=os.environ['CLOUDFLARE_API_TOKEN']
PUB='''-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA4DsD206W5CiuanLihQM5
CIDnx0mkRV3JpVUMK3b8xCdfd7/YM6P4z9i02AHdb1Z+U+NA/Uy45OmXm1fhi5R1
8uBd4hlrkSnvqSe02HTzCr0f980eLpiNQ8gGb24tIpLyRgVXFEubYLzH0SFM5Uyj
czXAFxA41SI5YnTuwvUyYEDJdDf9l6bSlf+qaVN+62CvybhXhxShB8n/NR0zoR6R
wopG/HogBWJ9/EgDjqpzj0NS/RlK+z9q55KFqgEgzVcu709ryv+xeSXOtaPwSrgq
qersSPdIMMs7fV5flEblgeH1eeoscczxRUuncl3dHLWJiK3tbX9t40K+0FBRgfHq
Hl5hBeAgaUwjPiz9ZBR2lltBm6gZQPY+Z3xp0JZO6H7Ro6vQCnBTUnMbwBPJ0kgJ
FcCgOfl7uW4TdNYfUkd5VVWXDFUKOsppxTH7XTv410hMTs9/RSJakxTkURhm2YJH
lw+rzp/XhXhR7z73PluMhhGiHr3OqLh5EeEWUfRcLiAPAgMBAAE=
-----END PUBLIC KEY-----
'''

def get(path):
    if not path.startswith(('/accounts/'+ACCOUNT+'/workers/','/zones')):raise RuntimeError('Read target outside Axiom capture scope')
    req=urllib.request.Request(API+path,headers={'Authorization':'Bearer '+TOKEN,'User-Agent':'MUSITU-Reviewer-Fix-Readback/1.0'})
    try:
        with urllib.request.urlopen(req,timeout=40) as r:return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:return e.code,{},e.read()

def json_get(path):
    c,_,raw=get(path)
    try:data=json.loads(raw)
    except ValueError:return c,None
    return c,data.get('result') if data.get('success') else None

manifest={'schema':'musitu.axiom.reviewer-fixes.readback.v1','mutation_performed':False,'workers':{},'zone_reads':{}}
def capture_worker(name):
    if name in manifest['workers']:return
    if not (name.startswith('musitu-axiom-') or name=='mft-axiom-modal-edge-stage'):raise RuntimeError('Worker outside Axiom source scope')
    path='/accounts/'+ACCOUNT+'/workers/scripts/'+urllib.parse.quote(name,safe='')
    c,h,raw=get(path)
    if c!=200:manifest['workers'][name]={'http':c};return
    ct=h.get('Content-Type') or h.get('content-type') or ''
    modules={}
    if 'multipart/' in ct:
        msg=email.message_from_bytes(('Content-Type: '+ct+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
        for part in msg.walk():
            if part.is_multipart():continue
            filename=part.get_filename() or part.get_param('name',header='content-disposition') or 'index.mjs'
            if pathlib.PurePosixPath(filename).is_absolute() or '..' in pathlib.PurePosixPath(filename).parts:raise RuntimeError('Unsafe module filename')
            modules[filename]=part.get_payload(decode=True) or b''
    else:modules={'index.mjs':raw}
    folder=PRIVATE/'workers'/name;folder.mkdir(parents=True,exist_ok=True)
    for filename,body in modules.items():
        p=folder/filename;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
    sc,settings=json_get(path+'/settings')
    if settings is not None:(folder/'settings.json').write_text(json.dumps(settings,indent=2)+'\n')
    manifest['workers'][name]={'http':c,'modules':{n:{'sha256':hashlib.sha256(v).hexdigest(),'bytes':len(v)} for n,v in modules.items()},'settings_http':sc,'settings_sha256':hashlib.sha256(json.dumps(settings,sort_keys=True,separators=(',',':')).encode()).hexdigest() if settings is not None else None,'binding_names':[{'name':b.get('name'),'type':b.get('type'),'service':b.get('service')} for b in (settings or {}).get('bindings',[])]}
    if name in ['musitu-axiom-mcp','musitu-axiom-mcp-core']:
        for binding in (settings or {}).get('bindings',[]):
            if binding.get('name') in ['MCP_CORE','AXIOM_SERVICE'] and binding.get('type')=='service':capture_worker(binding['service'])

capture_worker('musitu-axiom-mcp')
# The retired global key is used only as the historical archive's offline password.
# It is never sent to any API and never used for Cloudflare authentication.
try:
    m=json.loads(pathlib.Path('deploy_payload/runtime_min/MANIFEST.json').read_text())
    cipher=base64.b64decode(''.join((pathlib.Path('deploy_payload/runtime_min')/n).read_text() for n in m['chunk_order']))
    assert hashlib.sha256(cipher).hexdigest()==m['ciphertext_sha256']
    password=os.environ.get('AXIOM_LEGACY_PAYLOAD_PASSPHRASE','')
    if not password:raise RuntimeError('Historical archive password unavailable')
    assert hmac.compare_digest(hmac.new(password.encode(),cipher,hashlib.sha256).hexdigest(),m['ciphertext_hmac_sha256'])
    enc=PRIVATE/'runtime.tar.gz.enc';enc.write_bytes(cipher)
    dec=PRIVATE/'runtime.tar.gz'
    subprocess.run(['openssl','enc','-d','-aes-256-cbc','-pbkdf2','-iter',str(m['iterations']),'-in',str(enc),'-out',str(dec),'-pass','env:AXIOM_LEGACY_PAYLOAD_PASSPHRASE'],check=True,capture_output=True)
    assert hashlib.sha256(dec.read_bytes()).hexdigest()==m['plaintext_tar_sha256']
    manifest['kernel_archive']={'verified':True,'plaintext_tar_sha256':m['plaintext_tar_sha256']}
except Exception as e:
    manifest['kernel_archive']={'verified':False,'failure_type':type(e).__name__}

pub=PRIVATE/'recipient-public.pem';pub.write_text(PUB)
key=PRIVATE/'transport-password';key.write_text(secrets.token_hex(32));os.chmod(key,0o600)
archive=PRIVATE/'capture.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
    for p in sorted(PRIVATE.rglob('*')):
        if p.is_file() and p.name not in ['capture.tar.gz','transport-password','recipient-public.pem']:tar.add(p,arcname=str(p.relative_to(PRIVATE)))
subprocess.run(['openssl','enc','-aes-256-cbc','-pbkdf2','-iter','250000','-salt','-in',str(archive),'-out',str(DEST/'capture.enc'),'-pass','file:'+str(key)],check=True,capture_output=True)
subprocess.run(['openssl','pkeyutl','-encrypt','-pubin','-inkey',str(pub),'-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256','-in',str(key),'-out',str(DEST/'transport-key.enc')],check=True,capture_output=True)
manifest['capture_sha256']=hashlib.sha256((DEST/'capture.enc').read_bytes()).hexdigest()
(DEST/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,sort_keys=True))

#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${CLOUDFLARE_EMAIL:?}"
: "${CLOUDFLARE_API_KEY:?}"
: "${CLOUDFLARE_GLOBAL_API_KEY:?}"
STAGING_WORKER="${STAGING_WORKER:-mft-axiom-staging}"
STAGING_DB="${STAGING_DB:-mft-axiom-staging}"
DEPLOY_BUILD_ID="${DEPLOY_BUILD_ID:-MFT-AXIOM-V3-RUNTIME-RECONSTRUCTION-20260904}"
ROOT="$PWD"
P="$ROOT/deploy_payload/runtime_min"

rm -rf runtime runtime.tar.gz runtime.tar.gz.enc runtime.enc.b64
cat "$P/chunk_00.b64" "$P/chunk_01_02.b64" "$P/chunk_03_04.b64" "$P/chunk_05_06.b64" "$P/chunk_07_08.b64" "$P/chunk_09.b64" > runtime.enc.b64
base64 -d runtime.enc.b64 > runtime.tar.gz.enc
test "$(sha256sum runtime.tar.gz.enc | awk '{print $1}')" = 'b82448d6b4b34b302748815af976b535d69922c197d4b7a9056fc2f91a9e12cf'
python - <<'PY'
import hashlib,hmac,os
b=open('runtime.tar.gz.enc','rb').read()
got=hmac.new(os.environ['CLOUDFLARE_GLOBAL_API_KEY'].encode(),b,hashlib.sha256).hexdigest()
if not hmac.compare_digest(got,'1a3193d4f3271d61d151e6ebd7cf4576d8ab86c2e79b84eff4ad0f635fe7ab47'):
    raise SystemExit('Fail-closed: encrypted transport HMAC mismatch')
print('transport_hmac=PASS')
PY
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -in runtime.tar.gz.enc -out runtime.tar.gz -pass env:CLOUDFLARE_GLOBAL_API_KEY
test "$(sha256sum runtime.tar.gz | awk '{print $1}')" = 'b4d5a0266446523969a619f5e9bb5a04d9b815c78a2ab82ed046ef5e23d53663'
mkdir runtime
tar -xzf runtime.tar.gz -C runtime
python - <<'PY'
import hashlib,json,pathlib
root=pathlib.Path('runtime'); m=json.loads((root/'RUNTIME_SOURCE_MANIFEST.json').read_text())
if m.get('source_build')!='MFT-AXIOM-V3-FULL-SELF-CONTAINED-20260904': raise SystemExit('source build identity mismatch')
problems=[]
for f in m['files']:
    p=root/f['path']
    if not p.is_file(): problems.append((f['path'],'missing')); continue
    b=p.read_bytes()
    if len(b)!=f['size'] or hashlib.sha256(b).hexdigest()!=f['sha256']: problems.append((f['path'],'integrity'))
if problems: raise SystemExit('Fail-closed source integrity mismatch: '+repr(problems[:5]))
print('source_integrity=PASS')
PY
node --input-type=module - <<'NODE'
import { TOOLS } from './runtime/worker/src/catalog.js';
if (!Array.isArray(TOOLS) || TOOLS.length !== 74 || new Set(TOOLS).size !== 74) throw new Error('operation registry mismatch');
console.log('operation_registry=PASS');
NODE
grep -q "enableInternet:false" runtime/worker/src/cloudflare.js
grep -q "wolfram_parity:'NOT_CERTIFIED'" runtime/worker/src/index.js
grep -q "superiority:'NOT_CERTIFIED'" runtime/worker/src/index.js

python - <<'PY'
from pathlib import Path
p=Path('runtime/worker/src/catalog.js'); s=p.read_text()
old="export const BUILD_ID = 'MFT-AXIOM-V3-SELF-CONTAINED-20260904';"
new="export const BUILD_ID = 'MFT-AXIOM-V3-RUNTIME-RECONSTRUCTION-20260904';"
if s.count(old)!=1: raise SystemExit('expected build identity not found exactly once')
p.write_text(s.replace(old,new))
PY
cat > runtime/kernel/Dockerfile <<'DOCKER'
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY kernel/requirements.txt /tmp/requirements.txt
COPY kernel/requirements.full.txt /tmp/requirements.full.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.full.txt
COPY kernel/app /app/app
EXPOSE 8080
CMD ["python","-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8080","--workers","1"]
DOCKER
sha256sum runtime/worker/src/catalog.js runtime/kernel/Dockerfile > deployment-mutations.sha256

cd runtime
npm install --ignore-scripts --no-audit --no-fund wrangler@4.129.0
npx wrangler --version
npx wrangler auth token --json >/tmp/cf-auth.json
python - <<'PY'
import json
x=json.load(open('/tmp/cf-auth.json'))
if x.get('type')!='api_key': raise SystemExit('Wrangler did not resolve API-key authentication')
print('wrangler_auth=PASS')
PY
rm -f /tmp/cf-auth.json

# Resolve/create D1 through the documented REST API to avoid CLI output-format ambiguity.
python - <<'PY' > /tmp/d1-id
import json,os,urllib.request
base='https://api.cloudflare.com/client/v4'
account=os.environ['CLOUDFLARE_ACCOUNT_ID']
headers={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Content-Type':'application/json','User-Agent':'MUSITU-Axiom-Staging/1.0'}
def call(method,path,body=None):
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(base+path,headers=headers,data=data,method=method)
    with urllib.request.urlopen(req,timeout=45) as r: x=json.load(r)
    if not x.get('success'): raise SystemExit(f'Cloudflare {method} failed')
    return x.get('result')
rows=call('GET',f'/accounts/{account}/d1/database?name=mft-axiom-staging&per_page=100') or []
m=[r for r in rows if r.get('name')=='mft-axiom-staging']
if len(m)>1: raise SystemExit('Fail-closed: multiple staging D1 databases')
if not m:
    call('POST',f'/accounts/{account}/d1/database',{'name':'mft-axiom-staging','primary_location_hint':'eeur','read_replication':{'mode':'disabled'}})
    rows=call('GET',f'/accounts/{account}/d1/database?name=mft-axiom-staging&per_page=100') or []
    m=[r for r in rows if r.get('name')=='mft-axiom-staging']
if len(m)!=1: raise SystemExit(f'Fail-closed: expected one staging D1, got {len(m)}')
ident=m[0].get('uuid') or m[0].get('id')
if not ident: raise SystemExit('D1 identifier unavailable')
print(ident)
PY
D1_ID="$(cat /tmp/d1-id)"
test -n "$D1_ID"
echo 'd1_identity=PASS'

D1_ID="$D1_ID" python - <<'PY'
import json,os
cfg={
 '$schema':'node_modules/wrangler/config-schema.json',
 'name':os.environ['STAGING_WORKER'],
 'main':'worker/src/cloudflare.js',
 'compatibility_date':'2026-09-04',
 'workers_dev':True,
 'observability':{'enabled':True},
 'containers':[{'class_name':'AxiomKernel','image':'./kernel/Dockerfile','max_instances':4,'instance_type':'basic','image_build_context':'.','name':'mft-axiom-staging-kernel'}],
 'durable_objects':{'bindings':[{'name':'AXIOM_KERNEL','class_name':'AxiomKernel'}]},
 'migrations':[{'tag':'axiom-staging-v1','new_sqlite_classes':['AxiomKernel']}],
 'd1_databases':[{'binding':'AXIOM_DB','database_name':'mft-axiom-staging','database_id':os.environ['D1_ID']}]
}
open('wrangler.json','w').write(json.dumps(cfg,indent=2))
PY
python - <<'PY'
import json
c=json.load(open('wrangler.json'))
assert c['name']=='mft-axiom-staging' and c['workers_dev'] is True
assert c['d1_databases'][0]['binding']=='AXIOM_DB' and c['containers'][0]['max_instances']==4
print('staging_config=PASS')
PY

npx wrangler d1 execute "$STAGING_DB" --remote --file migrations/0001_revenue_core.sql --yes
npx wrangler d1 execute "$STAGING_DB" --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --json > schema-check.json
python - <<'PY'
text=open('schema-check.json').read()
required=['customers','api_keys','usage_buckets','usage_events','billing_subscriptions','webhook_events']
missing=[x for x in required if x not in text]
if missing: raise SystemExit('Fail-closed D1 schema missing: '+repr(missing))
print('d1_schema=PASS')
PY

docker version >/dev/null
npx wrangler deploy --config wrangler.json > deploy.log 2>&1 || { tail -250 deploy.log; exit 1; }
tail -120 deploy.log

MFT_CONTROL_SECRET="$(openssl rand -hex 32)"
MFT_RECEIPT_SECRET="$(openssl rand -hex 32)"
echo "::add-mask::$MFT_CONTROL_SECRET"
echo "::add-mask::$MFT_RECEIPT_SECRET"
printf '%s' "$MFT_CONTROL_SECRET" | npx wrangler secret put MFT_CONTROL_SECRET --config wrangler.json >/tmp/control-secret.log
printf '%s' "$MFT_RECEIPT_SECRET" | npx wrangler secret put MFT_RECEIPT_SECRET --config wrangler.json >/tmp/receipt-secret.log
printf '%s' "$MFT_CONTROL_SECRET" > /tmp/musitu-control-secret
printf '%s' "$MFT_RECEIPT_SECRET" > /tmp/musitu-receipt-secret
echo 'runtime_secrets=PASS'

SUBDOMAIN="$(python - <<'PY'
import json,os,urllib.request
req=urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/workers/subdomain",headers={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY']})
with urllib.request.urlopen(req,timeout=30) as r: x=json.load(r)
if not x.get('success') or not (x.get('result') or {}).get('subdomain'): raise SystemExit('workers subdomain unavailable')
print(x['result']['subdomain'])
PY
)"
URL="https://${STAGING_WORKER}.${SUBDOMAIN}.workers.dev"
echo "STAGING_URL=$URL" >> "$GITHUB_ENV"
for i in $(seq 1 72); do
  code="$(curl -sS -o health.json -w '%{http_code}' "$URL/health" || true)"
  [ "$code" = 200 ] && break
  sleep 5
done
[ "$code" = 200 ] || { echo "Fail-closed: staging health unavailable ($code)"; exit 1; }
python - <<'PY'
import json,os
h=json.load(open('health.json'))
expected={'ok':True,'status':'READY','version':'3.0.0','build_id':os.environ['DEPLOY_BUILD_ID'],'operation_count':74,'state':'D1','wolfram_parity':'NOT_CERTIFIED','superiority':'NOT_CERTIFIED'}
bad={k:(h.get(k),v) for k,v in expected.items() if h.get(k)!=v}
if bad: raise SystemExit('Fail-closed health mismatch: '+repr(bad))
print('health=PASS')
PY
unauth="$(curl -sS -o unauth.json -w '%{http_code}' -X POST "$URL/v1/compute" -H 'content-type: application/json' --data '{"operation":"arithmetic.evaluate","args":{"expression":"40+2"}}')"
[ "$unauth" = 401 ] || { echo "Fail-closed: unauth compute expected 401 got $unauth"; exit 1; }
curl -sS "$URL/v1/tools" > tools.json
python - <<'PY'
import json
x=json.load(open('tools.json'))
if x.get('operation_count')!=74 or len(x.get('tools',[]))!=74: raise SystemExit('tool count mismatch')
print('public_security_and_tools=PASS')
PY

CONTROL="$(cat /tmp/musitu-control-secret)"
code="$(curl -sS -o compute.json -w '%{http_code}' -X POST "$URL/v1/compute" -H "x-mft-control: $CONTROL" -H 'content-type: application/json' --data '{"operation":"arithmetic.evaluate","args":{"expression":"40+2"},"verify":true}')"
[ "$code" = 200 ] || { cat compute.json; echo "Fail-closed: authenticated compute HTTP $code"; exit 1; }
python - <<'PY'
import json
x=json.load(open('compute.json'))
if not x.get('ok'): raise SystemExit('compute not ok')
r=x.get('receipt') or {}
if not r.get('signature') or r.get('signature_alg')!='HMAC-SHA256': raise SystemExit('signed receipt missing')
if not r.get('request_sha256') or not r.get('result_sha256'): raise SystemExit('receipt hashes missing')
print('authenticated_compute=PASS')
print('signed_receipt=PASS')
PY

python - <<'PY'
import json,os,urllib.request,hashlib
base='https://api.cloudflare.com/client/v4'; account=os.environ['CLOUDFLARE_ACCOUNT_ID']; worker=os.environ['STAGING_WORKER']
headers={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY']}
req=urllib.request.Request(f'{base}/accounts/{account}/workers/scripts/{worker}/settings',headers=headers)
with urllib.request.urlopen(req,timeout=30) as r: x=json.load(r)
if not x.get('success'): raise SystemExit('Cloudflare settings readback failed')
settings=x.get('result') or {}; bindings=settings.get('bindings',[])
names=sorted({b.get('name') for b in bindings if isinstance(b,dict) and b.get('name')})
required={'AXIOM_DB','AXIOM_KERNEL','MFT_CONTROL_SECRET','MFT_RECEIPT_SECRET'}
missing=sorted(required-set(names))
if missing: raise SystemExit('Fail-closed missing bindings: '+repr(missing))
ev={'schema':'musitu.axiom.cloudflare.staging_deployment.v1','worker':worker,'url':os.environ['STAGING_URL'],'build_id':os.environ['DEPLOY_BUILD_ID'],'operation_count':74,'d1_binding':'AXIOM_DB','container_binding':'AXIOM_KERNEL','required_secret_bindings_present':True,'health':'PASS','unauth_compute_401':'PASS','authenticated_compute':'PASS','signed_receipt':'PASS','wolfram_parity':'NOT_CERTIFIED','superiority':'NOT_CERTIFIED','custom_domain_attached':False,'promotion_gate':'STAGING_PASS'}
raw=json.dumps(ev,sort_keys=True,separators=(',',':')).encode(); ev['evidence_sha256']=hashlib.sha256(raw).hexdigest()
open('../axiom-staging-deployment-evidence.json','w').write(json.dumps(ev,indent=2,sort_keys=True))
PY
cd "$ROOT"
sha256sum axiom-staging-deployment-evidence.json > axiom-staging-deployment-evidence.sha256
cat axiom-staging-deployment-evidence.sha256
echo 'AXIOM_STAGING_DEPLOYMENT_PASS'

import base64,gzip,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent/'app'/'flagship'
EXPECTED={
'v2_assets.part00':('04fc82a0243e03a2fe297ef5b54e0240482a40d39b10068f80b51dd65c478de8',6000),
'v2_assets.part01':('621dd6bf0fb7fcea2c807db6c2a6a131cef22620272262095dd495bb251ec08d',6000),
'v2_assets.part02':('bc21f6797195a10ccd8ba22303a752f8dfe61f2a36259fa447d93c08b26a707f',6000),
'v2_assets.part03':('3ef1c8b88a81c1a10a6f098f6fcde48930a156dfb70f20c3f88c8b295bb37530',5907),
}
chunks=[]
for name,(digest,size) in EXPECTED.items():
    p=ROOT/name;b=p.read_bytes()
    if len(b)!=size:raise SystemExit(f'{name}: size {len(b)} != {size}')
    got=hashlib.sha256(b).hexdigest()
    if got!=digest:raise SystemExit(f'{name}: sha256 {got} != {digest}')
    chunks.append(b.decode('utf-8'))
pack=json.loads(''.join(chunks))
for name in ('v2_index.html','v2_app.css','v2_app.js'):
    if name not in pack:raise SystemExit('missing '+name)
    gzip.decompress(base64.b64decode(pack[name]))
appjs=gzip.decompress(base64.b64decode(pack['v2_app.js']))
app_sha=hashlib.sha256(appjs).hexdigest()
expected_app='76ac97a3c2dd44343b599ac836bca2d815e78dee841fa583b0bacae1f76f373f'
if app_sha!=expected_app:raise SystemExit(f'v2_app.js sha256 {app_sha} != {expected_app}')
print(json.dumps({'gate':'FMI_FLAGSHIP_V2_ASSET_INTEGRITY_PASS','chunks':4,'v2_app_js_sha256':app_sha},sort_keys=True))

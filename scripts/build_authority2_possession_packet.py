"""Build a public-only Windows possession-check packet; never read owner keys."""
import argparse, hashlib, json, pathlib, subprocess, zipfile

root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True)
parser.add_argument('--source-commit',required=True)
parser.add_argument('--local-source',action='store_true')
args=parser.parse_args()
def source(path):
    if args.local_source:
        return (root/path).read_bytes()
    return subprocess.check_output(['git','show',args.source_commit+':'+path],cwd=root)
evidence='customer_frontier/evidence/gate3_security_20261114/authority2_signer_possession_20261116/'
files={
 'Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1':source('customer_frontier/qualification/step3_authority2_signer_possession.ps1'),
 'step3_authority2_signer_possession.mjs':source('customer_frontier/qualification/step3_authority2_signer_possession.mjs'),
 'challenge.json':source(evidence+'challenge.json'),
 'owner_ed25519_spki.der':source(evidence+'owner_ed25519_spki.der'),
 'README.txt':source('customer_frontier/qualification/STEP3_AUTHORITY2_SIGNER_POSSESSION_20261116_NOT_RELEASE.md')}
helper_hash=hashlib.sha256(files['step3_authority2_signer_possession.mjs']).hexdigest()
assert helper_hash.encode() in files['Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1'], 'Pinned helper hash mismatch'
assert hashlib.sha256(files['owner_ed25519_spki.der']).hexdigest()=='6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a'
assert hashlib.sha256(files['challenge.json']).hexdigest().encode() in files['step3_authority2_signer_possession.mjs']
manifest={'schema':'musitu.axiom.authority2.possession-packet.v1','tool_source_commit':args.source_commit,'approved_authority_source_commit':'68799a41a367865649b833de649edcb26f77c0d3','files':[{'name':n,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in files.items()],'network_operations':0,'deployment_performed':False,'private_key_material_included':False,'gate3_closed':False,'release_status':'NOT_RELEASE'}
files['PACKET_MANIFEST.json']=(json.dumps(manifest,indent=2)+'\n').encode()
out=pathlib.Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
for name,body in files.items():
    (out/name).write_bytes(body)
archive=out.parent/'MUSITU_AXIOM_A2_SIGNER_CHECK_WINDOWS_20261116_NOT_RELEASE.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,body in files.items():
        entry=zipfile.ZipInfo(name,(2026,11,16,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100600<<16;z.writestr(entry,body)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    assert set(z.namelist())==set(files)
    for name,body in files.items():
        assert z.read(name)==body
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'members':len(files),'challenge_expires_at_utc':json.loads(files['challenge.json'])['expires_at_utc'],'private_key_material_included':False,'gate3_closed':False}))

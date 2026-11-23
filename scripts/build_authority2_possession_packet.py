"""Build a public-only Windows possession-check packet; never read owner keys."""
import argparse, hashlib, json, pathlib, re, secrets, subprocess, zipfile
from datetime import datetime, timedelta, timezone

root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True)
parser.add_argument('--source-commit',required=True)
parser.add_argument('--local-source',action='store_true')
parser.add_argument('--renew-challenge',action='store_true',
                    help='Issue a new 24-hour public possession challenge; no signing or provider action')
args=parser.parse_args()
def require(condition,message):
    if not condition:
        raise ValueError(message)
if not re.fullmatch('[0-9a-f]{40}',args.source_commit):
    parser.error('--source-commit requires the exact full Git commit SHA')
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
require(files['Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1'].count(helper_hash.encode())==1, 'Pinned helper hash mismatch')
require(hashlib.sha256(files['owner_ed25519_spki.der']).hexdigest()=='6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a','Pinned public key mismatch')
require(hashlib.sha256(files['challenge.json']).hexdigest().encode() in files['step3_authority2_signer_possession.mjs'],'Pinned challenge mismatch')
original_files={name:hashlib.sha256(body).hexdigest() for name,body in files.items()}
challenge=json.loads(files['challenge.json'])
issued=datetime.fromisoformat(challenge['issued_at_utc'])
if args.renew_challenge:
    original_challenge=dict(challenge)
    issued=datetime.now(timezone.utc)
    # Do not extend old authorization or alter the approved account/key/source.
    challenge.update(challenge_id=secrets.token_hex(32),
                     issued_at_utc=issued.isoformat(timespec='milliseconds').replace('+00:00','Z'),
                     expires_at_utc=(issued+timedelta(hours=24)).isoformat(timespec='milliseconds').replace('+00:00','Z'))
    files['challenge.json']=(json.dumps(challenge,sort_keys=True,separators=(',',':'))+'\n').encode()
    helper=files['step3_authority2_signer_possession.mjs']
    digest=hashlib.sha256(files['challenge.json']).hexdigest().encode()
    helper,count=re.subn(rb"(export const CHALLENGE_SHA256=')[a-f0-9]{64}(';)",
                         lambda match:match[1]+digest+match[2],helper)
    require(count==1, 'Single reviewed challenge pin required')
    files['step3_authority2_signer_possession.mjs']=helper
    files['Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1']=files['Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1'].replace(
        helper_hash.encode(),hashlib.sha256(helper).hexdigest().encode())
    # Keep the original instructions intact and replace only the stale deadline.
    deadline=re.compile(rb'The challenge expires on [^\n]+\nAfter expiry obtain a fresh packet;')
    expiry=datetime.fromisoformat(challenge['expires_at_utc'])
    line=('The challenge expires on '+expiry.strftime('%d %B %Y at %H:%M:%S')+' UTC ('+
          (expiry+timedelta(hours=2)).strftime('%H:%M:%S')+' Harare).\nAfter expiry obtain a fresh packet;').encode()
    files['README.txt'],count=deadline.subn(lambda _:line,files['README.txt'])
    require(count==1, 'Single original expiry instruction required')
    for key in original_challenge.keys()-{'challenge_id','issued_at_utc','expires_at_utc'}:
        require(challenge[key]==original_challenge[key], 'Approved context changed')
manifest={'schema':'musitu.axiom.authority2.possession-packet.v1','tool_source_commit':args.source_commit,'approved_authority_source_commit':'68799a41a367865649b833de649edcb26f77c0d3','files':[{'name':n,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)} for n,b in files.items()],'network_operations':0,'deployment_performed':False,'private_key_material_included':False,'gate3_closed':False,'release_status':'NOT_RELEASE',
          'source_mode':('local_source' if args.local_source else 'exact_git_bytes')+('_with_public_challenge_renewal' if args.renew_challenge else ''),
          'original_file_sha256':original_files,'challenge_renewed':args.renew_challenge,
          'challenge_sha256':hashlib.sha256(files['challenge.json']).hexdigest(),
          'challenge_issued_at_utc':challenge['issued_at_utc'],
          'challenge_expires_at_utc':challenge['expires_at_utc']}
files['PACKET_MANIFEST.json']=(json.dumps(manifest,indent=2)+'\n').encode()
out=pathlib.Path(args.out).resolve()
stamp=issued.strftime('%Y%m%d') if args.renew_challenge else '20261116'
archive=out.parent/('MUSITU_AXIOM_A2_SIGNER_CHECK_WINDOWS_'+stamp+'_NOT_RELEASE.zip')
if args.renew_challenge and (out.exists() or archive.exists()):
    parser.error('Renewal requires a new output directory and archive; existing evidence is never overwritten')
out.mkdir(parents=True,exist_ok=not args.renew_challenge)
for name,body in files.items():
    (out/name).write_bytes(body)
with zipfile.ZipFile(archive,'x' if args.renew_challenge else 'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,body in files.items():
        entry=zipfile.ZipInfo(name,(issued.year,issued.month,issued.day,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100600<<16;z.writestr(entry,body)
with zipfile.ZipFile(archive) as z:
    require(z.testzip() is None,'Archive CRC failed')
    require(set(z.namelist())==set(files),'Archive inventory changed')
    for name,body in files.items():
        require(z.read(name)==body,'Archive member changed: '+name)
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'members':len(files),'challenge_expires_at_utc':json.loads(files['challenge.json'])['expires_at_utc'],'private_key_material_included':False,'gate3_closed':False}))

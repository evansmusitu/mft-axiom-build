"""Embed a reviewed public packet in one Windows launcher. Never read owner keys."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile
from datetime import datetime

ROOT=Path(__file__).resolve().parents[1]
TEMPLATE='customer_frontier/qualification/step3_authority2_single_file_launcher.template.ps1'
HELPER_SHA='1200d429517bc2fe61b1efd60216b78e0ec99100f63793a88b51137d75c1cd4f'
WRAPPER_SHA='f35eaa554952564bc902a98fa009064dfc50aa9000dd38948f4cbddebcac0c2b'
ORIGINAL_CHALLENGE_SHA='60cd2f0ceec35106bc90beb7bfdb00326223d0a871a893f455e9dc0350a57878'
EXPECTED={'Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1','step3_authority2_signer_possession.mjs','challenge.json','owner_ed25519_spki.der','README.txt','PACKET_MANIFEST.json'}
sha=lambda b:hashlib.sha256(b).hexdigest()
def require(ok,message):
 if not ok:raise ValueError(message)

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--packet',required=True);p.add_argument('--expected-sha256',required=True);p.add_argument('--out',required=True)
 p.add_argument('--source-commit',required=True);p.add_argument('--local-source',action='store_true')
 a=p.parse_args()
 require(re.fullmatch('[a-f0-9]{40}',a.source_commit),'Exact full Git source commit required')
 require(re.fullmatch('[a-f0-9]{64}',a.expected_sha256),'Exact public ZIP SHA256 required')
 packet=Path(a.packet);out=Path(a.out)
 require(not out.exists(),'Existing launcher is never overwritten')
 require(out.suffix.lower()=='.ps1','A .ps1 output is required')
 require(packet.stat().st_size<=131072,'Public packet size limit')
 data=packet.read_bytes();require(sha(data)==a.expected_sha256,'Public packet outer digest mismatch')
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  require(len(z.namelist())==len(EXPECTED) and set(z.namelist())==EXPECTED,'Exact public file inventory required')
  require(all(i.file_size<=65536 for i in z.infolist()) and sum(i.file_size for i in z.infolist())<=131072,'Public packet member size limit')
  require(z.testzip() is None,'Public packet CRC failure');files={name:z.read(name) for name in EXPECTED}
 m=json.loads(files['PACKET_MANIFEST.json'])
 require(m['schema']=='musitu.axiom.authority2.possession-packet.v1' and m['network_operations']==0 and
         m['deployment_performed'] is False and m['private_key_material_included'] is False and m['gate3_closed'] is False and
         m['release_status']=='NOT_RELEASE' and m['approved_authority_source_commit']=='68799a41a367865649b833de649edcb26f77c0d3','Public packet scope changed')
 require(len(m['files'])==5 and {f['name'] for f in m['files']}==EXPECTED-{'PACKET_MANIFEST.json'},'Public manifest inventory changed')
 for f in m['files']:require(sha(files[f['name']])==f['sha256'] and len(files[f['name']])==f['bytes'],'Public member hash changed')
 require(sha(files['owner_ed25519_spki.der'])=='6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a','Public signer pin changed')
 challenge=json.loads(files['challenge.json'])
 context={'schema':'musitu.axiom.authority2.possession-challenge.v1','purpose':'EXISTING_A2_KEY_POSSESSION_ONLY_NOT_AUTHORITY',
  'account_id':'67469478aa9349fa0a57fe3a72da200a','expected_spki_sha256':'6792c82b245cd45051052cc1b00eb5f99a99489829c3f0567c7c15f741389d8a',
  'approved_source_commit':'68799a41a367865649b833de649edcb26f77c0d3','approved_config_sha256':'bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3','release_status':'NOT_RELEASE'}
 require(set(challenge)==set(context)|{'challenge_id','issued_at_utc','expires_at_utc'} and all(challenge[k]==v for k,v in context.items()),'Approved challenge context changed')
 require(re.fullmatch('[a-f0-9]{64}',challenge['challenge_id']),'Invalid public challenge id')
 issued=datetime.fromisoformat(challenge['issued_at_utc']);expiry=datetime.fromisoformat(challenge['expires_at_utc'])
 require(issued.tzinfo is not None and expiry.tzinfo is not None and 0<(expiry-issued).total_seconds()<=86400,'Public challenge lifetime invalid')
 require(files['challenge.json']==(json.dumps(challenge,sort_keys=True,separators=(',',':'))+'\n').encode(),'Noncanonical challenge')
 digest=sha(files['challenge.json']).encode()
 helper=files['step3_authority2_signer_possession.mjs']
 require(helper.count(b"export const CHALLENGE_SHA256='"+digest+b"';")==1,'Challenge/helper pin mismatch')
 normalized,count=re.subn(rb"(export const CHALLENGE_SHA256=')[a-f0-9]{64}(';)",lambda match:match[1]+ORIGINAL_CHALLENGE_SHA.encode()+match[2],helper)
 require(count==1 and sha(normalized)==HELPER_SHA,'Unreviewed signer helper changed')
 wrapper=files['Run_MUSITU_AXIOM_Authority2_Signer_Check.ps1']
 require(wrapper.count(sha(helper).encode())==1 and sha(wrapper.replace(sha(helper).encode(),HELPER_SHA.encode()))==WRAPPER_SHA,'Unreviewed Windows wrapper changed')
 template=(ROOT/TEMPLATE).read_text() if a.local_source else subprocess.check_output(['git','show',a.source_commit+':'+TEMPLATE],cwd=ROOT).decode()
 replacements={'@@PACKET_SHA256@@':a.expected_sha256,'@@SOURCE_COMMIT@@':a.source_commit,'@@PACKET_BASE64@@':base64.b64encode(data).decode()}
 for marker,value in replacements.items():
  require(template.count(marker)==1,'Single template marker required: '+marker);template=template.replace(marker,value)
 require('@@' not in template,'Unresolved template markers')
 # UTF8 BOM makes PowerShell5.1 decoding deterministic; contents are ASCII.
 body=b'\xef\xbb\xbf'+template.encode('utf-8');out.parent.mkdir(parents=True,exist_ok=True)
 with out.open('xb') as f:f.write(body)
 print(json.dumps({'file':str(out.resolve()),'bytes':len(body),'sha256':sha(body),'packet_sha256':a.expected_sha256,'tool_source_commit':a.source_commit,
  'challenge_expires_at_utc':challenge['expires_at_utc'],'private_key_material_included':False,'owner_proof_observed':False,'network_operations':0,'gate3_closed':False,'release_status':'NOT_RELEASE'}))

if __name__=='__main__':main()

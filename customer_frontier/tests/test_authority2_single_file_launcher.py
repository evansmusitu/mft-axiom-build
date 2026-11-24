"""Public packaging tests. No owner key, secret, provider or paid operation."""
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[2]
BUILDER=ROOT/'scripts/build_authority2_single_file_launcher.py'
PACKET_BUILDER=ROOT/'scripts/build_authority2_possession_packet.py'
SOURCE=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()

class SingleFileLauncherTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='a2-launcher-public-');self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  result=subprocess.run([sys.executable,str(PACKET_BUILDER),'--out',str(self.base/'packet'),'--source-commit',SOURCE],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr);self.archive=Path(json.loads(result.stdout)['archive'])
 def build(self,archive=None,digest=None,out=None):
  archive=archive or self.archive
  return subprocess.run([sys.executable,str(BUILDER),'--packet',str(archive),'--expected-sha256',digest or hashlib.sha256(archive.read_bytes()).hexdigest(),
   '--out',str(out or self.base/'Run_Axiom.ps1'),'--source-commit',SOURCE,'--local-source'],cwd=ROOT,capture_output=True,text=True)
 def changed(self,changes):
  other=self.base/'changed.zip'
  with zipfile.ZipFile(self.archive) as old,zipfile.ZipFile(other,'w',compression=zipfile.ZIP_DEFLATED) as new:
   for name in old.namelist():new.writestr(name,changes.get(name,old.read(name)))
   for name,body in changes.items():
    if name not in old.namelist():new.writestr(name,body)
  return other
 def test_single_file_embeds_exact_archive_and_preserves_all_gate_holds(self):
  r=self.build();self.assertEqual(r.returncode,0,r.stderr);report=json.loads(r.stdout);script=(self.base/'Run_Axiom.ps1').read_text(encoding='utf-8-sig')
  payload=re.search(r"\$PacketBase64='([A-Za-z0-9+/=]+)'",script).group(1)
  self.assertEqual(base64.b64decode(payload),self.archive.read_bytes());self.assertFalse(report['gate3_closed']);self.assertFalse(report['owner_proof_observed'])
  self.assertIn('Gate3 remains OPEN',script);self.assertNotIn('@@',script)
  self.assertNotRegex(script,r'(?i)Invoke-WebRequest|Invoke-RestMethod|DownloadString|Set-ExecutionPolicy|Start-Transcript')
 def test_wrong_outer_digest_refuses_before_output(self):
  r=self.build(digest='0'*64);self.assertNotEqual(r.returncode,0);self.assertFalse((self.base/'Run_Axiom.ps1').exists())
 def test_extra_or_traversal_members_are_rejected(self):
  for name in ['unexpected.txt','../escape.ps1']:
   r=self.build(self.changed({name:b'not permitted'}));self.assertNotEqual(r.returncode,0);self.assertFalse((self.base/'Run_Axiom.ps1').exists());(self.base/'changed.zip').unlink()
 def test_manifest_cannot_promote_deployment_or_gate_acceptance(self):
  with zipfile.ZipFile(self.archive) as z:m=json.loads(z.read('PACKET_MANIFEST.json'))
  m['gate3_closed']=True
  r=self.build(self.changed({'PACKET_MANIFEST.json':json.dumps(m).encode()}));self.assertNotEqual(r.returncode,0);self.assertFalse((self.base/'Run_Axiom.ps1').exists())
 def test_appended_helper_is_rejected_even_with_rewritten_member_manifest(self):
  with zipfile.ZipFile(self.archive) as z:m=json.loads(z.read('PACKET_MANIFEST.json'));helper=z.read('step3_authority2_signer_possession.mjs')+b'\n// unreviewed\n'
  for f in m['files']:
   if f['name']=='step3_authority2_signer_possession.mjs':f.update(sha256=hashlib.sha256(helper).hexdigest(),bytes=len(helper))
  r=self.build(self.changed({'step3_authority2_signer_possession.mjs':helper,'PACKET_MANIFEST.json':json.dumps(m).encode()}));self.assertNotEqual(r.returncode,0)
 def test_no_overwrite_or_unversioned_template_source(self):
  first=self.build();self.assertEqual(first.returncode,0,first.stderr);before=(self.base/'Run_Axiom.ps1').read_bytes()
  self.assertNotEqual(self.build().returncode,0);self.assertEqual((self.base/'Run_Axiom.ps1').read_bytes(),before)
  cmd=[sys.executable,str(BUILDER),'--packet',str(self.archive),'--expected-sha256',hashlib.sha256(self.archive.read_bytes()).hexdigest(),'--out',str(self.base/'other.ps1'),'--source-commit','main','--local-source']
  self.assertNotEqual(subprocess.run(cmd,cwd=ROOT,capture_output=True).returncode,0);self.assertFalse((self.base/'other.ps1').exists())
 def test_renewed_packet_supported_without_modifying_original_helper(self):
  p=subprocess.run([sys.executable,str(PACKET_BUILDER),'--out',str(self.base/'renewed/packet'),'--source-commit',SOURCE,'--renew-challenge'],cwd=ROOT,capture_output=True,text=True)
  self.assertEqual(p.returncode,0,p.stderr);archive=Path(json.loads(p.stdout)['archive']);r=self.build(archive);self.assertEqual(r.returncode,0,r.stderr)
 def test_inventory_duplicates_and_invalid_public_key_fail(self):
  with zipfile.ZipFile(self.archive) as z:m=json.loads(z.read('PACKET_MANIFEST.json'))
  m['files'][0]['name']=m['files'][1]['name']
  self.assertNotEqual(self.build(self.changed({'PACKET_MANIFEST.json':json.dumps(m).encode()})).returncode,0)

if __name__=='__main__':unittest.main()

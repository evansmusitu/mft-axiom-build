import pathlib, subprocess, tempfile, unittest, hashlib, json
from shutil import which
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_owner_offline_key_ceremony.sh'
class OwnerCeremonyTests(unittest.TestCase):
 def test_bash_syntax(self):
  self.assertEqual(subprocess.run(['bash','-n',str(SCRIPT)]).returncode,0)
 def test_non_interactive_refuses_prior_to_creation(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)/'owner-secret'
   r=subprocess.run(['bash',str(SCRIPT),str(path)],input=b'',capture_output=True)
   self.assertEqual(r.returncode,2);self.assertFalse(path.exists())
 def test_only_new_destination_allowed(self):
  src=SCRIPT.read_text()
  self.assertIn('target already exists; refusing overwrite',src)
  self.assertIn('umask 077',src)
 def test_no_network_or_git_automation(self):
  src=SCRIPT.read_text()
  for forbidden in ['curl ','wget ','git push','https://','http://','wrangler ', 'CLOUDFLARE_API_TOKEN','GITHUB_TOKEN']:
   self.assertNotIn(forbidden,src)
 def test_encrypted_key_exchange_synthetic_no_real_owner_keys(self):
  if not which('openssl'):self.skipTest('openssl unavailable')
  with tempfile.TemporaryDirectory() as td:
   temp=pathlib.Path(td);passphrase='throwaway-offline-synthetic'
   for algorithm in ['ED25519','X25519']:
    private=temp/(algorithm+'.pem')
    subprocess.run(['openssl','genpkey','-algorithm',algorithm,'-aes-256-cbc','-pass','pass:'+passphrase,'-out',str(private)],check=True,capture_output=True)
    ciphertext=private.read_bytes();self.assertIn(b'ENCRYPTED PRIVATE KEY',ciphertext)
    r=subprocess.run(['openssl','pkey','-in',str(private),'-passin','pass:'+passphrase,'-pubout','-outform','DER'],capture_output=True,check=True)
    self.assertEqual(len(hashlib.sha256(r.stdout).hexdigest()),64)
    self.assertNotIn(b'PRIVATE KEY',r.stdout)
 def test_does_not_qualify_runtime_on_creation(self):
  src=SCRIPT.read_text()
  for item in ['public_key_pins_approved_for_runtime\':False','step1_closed\':False','step2_authorized\':False','release\':\'NOT_RELEASE']:
   self.assertIn(item,src)
if __name__=='__main__':unittest.main()

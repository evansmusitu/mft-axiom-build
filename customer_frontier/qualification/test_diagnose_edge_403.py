import unittest,io,email.message,urllib.error
from diagnose_edge_403 import probe,NoRedirect,AGENTS
class Fake:
 def __init__(self,status,header='',body=b''):
  self.status=status;self.headers=email.message.Message();self.headers['server']='cloudflare'
  if header:self.headers['cf-mitigated']=header
  self.body=body
 def __enter__(self):return self
 def __exit__(self,*a):pass
 def read(self,n):return self.body[:n]
class O:
 def __init__(self,r):self.r=r
 def open(self,req,timeout):return self.r
class Edge403Tests(unittest.TestCase):
 def test_403_challenge_does_not_become_signed_login(self):
  r=probe('/_health',AGENTS[0],O(Fake(403,'challenge',b'Just a moment Cloudflare Access')))
  self.assertEqual(r['status'],403);self.assertEqual(r['cf_mitigated'],'challenge')
  self.assertIn('just a moment',r['markers'])
 def test_200_health_does_not_claim_user_session(self):
  r=probe('/_health',AGENTS[1],O(Fake(200,body=b'{"ok":true}')))
  self.assertEqual(r['status'],200);self.assertFalse(r['location_set'])
 def test_reject_unknown_uri(self):
  with self.assertRaises(ValueError):probe('https://evil.example/',AGENTS[0])
 def test_reject_unknown_agent(self):
  with self.assertRaises(ValueError):probe('/_health','untrusted')
if __name__=='__main__':unittest.main()

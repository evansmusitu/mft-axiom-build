"""Offline agent protocol acceptance. No broker, Windows binary, or external network needed."""
import hashlib
import hmac
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid
import agent

KEY=b"lifeline-test-only-pairing-key-no-real-credential-32"
def job(op="probe",args=None,when=None):
    d={"job_id":str(uuid.uuid4()),"issued_at":int(time.time()) if when is None else when,"nonce":"aVeryLongUniqueNonce123",
       "operation":op,"args":{} if args is None else args,"tenant":"staging"}
    d["signature"]=agent.sign(d,KEY)
    return d

class SecurityTests(unittest.TestCase):
    def test_valid_probe_and_signed_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            response=agent.execute(job(),KEY,Path(tmp),None,None)
            self.assertEqual(response["outcome"],"completed")
            self.assertFalse(response["trading_enabled"])
            sig=response.pop("signature");self.assertTrue(hmac.compare_digest(sig,agent.sign(response,KEY)))
    def test_bad_signature_fails(self):
        x=job();x["operation"]="compile"
        with self.assertRaisesRegex(agent.AgentError,"signature"):agent.verify_job(x,KEY)
    def test_expired_fails(self):
        with self.assertRaisesRegex(agent.AgentError,"expired"):agent.verify_job(job(when=1),KEY)
    def test_no_trade_operations(self):
        with self.assertRaisesRegex(agent.AgentError,"forbidden"):agent.verify_job(job("order_send"),KEY)
    def test_missing_tenant(self):
        x=job();x.pop("tenant");x["signature"]=agent.sign({k:v for k,v in x.items() if k!="signature"},KEY)
        with self.assertRaisesRegex(agent.AgentError,"tenant"):agent.verify_job(x,KEY)
    def test_reject_unexpected_fields(self):
        x=job();x["shell_command"]="powershell";x["signature"]=agent.sign({k:v for k,v in x.items() if k!="signature"},KEY)
        with self.assertRaisesRegex(agent.AgentError,"unexpected"):agent.verify_job(x,KEY)
    def test_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            outside=Path(tmp).parent/"outside-agent-test.mq5"
            outside.write_text("// test")
            try:
                with self.assertRaises(agent.AgentError):agent.safe_relative(Path(tmp),"../outside-agent-test.mq5",".mq5")
            finally:outside.unlink(missing_ok=True)
    def test_source_integrity(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"ea.mq5";f.write_text("void OnTick(){}")
            with self.assertRaisesRegex(agent.AgentError,"hash mismatch"):
                agent.compile_mql5(Path(tmp),{"relative_source":"ea.mq5","source_sha256":"f"*64},"not-an-exe")
    def test_no_generic_args(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"ea.mq5";f.write_text("void OnTick(){}")
            with self.assertRaisesRegex(agent.AgentError,"allowlisted"):
                agent.compile_mql5(Path(tmp),{"relative_source":"ea.mq5","source_sha256":agent.sha_file(f),"extra":"x"},"x")
    def test_short_pairing_key(self):
        with self.assertRaisesRegex(agent.AgentError,"pairing key"):agent.verify_job(job(),b"short")

if __name__=="__main__": unittest.main()

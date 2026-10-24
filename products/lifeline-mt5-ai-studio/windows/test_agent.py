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
    def test_durable_at_most_once_and_matching_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);d=root/"leases.db";request=job()
            first=agent.execute_once(request,KEY,root,None,None,d)
            second=agent.execute_once(request,KEY,root,None,None,d)
            self.assertEqual(first,second)
    def test_completed_job_cannot_rebind_same_id_and_nonce_to_other_work(self):
        # A valid resigner must not use a durable receipt for a DIFFERENT command.
        # Timestamp refreshes are allowed, but immutable job fields must match.
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            ledger=root/"durable.sqlite"
            original=job()
            original["args"]={"approved_scope":"read-only"}
            original["signature"]=agent.sign({k:v for k,v in original.items() if k!="signature"},KEY)
            first=agent.execute_once(original,KEY,root,None,None,ledger)
            self.assertEqual(first["operation"],"probe")
            for change in (
                {"operation":"backtest","args":{}},
                {"operation":"probe","args":{"shell":"powershell"}},
                {"operation":"probe","args":{"approved_scope":"different"}},
                {"operation":"probe","tenant":"another-tenant"},
            ):
                altered=dict(original,**change)
                altered["signature"]=agent.sign({k:v for k,v in altered.items() if k!="signature"},KEY)
                with self.subTest(change=change),self.assertRaisesRegex(agent.AgentError,"job binding mismatch"):
                    agent.execute_once(altered,KEY,root,None,None,ledger)
            refresh=dict(original,issued_at=int(time.time()))
            refresh["signature"]=agent.sign({k:v for k,v in refresh.items() if k!="signature"},KEY)
            self.assertEqual(agent.execute_once(refresh,KEY,root,None,None,ledger),first)

    def test_local_shared_ledger_concurrent_claim_must_not_execute_twice(self):
        from concurrent.futures import ThreadPoolExecutor
        from unittest.mock import patch
        from threading import Lock
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); ledger=root/"durable.sqlite";request=job()
            counter=[0]
            lock=Lock()
            genuine=agent.execute
            def counted(*args,**kwargs):
                with lock:counter[0]+=1
                time.sleep(0.08)
                return genuine(*args,**kwargs)
            with patch.object(agent,"execute",counted):
                with ThreadPoolExecutor(max_workers=12) as pool:
                    futures=[pool.submit(agent.execute_once,request,KEY,root,None,None,ledger)
                             for _ in range(24)]
                    results=[]
                    for future in futures:
                        try:results.append(future.result())
                        except agent.AgentError as exc:
                            self.assertIn("job already claimed",str(exc))
            self.assertEqual(counter[0],1,"only one worker on the SAME durable ledger may execute")
            self.assertGreaterEqual(len(results),1)
            self.assertTrue(all(r==results[0] for r in results))

    def test_nonce_reuse_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);d=root/"leases.db";first=job()
            agent.execute_once(first,KEY,root,None,None,d)
            different=job();different["nonce"]=first["nonce"]
            different["signature"]=agent.sign({k:v for k,v in different.items() if k!="signature"},KEY)
            with self.assertRaisesRegex(agent.AgentError,"claimed or nonce reused"):
                agent.execute_once(different,KEY,root,None,None,d)
    def test_unhashable_operation_rejected(self):
        x=job();x["operation"]={"code":"shell"};x["signature"]=agent.sign({k:v for k,v in x.items() if k!="signature"},KEY)
        with self.assertRaisesRegex(agent.AgentError,"operation forbidden"):agent.verify_job(x,KEY)
    def test_short_pairing_key(self):
        with self.assertRaisesRegex(agent.AgentError,"pairing key"):agent.verify_job(job(),b"short")

if __name__=="__main__": unittest.main()

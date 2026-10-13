"""S0 shim negative tests; no model call, no Workerd or secrets required."""
import base64
import http.server
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock

MOD_PATH=Path(__file__).resolve().parents[1]/'gated_b12.py'
SOURCE=Path('/tmp/axiom-b22-unmodified-b12.py')
SECRET=Path('/tmp/axiom-b22-local-token')
if not SOURCE.exists():
    SOURCE.write_text('''\nTASKS={"agent-a":{},"agent-b":{}}\nclass Broker:\n    gate=__import__('threading').Lock()\n    state={"agent-a":{"token":"test-token","requests":0},"agent-b":{"token":"test-token","requests":0}}\n    def do_POST(self): return None\ndef main(): pass\n''')
if not SECRET.exists():SECRET.write_text('local-only-test-fixture-no-production')
spec=importlib.util.spec_from_file_location('gated_b12',MOD_PATH)
gate=importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def good_body():
    return json.dumps({'model':'b12-synthetic','stream':False,'messages':[{'role':'user','content':'synthetic'}],
        'tools':[{'function':{'name':'file_editor'}},{'function':{'name':'finish'}}]}).encode()

class GateBehavior(unittest.TestCase):
    def test_valid_request(self):self.assertTrue(gate.validated_sdk(good_body()))
    def test_unknown_model_denied(self):self.assertFalse(gate.validated_sdk(good_body().replace(b'b12-synthetic',b'other-model')))
    def test_unknown_tool_denied(self):self.assertFalse(gate.validated_sdk(good_body().replace(b'finish',b'trash')))
    def test_stream_denied(self):self.assertFalse(gate.validated_sdk(good_body().replace(b'false',b'true')))
    def test_malformed_denied(self):self.assertFalse(gate.validated_sdk(b'{not valid'))
    def test_real_sdk_large_messages_supported(self):
        blob=json.loads(good_body());blob['messages'][0]['content']='synthetic-'+'x'*36000
        self.assertTrue(gate.validated_sdk(json.dumps(blob).encode()))
    def test_oversize_denied(self):self.assertFalse(gate.validated_sdk(good_body()+b' '*65000))
    def test_bad_worker_denied(self):self.assertIsNone(gate.admit('attacker',0,good_body(),'secret'))
    def test_bad_ordinal_denied(self):self.assertIsNone(gate.admit('agent-a',3,good_body(),'secret'))
    def test_header_requires_valid_token(self):
        obj=Mock(path='/v1/chat/completions',headers={'Authorization':'Bearer wrong'})
        self.assertFalse(gate.authorized_preflight(obj,'agent-a','expected'))
    def test_missing_broker_token_denied_even_if_attacker_supplies_sentinel(self):
        obj=Mock(path='/v1/chat/completions',headers={'Authorization':'Bearer invalid'})
        self.assertFalse(gate.authorized_preflight(obj,'agent-a','invalid'))
    def test_unknown_path_denied(self):
        obj=Mock(path='/evil',headers={'Authorization':'Bearer expected'})
        self.assertFalse(gate.authorized_preflight(obj,'agent-a','expected'))
    def test_expected_bearer_allowed(self):
        obj=Mock(path='/v1/chat/completions',headers={'Authorization':'Bearer expected'})
        self.assertTrue(gate.authorized_preflight(obj,'agent-a','expected'))
    def test_gate_refuses_forged_receipt(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                size=int(self.headers['Content-Length']);self.rfile.read(size)
                msg=json.dumps({'status':'COMPLETED','synthetic':True,'request_id':'wrong',
                    'canonical_body_sha256':'a'*64,'dispatch_allowed':False}).encode()
                self.send_response(200);self.send_header('Content-Length',str(len(msg)));self.end_headers();self.wfile.write(msg)
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
        try:self.assertIsNone(gate.admit('agent-a',0,good_body(),'secret','http://127.0.0.1:'+str(server.server_port)))
        finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()

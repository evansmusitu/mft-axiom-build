"""Synthetic B27 network boundary for a forked local process, NOT a deployable service.

Same OS, CI keys and destructive storage; this DOES NOT establish independent
operator, external trust or $0 provider-certified authority.
"""
import hmac
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import json
from pathlib import Path
import os
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
from quorum import canonical
from witness_gate import WitnessDenied
from synthetic_witness import SyntheticWitness

REQ_FIELDS={'proposal','votes','proposal_sha256','votes_sha256'}

def _json_no_duplicate_keys(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('duplicate object key')
        result[key]=value
    return result

def run_synthetic_loopback_child(pipe,db_path,pinned_voters,token,clock,reply_loss_after_commit=False):
    # These materials live only in the child process after fork. They are still
    # synthetic tests, not an independently owned or hardware-protected key.
    if type(clock) is not int or type(clock) is bool or clock<0 or type(token) is not str:
        raise RuntimeError('S0_CONFIG_DENIED')
    signer=Ed25519PrivateKey.generate()
    witness=SyntheticWitness(db_path,signer,pinned_voters)
    class Endpoint(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(4)
        def log_message(self,*args):pass
        def respond(self,code,obj):
            payload=canonical(obj)
            self.send_response(code)
            self.send_header('Content-Type','application/json')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        def do_GET(self):self.respond(404,{'error':'S0_PUBLIC_READ_DENIED'})
        def do_POST(self):
            if self.path!='/v1/audit/checkpoint' or not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):
                return self.respond(403,{'error':'S0_WORKLOAD_TOKEN_REQUIRED'})
            rawlen=self.headers.get('Content-Length','')
            if not rawlen.isascii() or not rawlen.isdecimal() or not 0<int(rawlen)<=16384:
                return self.respond(403,{'error':'S0_REQUEST_LENGTH_DENIED'})
            if self.headers.get('Content-Type')!='application/json' or self.headers.get('Transfer-Encoding') is not None:
                return self.respond(403,{'error':'S0_CONTENT_TYPE_DENIED'})
            try:
                raw=self.rfile.read(int(rawlen))
                obj=json.loads(raw.decode('utf-8'),object_pairs_hook=_json_no_duplicate_keys)
                if type(obj) is not dict or set(obj)!=REQ_FIELDS or canonical(obj)!=raw:
                    raise ValueError('noncanonical/extra schema')
                result=witness.commit(proposal=obj['proposal'],votes=obj['votes'],
                    proposal_sha256=obj['proposal_sha256'],votes_sha256=obj['votes_sha256'],
                    trusted_now=clock) # Server-owned trusted time, not caller-supplied.
                if reply_loss_after_commit:
                    # Simulate a lost acknowledgement AFTER durable commit.
                    self.close_connection=True
                    return
                return self.respond(200,result)
            except (WitnessDenied,ValueError,TypeError,UnicodeDecodeError,KeyError):
                return self.respond(403,{'error':'S0_CHECKPOINT_DENIED'})
            except Exception:
                # Uncertain crash window: never offer fallback or automatic retry.
                return self.respond(503,{'error':'S0_WITNESS_STATE_UNKNOWN'})
    with ThreadingHTTPServer(('127.0.0.1',0),Endpoint) as server:
        if server.server_address[0]!='127.0.0.1':raise RuntimeError('NON_LOOPBACK_LISTENER_DENIED')
        public=signer.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
        import base64
        pipe.send({'pid':os.getpid(),'port':server.server_address[1],
                   'pub':base64.b64encode(public).decode()})
        pipe.close()
        server.serve_forever(poll_interval=.05)

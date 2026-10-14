"""B27 synthetic cross-process witness transport, S0 audit receipts only.

Loopback is deliberately mandatory: no real remote authority is claimed.
The externally pinned witness public key is passed to B26 verification, not
accepted from an HTTP receipt or this transport client.
"""
import http.client
import json
import re
from witness_gate import WitnessDenied
from quorum import canonical

class LoopbackWitnessClient:
    def __init__(self, *, port, token, witness_id='test-witness', timeout=4):
        if type(port) is not int or not 0<port<=65535 or type(token) is not str or not 24<=len(token)<=200 or not re.fullmatch(r'[A-Za-z0-9_-]+',token) or type(witness_id) is not str or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}',witness_id) or type(timeout) not in (int,float) or not 0<timeout<=8:
            raise WitnessDenied('S0_LOOPBACK_CONFIG_DENIED')
        self.port=port
        self.token=token
        self.witness_id=witness_id
        self.timeout=timeout

    def commit(self, *, proposal, votes, proposal_sha256, votes_sha256, trusted_now):
        # trusted_now is deliberately NEVER sent to the server. It owns its clock.
        # An S0-only pre-shared random test token is NOT an mTLS/workload identity.
        request=canonical({'proposal':proposal,'votes':votes,
            'proposal_sha256':proposal_sha256,'votes_sha256':votes_sha256})
        if len(request)>16_384:raise WitnessDenied('S0_REQUEST_TOO_LARGE')
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=self.timeout)
        try:
            connection.request('POST','/v1/audit/checkpoint',body=request,headers={
                'Authorization':'Bearer '+self.token,
                'Content-Type':'application/json',
                'Content-Length':str(len(request))})
            reply=connection.getresponse()
            bounded=reply.read(8193)
            if len(bounded)>8192 or reply.status!=200:
                raise WitnessDenied('S0_WITNESS_DENIED_OR_UNAVAILABLE')
            result=json.loads(bounded)
            if type(result) is not dict or set(result)!={'witness_id','payload_b64','signature_b64'}:
                raise WitnessDenied('S0_WITNESS_RESPONSE_SCHEMA_DENIED')
            return result
        except (OSError,TimeoutError,ValueError) as exc:
            raise WitnessDenied('S0_WITNESS_TRANSPORT_AMBIGUOUS_DENIED') from exc
        finally:
            connection.close()

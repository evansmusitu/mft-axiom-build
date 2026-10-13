#!/usr/bin/env python3
"""B21 S0 root-owned interception shim; imports byte-verified original B12.

A genuine OpenHands SDK request cannot get a synthetic model answer until
Workerd has independently admitted the canonical signed B15/B16/B17 request.
This is NOT a production broker, tenant authenticator or provider client.
"""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError

SOURCE=Path('/tmp/axiom-b22-unmodified-b12.py')
SECRET=Path('/tmp/axiom-b22-local-token')
assert SOURCE.is_file() and SECRET.is_file(), 'B22_TRUSTED_SETUP_MISSING'
spec=importlib.util.spec_from_file_location('b12_original',SOURCE)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ORIGINAL=module.Broker.do_POST
LOCAL_URL='http://127.0.0.1:18768/_internal_s0_admit'


def authorized_preflight(request,who,expected_token):
    if (who not in module.TASKS or request.path!='/v1/chat/completions' or
        type(expected_token) is not str or expected_token in ('','invalid','none') or
        request.headers.get('Authorization')!='Bearer '+expected_token):
        return False
    return True


def validated_sdk(raw):
    if type(raw) is not bytes or not 10<len(raw)<=60000: return False
    try:
        body=json.loads(raw)
        if type(body) is not dict or body.get('model') not in ('b12-synthetic','openai/b12-synthetic') or body.get('stream',False) is not False:
            return False
        if type(body.get('messages')) is not list or not 1<=len(body['messages'])<=75: return False
        if type(body.get('tools')) is not list or not 2<=len(body['tools'])<=10: return False
        funcs={t['function']['name'] for t in body['tools']}
        return {'file_editor','finish'}.issubset(funcs)
    except (TypeError,KeyError,ValueError,AttributeError,UnicodeDecodeError):
        return False


def admit(wid,index,raw,token,url=LOCAL_URL):
    if wid not in module.TASKS or type(index) is not int or not 0<=index<=2 or not validated_sdk(raw):return None
    body=json.dumps({'agent':wid,'ordinal':str(index),
                     'raw_b64':base64.b64encode(raw).decode('ascii')},separators=(',',':')).encode('utf8')
    request=Request(url,body,{'Content-Type':'application/json','X-Axiom-B21-Local-Secret':token},method='POST')
    try:
        with urlopen(request,timeout=18) as response:
            if response.status!=200:return None
            receipt=json.load(response)
    except HTTPError as err:
        try:
            reason=json.load(err).get('reason','UNKNOWN')
            if type(reason) is not str or len(reason)>80 or not reason.replace('_','').isalnum():reason='INVALID_REASON'
        except (ValueError,TypeError,AttributeError):reason='INVALID_RESPONSE'
        print('B22_LOCAL_WORKERD_QUOTA_DENIED='+str(err.code)+':'+reason+':'+wid+':'+str(index),flush=True)
        return None
    except (URLError,TimeoutError,OSError,ValueError):return None
    if not (type(receipt) is dict and receipt.get('status')=='COMPLETED' and receipt.get('synthetic') is True and
            receipt.get('request_id')=='b22-'+wid+'-'+str(index) and receipt.get('dispatch_allowed') is False and
            type(receipt.get('canonical_body_sha256')) is str and len(receipt['canonical_body_sha256'])==64):
        return None
    return receipt


def guarded_post(self):
    wid=self.headers.get('X-Axiom-Workload-ID','')
    expected=module.Broker.state.get(wid,{}).get('token','invalid')
    if not authorized_preflight(self,wid,expected):
        return self.send_json(403,{'error':{'message':'unauthorized_workload'}})
    n=self.headers.get('Content-Length','')
    if not n.isdecimal() or not 10<int(n)<=60000:
        return self.send_json(403,{'error':{'message':'invalid_body_size'}})
    raw=self.rfile.read(int(n))
    if len(raw)!=int(n) or not validated_sdk(raw):
        return self.send_json(403,{'error':{'message':'invalid_sdk_request'}})
    with module.Broker.gate:
        ordinal=module.Broker.state[wid]['requests']
    token=SECRET.read_text().strip()
    receipt=admit(wid,ordinal,raw,token)
    if receipt is None:
        print('B22_DENIED_BEFORE_NATIVE_MODEL_REPLY='+wid+':'+str(ordinal),flush=True)
        return self.send_json(403,{'error':{'message':'durable_admission_denied'}})
    print('B22_WORKERD_ADMITTED='+wid+':'+str(ordinal)+':'+receipt['canonical_body_sha256'],flush=True)
    self.rfile=io.BytesIO(raw)
    return ORIGINAL(self)

module.Broker.do_POST=guarded_post
if __name__=='__main__':module.main()

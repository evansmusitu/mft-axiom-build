import hashlib, importlib.metadata, json, pathlib, platform, sys
import modal

APP_NAME='musitu-forge-private-staging'
SOURCE_COMMIT='f0e805ae298b4720f9263dc15d10f4864b385669'
image=(
    modal.Image.debian_slim(python_version='3.12')
    .pip_install('cryptography==50.0.1','cffi==2.1.1','pycparser==3.0')
    .add_local_dir('runtime','/opt/forge/runtime',copy=True)
)
app=modal.App(APP_NAME, include_source=True)

@app.function(image=image,name='runtime_probe',min_containers=0,max_containers=1,scaledown_window=30,timeout=120)
def runtime_probe():
    root=pathlib.Path('/opt/forge/runtime')
    m=json.loads((root/'FORGE_PRIVATE_RUNTIME_MANIFEST.json').read_text())
    bad=[]
    for f in m['files']:
        p=root/f['path']; b=p.read_bytes() if p.is_file() else b''
        if not p.is_file() or len(b)!=f['size'] or hashlib.sha256(b).hexdigest()!=f['sha256']: bad.append(f['path'])
    return {
        'schema':'musitu.forge.modal_private_staging_probe.v1',
        'source_commit':SOURCE_COMMIT,
        'source_manifest_ok':not bad,
        'bad_files':bad,
        'python':platform.python_version(),
        'machine':platform.machine(),
        'libc':platform.libc_ver(),
        'packages':{n:importlib.metadata.version(n) for n in ('cryptography','cffi','pycparser')},
        'production_authorized':False,
    }

@app.function(image=image,name='forge_custody',min_containers=0,max_containers=1,scaledown_window=60,timeout=300)
@modal.web_server(8000,startup_timeout=90,requires_proxy_auth=True)
def forge_custody():
    import os, pathlib, subprocess, sys, textwrap, time, urllib.request
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    root=pathlib.Path('/tmp/forge-staging')
    release=root/'release'; custody=root/'custody'; sessions=root/'sessions'; uploads=root/'uploads'; keys=root/'keys'
    for p in (release,custody,sessions,uploads,keys): p.mkdir(parents=True,exist_ok=True)
    reg=root/'activation_registry.json'; reg.write_text('{"schema":"musitu.forge.activation_registry.v1","activations":[]}\n')
    os.chmod(reg,0o600)
    for name in ('assignment','receipt'):
        p=keys/f'{name}.pem'
        k=Ed25519PrivateKey.generate()
        p.write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        os.chmod(p,0o600)
    env=os.environ.copy()
    env.update({
        'PYTHONPATH':'/opt/forge/runtime',
        'FORGE_QUALIFIED_CORE_ROOT':'/opt/forge/runtime',
        'FORGE_QUALIFIED_CORE_FIELD_PILOT_SHA256':'70e87784d402ca8ecbb1d34dd82bd5ad8f041612f30fec7e697da8e6bcfa3ca0',
        'FORGE_QUALIFIED_CORE_REVIEW_FIELD_PILOT_SHA256':'128f6e0dc78ece85b8c001d726f14d48dc4c635afe4b4ede6575fb201fe6f695',
        'FORGE_QUALIFIED_CORE_REVIEW_FIELD_DATASET_SHA256':'28d4e15f483080576b31474a10746fb025e94ddfa99fa77c1ed04283341c311d',
        'FORGE_QUALIFIED_CORE_FIELD_DATASET_SHA256':'28d4e15f483080576b31474a10746fb025e94ddfa99fa77c1ed04283341c311d',
        'FORGE_QUALIFIED_CORE_FAULT_FIELD_PILOT_SHA256':'128f6e0dc78ece85b8c001d726f14d48dc4c635afe4b4ede6575fb201fe6f695',
        'FORGE_RELEASE_ROOT':str(release),
        'FORGE_PROTOCOL_DIGEST':'0'*64,
        'FORGE_FIELD_CUSTODY_ROOT':str(custody),
        'FORGE_ACTIVATION_REGISTRY':str(reg),
        'FORGE_SESSION_STATE_ROOT':str(sessions),
        'FORGE_UPLOAD_STATE_ROOT':str(uploads),
        'FORGE_ASSIGNMENT_SIGNING_KEY_ID':'staging-assignment-ephemeral',
        'FORGE_ASSIGNMENT_SIGNING_KEY_FILE':str(keys/'assignment.pem'),
        'FORGE_RECEIPT_SIGNING_KEY_ID':'staging-receipt-ephemeral',
        'FORGE_RECEIPT_SIGNING_KEY_FILE':str(keys/'receipt.pem'),
        'FORGE_BIND_HOST':'127.0.0.1','FORGE_BIND_PORT':'8787',
    })
    server=subprocess.Popen([sys.executable,'-m','apps.musitu_forge_custody_server'],env=env)
    for _ in range(120):
        if server.poll() is not None: raise RuntimeError(f'custody_server_exited_{server.returncode}')
        try:
            with urllib.request.urlopen('http://127.0.0.1:8787/v1/health',timeout=0.5) as r:
                h=json.loads(r.read())
            if h.get('status')=='READY' and h.get('production_authorized') is False: break
        except Exception: time.sleep(0.25)
    else: raise RuntimeError('custody_server_not_ready')
    proxy=pathlib.Path('/tmp/forge_reverse_proxy.py')
    proxy.write_text(textwrap.dedent('''
        import http.client
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        HOP={'connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailers','transfer-encoding','upgrade'}
        class H(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def _go(self):
                n=int(self.headers.get('content-length','0') or 0); body=self.rfile.read(n) if n else None
                hdr={k:v for k,v in self.headers.items() if k.lower() not in HOP and k.lower()!='host'}
                c=http.client.HTTPConnection('127.0.0.1',8787,timeout=60); c.request(self.command,self.path,body=body,headers=hdr); r=c.getresponse(); data=r.read()
                self.send_response(r.status,r.reason)
                for k,v in r.getheaders():
                    if k.lower() not in HOP and k.lower()!='content-length': self.send_header(k,v)
                self.send_header('Content-Length',str(len(data))); self.end_headers()
                if data: self.wfile.write(data)
                c.close()
            do_GET=do_POST=do_PUT=do_PATCH=do_DELETE=do_OPTIONS=do_HEAD=_go
            def log_message(self,*a): pass
        ThreadingHTTPServer(('0.0.0.0',8000),H).serve_forever()
    '''))
    subprocess.Popen([sys.executable,str(proxy)],env=env)

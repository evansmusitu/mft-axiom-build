"""Local, authenticated MUSITU Studio v0.1 dashboard and project API.

Security assumptions: trusted single administrator, TLS at approved reverse proxy,
loopback binding by default, worker runs in *separate* externally isolated process.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlsplit

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles

from .store import Conflict, Missing, StudioStore

APP_ROOT = Path(__file__).resolve().parent.parent
COOKIE_DEV = 'musitu_session'
COOKIE_PROD = '__Host-musitu_session'
RATE = {}


def create_app(root=None, admin_token=None, secure_cookie=False, allowed_hosts=None):
    token = admin_token if admin_token is not None else os.getenv('MUSITU_STUDIO_ADMIN_TOKEN','')
    if len(token) < 24:
        raise RuntimeError('MUSITU_STUDIO_ADMIN_TOKEN must contain at least 24 characters')
    secret = hashlib.sha256(('musitu-studio-v1-csrf:'+token).encode()).digest()
    storage = StudioStore(root or os.environ.get('MUSITU_STUDIO_DATA','./studio-data'), csrf_key=secret)
    app = FastAPI(title='MUSITU Enterprise Studio v0.1', docs_url=None, redoc_url=None, openapi_url=None)
    hosts = allowed_hosts or os.getenv('MUSITU_STUDIO_ALLOWED_HOSTS','localhost,127.0.0.1,testserver').split(',')
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[h.strip() for h in hosts if h.strip()])
    app.state.store = storage
    cookie = COOKIE_PROD if secure_cookie else COOKIE_DEV
    static = APP_ROOT / 'static'
    app.mount('/static', StaticFiles(directory=str(static)), name='static')

    @app.middleware('http')
    async def hardening(request, call_next):
        # FastAPI handles malformed requests, but reject oversized POST bodies.
        if request.method in ('POST','PATCH','PUT','DELETE'):
            length=request.headers.get('content-length')
            if length is not None:
                try:
                    if int(length) > 100*1024:
                        return JSONResponse({'error':'Request too large'},status_code=413)
                except ValueError:
                    return JSONResponse({'error':'Invalid Content-Length'},status_code=400)
        resp=await call_next(request)
        resp.headers['X-Content-Type-Options']='nosniff'
        resp.headers['X-Frame-Options']='DENY'
        resp.headers['Referrer-Policy']='no-referrer'
        resp.headers['Cache-Control']='no-store'
        resp.headers['Content-Security-Policy']="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        return resp

    def _require(request, mutation=False):
        sid=request.cookies.get(cookie)
        if not storage.session_check(sid):
            raise HTTPException(status_code=401,detail='Authentication required')
        if mutation:
            origin=request.headers.get('origin')
            if origin:
                try:
                    parsed=urlsplit(origin)
                    if parsed.netloc.lower()!=request.headers.get('host','').lower() or parsed.scheme not in ('http','https'):
                        raise HTTPException(status_code=403, detail='Invalid origin')
                except ValueError:
                    raise HTTPException(status_code=403,detail='Invalid origin')
            csrf=request.headers.get('x-csrf-token')
            if not csrf or not storage.session_check(sid,csrf):
                raise HTTPException(status_code=403,detail='Invalid CSRF token')
        return sid

    async def _json(request):
        body=await request.body()
        if len(body)>65536:raise HTTPException(status_code=413,detail='JSON exceeds 64 KiB')
        try:
            def no_duplicates(pairs):
                obj={}
                for k,v in pairs:
                    if k in obj:raise ValueError('Duplicate JSON property: '+k)
                    obj[k]=v
                return obj
            d=json.loads(body,object_pairs_hook=no_duplicates,
                         parse_constant=lambda v: (_ for _ in ()).throw(ValueError('Nonfinite JSON number')))
        except (ValueError,UnicodeDecodeError):
            raise HTTPException(status_code=400,detail='Malformed JSON')
        if type(d) is not dict:raise HTTPException(status_code=400,detail='Expected JSON object')
        return d

    @app.exception_handler(Missing)
    async def not_found(_req, exc):return JSONResponse({'error':str(exc)},status_code=404)

    @app.exception_handler(Conflict)
    async def conflict(_req,exc):return JSONResponse({'error':str(exc)},status_code=409)

    @app.exception_handler(ValueError)
    async def invalid(_req,exc):return JSONResponse({'error':str(exc)[:250]},status_code=400)

    @app.get('/')
    async def index():return FileResponse(static/'index.html',media_type='text/html')

    @app.get('/healthz')
    async def health():return {'service':'MUSITU Studio','status':'UP','ready_for_commercial_rendering':False,'gpu_verified':False}

    @app.post('/api/login')
    async def login(request:Request):
        ip=request.client.host if request.client else 'unknown'
        now=time.monotonic()
        entries=[t for t in RATE.get(ip,[]) if now-t<300]
        if len(entries)>=5:
            raise HTTPException(status_code=429,detail='Login rate limit exceeded')
        data=await _json(request)
        supplied=data.get('token','')
        if not isinstance(supplied,str) or not secrets.compare_digest(supplied,token):
            entries.append(now)
            RATE[ip]=entries
            raise HTTPException(status_code=401,detail='Invalid credentials')
        RATE.pop(ip,None)
        sid,csrf=storage.session_create()
        response=JSONResponse({'authenticated':True,'csrf':csrf,'role':'administrator'})
        response.set_cookie(cookie,sid,httponly=True,secure=secure_cookie,samesite='strict',path='/',max_age=8*3600)
        return response

    @app.get('/api/me')
    async def me(request:Request):
        sid=_require(request)
        return {'authenticated':True,'role':'administrator','csrf':storage.session_csrf(sid),
                'production_host_verified':False,'gpu_verified':False}

    @app.post('/api/logout')
    async def logout(request:Request):
        sid=_require(request,True)
        storage.session_delete(sid)
        response=JSONResponse({'ok':True})
        response.delete_cookie(cookie,path='/')
        return response

    @app.get('/api/projects')
    async def projects(request:Request):
        _require(request)
        return {'projects':storage.projects()}

    @app.post('/api/projects')
    async def new_project(request:Request):
        _require(request,True)
        d=await _json(request)
        if set(d)!={'name'}:raise ValueError('Only name is allowed')
        return JSONResponse(storage.create_project(d['name']),status_code=201)

    @app.get('/api/jobs')
    async def jobs(request:Request,project_id:str|None=None):
        _require(request)
        if project_id:storage.project(project_id)
        return {'jobs':storage.jobs(project_id)}

    @app.post('/api/projects/{project_id}/jobs')
    async def new_job(project_id:str, request:Request):
        _require(request,True)
        data=await _json(request)
        return JSONResponse(storage.create_job(project_id,data),status_code=201)

    @app.get('/api/jobs/{jid}')
    async def job(jid:str,request:Request):
        _require(request)
        return storage.job(jid)

    @app.post('/api/jobs/{jid}/approve')
    async def approve(jid:str,request:Request):
        _require(request,True)
        return storage.approve(jid)

    @app.post('/api/jobs/{jid}/cancel')
    async def cancel(jid:str,request:Request):
        _require(request,True)
        return storage.cancel(jid)

    @app.get('/api/jobs/{jid}/files/{filename}')
    async def artifact(jid:str, filename:str, request:Request):
        _require(request)
        job=storage.job(jid)
        allow={'scene.blend','scene.glb','preview.png','evidence.json','verification.json','worker_receipt.json'}
        if filename not in allow:raise HTTPException(status_code=404,detail='Unknown artifact')
        if job['state']!='VERIFIED':raise HTTPException(status_code=409,detail='Job output is not verified')
        base=storage.root/'runs'/jid
        target=base/('worker_receipt.json' if filename=='worker_receipt.json' else 'artifacts/'+filename)
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(base.resolve()):
            raise HTTPException(status_code=404,detail='Artifact not found')
        receipt=base/'worker_receipt.json'
        if not receipt.is_file() or receipt.is_symlink():
            raise HTTPException(status_code=409,detail='Missing verified receipt')
        if hashlib.sha256(receipt.read_bytes()).hexdigest()!=job['execution_receipt_sha256']:
            raise HTTPException(status_code=409,detail='Receipt digest mismatch')
        try:
            proof=json.loads(receipt.read_text())
            assert proof['state']=='VERIFIED' and proof['job_id']==jid
            checks=proof['verification']['sha256']
            if filename in ('scene.blend','scene.glb','preview.png'):
                if hashlib.sha256(target.read_bytes()).hexdigest()!=checks[filename]:
                    raise HTTPException(status_code=409,detail='Artifact integrity check failed')
        except HTTPException:
            raise
        except (ValueError,KeyError,AssertionError,TypeError):
            raise HTTPException(status_code=409,detail='Invalid verification receipt')
        media={'preview.png':'image/png','scene.glb':'model/gltf-binary','scene.blend':'application/octet-stream'}
        return FileResponse(target, media_type=media.get(filename,'application/json'),
                            filename=filename if filename!='preview.png' else None,
                            content_disposition_type='attachment' if filename!='preview.png' else 'inline')

    @app.get('/api/audit')
    async def audit(request:Request):
        _require(request)
        return {'events':storage.audit_log()}

    return app

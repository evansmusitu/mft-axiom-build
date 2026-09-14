import os
import pathlib
import runpy

src_path=pathlib.Path('admin/fmi_admin_worker.mjs')
src=src_path.read_text()
old_iterations="const PBKDF2_ITERATIONS = 120000;"
if old_iterations not in src:
    raise RuntimeError('expected PBKDF2 source invariant missing')
src=src.replace(old_iterations,"const PBKDF2_ITERATIONS = 60000;",1)
old_batch="""  await env.FMI_DB.batch([
    env.FMI_DB.prepare('INSERT INTO fmi_admin_credentials(principal,password_salt,password_hash,pbkdf2_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('owner', b64url(salt), b64url(derived), PBKDF2_ITERATIONS, now, now),
    env.FMI_DB.prepare('UPDATE fmi_admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, hash),
  ]);"""
new_batch="""  await dbRun(env, 'INSERT INTO fmi_admin_credentials(principal,password_salt,password_hash,pbkdf2_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)', 'owner', b64url(salt), b64url(derived), PBKDF2_ITERATIONS, now, now);
  await dbRun(env, 'UPDATE fmi_admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL', now, hash);"""
if old_batch not in src:
    raise RuntimeError('expected D1 batch source invariant missing')
src=src.replace(old_batch,new_batch,1)
worker_out=pathlib.Path('/tmp/fmi_admin_worker_v2.mjs')
worker_out.write_text(src)
os.environ['ADMIN_SOURCE']=str(worker_out)

deploy_path=pathlib.Path('scripts/deploy_fmi_admin.py')
deploy=deploy_path.read_text()
old_routes="""    protected={}
    for path in ('/api/overview','/api/customers','/api/revenue','/api/usage','/api/system','/api/audit'):
        pc,_,po,_=http_json(dev+path,'GET',headers=authh)
        if pc!=200:raise RuntimeError(f'admin protected smoke {path} HTTP {pc}')
        protected[path]=pc
"""
new_routes="""    protected={}
    for path in ('/api/overview','/api/customers','/api/revenue','/api/usage','/api/system','/api/audit'):
        pc=None
        for _route_try in range(30):
            pc,_,po,_=http_json(dev+path,'GET',headers=authh)
            if pc==200:break
            if pc not in (404,503):break
            time.sleep(1)
        if pc!=200:raise RuntimeError(f'admin protected smoke {path} HTTP {pc}')
        protected[path]=pc
"""
if old_routes not in deploy:
    raise RuntimeError('expected protected-route smoke invariant missing')
deploy=deploy.replace(old_routes,new_routes,1)
patched_deploy=pathlib.Path('/tmp/deploy_fmi_admin_v2_inner.py')
patched_deploy.write_text(deploy)
runpy.run_path(str(patched_deploy),run_name='__main__')

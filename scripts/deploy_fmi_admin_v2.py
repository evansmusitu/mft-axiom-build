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
# Keep error output intentionally generic; diagnostics must not echo secrets.
out=pathlib.Path('/tmp/fmi_admin_worker_v2.mjs')
out.write_text(src)
os.environ['ADMIN_SOURCE']=str(out)
runpy.run_path('scripts/deploy_fmi_admin.py',run_name='__main__')

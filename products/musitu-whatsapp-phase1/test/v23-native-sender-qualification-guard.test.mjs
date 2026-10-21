import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('destructive native sender qualifier refuses remote, ambiguous and unapproved targets before loading pg',()=>{
 const script=fileURLToPath(new URL('../scripts/qualify-development-reply-native.mjs',import.meta.url));
 const invalid=[
  {},
  {PG_ADMIN_URL:'postgres://postgres@127.0.0.1:55439/postgres'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@db.example.com:55439/postgres'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@127.0.0.1:55439/musitu_whatsapp_phase1'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@localhost:55439/postgres'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@127.0.0.1/postgres'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@127.0.0.1:55439/postgres?host=db.example.com'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@127.0.0.1:55439/postgres#ambiguous'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'https://127.0.0.1:55439/postgres'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@127.0.0.1:443/postgres'},
  {PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:'postgres://postgres@[::ffff:127.0.0.1]:55439/postgres'}
 ];
 for(const env of invalid){
  const result=spawnSync(process.execPath,[script],{env,encoding:'utf8',timeout:3000,maxBuffer:4096});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,78);
  assert.equal(result.stdout,'');assert.match(result.stderr,/^BLOCKED: explicit isolated qualification/);
  assert.ok(!result.stderr.includes(env.PG_ADMIN_URL||'postgres://'));
 }
});

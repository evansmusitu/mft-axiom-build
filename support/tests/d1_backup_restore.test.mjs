import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {runBackupRestoreDrill} from '../scripts/verify_d1_backup_restore.mjs';

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, async json() { return payload; }};
}

test('backup/restore drill restores synthetic support data from a D1 Time Travel bookmark and cleans up', async () => {
  const calls = [];
  const expectedPayloadSha = createHash('sha256').update('synthetic-support-backup-restore-v1').digest('hex');
  let marker = 'seed';
  let deleted = false;
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({method, path: u.pathname + u.search, body});

    if (u.pathname.endsWith('/d1/database') && method === 'POST') {
      return response(200, {success: true, result: {uuid: 'db-test-1', name: body.name, version: 'production'}});
    }
    if (u.pathname.endsWith('/d1/database/db-test-1/query') && method === 'POST') {
      const sql = String(body.sql || '');
      if (sql.includes('INSERT INTO support_backup_probe')) marker = 'seed';
      if (sql.includes("UPDATE support_backup_probe SET marker='mutated'")) marker = 'mutated';
      if (sql.startsWith('SELECT ')) return response(200, {success: true, result: [{results: [{marker, payload_sha256: expectedPayloadSha}]}]});
      return response(200, {success: true, result: [{success: true}]});
    }
    if (u.pathname.endsWith('/time_travel/bookmark') && method === 'GET') {
      return response(200, {success: true, result: {bookmark: 'bookmark-seed'}});
    }
    if (u.pathname.endsWith('/time_travel/restore') && method === 'POST') {
      assert.equal(u.searchParams.get('bookmark'), 'bookmark-seed');
      marker = 'seed';
      return response(200, {success: true, result: {bookmark: 'bookmark-restored', previous_bookmark: 'bookmark-mutated'}});
    }
    if (u.pathname.endsWith('/d1/database/db-test-1') && method === 'DELETE') {
      deleted = true;
      return response(200, {success: true, result: null});
    }
    throw new Error(`unexpected ${method} ${u.pathname}`);
  };

  const evidence = await runBackupRestoreDrill({
    fetchImpl,
    env: {
      GITHUB_REPOSITORY: 'evansmusitu/mft-axiom-build',
      GITHUB_REF_NAME: 'support/axiom-official-support-20261005',
      GITHUB_RUN_ID: '12345',
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'masked-token',
      SUPPORT_BACKUP_RESTORE_CONFIRM: 'VERIFY_MUSITU_AXIOM_SUPPORT_BACKUP_RESTORE',
    },
  });

  assert.equal(evidence.gate, 'BACKUP_RESTORE');
  assert.equal(evidence.status, 'PASS');
  assert.equal(evidence.synthetic_seed_restored, true);
  assert.equal(evidence.temporary_database_deleted, true);
  assert.equal(evidence.production_support_database_modified, false);
  assert.equal(deleted, true);
  assert.ok(calls.some(c => c.path.includes('/time_travel/restore?bookmark=')));
});


test('backup/restore drill can safely use the non-public empty support D1 when account database slots are full', async () => {
  const calls = [];
  let marker = null;
  let tableExists = false;
  const expectedPayloadSha = createHash('sha256').update('synthetic-support-backup-restore-v1').digest('hex');
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({method, path:u.pathname + u.search, body});

    if (u.pathname.endsWith('/workers/domains') && method === 'GET') return response(200, {success:true, result:[]});
    if (u.pathname.includes('/dns_records') && method === 'GET') return response(200, {success:true, result:[]});
    if (u.pathname.endsWith('/d1/database/support-db/query') && method === 'POST') {
      const sql=String(body.sql||'');
      if (sql.includes('COUNT(*) AS count FROM support_cases')) return response(200,{success:true,result:[{results:[{count:0}]}]});
      if (sql.includes('COUNT(*) AS count FROM support_case_events')) return response(200,{success:true,result:[{results:[{count:0}]}]});
      if (sql.startsWith('CREATE TABLE')) { tableExists=true; marker='seed'; return response(200,{success:true,result:[{success:true}]}); }
      if (sql.includes("UPDATE support_backup_probe_")) { marker='mutated'; return response(200,{success:true,result:[{success:true}]}); }
      if (sql.startsWith('SELECT payload_sha256')) return response(200,{success:true,result:[{results:tableExists?[{marker,payload_sha256:expectedPayloadSha}]:[]} ]});
      if (sql.startsWith('DROP TABLE')) { tableExists=false; marker=null; return response(200,{success:true,result:[{success:true}]}); }
      throw new Error('unexpected support-db query: '+sql);
    }
    if (u.pathname.endsWith('/d1/database/support-db/time_travel/bookmark') && method === 'GET') {
      return response(200,{success:true,result:{bookmark:'support-bookmark'}});
    }
    if (u.pathname.endsWith('/d1/database/support-db/time_travel/restore') && method === 'POST') {
      assert.equal(u.searchParams.get('bookmark'),'support-bookmark');
      marker='seed'; tableExists=true;
      return response(200,{success:true,result:{bookmark:'restored',previous_bookmark:'mutated'}});
    }
    throw new Error(`unexpected ${method} ${u.pathname}`);
  };

  const evidence=await runBackupRestoreDrill({
    fetchImpl,
    env:{
      GITHUB_REPOSITORY:'evansmusitu/mft-axiom-build',
      GITHUB_REF_NAME:'support/axiom-official-support-20261005',
      GITHUB_RUN_ID:'456',
      CLOUDFLARE_ACCOUNT_ID:'acct',
      CLOUDFLARE_ZONE_ID:'zone',
      CLOUDFLARE_API_TOKEN:'masked-token',
      SUPPORT_D1_DATABASE_ID:'support-db',
      SUPPORT_BACKUP_RESTORE_CONFIRM:'VERIFY_MUSITU_AXIOM_SUPPORT_BACKUP_RESTORE',
    },
  });

  assert.equal(evidence.status,'PASS');
  assert.equal(evidence.production_support_database_modified,false);
  assert.equal(evidence.existing_support_database_used,true);
  assert.equal(evidence.support_case_count_before,0);
  assert.equal(evidence.support_event_count_before,0);
  assert.equal(evidence.temporary_table_deleted,true);
  assert.equal(tableExists,false);
  assert.equal(calls.some(c=>c.method==='POST' && c.path.endsWith('/d1/database')),false);
});

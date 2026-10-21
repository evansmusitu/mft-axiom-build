import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../0002_harden_terminal_asset_integrity.sql',import.meta.url),'utf8');
const chunks=source.split(/^-- @statement\s*$/m).map(s=>s.trim()).filter(s=>s&&!s.startsWith('-- MUSITU'));

test('isolated hardening is explicit, ordered, versioned, and additive',()=>{
 assert.equal(chunks.length,4);
 assert.match(source,/CREATE OR REPLACE FUNCTION studio_v03\.enforce_job_asset_integrity\(\)/);
 assert.match(source,/CREATE OR REPLACE FUNCTION studio_v03\.enforce_asset_integrity\(\)/);
 assert.match(source,/CREATE OR REPLACE TRIGGER job_state_integrity BEFORE UPDATE ON studio_v03\.jobs/);
 assert.match(source,/VALUES\(2,/);
 assert.doesNotMatch(source,/\b(?:DROP|TRUNCATE|DELETE FROM|GRANT|REVOKE|ALTER ROLE|DISABLE TRIGGER)\b/i);
});
test('terminal jobs reject ALL row mutations, not only changes to state',()=>{
 assert.match(source,/OLD\.state IN \('COMPLETED','FAILED'\)/);
 assert.match(source,/RAISE EXCEPTION 'TERMINAL_JOB_IMMUTABLE'/);
 assert.doesNotMatch(source,/BEFORE UPDATE OF state ON studio_v03\.jobs/);
});
test('asset row cannot be reassigned from a completed job to an active job',()=>{
 assert.match(source,/IF NEW\.job_id IS DISTINCT FROM OLD\.job_id/);
 assert.match(source,/ASSET_JOB_REASSIGNMENT_DENIED/);
 assert.match(source,/WHERE id=OLD\.job_id FOR UPDATE/);
});
test('assets serialize against job completion with database row locks',()=>{
 assert.match(source,/WHERE id=NEW\.job_id FOR UPDATE/);
 assert.match(source,/WHERE id=OLD\.job_id FOR UPDATE/);
 assert.match(source,/ASSET_INSERT_NONACTIVE_JOB/);
 assert.match(source,/COMPLETED_ASSET_IMMUTABLE/);
 assert.match(source,/COMPLETED_JOB_REQUIRES_THREE_ASSETS/);
});

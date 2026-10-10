import test from "node:test";
import assert from "node:assert/strict";
import { hashJson } from "../../phase1/src/index.ts";
import { evaluateEvidencePolicy, type TemporalFact, type WorldSnapshot } from "../src/index.ts";

const tenantId="tenant:test";
function fact(id:string,value:string,observedAt:string,extra:Partial<TemporalFact>={}):TemporalFact {
  return {id,entity:"portfolio:alpha",attribute:"equity",value:{type:{kind:"decimal",unit:"USD",scale:2},value},validFrom:"2026-10-05T18:00:00.000Z",observedAt,source:`source:${id}`,...extra};
}
function snapshot(facts:TemporalFact[],asOf="2026-10-05T18:30:00.000Z"):WorldSnapshot {
  const snapshotHash=hashJson({tenantId,asOf,facts});
  return {tenantId,snapshotId:`snapshot:${snapshotHash}`,snapshotHash,asOf,facts};
}
const req=[{id:"fresh-equity",entity:"portfolio:alpha",attribute:"equity",maxAgeMs:15*60*1000}];

test("policy allows fresh evidence and denies stale or unresolved conflicting evidence",()=>{
  const fresh=evaluateEvidencePolicy(snapshot([fact("a","100000.00","2026-10-05T18:25:00.000Z")]),req);
  assert.equal(fresh.status,"ALLOW"); assert.equal(fresh.checks[0].code,"OK");
  const stale=evaluateEvidencePolicy(snapshot([fact("a","100000.00","2026-10-05T18:00:00.000Z")]),req);
  assert.equal(stale.status,"DENY"); assert.equal(stale.checks[0].code,"STALE_EVIDENCE");
  const conflict=evaluateEvidencePolicy(snapshot([fact("a","100000.00","2026-10-05T18:25:00.000Z"),fact("b","120000.00","2026-10-05T18:26:00.000Z")]),req);
  assert.equal(conflict.status,"DENY"); assert.equal(conflict.checks[0].code,"CONFLICTING_EVIDENCE");
  const resolved=evaluateEvidencePolicy(snapshot([fact("a","100000.00","2026-10-05T18:25:00.000Z"),fact("b","120000.00","2026-10-05T18:26:00.000Z",{supersedes:["a"]})]),req);
  assert.equal(resolved.status,"ALLOW"); assert.deepEqual(resolved.checks[0].factIds,["b"]);
});

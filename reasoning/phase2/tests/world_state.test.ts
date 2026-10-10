import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashJson } from "../../phase1/src/index.ts";
import { WorldStateStore, type TemporalFact } from "../src/index.ts";

const scope={tenantId:"tenant:test"};
function fact(overrides:Partial<TemporalFact>={}):TemporalFact {
  return {
    id:"fact-1",entity:"portfolio:alpha",attribute:"equity",
    value:{type:{kind:"decimal",unit:"USD",scale:2},value:"100000.00"},
    validFrom:"2026-10-05T18:00:00.000Z",observedAt:"2026-10-05T18:00:00.000Z",
    source:"custodian:test",confidence:1,...overrides
  };
}

test("world state persists temporal facts and reproduces deterministic snapshots",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-p2-")); const db=join(dir,"world.db");
  try{
    const first=new WorldStateStore(db);
    await first.putFact(scope,fact());
    const a=await first.snapshot(scope,"2026-10-05T18:30:00.000Z");
    first.close();
    assert.equal(a.tenantId,scope.tenantId);
    assert.equal(a.facts.length,1);
    assert.equal(a.facts[0].value.value,"100000.00");
    assert.match(a.snapshotHash,/^[0-9a-f]{64}$/);
    assert.equal(a.snapshotId,`snapshot:${a.snapshotHash}`);

    const reopened=new WorldStateStore(db);
    const b=await reopened.snapshot(scope,"2026-10-05T18:30:00.000Z");
    reopened.close();
    assert.deepEqual(b,a);
    assert.equal(b.snapshotHash,hashJson({tenantId:scope.tenantId,asOf:b.asOf,facts:b.facts}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

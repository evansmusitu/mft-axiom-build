import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("Phase 2.5C exposes no raw worker-id authority path",async()=>{
  const phase2:any=await import("../src/index.ts");
  const dir=mkdtempSync(join(tmpdir(),"axiom-p25c-no-raw-worker-"));
  const db=join(dir,"jobs.db");
  const store:any=new phase2.DistributedExecutionStore(db);
  try{
    for(const name of ["claimNext","heartbeat","releaseForRetry","complete","failTerminal","currentLease"]){
      assert.equal(typeof store[name],"undefined",`SQLite repository must not expose raw worker mutation ${name}`);
      assert.equal(
        typeof phase2.PostgresDistributedExecutionRepository.prototype[name],
        "undefined",
        `PostgreSQL repository must not expose raw worker mutation ${name}`
      );
    }

    assert.throws(
      ()=>new phase2.DistributedModelExecutionWorker({
        jobs:store,
        runtimes:{create(){throw new Error("must not create runtime");}},
        leaseMs:1000,
        clock:()=>"2026-10-10T00:00:00.000Z"
      }),
      /authenticated worker control|worker credential|requestId/i,
      "worker runtime must require authenticated worker control instead of accepting raw jobs/workerId authority"
    );
  }finally{
    store.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

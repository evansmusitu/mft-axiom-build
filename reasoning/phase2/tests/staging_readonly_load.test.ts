import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const cmd=resolve(root,"scripts/readonly-staging-load.mjs");
function tryRun(env:Record<string,string>){
  const child=spawnSync(process.execPath,[cmd],{
    cwd:root,timeout:8000,encoding:"utf8",
    env:{PATH:process.env.PATH??"",HOME:process.env.HOME??"",...env}
  });
  assert.equal(child.signal,null);
  return child;
}
test("staging load probe refuses all network activity without explicit operator authorization",()=>{
  const result=tryRun({});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/AUTHORIZATION_REQUIRED/);
  assert.doesNotMatch(result.stderr,/api[_-]?key|token|credential/i);
});
test("staging load probe refuses unverifiable configuration before network",()=>{
  const result=tryRun({
    AXIOM_STAGING_LOAD:"AUTHORIZED",
    AXIOM_STAGING_CONFIG_PATH:"/not-a-real-axiom-approved-manifest.json",
    AXIOM_STAGING_CONFIG_SHA256:"a".repeat(64),
    AXIOM_STAGING_EVIDENCE_PATH:"/not-a-real-axiom-evidence-file.json"
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/CONFIG_INVALID/);
});

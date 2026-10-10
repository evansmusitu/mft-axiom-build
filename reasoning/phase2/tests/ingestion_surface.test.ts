import assert from "node:assert/strict";
import test from "node:test";

test("authenticated ingestion exposes only the atomic world-repository replay path", async()=>{
  const phase2=await import("../src/index.ts");
  assert.equal(
    "IngestionReceiptStore" in phase2,
    false,
    "standalone ingestion receipt storage must not remain on the public Phase-2 surface"
  );
});

import { readFileSync } from "node:fs";
import { compileProgram } from "./compiler.ts";
import { createDefaultRegistry } from "./registry.ts";
import { AxiomRuntime } from "./runtime.ts";
import { createSigner, issueCertificate, type ReasoningCertificate } from "./certificate.ts";
import { replayCertificate } from "./replay.ts";
import type { AxiomProgram } from "./types.ts";

function usage():never {
  console.error("Usage: cli.ts execute <program.json> | replay <certificate.json>");
  process.exit(64);
}

const [, , command, file] = process.argv;
if (!command || !file) usage();
const registry=createDefaultRegistry();
if(command==="execute"){
  const program=JSON.parse(readFileSync(file,"utf8")) as AxiomProgram;
  const compiled=compileProgram(program,registry);
  const execution=new AxiomRuntime(registry).execute(compiled);
  const certificate=issueCertificate(compiled,execution,createSigner());
  process.stdout.write(`${JSON.stringify(certificate,null,2)}\n`);
}else if(command==="replay"){
  const certificate=JSON.parse(readFileSync(file,"utf8")) as ReasoningCertificate;
  const result=replayCertificate(certificate,registry);
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  process.exitCode=result.status==="MATCH"?0:2;
}else usage();

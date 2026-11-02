/** Reproducible operator review bundle. Does not provision keys or deploy. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const {build,version}=await import(process.env.AXIOM_ESBUILD_MODULE||'esbuild');
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--output-dir'||args[2]!=='--execution-artifact-sha256'||!/^[0-9a-f]{64}$/.test(args[3]))throw Error('usage: node integrations/independent-ledger/build.mjs --output-dir PATH --execution-artifact-sha256 OPERATOR_APPROVED_RUNTIME_SHA256');
const root=fileURLToPath(new URL('../../',import.meta.url)),output=resolve(args[1]),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=['integrations/independent-ledger/worker.mjs','integrations/independent-ledger/protocol.mjs','integrations/independent-ledger/github-anchor.mjs','axiom_interface/vnext/execution_integrity.mjs','axiom_interface/vnext/analytical_workflows.mjs','axiom_interface/vnext/decision_analysis.mjs'];
const result=await build({absWorkingDir:root,entryPoints:[sources[0]],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent',metafile:true});
if(JSON.stringify(Object.keys(result.metafile.inputs).sort())!==JSON.stringify([...sources].sort()))throw Error('review source set changed; explicitly review the build manifest inputs');
const bundle=result.outputFiles[0].contents;
const manifest={schema:'musitu.axiom.external-ledger-build.v1',execution_artifact_sha256:args[3],toolchain:{esbuild:version,format:'esm',platform:'browser',target:'es2022'},bundle:{path:'ledger-worker.mjs',sha256:hash(bundle),bytes:bundle.byteLength},
  sources:await Promise.all(sources.map(async path=>{const bytes=await readFile(join(root,path));return {path,sha256:hash(bytes),bytes:bytes.byteLength};})),
  independent_custody_verified:false,live_external_qualification:false};
await mkdir(output,{recursive:true});
await writeFile(join(output,'ledger-worker.mjs'),bundle,{flag:'wx'});
await writeFile(join(output,'ledger-build-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify(manifest)+'\n');

#!/usr/bin/env python3
"""Build one owner-only Windows operator file from exact approved code/bundles."""
import argparse,base64,gzip,hashlib,json,re,subprocess,zipfile
from pathlib import Path

APPROVED='68799a41a367865649b833de649edcb26f77c0d3'
CONFIG='bc09d63349f611a71f0eef6c1ad1d00bd861454aeab7c41f9565056758f2f8e3'
APPROVED_HASHES={
'integrations/security-authority2/authority2-r2-worm.mjs':'ce080ac8b5a6e190cf22e0bf9a5cf34251174822020b3b6da3e349fe4f5e17f7',
'integrations/security-authority2/external-highwater-fence.mjs':'05e2af07f51f3db07f182b48f1597dae2543f090834a8b6b71b74118f675a374',
'integrations/security-authority2/authority2-initializer-retirement.mjs':'faf2b0cb87596c2d9854b82755f9ee31429647dd053bb6ea916e5ddf1925e711',
'integrations/security-authority2/authority2-active-deployment.mjs':'92919c572706cd06e13fe634c5ab0ff1a9ce7fd6ca67c1df65d1203cbd4e0a06',
'integrations/security-authority2/authority2-worker-bindings.mjs':'1323ff19cedc1df9d43819e34498e7b17381a990cc5455dd637ab374587c75c7',
'integrations/independent-ledger/github-anchor.mjs':'56adbfd251a1dcf77d09ac4f28aebf88d75500ee1ea02dc02733bd86e42f3a01',
'integrations/independent-ledger/protocol.mjs':'6783a69358851a5f95595e85c5504282f33bcc407bd9225c7e36a95576c5ac93',
'axiom_interface/vnext/execution_integrity.mjs':'d7cdfd215de86fd44b6e25e8adc014ce3314e11e2529f616a5d6f066dd4884d6',
'axiom_interface/vnext/analytical_workflows.mjs':'568ebb3d629065d12825f322b9a2465a538fd548a72a6516488d685f5d233520',
'axiom_interface/vnext/decision_analysis.mjs':'e8477d71f61627c231fb31e236767cdc37485f317cc16c38f5dd24a304005d35'}
sha=lambda b:hashlib.sha256(b).hexdigest()
def build(args):
 root=Path(__file__).resolve().parents[1];src=root/'customer_frontier/qualification/authority2_operator'
 if not re.fullmatch('[a-f0-9]{40}',args.source_commit):raise ValueError('SOURCE_COMMIT_INVALID')
 approved=args.approved_root.resolve();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=approved,text=True).strip()
 if head!=APPROVED:raise ValueError('APPROVED_CHECKOUT_COMMIT_MISMATCH')
 for name,digest in APPROVED_HASHES.items():
  if sha((approved/name).read_bytes())!=digest:raise ValueError('APPROVED_SOURCE_HASH_MISMATCH:'+name)
 stage=args.stage.resolve();stage.mkdir(parents=True,exist_ok=True)
 for name in ['pins.mjs','transport.mjs','scope_policy.mjs','boundary.mjs','tail.mjs','operator_core.mjs','operator_cli.mjs','private_evidence.mjs','private_hosted_harness.mjs']:(stage/name).write_bytes((src/name).read_bytes())
 (stage/'parser.mjs').write_bytes((root/'customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs').read_bytes())
 for name,target in [('authority2-r2-worm.mjs','approved-r2.mjs'),('external-highwater-fence.mjs','approved-fence.mjs')]:(stage/target).write_bytes((approved/'integrations/security-authority2'/name).read_bytes())
 evidence=root/'customer_frontier/evidence/gate3_security_20261114/raw_ci_artifacts_20261115';bundles={}
 for kind,zname,mname,expected in [('initializer','14166403026.zip','PRIVATE_INITIALIZER_BUILD_MANIFEST.json','ec884e4117e3ba392c59ae33b029722cb23bba03889a6dd23facd52a9a5aa3c4'),('serving','14166586455.zip','A2_BUILD_MANIFEST.json','d1ddd1e944bfa4560cc662f7fd12a9b22b3f6493175e4a38b2b3db7e1aed4210')]:
  with zipfile.ZipFile(evidence/zname) as z:
   if z.testzip() is not None:raise ValueError('ORIGINAL_ARTIFACT_ZIP_INVALID')
   m=json.loads(z.read(mname));data=z.read(m['bundle_file'])
   if m['source_commit']!=APPROVED or sha(data)!=expected:raise ValueError('APPROVED_BUNDLE_MISMATCH')
   bundles[kind]={'base64':base64.b64encode(data).decode(),'sha256':expected,'bytes':len(data)}
 (stage/'approved-serving.mjs').write_bytes(base64.b64decode(bundles['serving']['base64']))
 js=r'''const fs=require('node:fs'),path=require('node:path');const esbuild=require(process.argv[1]);const approved=process.argv[2],stage=process.argv[3];
 (async()=>{for(const [source,target]of [['integrations/independent-ledger/github-anchor.mjs','approved-anchor.mjs'],['integrations/security-authority2/authority2-initializer-retirement.mjs','approved-retirement.mjs']]){const b=await esbuild.build({absWorkingDir:approved,entryPoints:[source],bundle:true,format:'esm',platform:target==='approved-retirement.mjs'?'node':'browser',target:'es2022',write:false});fs.writeFileSync(path.join(stage,target),b.outputFiles[0].contents);}
 const b=await esbuild.build({absWorkingDir:stage,entryPoints:['private_hosted_harness.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});fs.writeFileSync(path.join(stage,'hosted-harness.js'),b.outputFiles[0].contents);})().catch(()=>process.exitCode=2);'''
 subprocess.run([args.node,'-e',js,str(args.esbuild.resolve()),str(approved),str(stage)],check=True)
 harness=(stage/'hosted-harness.js').read_bytes();bundles['harness']={'base64':base64.b64encode(harness).decode(),'sha256':sha(harness),'bytes':len(harness)}
 files={n:(stage/n).read_text(encoding='utf-8') for n in ['pins.mjs','transport.mjs','scope_policy.mjs','boundary.mjs','tail.mjs','operator_core.mjs','operator_cli.mjs','private_evidence.mjs','parser.mjs','approved-anchor.mjs','approved-retirement.mjs']}
 payload={'schema':'musitu.axiom.authority2.single-file-online-operator-package.v1','source_commit':args.source_commit,'approved_source_commit':APPROVED,'approved_config_sha256':CONFIG,'approved_input_source_sha256':APPROVED_HASHES,'files':files,'bundles':bundles,'new_automation_and_hosted_harness_requires_operator_review':True,'credential_values_included':False,'gate3_closed':False,'release_status':'NOT_RELEASE'}
 raw=json.dumps(payload,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode();(stage/'payload.json').write_bytes(raw)
 text=(src/'owner_online_runner.template.ps1').read_text(encoding='utf-8');replace={'SOURCE_COMMIT':args.source_commit,'PAYLOAD_SHA':sha(raw),'PAYLOAD_GZIP_B64':base64.b64encode(gzip.compress(raw,mtime=0)).decode()}
 for k,v in replace.items():
  if text.count('@@'+k+'@@')!=1:raise ValueError('PACKAGE_PLACEHOLDER_INVALID')
  text=text.replace('@@'+k+'@@',v)
 out=text.encode('utf-8-sig');args.out.write_bytes(out)
 receipt={'source_commit':args.source_commit,'file':args.out.name,'bytes':len(out),'sha256':sha(out),'payload_sha256':sha(raw),'bundles':{k:{x:y for x,y in v.items() if x!='base64'} for k,v in bundles.items()},'actual_owner_execution_performed':False,'gate3_closed':False,'release_status':'NOT_RELEASE'}
 (stage/'PACKAGE_BUILD_RECEIPT.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-commit',required=True);p.add_argument('--approved-root',type=Path,required=True);p.add_argument('--stage',type=Path,required=True);p.add_argument('--esbuild',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--node',default='node');build(p.parse_args())

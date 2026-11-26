// Owner-PC only. Original provider bytes may contain private metadata/capabilities.
// Encrypt them locally; never put raw responses or the archive in RETURN_ONLY.
import {randomBytes,createCipheriv} from 'node:crypto';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {need} from './pins.mjs';
export class PrivateEvidence{
 constructor(root,{wrap}={}){
  this.key=randomBytes(32);this.n=0;this.size=0;this.failed=false;this.directory=join(root,'PRIVATE_ORIGINAL_PROVIDER_RESPONSES_DO_NOT_UPLOAD');mkdirSync(this.directory,{recursive:false});
  const encode=wrap??(bytes=>{
   const exe=join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
   const code="try { Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p)); [Array]::Clear($b,0,$b.Length) } catch { [Console]::Error.WriteLine('A2_OWNER_DPAPI_UNAVAILABLE'); exit 2 }";
   const r=spawnSync(exe,['-NoProfile','-NonInteractive','-Command',code],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,shell:false,timeout:30000,maxBuffer:32768});need(r.status===0&&/^[A-Za-z0-9+/=]+$/.test(r.stdout),'A2OP_OWNER_DPAPI_REQUIRED_HOLD');return Buffer.from(r.stdout,'base64');
  });
  const wrapped=encode(this.key);need(wrapped instanceof Uint8Array&&wrapped.length>32&&wrapped.length<8192,'A2OP_DPAPI_WRAPPED_KEY_HOLD');writeFileSync(join(this.directory,'WINDOWS_CURRENT_USER_WRAPPED_SESSION_KEY.bin'),wrapped,{flag:'wx',mode:0o600});
  this.file=join(this.directory,'ORIGINAL_PROVIDER_RESPONSES.aes256gcm.jsonl');writeFileSync(this.file,'',{flag:'wx',mode:0o600});
 }
 capture(record){
  try{const plain=Buffer.from(JSON.stringify(record));need(this.size+plain.length<=16777216&&this.n<1024,'A2OP_PRIVATE_EVIDENCE_BUDGET_HOLD');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const bytes=Buffer.concat([cipher.update(plain),cipher.final()]);const row={sequence:++this.n,iv_base64:iv.toString('base64'),tag_base64:cipher.getAuthTag().toString('base64'),ciphertext_base64:bytes.toString('base64')};appendFileSync(this.file,JSON.stringify(row)+'\n',{mode:0o600});this.size+=plain.length;plain.fill(0);return true;}catch{this.failed=true;return false;}
 }
 close(){this.key.fill(0);}
}

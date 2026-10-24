/** Operator-only offsite restore build. Existing escrow key stays in the
 * provider; actual restore child has only loopback credentials and private input.
 */
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,readFileSync,readdirSync,chownSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {openPostgresBackup} from '../src/postgres/encrypted-backup.mjs';
if(process.env.PG_HOSTED_RECOVERY_QUALIFICATION!=='YES'||process.platform!=='linux'||process.arch!=='x64'){
 console.error('BLOCKED: explicit isolated hosted-checkpoint recovery build required');process.exit(78);
}
const root=resolve(import.meta.dirname,'..'),hash=process.env.EXPECTED_BACKUP_SHA256||'';
const uid=process.getuid()===0?65534:process.getuid(),gid=process.getuid()===0?65534:process.getgid();
const temp=mkdtempSync(join(tmpdir(),'musitu-offsite-restore-')),env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C',TMPDIR:temp};
const own=p=>{if(process.getuid()===0)chownSync(p,uid,gid);};
let started=false,bin,report,failure,key;
function run(command,args,{cwd=temp,extraEnv={}}={}){
 const r=spawnSync(command,args,{uid,gid,env:{...env,...extraEnv},cwd,encoding:'utf8',maxBuffer:1024*1024,timeout:180000});
 if(r.error||r.status!==0){if(args[0]?.endsWith('restore-hosted-checkpoint-child.mjs'))console.error(r.stderr.slice(-1000));throw Error('ISOLATED_RESTORE_BUILD_STEP_FAILED');}
 return r.stdout;
}
try{
 if(!/^[a-f0-9]{64}$/.test(hash))throw Error('EXPECTED_BACKUP_HASH_REQUIRED');
 const encrypted=readFileSync(join(root,'.private-offsite-checkpoint.musitubak'));
 if(encrypted.length>8*1024*1024||createHash('sha256').update(encrypted).digest('hex')!==hash)throw Error('OFFSITE_CIPHERTEXT_HASH_MISMATCH');
 const rawKey=process.env.BACKUP_KEY_20261018||'';if(!/^[A-Za-z0-9+/]{43}=$/.test(rawKey))throw Error('EXISTING_ESCROW_KEY_REQUIRED');
 key=Buffer.from(rawKey,'base64');const payload=openPostgresBackup({encrypted,backupKey:key});key.fill(0);
 if(payload.version!==2||![15,16,17].includes(payload.schemaVersion)||!payload.sourceCatalog||payload.sourceCatalog.length!==6||!payload.sourceRoles||!payload.sourceDependencies)throw Error('CURRENT_HOSTED_CHECKPOINT_REQUIRED');
 const files=readdirSync(join(root,'db')).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort();
 if(files.length<payload.schemaVersion||payload.migrations.length!==payload.schemaVersion)throw Error('MIGRATION_INVENTORY_REJECTED');
 for(const [i,m] of payload.migrations.entries()){const sql=readFileSync(join(root,'db',files[i]),'utf8');if(m.name!==files[i]||m.sql!==sql||m.sha256!==createHash('sha256').update(sql).digest('hex'))throw Error('RESTORE_SQL_PROVENANCE_REJECTED');}
 own(temp);chmodSync(temp,0o700);
 const identity=JSON.parse(run(process.execPath,['-e','console.log(JSON.stringify({uid:process.getuid()}))']));
 if(identity.uid===0)throw Error('NONROOT_POSTGRES_REQUIRED');
 run('npm',['install','--prefix',temp,'--cache',join(temp,'npm-cache'),'--ignore-scripts','--no-save','--no-audit','--no-fund','@embedded-postgres/linux-x64@17.10.0-beta.17','pg@8.23.1','jose@6.1.0']);
 const packageRoot=join(temp,'node_modules/@embedded-postgres/linux-x64');run(process.execPath,['scripts/hydrate-symlinks.js'],{cwd:packageRoot});bin=join(packageRoot,'native/bin');
 const product=join(temp,'product');mkdirSync(product);own(product);
 for(const name of ['src','scripts'])cpSync(join(root,name),join(product,name),{recursive:true});
 const input=join(product,'.private-restore-payload.json');writeFileSync(input,JSON.stringify(payload),{mode:0o600});own(input);
 const password=randomBytes(32).toString('hex'),pwfile=join(temp,'local-password');writeFileSync(pwfile,password,{mode:0o600});own(pwfile);
 const data=join(temp,'data');run(join(bin,'initdb'),['-D',data,'-U','postgres','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',pwfile,'--no-locale','--encoding=UTF8']);
 const port=await new Promise((yes,no)=>{const server=createServer();server.once('error',no);server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(e=>e?no(e):yes(p));});});
 run(join(bin,'pg_ctl'),['-D',data,'-l',join(temp,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${temp}`,'-w','start']);started=true;
 report=JSON.parse(run(process.execPath,[join(product,'scripts/restore-hosted-checkpoint-child.mjs')],{cwd:product,extraEnv:{PG_HOSTED_RECOVERY_CHILD:'YES',PG_ADMIN_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`}}).trim());
 if(report.status!=='PASS'||report.tables!==22||report.rowFingerprintsMatched!==22||report.catalogClassesMatched!==6||report.hostedDatabaseModified!==false||report.disposableDatabaseAndRolesRemoved!==true)throw Error('ISOLATED_RESTORE_REPORT_REJECTED');
 report={...report,backupSha256:hash,backupBytes:encrypted.length,postgresOsUid:identity.uid,restoreInput:'INDEPENDENT_DRIVE_RETRIEVAL'};
}catch(e){failure=e;}
finally{
 key?.fill(0);
 if(started)try{run(join(bin,'pg_ctl'),['-D',join(temp,'data'),'-m','immediate','-w','stop']);}catch{failure??=Error('RESTORE_SERVER_STOP_FAILED');}
 try{rmSync(temp,{recursive:true,force:true});}catch{failure??=Error('RESTORE_TEMPORARY_CLEANUP_FAILED');}
}
if(failure){console.error(/^[A-Z_]+$/.test(failure.message)?failure.message:'ISOLATED_HOSTED_RECOVERY_FAILED');process.exitCode=1;}
else console.log(JSON.stringify({...report,serverStopped:true,temporaryFilesRemoved:true,fixtureCleanupPassed:true}));

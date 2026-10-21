/** Explicit, disposable Linux build qualification. No hosted DB or provider access.
 * Runs PostgreSQL as an actual non-root OS user, with a minimal child environment.
 * Temporary test dependencies never enter product package files or deployment output.
 */
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,chownSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';

if(process.env.PG_BUILD_QUALIFICATION!=='YES'||process.platform!=='linux'||process.arch!=='x64'){
 console.error('BLOCKED: explicit disposable Linux x64 build qualification required');process.exit(78);
}
const root=resolve(import.meta.dirname,'..'),uid=process.getuid()===0?65534:process.getuid(),gid=process.getuid()===0?65534:process.getgid();
const temp=mkdtempSync(join(tmpdir(),'musitu-native-sender-'));
const env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C',TMPDIR:temp};
const options={uid,gid,env,encoding:'utf8',maxBuffer:4*1024*1024,timeout:180000};
let started=false,bin,report,failed;
const own=path=>{if(process.getuid()===0)chownSync(path,uid,gid);};
function run(command,args,{cwd=temp,extraEnv={},timeout=180000}={}){
 const result=spawnSync(command,args,{...options,cwd,env:{...env,...extraEnv},timeout});
 if(result.error||result.status!==0){
  // Child environment contains no hosted credentials. Retain synthetic diagnostic
  // text only for the qualifier; package/server logs are intentionally omitted.
  if(args[0]?.endsWith('qualify-development-reply-native.mjs'))console.error(result.stderr.slice(-10000));
  throw Error('NATIVE_BUILD_STEP_FAILED:'+command.split('/').at(-1)+':'+(result.error?.code??result.status));
 }
 return result.stdout;
}
try{
 own(temp);chmodSync(temp,0o700);
 const childIdentity=JSON.parse(run(process.execPath,['-e','console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid()}))']));
 if(childIdentity.uid===0)throw Error('NATIVE_NONROOT_REQUIRED');
 run('npm',['install','--prefix',temp,'--cache',join(temp,'npm-cache'),'--ignore-scripts','--no-save','--no-audit','--no-fund','@embedded-postgres/linux-x64@17.10.0-beta.17','pg@8.23.1']);
 const packageRoot=join(temp,'node_modules/@embedded-postgres/linux-x64');
 run(process.execPath,['scripts/hydrate-symlinks.js'],{cwd:packageRoot});
 bin=join(packageRoot,'native/bin');
 const product=join(temp,'product');mkdirSync(product);own(product);
 for(const name of ['src','db'])cpSync(join(root,name),join(product,name),{recursive:true});
 mkdirSync(join(product,'scripts'));
 cpSync(join(root,'scripts/qualify-development-reply-native.mjs'),join(product,'scripts/qualify-development-reply-native.mjs'));
 const password=randomBytes(32).toString('hex'),pwfile=join(temp,'local-password');
 writeFileSync(pwfile,password,{mode:0o600});own(pwfile);
 const data=join(temp,'data');
 run(join(bin,'initdb'),['-D',data,'-U','postgres','--auth-local=trust','--auth-host=scram-sha-256','--pwfile',pwfile,'--no-locale','--encoding=UTF8']);
 const port=await new Promise((resolvePort,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(error=>error?reject(error):resolvePort(n));});});
 run(join(bin,'pg_ctl'),['-D',data,'-l',join(temp,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${temp}`,'-w','start']);started=true;
 const output=run(process.execPath,[join(product,'scripts/qualify-development-reply-native.mjs')],{cwd:product,extraEnv:{PG_ISOLATED_QUALIFICATION:'YES',PG_ADMIN_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`}});
 report=JSON.parse(output.trim());
 if(report.passed!==6||report.failed!==0||report.realMetaPosts!==0||report.hostedDatabaseTouched!==false)throw Error('NATIVE_REPORT_REJECTED');
 report={...report,executionEnvironment:'DISPOSABLE_BUILD_NONROOT_POSTGRES',postgresOsUid:childIdentity.uid};
}catch(error){failed=error;}
finally{
 if(started){try{run(join(bin,'pg_ctl'),['-D',join(temp,'data'),'-m','immediate','-w','stop']);}catch(error){failed??=error;}}
 try{rmSync(temp,{recursive:true,force:true});}catch(error){failed??=error;}
}
if(failed){console.error(failed.message);process.exitCode=1;}
else console.log(JSON.stringify({...report,fixtureCleanupPassed:true,serverStopped:true,temporaryFilesRemoved:true}));

/** Private synthetic-only count inspection. No remote write, no customer record returned. */
import {fileURLToPath} from 'node:url';
const deny=()=>{throw Error('MMF_PRIVATE_CONTROL_INSPECTION_DENIED')};
const FIELDS=['schema','state','tenantCount','usageCount'];
export async function inspectRemoteMmfControl(fetchImpl=fetch){
 try{
  const r=await fetchImpl('http://127.0.0.1:8796/control/inspect',{
   method:'GET',signal:AbortSignal.timeout(18000)
  });
  if(r.status!==200)deny();
  const o=await r.json();
  if(!o||Object.getPrototypeOf(o)!==Object.prototype||
     Object.keys(o).length!==FIELDS.length||FIELDS.some(x=>!Object.hasOwn(o,x))||
     o.schema!=='mmf-private-synthetic-control-occupancy-v1'||
     !['ABSENT','EMPTY','OCCUPIED'].includes(o.state)||
     !Number.isSafeInteger(o.tenantCount)||o.tenantCount<0||
     !Number.isSafeInteger(o.usageCount)||o.usageCount<0||
     ((o.state==='ABSENT'||o.state==='EMPTY')&&(o.tenantCount!==0||o.usageCount!==0))||
     (o.state==='OCCUPIED'&&o.tenantCount===0))deny();
  if(o.state==='OCCUPIED')deny();
  return {gate:'MMF_PRIVATE_CONTROL_READONLY_EMPTY',safeToSeed:true};
 }catch{deny()}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 inspectRemoteMmfControl().then(o=>console.log(o.gate))
  .catch(()=>{console.error('MMF_PRIVATE_CONTROL_READONLY_NOT_QUALIFIED');process.exitCode=2});
}

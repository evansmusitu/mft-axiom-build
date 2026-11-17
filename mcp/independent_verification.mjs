// A bounded checker, independent of the Python/SymPy/SciPy execution path.
// All financial and LP comparisons use exact decimal-rational arithmetic.
export const CHECKER_VERSION='axiom-independent-v1';
export const CHECKER_SOURCE_SHA256='__CHECKER_SOURCE_SHA256__';
const ABS='0.0000001', REL='0.000000000001';
const FEAS_ABS='0.00000001', FEAS_REL='0.0000000001';
class Unsupported extends Error {}
class Invalid extends Error {}
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b];}return a;};
class Q {
 constructor(n,d=1n){if(d===0n)throw new Invalid('zero_denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);this.n=n/g;this.d=d/g;if(this.n.toString().length+this.d.toString().length>12000)throw new Unsupported('rational_resource_limit');}
 add(b){return new Q(this.n*b.d+b.n*this.d,this.d*b.d);}
 neg(){return new Q(-this.n,this.d);}
 sub(b){return this.add(b.neg());}
 mul(b){return new Q(this.n*b.n,this.d*b.d);}
 div(b){return new Q(this.n*b.d,this.d*b.n);}
 abs(){return this.n<0n?this.neg():this;}
 cmp(b){const n=this.n*b.d-b.n*this.d;return n<0n?-1:n>0n?1:0;}
 str(){return this.d===1n?String(this.n):`${this.n}/${this.d}`;}
 number(){const a=this.n<0n?-this.n:this.n,ns=String(a),ds=String(this.d);return (this.n<0n?-1:1)*(Number(ns.slice(0,16))/Number(ds.slice(0,16)))*10**((ns.length-Math.min(ns.length,16))-(ds.length-Math.min(ds.length,16)));}
}
const ZERO=new Q(0n),ONE=new Q(1n);
function decimal(x){
 if(typeof x==='number'){if(!Number.isFinite(x))throw new Invalid('nonfinite_number');x=String(x);}
 if(typeof x!=='string'||x.length>1024)throw new Unsupported('unsupported_numeric_representation');
 const m=x.trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
 if(!m)throw new Unsupported('non_real_or_symbolic_result');
 const exp=Number(m[4]||0)-(m[3]||'').length;if(!Number.isSafeInteger(exp)||Math.abs(exp)>1000)throw new Unsupported('numeric_resource_limit');
 const n=BigInt((m[1]==='-'?'-':'')+m[2]+(m[3]||''));
 return exp>=0?new Q(n*10n**BigInt(exp)):new Q(n,10n**BigInt(-exp));
}
function inputNumber(x){if(typeof x!=='number'||!Number.isFinite(x))throw new Invalid('invalid_numeric_input');if(Math.abs(x)>1e100)throw new Unsupported('numeric_magnitude_limit');return decimal(x);}
const dot=(a,b)=>a.reduce((s,v,i)=>s.add(v.mul(b[i])),ZERO);
function tolerance(a,b,abs=ABS,rel=REL){const scale=a.abs().cmp(b.abs())>=0?a.abs():b.abs();return decimal(abs).add(decimal(rel).mul(scale));}
function compare(a,b,abs=ABS,rel=REL){const residual=a.sub(b).abs(),limit=tolerance(a,b,abs,rel);return{pass:residual.cmp(limit)<=0,residual:residual.number(),limit:limit.number()};}
function pow(a,k){if(!Number.isSafeInteger(k)||Math.abs(k)>512)throw new Unsupported('power_limit');let out=ONE,b=a,e=Math.abs(k);while(e){if(e%2)out=out.mul(b);e=Math.floor(e/2);if(e)b=b.mul(b);}return k<0?ONE.div(out):out;}
function arithmetic(expression){
 if(typeof expression!=='string'||expression.length>4096)throw new Unsupported('expression_resource_limit');
 const tokens=[];let pos=0;
 while(pos<expression.length){if(/\s/.test(expression[pos])){pos++;continue;}const m=expression.slice(pos).match(/^(?:(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\*\*|[()+\-*/])/);if(!m)throw new Unsupported('expression_method_not_supported');tokens.push(m[0]);pos+=m[0].length;if(tokens.length>512)throw new Unsupported('expression_resource_limit');}
 let i=0,depth=0;
 const peek=()=>tokens[i];
 function atom(){if(++depth>48)throw new Unsupported('expression_depth_limit');let a;if(peek()==='('){i++;a=sum();if(peek()!==')')throw new Invalid('invalid_expression');i++;}else{const s=tokens[i++];if(!s||!/^\d|^\.\d/.test(s))throw new Invalid('invalid_expression');a=decimal(s.startsWith('.')?'0'+s:s);}depth--;return a;}
 function power(){let a=atom();if(peek()==='**'){i++;const k=unary();if(k.d!==1n||k.abs().cmp(new Q(512n))>0)throw new Unsupported('noninteger_or_large_power');a=pow(a,Number(k.n));}return a;}
 function unary(){if(peek()==='+'){i++;return unary();}if(peek()==='-'){i++;return unary().neg();}return power();}
 function product(){let a=unary();while(peek()==='*'||peek()==='/'){const op=tokens[i++],b=unary();a=op==='*'?a.mul(b):a.div(b);}return a;}
 function sum(){let a=product();while(peek()==='+'||peek()==='-'){const op=tokens[i++],b=product();a=op==='+'?a.add(b):a.sub(b);}return a;}
 const value=sum();if(i!==tokens.length)throw new Invalid('invalid_expression');return value;
}
function npv(a){
 if(!Array.isArray(a.cashflows)||!a.cashflows.length)throw new Invalid('malformed_cashflows');
 if(a.cashflows.length>128)throw new Unsupported('cashflow_resource_limit');
 const rate=inputNumber(a.rate),base=ONE.add(rate);if(!base.n)throw new Invalid('invalid_discount_rate');
 // Recurrence differs from the numerical kernel's per-period float powers.
 let factor=ONE,total=ZERO;
 for(const flow of a.cashflows){total=total.add(inputNumber(flow).mul(factor));factor=factor.div(base);}
 return total;
}
function solveColumns(columns,target){
 const rows=target.map((b,i)=>[...columns.map(c=>c[i]),b]),m=columns.length;let row=0;
 for(let col=0;col<m;col++){
  const pivot=rows.findIndex((r,i)=>i>=row&&r[col].n!==0n);if(pivot<0)return null;
  [rows[row],rows[pivot]]=[rows[pivot],rows[row]];const v=rows[row][col];rows[row]=rows[row].map(x=>x.div(v));
  for(let i=0;i<rows.length;i++)if(i!==row&&rows[i][col].n){const f=rows[i][col];rows[i]=rows[i].map((x,j)=>x.sub(f.mul(rows[row][j])));}
  row++;
 }
 if(rows.slice(row).some(r=>r[m].n))return null;return rows.slice(0,m).map(r=>r[m]);
}
function lp(a,r){
 if(!Array.isArray(a.c)||!a.c.length)throw new Invalid('malformed_objective');const n=a.c.length;
 if(n>8)throw new Unsupported('lp_dimension_limit');const c=a.c.map(inputNumber);
 if(!r||r.success!==true||r.status!==0)return{status:'unverified',method:'lp-rational-primal-dual',reason:'solver_not_successful',checks:{solver_success:false}};
 if(!Array.isArray(r.x)||r.x.length!==n)throw new Invalid('invalid_solution_shape');
 const x=r.x.map(inputNumber),f=inputNumber(r.fun),constraints=[];
 for(const [A,b,eq] of [['A_ub','b_ub',false],['A_eq','b_eq',true]]){
  if(own(a,A)!==own(a,b))throw new Invalid('incomplete_constraints');
  if(a[A]!==undefined){if(!Array.isArray(a[A])||!Array.isArray(a[b])||a[A].length!==a[b].length)throw new Invalid('invalid_constraint_shape');
   if(a[A].length>128)throw new Unsupported('lp_constraint_limit');
   a[A].forEach((row,i)=>{if(!Array.isArray(row)||row.length!==n)throw new Invalid('invalid_constraint_shape');const v=row.map(inputNumber),rhs=inputNumber(a[b][i]);constraints.push({row:v,rhs,label:`${A}[${i}]`});if(eq)constraints.push({row:v.map(q=>q.neg()),rhs:rhs.neg(),label:`-${A}[${i}]`});});}
 }
 const bounds=a.bounds==null?Array.from({length:n},()=>[0,null]):Array.isArray(a.bounds[0])?a.bounds:Array.from({length:n},()=>a.bounds);
 if(bounds.length!==n)throw new Invalid('invalid_bounds_shape');
 bounds.forEach((b,i)=>{if(!Array.isArray(b)||b.length!==2)throw new Invalid('invalid_bounds_shape');const lo=b[0]===null?null:inputNumber(b[0]),hi=b[1]===null?null:inputNumber(b[1]);if(lo&&hi&&lo.cmp(hi)>0)throw new Invalid('contradictory_bounds');for(const [v,lower] of [[lo,true],[hi,false]])if(v!==null){const row=Array.from({length:n},(_,j)=>new Q(j===i?(lower?-1n:1n):0n));constraints.push({row,rhs:lower?v.neg():v,label:`${lower?'lower':'upper'}[${i}]`});}});
 const active=[],primal=[];
 for(const row of constraints){const value=dot(row.row,x),delta=value.sub(row.rhs),tol=tolerance(value,row.rhs,FEAS_ABS,FEAS_REL);primal.push({constraint:row.label,residual:delta.number(),limit:tol.number()});if(delta.cmp(tol)>0)return{status:'failed',method:'lp-rational-primal-dual',reason:'constraint_or_bound_violation',checks:{solver_success:true,primal_feasible:false,violation:primal.at(-1)}};if(delta.abs().cmp(tol)<=0)active.push(row);}
 const objective=dot(c,x),objectiveCheck=compare(objective,f);
 if(!objectiveCheck.pass)return{status:'failed',method:'lp-rational-primal-dual',reason:'objective_mismatch',checks:{solver_success:true,primal_feasible:true,objective_consistency:objectiveCheck,recomputed_objective:objective.number()}};
 if(active.length>32)throw new Unsupported('lp_active_constraint_limit');
 let attempts=0,certificate=null;
 function search(start,chosen,k){
  if(++attempts>2048)throw new Unsupported('lp_certificate_search_limit');
  if(chosen.length===k){const rows=chosen.map(i=>active[i]),lambda=k?solveColumns(rows.map(q=>q.row),c.map(q=>q.neg())):[];if(!lambda||lambda.some(q=>q.n<0n)||(k===0&&c.some(q=>q.n)))return;
   const lower=dot(rows.map(q=>q.rhs),lambda).neg(),gap=compare(objective,lower);if(gap.pass)certificate={constraints:rows.map(q=>q.label),multipliers:lambda.map(q=>q.str()),dual_lower_bound:lower.number(),dual_lower_bound_exact:lower.str(),stationarity_exact:true,nonnegative_multipliers:true,duality_gap:gap};return;}
  for(let j=start;j<=active.length-(k-chosen.length)&&!certificate;j++)search(j+1,[...chosen,j],k);
 }
 for(let k=0;k<=Math.min(n,active.length)&&!certificate;k++)search(0,[],k);
 const checks={solver_success:true,primal_feasible:true,constraints:primal,objective_consistency:objectiveCheck,recomputed_objective:objective.number(),optimality_certificate:certificate};
 return{status:certificate?'verified':'unverified',method:'lp-rational-primal-dual',reason:certificate?'primal_feasibility_and_dual_bound_agree':'independent_optimality_certificate_unavailable',checks};
}
export function checkCalculation(operation,args,value){
 try{
  if(operation==='optimization.linear_program')return lp(args,value);
  if(!['arithmetic.evaluate','finance.npv'].includes(operation))return{status:'unverified',method:'unsupported',reason:'independent_method_unavailable'};
  const expected=operation==='finance.npv'?npv(args):arithmetic(args.expression),actual=decimal(value),comparison=compare(expected,actual);
  return{status:comparison.pass?'verified':'failed',method:operation==='finance.npv'?'npv-exact-decimal-discount-recurrence':'arithmetic-exact-rational-parser',reason:comparison.pass?'independent_comparison_passed':'numerical_mismatch',checks:{expected:expected.number(),expected_exact:expected.str(),comparison}};
 }catch(e){return{status:e instanceof Invalid?'failed':'unverified',method:'unavailable',reason:e instanceof Invalid||e instanceof Unsupported?e.message:'independent_checker_unavailable'};}
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=canonical(value[key]);return out;}if(typeof value==='number'&&!Number.isFinite(value))throw new Invalid('nonfinite_evidence');return value;}
async function digest(value){const b=new TextEncoder().encode(JSON.stringify(canonical(value))),h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const SUPPORTED=new Set(['arithmetic.evaluate','finance.npv','optimization.linear_program']);
export async function applyIndependentVerification(rpc,call){
 const sc=rpc?.result?.structuredContent,engine=sc?.result;if(!engine||typeof engine!=='object'||!own(engine,'result'))return rpc;
 let operation=TOOL_OPERATION(call),args=call?.arguments?.args,value=engine.result,wrapped=value;
 // Crosscheck is a wrapper; validate every response wrapper against the request.
 let mismatch=engine.operation!==operation||sc.operation!==operation;
 while(operation==='verify.crosscheck'&&args&&typeof args==='object'){
  operation=args.operation;args=args.args;wrapped=value;value=value?.result;
 }
 if(!SUPPORTED.has(operation))return rpc;
 let evidence;
 try{
  evidence=mismatch?{status:'failed',method:'response-binding',reason:'operation_mismatch'}:engine.ok!==true||rpc.result.isError?{status:'unverified',method:'unavailable',reason:'execution_not_successful'}:checkCalculation(operation,args,value);
  evidence={...evidence,operation,checker_version:CHECKER_VERSION,checker_source_sha256:CHECKER_SOURCE_SHA256,tolerances:{absolute:ABS,relative:REL,feasibility_absolute:FEAS_ABS,feasibility_relative:FEAS_REL},input_digest:await digest({operation,args}),output_digest:await digest(value??null)};
  evidence.evidence_digest=await digest(evidence);
 }catch{evidence={status:'unverified',method:'unavailable',reason:'independent_checker_unavailable',checker_version:CHECKER_VERSION,checker_source_sha256:CHECKER_SOURCE_SHA256};}
 // Never reuse a certificate or verification flag supplied by the upstream result.
 delete engine.certificate;engine.verification=evidence;engine.verified=evidence.status==='verified'?true:evidence.status==='failed'?false:null;
 if(wrapped&&typeof wrapped==='object'&&own(wrapped,'verification'))wrapped.verification=evidence;
 if(evidence.status==='failed'){engine.ok=false;engine.result=null;engine.error={code:'independent_verification_failed',message:'The independent numerical checks failed. This result must not be used as verified.'};rpc.result.isError=true;rpc.result.content=[{type:'text',text:engine.error.message}];}
 return rpc;
}
// Use the existing authoritative tool map supplied by the contract module.
let operationMap={};
export function configureVerificationOperations(map){operationMap=Object.freeze({...map});}
function TOOL_OPERATION(call){return call?.name==='musitu_axiom_execute'?call?.arguments?.operation:operationMap[call?.name];}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {checkCalculation,applyIndependentVerification,configureVerificationOperations} from '../independent_verification.mjs';
import {validateComputationCall} from '../plugin_contract_runtime.mjs';
globalThis.crypto??=webcrypto;
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/verification-live-before.json',import.meta.url))).cases;
const ggf=fixtures.find(x=>x.id==='ggf_lp'),a=ggf.args,r=ggf.response.structuredContent.result.result;
const call=(operation,args)=>({name:'musitu_axiom_execute',arguments:{operation,args}});
function envelope(operation,result,extra={}){return {result:{structuredContent:{operation,result:{ok:true,operation,result,verified:null,...extra}}}};}
for(const f of fixtures)test(`independently verifies real connected ${f.id}`,()=>{
 const c=checkCalculation(f.operation,f.args,f.response.structuredContent.result.result);assert.equal(c.status,'verified',JSON.stringify(c));
 if(f.id==='ggf_lp'){assert.equal(c.checks.optimality_certificate.stationarity_exact,true);assert.equal(c.checks.optimality_certificate.duality_gap.pass,true);}
});
test('arithmetic precedence, exact decimals, signed exponents and mathematical expressions',()=>{
 for(const [expression,value] of [['(12*8)-5','91'],['0.1+0.2','0.3'],['-2**2','-4'],['2**-2','0.25'],['2**3**2','512'],['(1+2)/3','1'],['.5*2e2','100']])assert.equal(checkCalculation('arithmetic.evaluate',{expression},value).status,'verified',expression);
});
test('wrong financial calculation and wrong arithmetic fail',()=>{
 assert.equal(checkCalculation('finance.npv',fixtures[0].args,0).status,'failed');
 assert.equal(checkCalculation('arithmetic.evaluate',{expression:'40+2'},'43').status,'failed');
});
test('objective corruption is rejected independently of solver success',()=>assert.equal(checkCalculation('optimization.linear_program',a,{...r,fun:0}).reason,'objective_mismatch'));
test('budget, equality and both bounds are independently enforced',()=>{
 for(const [args,result] of [[a,{...r,x:[1,1]}],[{c:[0],bounds:[[0,1]]},{success:true,status:0,x:[1.1],fun:0}],[{c:[0],bounds:[[0,1]]},{success:true,status:0,x:[-0.1],fun:0}],[{c:[0],A_eq:[[1]],b_eq:[1]},{success:true,status:0,x:[0],fun:0}]])assert.equal(checkCalculation('optimization.linear_program',args,result).reason,'constraint_or_bound_violation');
});
test('feasible suboptimal solution cannot acquire an optimality certificate',()=>{
 const result=checkCalculation('optimization.linear_program',a,{success:true,status:0,x:[0,0],fun:0});assert.equal(result.status,'unverified');assert.equal(result.checks.primal_feasible,true);assert.equal(result.checks.optimality_certificate,null);
});
test('infeasible and unbounded solver outputs remain unverified',()=>{
 for(const status of [2,3,4])assert.equal(checkCalculation('optimization.linear_program',{c:[-1]},{success:false,status,x:[],fun:null}).status,'unverified');
 assert.equal(checkCalculation('optimization.linear_program',{c:[-1]},{success:true,status:0,x:[0],fun:0}).status,'unverified');
});
test('dual proof covers equality, default/shared/free bounds and zero objective',()=>{
 const cases=[
  [{c:[1],A_eq:[[1]],b_eq:[2],bounds:[[null,null]]},{x:[2],fun:2}],
  [{c:[1]},{x:[0],fun:0}],
  [{c:[-1],bounds:[0,2]},{x:[2],fun:-2}],
  [{c:[0],bounds:[[null,null]]},{x:[-50],fun:0}],
  [{c:[1],bounds:[[-2,null]]},{x:[-2],fun:-2}],
 ];for(const [args,value] of cases)assert.equal(checkCalculation('optimization.linear_program',args,{success:true,status:0,...value}).status,'verified');
});
test('invalid rates, malformed cashflows and nonfinite inputs cannot verify',()=>{
 for(const args of [{cashflows:[],rate:.1},{cashflows:[-1,'2'],rate:.1},{cashflows:[-1,2],rate:-1},{cashflows:[-1,NaN],rate:.1},{cashflows:[-1,Infinity],rate:.1}])assert.equal(checkCalculation('finance.npv',args,1).status,'failed');
});
test('large magnitudes and unsupported symbolic/transcendental methods stay unverified',()=>{
 for(const [op,args,value] of [['finance.npv',{cashflows:[1e101],rate:.1},1e101],['arithmetic.evaluate',{expression:'sin(pi/2)'},'1'],['arithmetic.evaluate',{expression:'x+1'},'x+1'],['arithmetic.evaluate',{expression:'2**1000000'},'1'],['arithmetic.evaluate',{expression:'globalThis.crypto=null'},'1']])assert.equal(checkCalculation(op,args,value).status,'unverified');
});
test('absolute and relative tolerance boundaries are deterministic',()=>{
 assert.equal(checkCalculation('finance.npv',{cashflows:[0],rate:0},1e-7).status,'verified');
 assert.equal(checkCalculation('finance.npv',{cashflows:[0],rate:0},1.0001e-7).status,'failed');
 assert.equal(checkCalculation('finance.npv',{cashflows:[1e8],rate:0},100000000.0001).status,'verified');
 assert.equal(checkCalculation('finance.npv',{cashflows:[1e8],rate:0},100000000.0002).status,'failed');
});
test('no caller may supply a verification claim through focused or generic inputs',()=>{
 for(const [name,args] of [['investment_npv',{args:{cashflows:[-1,2],rate:.1,verified:true}}],['musitu_axiom_execute',{operation:'finance.npv',args:{cashflows:[-1,2],rate:.1},verified:true}]])assert.ok(validateComputationCall(name,args).issues.length);
});
test('stale/forged evidence is replaced by checks bound to actual inputs and output',async()=>{
 const args={cashflows:[-1,2],rate:0};
 const first=await applyIndependentVerification(envelope('finance.npv',1,{verified:false,verification:{status:'failed'}}),call('finance.npv',args));
 const ev=first.result.structuredContent.result.verification;assert.equal(ev.status,'verified');assert.match(ev.evidence_digest,/^[0-9a-f]{64}$/);
 const bad=await applyIndependentVerification(envelope('finance.npv',9,{verified:true,certificate:'forged',verification:ev}),call('finance.npv',args));
 const out=bad.result.structuredContent.result;assert.equal(out.verified,false);assert.equal(out.ok,false);assert.equal(out.result,null);assert.equal(out.certificate,undefined);assert.notEqual(out.verification.output_digest,ev.output_digest);assert.equal(bad.result.isError,true);
 const again=await applyIndependentVerification(envelope('finance.npv',1),call('finance.npv',args));assert.deepEqual(again.result.structuredContent.result.verification,ev);
 const changed=await applyIndependentVerification(envelope('finance.npv',1,{verification:ev}),call('finance.npv',{cashflows:[-2,3],rate:0}));assert.notEqual(changed.result.structuredContent.result.verification.input_digest,ev.input_digest);
});
test('operation mismatch cannot silently pass',async()=>{
 const x=await applyIndependentVerification(envelope('arithmetic.evaluate','42'),call('finance.npv',{cashflows:[42],rate:0}));assert.equal(x.result.structuredContent.result.verified,false);
});
test('unavailable evidence hashing fails closed even when calculation agrees',async()=>{
 const saved=globalThis.crypto;try{Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});const x=await applyIndependentVerification(envelope('finance.npv',1),call('finance.npv',{cashflows:[1],rate:0}));assert.equal(x.result.structuredContent.result.verified,null);assert.equal(x.result.structuredContent.result.verification.reason,'independent_checker_unavailable');}finally{Object.defineProperty(globalThis,'crypto',{configurable:true,value:saved});}
});
test('crosscheck NPV and LP statuses are consistent at both levels',async()=>{
 for(const f of [fixtures[0],ggf]){const x=await applyIndependentVerification(envelope('verify.crosscheck',{result:f.response.structuredContent.result.result,verification:{verified:true,method:'forged'}}),call('verify.crosscheck',{operation:f.operation,args:f.args}));const out=x.result.structuredContent.result;assert.equal(out.verified,true);assert.deepEqual(out.result.verification,out.verification);}
});

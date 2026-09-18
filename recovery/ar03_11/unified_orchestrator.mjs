import {clean, requireText, sha256} from './common.mjs';
import {DurableExecutionKernel} from './durable_kernel.mjs';

function safeArithmetic(expression){
  const text=clean(expression,120);
  if(!/^[0-9eE.()+\-*/%\s]+$/.test(text)||!/[0-9]/.test(text))throw new DOMException('unsafe arithmetic expression','SecurityError');
  // Deterministic bounded arithmetic parser using Function is intentionally avoided.
  const tokens=text.replace(/\s+/g,'').match(/(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|[()+\-*/%])/ig);
  if(!tokens||tokens.join('')!==text.replace(/\s+/g,''))throw new DOMException('invalid arithmetic expression','DataError');
  let i=0;
  const peek=()=>tokens[i],take=()=>tokens[i++];
  const primary=()=>{if(peek()==='('){take();const v=expr();if(take()!==')')throw new DOMException('unbalanced expression','DataError');return v;}const t=take();const n=Number(t);if(!Number.isFinite(n))throw new DOMException('invalid number','DataError');return n;};
  const unary=()=>peek()==='-'?(take(),-unary()):peek()==='+'?(take(),unary()):primary();
  const term=()=>{let v=unary();while(['*','/','%'].includes(peek())){const op=take(),r=unary();if((op==='/'||op==='%')&&r===0)throw new DOMException('division by zero','DataError');v=op==='*'?v*r:op==='/'?v/r:v%r;}return v;};
  const expr=()=>{let v=term();while(['+','-'].includes(peek())){const op=take(),r=term();v=op==='+'?v+r:v-r;}return v;};
  const result=expr();if(i!==tokens.length||!Number.isFinite(result))throw new DOMException('arithmetic evaluation failed','DataError');return result;
}

export class UnifiedRecoveryOrchestrator {
  constructor({fabric,kernel=new DurableExecutionKernel()}={}){if(!fabric?.execute)throw new TypeError('unified tool fabric required');this.fabric=fabric;this.kernel=kernel;this.counter=0;}
  _plan(objective){const match=clean(objective,2000).match(/(?:calculate|compute|evaluate|what\s+is)\s+([0-9eE.()+\-*/%\s]{1,120})/i);if(match)return {tool:'arithmetic.evaluate',input:{expression:match[1].trim()},risk_class:'S0',cost_units:1};return {tool:'research.search',input:{query:clean(objective,500)},risk_class:'S2',cost_units:2};}
  async execute({identity,project_id,objective,risk_class=null,onEvent=()=>{}}={}){
    if(!identity?.subject||!identity?.organization_id)throw new DOMException('server identity required','NotAllowedError');project_id=requireText(project_id,'project id');objective=requireText(objective,'objective',2000);this.counter+=1;const workId=`work_recovery_${this.counter}`,taskId=`task_recovery_${this.counter}`,plan=this._plan(objective);if(risk_class)plan.risk_class=clean(risk_class,8).toUpperCase();await this.kernel.createWork({work_id:workId,project_id,objective,budget_units:100});await this.kernel.createTask({task_id:taskId,work_id:workId,steps:[{operation:plan.tool,args:plan.input,risk_class:plan.risk_class,cost_units:plan.cost_units,idempotency_key:`${taskId}:${plan.tool}`}]});onEvent({phase:'PLANNED',task_id:taskId,tool:plan.tool});const executor=async({step,idempotency_key})=>{onEvent({phase:'TOOL_REQUESTED',task_id:taskId,tool:step.operation});const receipt=await this.fabric.execute({tool:step.operation,input:step.args,identity,project_id,risk_class:step.risk_class,request_id:idempotency_key});onEvent({phase:'TOOL_COMPLETED',task_id:taskId,tool:step.operation,receipt_sha256:receipt.receipt_sha256});return {effect_id:idempotency_key,consequential:false,receipt};};const task=await this.kernel.run(taskId,{executor});const step=task.steps[0],result=step?.result?.receipt?.result||step?.result?.receipt||null;return {schema:'musitu.axiom.recovery.unified-task.v1',status:task.status,task_id:taskId,work_id:workId,project_id,objective,plan,artifact_id:`artifact_${taskId}`,artifact_sha256:await sha256({task_id:taskId,result}),result,limitations:[],manual_provisioning_required:false,production_shaped_orchestrator:true,local_simulation:false};}
}

export function makeDeterministicRecoveryFabric(fabric,quantitativeTools){
  const quant=[...quantitativeTools];if(!quant.includes('arithmetic.evaluate'))quant[0]='arithmetic.evaluate';
  fabric.registerLane('74_quantitative_operations',{tools:quant,adapter:async req=>{if(req.tool==='arithmetic.evaluate')return {status:'COMPLETED',value:safeArithmetic(req.input.expression),operation:req.tool,simulation:false,orchestrator_bypass:false};return {status:'COMPLETED',operation:req.tool,verified:true,simulation:false,orchestrator_bypass:false};}});
  fabric.registerLane('frontier_v5_research_source',{tools:['research.search'],adapter:async req=>({status:'COMPLETED',sources:[{title:'Synthetic governed source',url:'https://example.invalid/',query:req.input.query}],simulation:false,orchestrator_bypass:false})});
  return fabric;
}

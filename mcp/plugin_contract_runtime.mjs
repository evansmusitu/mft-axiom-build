// Public schemas and pre-metering validation. Bundled into the gateway at build time.
import OPERATION_CONTRACTS from './operation_contracts.json' with {type:'json'};
import TOOL_OPERATION_MAP from './operation_tool_map.json' with {type:'json'};
const TOOL_OPERATIONS={...TOOL_OPERATION_MAP};
TOOL_OPERATIONS.ewma_forecast='timeseries.ewma';
const OPERATION_NAMES=Object.keys(OPERATION_CONTRACTS);
const copy=x=>JSON.parse(JSON.stringify(x));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const operationRef=op=>({$ref:`#/$defs/${op}`});
function operationSelector(){return {type:'object',properties:{operation:{type:'string',enum:OPERATION_NAMES,description:'Exact runtime operation identifier.'},args:{type:'object',description:'Inputs for the selected operation; see its operation-specific branch.'}},required:['operation','args'],additionalProperties:false,oneOf:OPERATION_NAMES.map(op=>({properties:{operation:{const:op},args:operationRef(op)}}))};}
function definitions(){const defs=copy(OPERATION_CONTRACTS);defs['verify.crosscheck']=operationSelector();return defs;}
export function computationInputSchema(name,operation){
 if(name==='musitu_axiom_execute')return {...operationSelector(),$defs:definitions()};
 const op=operation||TOOL_OPERATIONS[name];if(!own(OPERATION_CONTRACTS,op))throw new Error('missing_operation_contract');
 const inner=op==='verify.crosscheck'?operationSelector():copy(OPERATION_CONTRACTS[op]);
 const schema={type:'object',properties:{args:inner},required:['args'],additionalProperties:false};
 if(op==='verify.crosscheck')schema.$defs=definitions();return schema;
}
function isType(v,t){return t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='array'?Array.isArray(v):t==='integer'?typeof v==='number'&&Number.isInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):t==='null'?v===null:typeof v===t;}
function validateNode(v,s,path,issues){
 const fail=message=>issues.push({path,message});
 if(s.anyOf){if(!s.anyOf.some(branch=>{const e=[];validateNode(v,branch,path,e);return !e.length;}))fail('Must match an allowed input type or shape. '+(s.description||''));return;}
 if(s.type&&!isType(v,s.type)){fail(`Expected ${s.type}. ${s.description||''}`.trim());return;}
 if(s.enum&&!s.enum.some(x=>Object.is(x,v)))fail(`Use one of: ${s.enum.join(', ')}.`);
 if(own(s,'const')&&!Object.is(s.const,v))fail(`Must equal ${s.const}.`);
 if(s.not&&own(s.not,'const')&&Object.is(s.not.const,v))fail(`Cannot equal ${s.not.const}.`);
 if(typeof v==='number')for(const [key,passes] of [['minimum',v>=s.minimum],['maximum',v<=s.maximum],['exclusiveMinimum',v>s.exclusiveMinimum],['exclusiveMaximum',v<s.exclusiveMaximum]])if(own(s,key)&&!passes)fail(`Must satisfy ${key} ${s[key]}.`);
 if(typeof v==='string'&&s.minLength!==undefined&&v.length<s.minLength)fail('A nonempty string is required.');
 if(typeof v==='string'&&s.pattern&&!new RegExp(s.pattern).test(v))fail(`Invalid value. ${s.description||'Check the required format.'}`);
 if(Array.isArray(v)){
  if(s.minItems!==undefined&&v.length<s.minItems)fail(`Provide at least ${s.minItems} entries.`);
  if(s.maxItems!==undefined&&v.length>s.maxItems)fail(`Provide at most ${s.maxItems} entries.`);
  if(s.uniqueItems&&new Set(v.map(x=>JSON.stringify(x))).size!==v.length)fail('Entries must be unique.');
  if(s.items)v.forEach((x,i)=>validateNode(x,s.items,`${path}[${i}]`,issues));
 }
 if(v&&typeof v==='object'&&!Array.isArray(v)&&s.properties){
  for(const key of s.required||[])if(!own(v,key))issues.push({path:`${path}.${key}`,message:`Required. ${s.properties[key]?.description||''}`.trim()});
  for(const [key,value] of Object.entries(v)){if(own(s.properties,key))validateNode(value,s.properties[key],`${path}.${key}`,issues);else if(s.additionalProperties===false)issues.push({path:`${path}.${key}`,message:`Unknown field. Supported fields: ${Object.keys(s.properties).join(', ')}.`});}
 }
}
function semanticIssues(op,a,path,issues){
 const fail=(key,message)=>issues.push({path:`${path}.${key}`,message});
 const pair=(x,y)=>{if(a[x].length!==a[y].length)fail(y,`Must have the same number of entries as ${x}.`);};
 if(['statistics.correlation','statistics.covariance','statistics.regression','numeric.interpolate'].includes(op))pair('x','y');
 if(op==='numeric.interpolate'&&a.x.some((x,i)=>i&&x<=a.x[i-1]))fail('x','Sample coordinates must be strictly increasing.');
 if(op==='geometry.distance')pair('p','q');
 if(op==='finance.beta')pair('asset_returns','market_returns');
 if(op==='finance.beta'&&a.market_returns.every(x=>x===a.market_returns[0]))fail('market_returns','Benchmark variance must be nonzero.');
 if(['statistics.correlation','statistics.regression'].includes(op)&&a.x.every(x=>x===a.x[0]))fail('x','Sample variance must be nonzero.');
 if(op==='statistics.correlation'&&a.y.every(x=>x===a.y[0]))fail('y','Sample variance must be nonzero.');
 if(op==='statistics.ttest_ind'){
  if(a.equal_var===true){if(a.x.length+a.y.length<3)fail('y','The pooled test requires at least 3 combined observations.');}
  else if(a.x.length<2||a.y.length<2)fail('equal_var','Welch testing requires at least 2 observations per sample. A pooled test may use one singleton sample when equal_var is true.');
 }
 if(op==='statistics.zscore'){
  if((a.ddof??0)>=a.data.length)fail('ddof','Must be less than the data length.');
  if(a.data.every(x=>x===a.data[0]))fail('data','A constant sample has zero standard deviation; z-scores are undefined.');
 }
 if(op==='timeseries.moving_average'&&a.window>a.data.length)fail('window','Cannot exceed the data length.');
 if(op==='timeseries.rolling_volatility'&&a.window>a.returns.length)fail('window','Cannot exceed the returns length.');
 if(op==='verified.interval_eval'&&a.interval[0]>a.interval[1])fail('interval','Lower bound must not exceed upper bound.');
 if(op==='numeric.optimize_scalar'&&a.a>a.b)fail('b','Upper bound must be at least a.');
 for(const key of ['A','b','Q','returns','A_ub','A_eq'])if(Array.isArray(a[key])&&Array.isArray(a[key][0])){
  const rows=a[key],n=rows[0].length;if(rows.some(row=>row.length!==n))fail(key,'Matrix rows must have equal lengths.');
  if((key==='A'&&op.startsWith('linear.'))||key==='Q')if(rows.length!==n)fail(key,'A square matrix is required.');
 }
 if(a.A&&a.b&&a.A.length!==a.b.length)fail('b','Provide one right-hand-side entry per row of A.');
 if(op==='optimization.quadratic'){
  const n=a.c.length;if(a.Q.length!==n||a.Q.some(row=>row.length!==n))fail('Q','Dimensions must match the length of c.');
  else if(a.Q.some((row,i)=>row.some((v,j)=>Math.abs(v-a.Q[j][i])>1e-10)))fail('Q','A symmetric quadratic matrix is required.');
  if(a.x0&&a.x0.length!==n)fail('x0','Length must match c.');
 }
 if(op==='optimization.linear_program'){
  for(const [A,b] of [['A_ub','b_ub'],['A_eq','b_eq']]){
   if(own(a,A)!==own(a,b))fail(own(a,A)?b:A,`Supply ${A} and ${b} together.`);
   if(a[A]&&a[A].some(row=>row.length!==a.c.length))fail(A,'Each row must have one coefficient per entry of c.');
   if(a[A]&&a[b]&&a[A].length!==a[b].length)fail(b,`Provide one entry per row of ${A}.`);
  }
  if(a.bounds){const pairs=Array.isArray(a.bounds[0])?a.bounds:[a.bounds];if(pairs!==undefined&&Array.isArray(a.bounds[0])&&a.bounds.length!==a.c.length)fail('bounds','Provide one bound pair per variable.');for(const [lo,hi] of pairs)if(lo!==null&&hi!==null&&lo>hi)fail('bounds','Lower bounds cannot exceed upper bounds.');}
 }
 if(op==='finance.portfolio_metrics'){
  if(a.returns.some(row=>row.length!==a.weights.length))fail('weights','Length must match the number of asset columns in returns.');
  if(Math.abs(a.weights.reduce((s,x)=>s+x,0)-1)>1e-8)fail('weights','Weights must sum to 1 within 1e-8.');
 }
 if(op==='finance.implied_vol'){
  const spot=a.S*Math.exp(-(a.q??0)*a.T),strike=a.K*Math.exp(-a.r*a.T),put=a.kind==='put';
  const lower=Math.max(0,put?strike-spot:spot-strike),upper=put?strike:spot;
  if(a.price<lower-1e-10||a.price>=upper)fail('price',`Option price must be at least its discounted intrinsic value (${lower}) and below its model upper bound (${upper}).`);
 }
 if(['finance.bond_price','finance.duration'].includes(op)&&a.yield<=-(a.frequency??2))fail('yield','Must be greater than -frequency.');
 if(op==='units.convert'){
  const groups=[['m','km','cm','mm'],['kg','g'],['s','min','h'],['Pa','kPa','MPa'],['C','F','K']];if(!groups.some(g=>g.includes(a.from)&&g.includes(a.to)))fail('to','Source and target units must have the same physical dimension.');
 }
 if(op==='transforms.ifft'&&a.data.length===1&&(a.n===undefined||a.n===null))fail('n','Specify a positive output length when supplying only one frequency bin.');
 if(op==='transforms.ifft')a.data.forEach((v,i)=>{if(typeof v==='string'){const values=v.replaceAll('_','').match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g)||[];if(values.some(x=>!Number.isFinite(Number(x))))fail(`data[${i}]`,'Complex real and imaginary parts must be finite.');}});
}
function validateOperation(op,args,path,issues,depth=0){
 if(!own(OPERATION_CONTRACTS,op)){issues.push({path:path.replace(/\.args$/,'')+'.operation',message:'Select a supported operation from the tool schema.'});return;}
 if(depth>8){issues.push({path,message:'Verification nesting exceeds 8 levels; split this into separate calculations.'});return;}
 const start=issues.length;validateNode(args,OPERATION_CONTRACTS[op],path,issues);if(issues.length!==start)return;
 if(op==='verify.crosscheck')validateOperation(args.operation,args.args,`${path}.args`,issues,depth+1);else semanticIssues(op,args,path,issues);
}
export function validateComputationCall(name,argumentsValue){
 const op=TOOL_OPERATIONS[name],issues=[];
 if(!op&&name!=='musitu_axiom_execute')return {operation:null,issues:[{path:'name',message:'Unknown computation tool. Use search to select an available capability.'}]};
 const generic=name==='musitu_axiom_execute';
 validateNode(argumentsValue,{type:'object',properties:{...(generic?{operation:{type:'string',minLength:1}}:{}),args:{type:'object'}},required:generic?['operation','args']:['args'],additionalProperties:false},'arguments',issues);
 if(!issues.length)validateOperation(generic?argumentsValue.operation:op,argumentsValue.args,'args',issues);
 return {operation:generic?argumentsValue?.operation:op,issues:issues.slice(0,20)};
}
export function invalidArgumentsResult(id,validation){
 const {operation,issues}=validation;return {jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:`Invalid calculation inputs: ${issues.map(x=>`${x.path}: ${x.message}`).join(' ')}`}],structuredContent:{operation:operation||null,error:{code:'invalid_arguments',message:'Correct the indicated fields and retry.',issues},...(own(OPERATION_CONTRACTS,operation)?{example:{args:copy(OPERATION_CONTRACTS[operation].examples[0])}}:{})}}};
}
const ENVELOPE_METADATA=new Set(['axiom','elapsed_ms','latency_ms','kernel_version','fabric_version','compute_units','plan','usage','request_id','request_sha256','result_sha256','receipt','signature','trace_id']);
const EXTENDED_REAL_OPERATIONS=new Set(['calculus.limit','calculus.integrate','calculus.sum','calculus.product','probability.normal_ppf']);
function nonfiniteKind(x){
 if(typeof x==='number'&&!Number.isFinite(x))return Number.isNaN(x)?'undefined':'infinite';
 if(typeof x==='string'){if(/(^|[^A-Za-z0-9_])(zoo|nan)(?=$|[^A-Za-z0-9_])/u.test(x))return 'undefined';if(/^[+-]?oo$/u.test(x.trim()))return 'infinite';}
 if(Array.isArray(x)){const kinds=x.map(nonfiniteKind);return kinds.includes('undefined')?'undefined':kinds.find(Boolean);}
 if(x&&typeof x==='object'){const kinds=Object.entries(x).filter(([key])=>!['message','note','engine','method','explanation'].includes(key)).map(([,v])=>nonfiniteKind(v));return kinds.includes('undefined')?'undefined':kinds.find(Boolean);}
 return null;
}
export function minimizeCalculationResult(rpc,call){
 const sc=rpc?.result?.structuredContent,engine=sc?.result;
 if(rpc?.result?.isError&&sc?.http_status===422){
  const message='The calculation could not be evaluated for these inputs. Check expression syntax, matrix rank, and the operation domain in the tool schema.';
  sc.error={code:'calculation_domain_error',message};rpc.result.content=[{type:'text',text:message}];
 }
 if(!engine||typeof engine!=='object'||Array.isArray(engine)||!own(engine,'ok')||!own(engine,'result'))return rpc;
 const operation=sc.operation||engine.operation;
 let effectiveOperation=operation,inputArgs=call?.arguments?.args;
 while(effectiveOperation==='verify.crosscheck'&&inputArgs&&typeof inputArgs==='object'){
  effectiveOperation=inputArgs.operation;inputArgs=inputArgs.args;
 }
 for(const key of ENVELOPE_METADATA)delete engine[key];
 for(const key of ENVELOPE_METADATA)delete sc[key];
 const kind=nonfiniteKind(engine.result);
 if(kind==='infinite'&&EXTENDED_REAL_OPERATIONS.has(effectiveOperation)){
  engine.result_kind='extended_real';engine.explanation='The mathematical result is an extended-real infinity, not a finite number.';
 }else if(kind){
  const message=kind==='undefined'?'The calculation is undefined. Division by zero or an indeterminate expression can produce this result; check the expression and its domain.':'The calculation did not produce a finite result. Check the inputs for singularities, division by zero, or numerical overflow.';
  engine.ok=false;engine.result=null;engine.verified=null;engine.error={code:kind==='undefined'?'undefined_result':'non_finite_result',message};
  rpc.result.isError=true;rpc.result.content=[{type:'text',text:message}];
 }
 return rpc;
}

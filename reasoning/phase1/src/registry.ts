import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "./canonical.ts";
import type { JsonValue, TypeRef, TypedValue } from "./types.ts";

const REGISTRY_MODULE_HASH=sha256Hex(readFileSync(fileURLToPath(import.meta.url),"utf8"));

export interface OperationContext { inputs: Record<string, TypedValue>; params: Record<string, JsonValue>; }
export interface OperationDefinition {
  id: string;
  version: string;
  implementationHash: string;
  inferOutput(inputs: Record<string, TypeRef>, params: Record<string, JsonValue>): TypeRef;
  execute(ctx: OperationContext): TypedValue;
}

export class OperationContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

function implHash(id: string, version: string, algorithm: string, inferOutput: OperationDefinition["inferOutput"], execute: OperationDefinition["execute"]): string {
  return sha256Hex(`${id}@${version}\n${algorithm}\n${inferOutput.toString()}\n${execute.toString()}`);
}
function typeKey(t: TypeRef): string {
  if(t.kind==="record"){
    const fields=Object.fromEntries(Object.entries(t.fields).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,typeKey(v)]));
    return JSON.stringify({kind:t.kind,fields});
  }
  if(t.kind==="series")return JSON.stringify({kind:t.kind,element:typeKey(t.element)});
  return JSON.stringify(t);
}
function requireNumber(t: TypeRef, label: string): asserts t is {kind:"number";unit:string} {
  if (t.kind !== "number") throw new OperationContractError("TYPE_MISMATCH", `${label} must be a number`);
}
function requireBoolean(t: TypeRef, label: string): void {
  if (t.kind !== "boolean") throw new OperationContractError("TYPE_MISMATCH", `${label} must be boolean`);
}
function requireDecimal(t: TypeRef, label: string): asserts t is {kind:"decimal";unit:string;scale:number} {
  if (t.kind !== "decimal") throw new OperationContractError("TYPE_MISMATCH", `${label} must be a fixed decimal`);
  if (!Number.isInteger(t.scale) || t.scale < 0 || t.scale > 18) throw new OperationContractError("INVALID_SCALE", `${label} decimal scale must be an integer from 0 to 18`);
}
function pow10(scale:number): bigint { return 10n ** BigInt(scale); }
function parseDecimal(tv: TypedValue): {int:bigint;scale:number;unit:string} {
  if(tv.type.kind!=="decimal" || typeof tv.value!=="string") throw new Error("Runtime value does not match decimal type");
  const scale=tv.type.scale, match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(tv.value);
  if(!match) throw new Error(`Invalid decimal value: ${tv.value}`);
  const frac=match[3]??""; if(frac.length>scale) throw new Error(`Decimal value exceeds declared scale ${scale}`);
  const digits=match[2]+frac.padEnd(scale,"0");
  const int=BigInt(digits||"0")*(match[1]==="-"?-1n:1n);
  return {int,scale,unit:tv.type.unit};
}
function formatDecimal(int:bigint,scale:number): string {
  const neg=int<0n, abs=neg?-int:int, raw=abs.toString().padStart(scale+1,"0");
  const text=scale===0?raw:`${raw.slice(0,-scale)}.${raw.slice(-scale)}`;
  return `${neg?"-":""}${text}`;
}
function divRoundHalfEven(num:bigint,den:bigint): bigint {
  if(den===0n) throw new Error("division by zero");
  const q=num/den, r=num%den, absR=r<0n?-r:r, absD=den<0n?-den:den;
  const twice=absR*2n; if(twice<absD)return q;
  const step=(num<0n)!==(den<0n)?-1n:1n;
  if(twice>absD)return q+step;
  return (q<0n?-q:q)%2n===0n?q:q+step;
}
function decimalCompare(a:TypedValue,b:TypedValue): number {
  const da=parseDecimal(a), db=parseDecimal(b), scale=Math.max(da.scale,db.scale);
  const ai=da.int*pow10(scale-da.scale), bi=db.int*pow10(scale-db.scale);
  return ai<bi?-1:ai>bi?1:0;
}
function decimalOutput(unit:string,scale:number,int:bigint):TypedValue { return {type:{kind:"decimal",unit,scale},value:formatDecimal(int,scale)}; }
function requireNumberSeries(t: TypeRef, label: string): {kind:"number";unit:string} {
  if (t.kind !== "series" || t.element.kind !== "number") throw new OperationContractError("TYPE_MISMATCH", `${label} must be a numeric series`);
  return t.element;
}
function sameType(a: TypeRef, b: TypeRef, message: string): void {
  if (typeKey(a) !== typeKey(b)) {
    const code = (a.kind === "number" || a.kind==="decimal") && (b.kind === "number" || b.kind==="decimal") && "unit" in a && "unit" in b && a.unit !== b.unit ? "UNIT_MISMATCH" : "TYPE_MISMATCH";
    throw new OperationContractError(code, message);
  }
}
function values(tv: TypedValue): number[] {
  if (!Array.isArray(tv.value) || tv.value.some(x => typeof x !== "number" || !Number.isFinite(x))) throw new Error("Runtime value does not match numeric series type");
  return tv.value as number[];
}
function numberValue(tv: TypedValue): number {
  if (typeof tv.value !== "number" || !Number.isFinite(tv.value)) throw new Error("Runtime value does not match numeric type");
  return tv.value;
}
function boolValue(tv: TypedValue): boolean {
  if (typeof tv.value !== "boolean") throw new Error("Runtime value does not match boolean type");
  return tv.value;
}
function mean(xs: number[]): number { if (!xs.length) throw new Error("Series must not be empty"); return xs.reduce((a,b)=>a+b,0)/xs.length; }
function sampleStd(xs: number[]): number {
  if (xs.length < 2) throw new Error("At least two observations are required");
  const m=mean(xs); return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1));
}
function numericSeriesOutput(unit: string, vals: number[]): TypedValue { return {type:{kind:"series",element:{kind:"number",unit}},value:vals}; }
function numericOutput(unit: string, value: number): TypedValue { return {type:{kind:"number",unit},value}; }
function booleanOutput(value: boolean): TypedValue { return {type:{kind:"boolean"},value}; }

export class OperationRegistry {
  private readonly operations = new Map<string, OperationDefinition>();
  register(def: OperationDefinition): void {
    if (this.operations.has(def.id)) throw new Error(`Operation already registered: ${def.id}`);
    this.operations.set(def.id, def);
  }
  get(id: string): OperationDefinition {
    const found=this.operations.get(id); if(!found) throw new OperationContractError("UNKNOWN_OPERATION",`Unknown operation: ${id}`); return found;
  }
  manifest(): {id:string;version:string;implementationHash:string;moduleHash:string}[] {
    return [...this.operations.values()].map(({id,version,implementationHash})=>({id,version,implementationHash,moduleHash:REGISTRY_MODULE_HASH})).sort((a,b)=>a.id.localeCompare(b.id));
  }
}

function op(id:string, algorithm:string, inferOutput:OperationDefinition["inferOutput"], execute:OperationDefinition["execute"]):OperationDefinition {
  const version="1.0.0"; return {id,version,implementationHash:implHash(id,version,algorithm,inferOutput,execute),inferOutput,execute};
}

export function createDefaultRegistry(): OperationRegistry {
  const r=new OperationRegistry();

  r.register(op("timeseries.returns","simple-return-v1",inputs=>{
    requireNumberSeries(inputs.series,"series"); return {kind:"series",element:{kind:"number",unit:"ratio"}};
  },({inputs})=>{
    const xs=values(inputs.series); if(xs.length<2) throw new Error("At least two prices are required");
    if(xs.slice(0,-1).some(x=>x===0))throw new Error("returns cannot divide by zero");
    return numericSeriesOutput("ratio",xs.slice(1).map((x,i)=>x/xs[i]-1));
  }));

  r.register(op("statistics.mean","arithmetic-mean-v1",inputs=>{
    const e=requireNumberSeries(inputs.series,"series"); return {kind:"number",unit:e.unit};
  },({inputs})=>{ const e=(inputs.series.type as any).element; return numericOutput(e.unit,mean(values(inputs.series))); }));

  r.register(op("statistics.stddev","sample-standard-deviation-v1",inputs=>{
    const e=requireNumberSeries(inputs.series,"series"); return {kind:"number",unit:e.unit};
  },({inputs})=>{ const e=(inputs.series.type as any).element; return numericOutput(e.unit,sampleStd(values(inputs.series))); }));

  r.register(op("timeseries.moving_average","trailing-simple-moving-average-v1",(inputs,params)=>{
    requireNumberSeries(inputs.series,"series"); const w=params.window;
    if(typeof w!=="number"||!Number.isInteger(w)||w<1) throw new OperationContractError("INVALID_PARAMETER","window must be a positive integer");
    return inputs.series;
  },({inputs,params})=>{
    const xs=values(inputs.series), w=params.window as number; if(xs.length<w) throw new Error("window exceeds series length");
    const out:number[]=[]; for(let i=w-1;i<xs.length;i++) out.push(mean(xs.slice(i-w+1,i+1)));
    const unit=((inputs.series.type as any).element as any).unit; return numericSeriesOutput(unit,out);
  }));

  r.register(op("statistics.regression_index","ols-index-regression-v1",inputs=>{
    const e=requireNumberSeries(inputs.series,"series");
    return {kind:"record",fields:{slope:{kind:"number",unit:`${e.unit}/period`},r:{kind:"number",unit:"ratio"}}};
  },({inputs})=>{
    const ys=values(inputs.series), n=ys.length; if(n<2) throw new Error("At least two observations are required");
    const xm=(n+1)/2, ym=mean(ys); let cov=0,vx=0,vy=0;
    for(let i=0;i<n;i++){const x=i+1;cov+=(x-xm)*(ys[i]-ym);vx+=(x-xm)**2;vy+=(ys[i]-ym)**2;}
    const slope=cov/vx, corr=vy===0?0:cov/Math.sqrt(vx*vy), unit=((inputs.series.type as any).element as any).unit;
    return {type:{kind:"record",fields:{slope:{kind:"number",unit:`${unit}/period`},r:{kind:"number",unit:"ratio"}}},value:{slope,r:corr}};
  }));

  r.register(op("statistics.zscore_last","population-zscore-last-v1",inputs=>{
    requireNumberSeries(inputs.series,"series"); return {kind:"number",unit:"ratio"};
  },({inputs})=>{
    const xs=values(inputs.series), m=mean(xs); const sd=Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/xs.length);
    return numericOutput("ratio",sd===0?0:(xs[xs.length-1]-m)/sd);
  }));

  r.register(op("finance.drawdown","peak-to-trough-v1",inputs=>{
    requireNumberSeries(inputs.series,"series"); return {kind:"record",fields:{current:{kind:"number",unit:"ratio"},max:{kind:"number",unit:"ratio"}}};
  },({inputs})=>{
    const xs=values(inputs.series); if(!xs.length)throw new Error("Series must not be empty");
    let peak=-Infinity,current=0,max=0;
    for(const x of xs){if(x>peak)peak=x;current=x/peak-1;if(current<max)max=current;}
    return {type:{kind:"record",fields:{current:{kind:"number",unit:"ratio"},max:{kind:"number",unit:"ratio"}}},value:{current,max}};
  }));

  r.register(op("timeseries.rolling_volatility","sample-volatility-annualized-v1",(inputs,params)=>{
    const e=requireNumberSeries(inputs.returns,"returns"); if(e.unit!=="ratio") throw new OperationContractError("UNIT_MISMATCH","returns must use ratio units");
    const w=params.window, a=params.annualization;
    if(typeof w!=="number"||!Number.isInteger(w)||w<2) throw new OperationContractError("INVALID_PARAMETER","window must be an integer >= 2");
    if(typeof a!=="number"||!Number.isFinite(a)||a<=0) throw new OperationContractError("INVALID_PARAMETER","annualization must be a positive finite number");
    return {kind:"number",unit:"ratio"};
  },({inputs,params})=>{
    const xs=values(inputs.returns), w=params.window as number, a=params.annualization as number; if(xs.length<w) throw new Error("window exceeds return series length");
    return numericOutput("ratio",sampleStd(xs.slice(-w))*Math.sqrt(a));
  }));

  r.register(op("finance.position_size","fixed-decimal-risk-budget-units-v1",inputs=>{
    requireDecimal(inputs.equity,"equity"); requireDecimal(inputs.risk_fraction,"risk_fraction"); requireDecimal(inputs.loss_per_unit,"loss_per_unit");
    if(inputs.risk_fraction.unit!=="ratio") throw new OperationContractError("UNIT_MISMATCH","risk_fraction must use ratio units");
    if(inputs.equity.unit!==inputs.loss_per_unit.unit) throw new OperationContractError("UNIT_MISMATCH","equity and loss_per_unit must use the same currency unit");
    return {kind:"decimal",unit:"units",scale:8};
  },({inputs})=>{
    const equity=parseDecimal(inputs.equity), risk=parseDecimal(inputs.risk_fraction), loss=parseDecimal(inputs.loss_per_unit);
    if(loss.int<=0n) throw new Error("loss_per_unit must be positive");
    const outScale=8;
    const numerator=equity.int*risk.int*pow10(loss.scale+outScale);
    const denominator=loss.int*pow10(equity.scale+risk.scale);
    return decimalOutput("units",outScale,divRoundHalfEven(numerator,denominator));
  }));

  r.register(op("optimization.min","bounded-min-v1",inputs=>{
    sameType(inputs.value,inputs.cap,"value and cap must have identical types and units");
    if(inputs.value.kind!=="number"&&inputs.value.kind!=="decimal") throw new OperationContractError("TYPE_MISMATCH","value and cap must be numeric or fixed decimal");
    return inputs.value;
  },({inputs})=>{
    if(inputs.value.type.kind==="decimal"){
      const chosen=decimalCompare(inputs.value,inputs.cap)<=0?inputs.value:inputs.cap; const d=parseDecimal(chosen); return decimalOutput(d.unit,d.scale,d.int);
    }
    return numericOutput((inputs.value.type as any).unit,Math.min(numberValue(inputs.value),numberValue(inputs.cap)));
  }));

  r.register(op("optimization.clamp","bounded-clamp-v1",inputs=>{
    sameType(inputs.value,inputs.min,"value and min must have identical types and units"); sameType(inputs.value,inputs.max,"value and max must have identical types and units");
    if(inputs.value.kind!=="number"&&inputs.value.kind!=="decimal") throw new OperationContractError("TYPE_MISMATCH","clamp operands must be numeric or fixed decimal"); return inputs.value;
  },({inputs})=>{
    if(inputs.value.type.kind==="decimal"){
      let chosen=inputs.value; if(decimalCompare(chosen,inputs.min)<0)chosen=inputs.min; if(decimalCompare(chosen,inputs.max)>0)chosen=inputs.max; const d=parseDecimal(chosen); return decimalOutput(d.unit,d.scale,d.int);
    }
    return numericOutput((inputs.value.type as any).unit,Math.max(numberValue(inputs.min),Math.min(numberValue(inputs.value),numberValue(inputs.max))));
  }));

  for(const [id,fn] of [["arithmetic.add",(a:number,b:number)=>a+b],["arithmetic.subtract",(a:number,b:number)=>a-b]] as const){
    r.register(op(id,`${id}-v1`,inputs=>{requireNumber(inputs.left,"left");requireNumber(inputs.right,"right");sameType(inputs.left,inputs.right,"numeric operands must have identical units");return inputs.left;},({inputs})=>numericOutput((inputs.left.type as any).unit,fn(numberValue(inputs.left),numberValue(inputs.right)))));
  }

  r.register(op("arithmetic.multiply","numeric-multiply-v1",inputs=>{
    requireNumber(inputs.left,"left"); requireNumber(inputs.right,"right");
    const unit=inputs.left.unit==="ratio"?inputs.right.unit:inputs.right.unit==="ratio"?inputs.left.unit:`${inputs.left.unit}*${inputs.right.unit}`;
    return {kind:"number",unit};
  },({inputs})=>{
    const a=inputs.left.type as any,b=inputs.right.type as any; const unit=a.unit==="ratio"?b.unit:b.unit==="ratio"?a.unit:`${a.unit}*${b.unit}`;
    return numericOutput(unit,numberValue(inputs.left)*numberValue(inputs.right));
  }));

  r.register(op("arithmetic.divide","numeric-divide-v1",inputs=>{
    requireNumber(inputs.left,"left"); requireNumber(inputs.right,"right");
    const unit=inputs.left.unit===inputs.right.unit?"ratio":inputs.right.unit==="ratio"?inputs.left.unit:`${inputs.left.unit}/${inputs.right.unit}`;
    return {kind:"number",unit};
  },({inputs})=>{
    const d=numberValue(inputs.right); if(d===0) throw new Error("division by zero"); const a=inputs.left.type as any,b=inputs.right.type as any;
    const unit=a.unit===b.unit?"ratio":b.unit==="ratio"?a.unit:`${a.unit}/${b.unit}`; return numericOutput(unit,numberValue(inputs.left)/d);
  }));

  for(const [id,fn] of [["comparison.lte",(a:number,b:number)=>a<=b],["comparison.gte",(a:number,b:number)=>a>=b]] as const){
    r.register(op(id,`${id}-v1`,inputs=>{
      sameType(inputs.left,inputs.right,"comparison operands must have identical types and units");
      if(inputs.left.kind!=="number"&&inputs.left.kind!=="decimal")throw new OperationContractError("TYPE_MISMATCH","comparison operands must be numeric or fixed decimal");
      return {kind:"boolean"};
    },({inputs})=>{
      if(inputs.left.type.kind==="decimal"){const c=decimalCompare(inputs.left,inputs.right);return booleanOutput(id==="comparison.lte"?c<=0:c>=0);}
      return booleanOutput(fn(numberValue(inputs.left),numberValue(inputs.right)));
    }));
  }

  r.register(op("logic.and","boolean-and-v1",inputs=>{requireBoolean(inputs.a,"a");requireBoolean(inputs.b,"b");return {kind:"boolean"};},({inputs})=>booleanOutput(boolValue(inputs.a)&&boolValue(inputs.b))));
  r.register(op("logic.or","boolean-or-v1",inputs=>{requireBoolean(inputs.a,"a");requireBoolean(inputs.b,"b");return {kind:"boolean"};},({inputs})=>booleanOutput(boolValue(inputs.a)||boolValue(inputs.b))));
  r.register(op("logic.not","boolean-not-v1",inputs=>{requireBoolean(inputs.value,"value");return {kind:"boolean"};},({inputs})=>booleanOutput(!boolValue(inputs.value))));

  return r;
}

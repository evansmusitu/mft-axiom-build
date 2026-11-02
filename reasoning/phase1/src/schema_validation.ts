import { readFileSync } from "node:fs";
import { canonicalize } from "./canonical.ts";
import type { JsonValue } from "./types.ts";

const schema=JSON.parse(readFileSync(new URL("../spec/axiom-ir.schema.json",import.meta.url),"utf8"));
export interface ShapeIssue { code:string; message:string; }

// Deliberately closed to the vocabulary used by the bundled IR schema. Any new
// schema keyword requires an implementation change rather than silently passing.
const supported=new Set(["$schema","$id","title","$defs","$ref","type","oneOf","const","enum","required","properties","additionalProperties","items","minLength","minimum","maximum","pattern"]);
function check(value:any,rule:any,path:string,issues:ShapeIssue[]):void {
  for(const key of Object.keys(rule))if(!supported.has(key))throw new Error(`Unsupported IR schema keyword: ${key}`);
  const fail=(message:string,code="INVALID_IR_SCHEMA")=>issues.push({code,message:`${path}: ${message}`});
  if(rule.$ref){
    if(!rule.$ref.startsWith("#/$defs/"))throw new Error("Only local IR definitions are supported");
    const target=schema.$defs[rule.$ref.slice(8)];
    if(!target)throw new Error("Unknown IR definition");
    check(value,target,path,issues);return;
  }
  if(rule.oneOf){
    const matches=rule.oneOf.filter((candidate:any)=>{const errors:ShapeIssue[]=[];check(value,candidate,path,errors);return !errors.length;});
    if(matches.length!==1)fail("must match exactly one reference/type variant");
    return;
  }
  if(Object.hasOwn(rule,"const")&&value!==rule.const)fail(`expected constant ${JSON.stringify(rule.const)}`);
  if(rule.enum&&!rule.enum.includes(value))fail("unsupported enum value");
  const valid=rule.type===undefined||rule.type==="object"?(rule.type===undefined||(value!==null&&typeof value==="object"&&!Array.isArray(value))):
    rule.type==="array"?Array.isArray(value):rule.type==="integer"?Number.isInteger(value):typeof value===rule.type;
  if(!valid){fail(`expected ${rule.type}`);return;}
  if(typeof value==="string"){
    if(rule.minLength!==undefined&&[...value].length<rule.minLength)fail("string is too short");
    if(rule.pattern&&!new RegExp(rule.pattern).test(value))fail("string does not match required pattern");
  }
  if(typeof value==="number"){
    if(rule.minimum!==undefined&&value<rule.minimum)fail("value is below minimum");
    if(rule.maximum!==undefined&&value>rule.maximum)fail("value exceeds maximum");
  }
  if(rule.type==="array")value.forEach((item:any,index:number)=>check(item,rule.items??{},`${path}[${index}]`,issues));
  if(rule.type==="object"){
    for(const key of rule.required??[])if(!Object.hasOwn(value,key))fail(`missing required ${key}`,key==="provenance"?"MISSING_PROVENANCE":"INVALID_IR_SCHEMA");
    for(const [key,item] of Object.entries(value)){
      if(Object.hasOwn(rule.properties??{},key))check(item,rule.properties[key],`${path}.${key}`,issues);
      else if(rule.additionalProperties===false)fail(`unexpected property ${key}`);
      else if(rule.additionalProperties&&typeof rule.additionalProperties==="object")check(item,rule.additionalProperties,`${path}.${key}`,issues);
    }
  }
}

export function validateProgramShape(program:unknown):ShapeIssue[]{
  try{canonicalize(program as JsonValue);}catch(error){return [{code:"INVALID_IR_SCHEMA",message:`Program must contain only JSON values: ${error instanceof Error?error.message:String(error)}`}];}
  const issues:ShapeIssue[]=[];check(program,schema,"program",issues);return issues;
}

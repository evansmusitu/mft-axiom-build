import base from "./musitu_axiom_plugin_gate_v4.mjs";
const DEMO_KEY="reviewer-demo-v1.mp4";
const DEMO_SHA256="779be1d7948f0971f673d54d99572a6dada168104f10388cc3139a4cd423e5d3";
const DEMO_SIZE=6325952;
function commonHeaders(){
  return {
    "content-type":"video/mp4",
    "content-disposition":'inline; filename="MUSITU_Axiom_OpenAI_Reviewer_Demo_FINAL.mp4"',
    "cache-control":"public, max-age=86400, immutable",
    "accept-ranges":"bytes",
    "x-content-type-options":"nosniff",
    "x-musitu-demo-sha256":DEMO_SHA256,
    "x-musitu-demo-size":String(DEMO_SIZE),
    "etag":`"sha256-${DEMO_SHA256}"`
  };
}
function parseRange(value){
  if(!value)return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if(!m)return {invalid:true};
  let start,end;
  if(m[1]===""&&m[2]==="")return {invalid:true};
  if(m[1]===""){
    const suffix=Number(m[2]);
    if(!Number.isSafeInteger(suffix)||suffix<=0)return {invalid:true};
    start=Math.max(0,DEMO_SIZE-suffix); end=DEMO_SIZE-1;
  }else{
    start=Number(m[1]);
    if(!Number.isSafeInteger(start)||start<0||start>=DEMO_SIZE)return {invalid:true};
    end=m[2]===""?DEMO_SIZE-1:Number(m[2]);
    if(!Number.isSafeInteger(end)||end<start)return {invalid:true};
    end=Math.min(end,DEMO_SIZE-1);
  }
  return {start,end};
}
async function reviewerDemo(req,env){
  const headers=commonHeaders();
  if(req.method==="HEAD"){
    headers["content-length"]=String(DEMO_SIZE);
    return new Response(null,{status:200,headers});
  }
  const range=parseRange(req.headers.get("range"));
  if(range?.invalid){
    headers["content-range"]=`bytes */${DEMO_SIZE}`;
    return new Response(null,{status:416,headers});
  }
  const data=await env.REVIEWER_ASSETS.get(DEMO_KEY,{type:"arrayBuffer"});
  if(!(data instanceof ArrayBuffer)||data.byteLength!==DEMO_SIZE){
    return new Response("Reviewer demo temporarily unavailable",{status:503,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store","retry-after":"10"}});
  }
  if(range){
    const body=data.slice(range.start,range.end+1);
    headers["content-range"]=`bytes ${range.start}-${range.end}/${DEMO_SIZE}`;
    headers["content-length"]=String(range.end-range.start+1);
    return new Response(body,{status:206,headers});
  }
  headers["content-length"]=String(DEMO_SIZE);
  return new Response(data,{status:200,headers});
}
export default{async fetch(req,env,ctx){
  const u=new URL(req.url);
  if(u.pathname==="/demo.mp4"&&(req.method==="GET"||req.method==="HEAD"))return reviewerDemo(req,env);
  return base.fetch(req,env,ctx);
}};

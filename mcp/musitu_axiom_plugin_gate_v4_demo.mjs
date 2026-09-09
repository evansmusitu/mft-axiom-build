import base from "./musitu_axiom_plugin_gate_v4.mjs";
const DEMO_URL='https://raw.githubusercontent.com/evansmusitu/mft-axiom-build/3d2a6843080b45f7a743eb88aeca95f28888648f/submission/reviewer/MUSITU_Axiom_OpenAI_Reviewer_Demo_FINAL.mp4';
const DEMO_SHA256='779be1d7948f0971f673d54d99572a6dada168104f10388cc3139a4cd423e5d3';
const DEMO_SIZE='6325952';
async function reviewerDemo(req){
  const h=new Headers();
  const range=req.headers.get("range");
  if(range)h.set("range",range);
  h.set("user-agent","MUSITU-Axiom-Reviewer-Demo/1.0");
  const method=req.method==="HEAD"?"HEAD":"GET";
  const r=await fetch(DEMO_URL,{method,headers:h,redirect:"follow"});
  if(r.status!==200&&r.status!==206)return new Response("Reviewer demo unavailable",{status:502,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
  const out=new Headers(r.headers);
  out.set("content-type","video/mp4");
  out.set("content-disposition",'inline; filename="MUSITU_Axiom_OpenAI_Reviewer_Demo_FINAL.mp4"');
  out.set("cache-control","public, max-age=3600, immutable");
  out.set("accept-ranges","bytes");
  out.set("x-content-type-options","nosniff");
  out.set("x-musitu-demo-sha256",DEMO_SHA256);
  out.set("x-musitu-demo-size",DEMO_SIZE);
  return new Response(method==="HEAD"?null:r.body,{status:r.status,headers:out});
}
export default{async fetch(req,env,ctx){
  const u=new URL(req.url);
  if(u.pathname==="/demo.mp4"&&(req.method==="GET"||req.method==="HEAD"))return reviewerDemo(req);
  return base.fetch(req,env,ctx);
}};

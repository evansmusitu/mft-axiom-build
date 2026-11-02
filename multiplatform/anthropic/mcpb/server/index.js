import readline from "node:readline";

const upstream=(process.env.AXIOM_FRONTIER_MCP_URL||"").replace(/\/$/,"");
if(!upstream || !upstream.startsWith("https://")){process.stderr.write("MISSING_OR_INVALID_AXIOM_FRONTIER_MCP_URL\n");process.exit(2)}
if(upstream==="https://mcp.mftintelligence.com/mcp"){process.stderr.write("PRODUCTION_ENDPOINT_FORBIDDEN\n");process.exit(3)}

let sessionId=null;
let initialized=false;

async function rpc(req){
  const headers={"content-type":"application/json","accept":"application/json, text/event-stream"};
  if(process.env.AXIOM_FRONTIER_OAUTH_TOKEN) headers.authorization="Bearer "+process.env.AXIOM_FRONTIER_OAUTH_TOKEN;
  if(sessionId) headers["mcp-session-id"]=sessionId;
  const response=await fetch(upstream,{method:"POST",headers,body:JSON.stringify(req)});
  const sid=response.headers.get("mcp-session-id"); if(sid) sessionId=sid;
  const text=await response.text();
  const dataLine=text.split("\n").find(x=>x.startsWith("data:"))?.slice(5).trim();
  const raw=dataLine||text.trim();
  return raw?JSON.parse(raw):{};
}

async function handle(req){
  if(req.method==="initialize"){
    const out=await rpc(req); initialized=true; return out;
  }
  if(req.method==="notifications/initialized") return null;
  if(!initialized){
    await rpc({jsonrpc:"2.0",id:"mcpb-init",method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"musitu-axiom-mcpb-bridge",version:"0.1.0"}}});
    initialized=true;
  }
  return rpc(req);
}

const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on("line",async line=>{
  try{
    const request=JSON.parse(line);
    const result=await handle(request);
    if(result!==null) process.stdout.write(JSON.stringify(result)+"\n");
  }catch(error){
    process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32603,message:String(error?.message||error)}})+"\n");
  }
});

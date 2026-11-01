const RELEASE="baseline";
const PROBE_STATUS=200;

const headers={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff",
};

function json(status,body){
  return new Response(JSON.stringify(body),{status,headers});
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==="/health" && request.method==="GET"){
      return json(200,{
        ok:true,
        service:"MUSITU Connect Admission Canary",
        release:RELEASE,
        production:false,
      });
    }
    if(url.pathname==="/probe" && request.method==="POST"){
      if(!env.CANARY_SECRET){
        return json(503,{ok:false,error:"CANARY_SECRET_NOT_CONFIGURED"});
      }
      const authorization=request.headers.get("authorization")||"";
      if(authorization!==("Bearer "+env.CANARY_SECRET)){
        return json(401,{ok:false,error:"UNAUTHORIZED"});
      }
      const requestId=request.headers.get("x-musitu-request-id")||"";
      return json(PROBE_STATUS,{
        ok:PROBE_STATUS===200,
        release:RELEASE,
        request_id:requestId,
        production:false,
      });
    }
    return json(404,{ok:false,error:"NOT_FOUND"});
  }
};

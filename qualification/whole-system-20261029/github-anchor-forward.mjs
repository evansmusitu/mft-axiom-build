/** workerd service requests carry transport headers; Node must calculate its own framing. */
export async function forwardGithubRequest(request,{fetchImpl=fetch}={}){
  const headers={};for(const name of ['authorization','accept','user-agent','x-github-api-version','content-type']){
    const value=request.headers.get(name);if(value!==null)headers[name]=value;
  }
  const body=['POST','PATCH'].includes(request.method)?await request.text():undefined;
  const response=await fetchImpl(request.url,{method:request.method,headers,...(body===undefined?{}:{body}),redirect:'manual',signal:AbortSignal.timeout(10000)});
  return {response,body};
}

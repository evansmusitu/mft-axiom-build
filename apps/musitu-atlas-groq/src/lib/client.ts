export type ApiReply<T=any>={data:T};
async function invoke<T=any>(method:string,path:string,data?:unknown):Promise<ApiReply<T>>{
 const ctrl=new AbortController();
 const timer=setTimeout(()=>ctrl.abort(),55000);
 try{
  const res=await fetch(path,{
   method,credentials:'same-origin',
   headers:method==='GET'?{}:{'Content-Type':'application/json'},
   body:method==='GET'?undefined:JSON.stringify(data??{}),
   signal:ctrl.signal
  });
  const body=await res.json().catch(()=>({}));
  if(!res.ok){const err=new Error(body.error||'Request failed: '+res.status) as Error&{status:number};err.status=res.status;throw err;}
  return {data:body as T};
 }finally{clearTimeout(timer);}
}
export const api={
 get:<T=any>(path:string)=>invoke<T>('GET',path),
 post:<T=any>(path:string,data?:unknown)=>invoke<T>('POST',path,data),
 put:<T=any>(path:string,data?:unknown)=>invoke<T>('PUT',path,data),
 delete:<T=any>(path:string)=>invoke<T>('DELETE',path)
};
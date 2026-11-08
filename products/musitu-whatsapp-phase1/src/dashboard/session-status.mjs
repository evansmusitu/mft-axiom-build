export async function readBusinessSession(fetchImpl=globalThis.fetch){
 try{
  const response=await fetchImpl('/api/session',{cache:'no-store',redirect:'error',credentials:'same-origin'});
  if(response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))return null;
  const body=await response.json();
  if(response.status===200&&body?.signedIn===true)return true;
  if(response.status===401&&body?.signedIn===false)return false;
 }catch{}
 return null;
}

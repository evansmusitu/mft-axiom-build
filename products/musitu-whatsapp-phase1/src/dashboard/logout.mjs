/** Revoke locally over same-origin fetch, then navigate to the provider. */
export async function endBusinessSession({request=globalThis.fetch,navigate=url=>globalThis.location.assign(url)}={}){
 const response=await request('/auth/logout',{method:'POST',headers:{accept:'application/json'},credentials:'same-origin',redirect:'error',cache:'no-store'});
 if(!response.ok)throw Error('LOGOUT_UNAVAILABLE');
 const body=await response.json();let target;
 try{target=new URL(body.redirect);}catch{throw Error('LOGOUT_REDIRECT_REJECTED');}
 if(target.protocol!=='https:'||target.username||target.password||target.hash)throw Error('LOGOUT_REDIRECT_REJECTED');
 navigate(target.href);
}

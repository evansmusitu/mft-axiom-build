/** Publish bookings and selectable resources only when both reads match the business. */
export async function loadBookingView(tenant,{request=globalThis.fetch}={}){
 const responses=await Promise.all(['bookings','resources'].map(kind=>request(`/api/tenants/${encodeURIComponent(tenant)}/${kind}`,{cache:'no-store',credentials:'same-origin'})));
 if(responses.some(r=>!r.ok))throw Error(responses.some(r=>r.status===403)?'Sign in and select a business you belong to.':'The business service is unavailable.');
 const [bookings,resources]=await Promise.all(responses.map(r=>r.json()));
 if([bookings,resources].some(r=>r?.tenantId!==tenant||!Array.isArray(r.data)))throw Error('Business response rejected');
 const ids=new Set();
 for(const resource of resources.data){
  if(!resource||typeof resource.resource_id!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(resource.resource_id)||typeof resource.label!=='string'||!resource.label.trim()||resource.label.length>200||ids.has(resource.resource_id.toLowerCase()))throw Error('Business response rejected');
  ids.add(resource.resource_id.toLowerCase());
 }
 return {bookings:bookings.data,resources:resources.data};
}

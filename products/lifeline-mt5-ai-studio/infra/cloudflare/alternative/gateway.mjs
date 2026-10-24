// RED test scaffold: no provider actions, no active cutover.
export async function forwardAlternative(){ return new Response(JSON.stringify({error:'not_configured'}),{status:503,headers:{'content-type':'application/json'}}); }
export async function signInternalRequest(){throw new Error('not_implemented');}

// RED test scaffold: fails closed.
export default {async fetch(){return new Response(JSON.stringify({error:'not_configured'}),{status:503,headers:{'content-type':'application/json'}});}};

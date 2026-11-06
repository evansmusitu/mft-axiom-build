// Optional browser-only same-origin adapter for existing AXIOM vNext shell.
// No token/API key storage. Never render billing or checkout inside ChatGPT.
export class AXIOMCustomerAdapter {
 constructor(base='/v1/customer'){this.base=base;}
 async request(path,{method='GET',body,idempotencyKey}={}){
  const headers={'accept':'application/json'};
  if(body!==undefined){headers['content-type']='application/json';headers['x-axiom-intent']='customer-action';}
  if(idempotencyKey)headers['idempotency-key']=idempotencyKey;
  const response=await fetch(this.base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',redirect:'error',cache:'no-store'});
  const data=await response.json();
  if(!response.ok||data.ok!==true)throw new Error(data.error||'customer_request_failed');
  return data;
 }
 getAccount(){return this.request('/me');}
 getMemberships(){return this.request('/memberships');}
 getCases(){return this.request('/cases');}
 createCase(kind,subject,detail,key=crypto.randomUUID()){return this.request('/cases',{method:'POST',body:{kind,subject,detail},idempotencyKey:key});}
 enroll(){return this.request('/enroll',{method:'POST',body:{}});}
 getLedger(){return this.request('/ledger');}
 getOrders(){return this.request('/orders');}
 getCatalog(){return this.request('/catalog');}
 getLiveBillingTruth(){return this.request('/billing/truth');}
 getInvoices(){return this.request('/invoices');}
 getRefunds(){return this.request('/refunds');}
 getProjects(){return this.request('/projects');}
 getWork(project){return this.request('/work?project='+encodeURIComponent(project));}
 getEvidence(work){return this.request('/evidence?work='+encodeURIComponent(work));}
 getArtifacts(work){return this.request('/artifacts?work='+encodeURIComponent(work));}
 getAgents(work){return this.request('/agents?work='+encodeURIComponent(work));}
 createProject(name,objective){return this.request('/projects',{method:'POST',body:{name,objective}});}
 createWork(project_id,title,desired_outcome){return this.request('/work',{method:'POST',body:{project_id,title,desired_outcome}});}
 createOrder(price_id,key=crypto.randomUUID()){return this.request('/orders',{method:'POST',body:{price_id},idempotencyKey:key});}
 requestRefund(order_id,amount_minor,reason,key=crypto.randomUUID()){return this.request('/refunds',{method:'POST',body:{order_id,amount_minor,reason},idempotencyKey:key});}
}

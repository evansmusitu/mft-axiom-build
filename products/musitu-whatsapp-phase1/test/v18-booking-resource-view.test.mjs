import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBookingView} from '../src/dashboard/booking-view.mjs';
const tenant='00000000-0000-4000-8000-00000000000a';
const resource={resource_id:'2660e3a0-c471-4bc0-ba22-c3e99c2d6f9a',label:'Synthetic appointment room'};
const response=(data,status=200)=>Response.json({tenantId:tenant,data},{status});
test('bookings include named resources from the same authenticated tenant without operator lookup',async()=>{
 const calls=[];
 const view=await loadBookingView(tenant,{request:async(url,options)=>{calls.push({url,options});return response(url.endsWith('/resources')?[resource]:[]);}});
 assert.deepEqual(view,{bookings:[],resources:[resource]});
 assert.deepEqual(calls.map(c=>c.url),[`/api/tenants/${tenant}/bookings`,`/api/tenants/${tenant}/resources`]);
 assert.ok(calls.every(c=>c.options.cache==='no-store'&&c.options.credentials==='same-origin'));
});
test('denied or unavailable resource reads never publish partial booking data',async()=>{
 for(const status of [403,503]){
  let parsed=0;
  await assert.rejects(loadBookingView(tenant,{request:async url=>url.endsWith('/resources')?{ok:false,status}:{ok:true,status:200,json:async()=>{parsed++;return {tenantId:tenant,data:[{bookingId:'synthetic'}]};}}}),status===403?/Sign in and select/:/unavailable/);
  assert.equal(parsed,0);
 }
});
test('either foreign-tenant response rejects the entire booking view',async()=>{
 for(const foreign of ['bookings','resources'])await assert.rejects(loadBookingView(tenant,{request:async url=>Response.json({tenantId:url.endsWith('/'+foreign)?'00000000-0000-4000-8000-00000000000b':tenant,data:url.endsWith('/resources')?[resource]:[]})}),/Business response rejected/);
});
test('malformed or duplicate selectable resources fail closed',async()=>{
 for(const data of [null,{},[null],[{...resource,resource_id:'not-an-id'}],[{...resource,label:''}],[{...resource,label:'x'.repeat(201)}],[resource,resource]])await assert.rejects(loadBookingView(tenant,{request:async url=>response(url.endsWith('/resources')?data:[])}),/Business response rejected/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {searchScholarlyWorks,ScholarSearchError} from '../scholar.mjs';

const hit={
 DOI:'10.1038/s41586-024-00001-7',
 title:['**Study of accessible water treatments**'],
 author:[{given:'Alice',family:'Kim'},{given:'Benjamin',family:'Okoro'}],
 published:{'date-parts':[[2024,5,14]]},
 'container-title':['Journal of Applied Research'],
 publisher:'Research Publisher',
 type:'journal-article',
 'is-referenced-by-count':19
};
function response(body,status=200,headers={}) {
 return {ok:status>=200&&status<300,status,headers:{get:k=>headers[k.toLowerCase()]??null},text:async()=>JSON.stringify(body)};
}
function fixture(items=[hit]){
 return response({status:'ok',message:{items}});
}
test('queries a fixed Crossref v1 provider with restrained resource use',async()=>{
 const calls=[];
 const result=await searchScholarlyWorks('water purification',async(url,init)=>{
  calls.push({url,init});return fixture();
 });
 assert.equal(calls.length,1);
 const parsed=new URL(calls[0].url);
 assert.equal(parsed.host,'api.crossref.org');
 assert.equal(parsed.pathname,'/v1/works');
 assert.equal(parsed.searchParams.get('rows'),'6');
 assert.equal(parsed.searchParams.get('query.bibliographic'),'water purification');
 assert.match(parsed.searchParams.get('select'),/DOI/);
 assert.equal(calls[0].init.redirect,'manual');
 assert.equal(result.providers[0],'Crossref');
 assert.equal(result.sources.length,1);
 assert.equal(result.sources[0].source,'Crossref');
 assert.equal(result.sources[0].url,'https://doi.org/10.1038/s41586-024-00001-7');
 assert.equal(result.sources[0].year,2024);
 assert.deepEqual(result.sources[0].authors,['Alice Kim','Benjamin Okoro']);
 assert.equal(result.sources[0].journal,'Journal of Applied Research');
 assert.equal(result.sources[0].referenceCount,19);
 assert.match(result.scope,/NOT|Not full|Not.*full/i);
});
test('removes markup from scholar metadata and never trusts record publisher URLs',async()=>{
 const input={...hit,title:['<script>evil()</script>Accessible engineering'],DOI:'10.1000/demo-123',URL:'http://untrusted.example/script',publisher:'<b>Publisher</b>'};
 const r=await searchScholarlyWorks('engineering',async()=>fixture([input]));
 assert.equal(r.sources.length,1);
 assert.equal(r.sources[0].url,'https://doi.org/10.1000/demo-123');
 assert.ok(!r.sources[0].title.includes('<'));
 assert.ok(!r.sources[0].publisher.includes('<'));
});
test('deduplicates normalized DOIs and skips invalid or missing ones',async()=>{
 const r=await searchScholarlyWorks('renewable energy',async()=>fixture([
  hit,{...hit,DOI:hit.DOI.toUpperCase()}, {...hit,DOI:'https://untrusted.example/abc'}, {...hit,DOI:'10.1000/different',title:[]}
 ]));
 assert.equal(r.sources.length,1);
});
test('scholar requests reject unsafe queries before network calls',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return fixture();};
 for(const input of ['', 'ab','x'.repeat(181),'a\ninjection','hello\u0000world']){
  await assert.rejects(()=>searchScholarlyWorks(input,fetcher),ScholarSearchError);
 }
 assert.equal(calls,0);
});
test('fails closed on Crossref HTTP failures and malformed JSON shape',async()=>{
 await assert.rejects(()=>searchScholarlyWorks('climate change',async()=>response({},429)),ScholarSearchError);
 await assert.rejects(()=>searchScholarlyWorks('climate change',async()=>response({message:{}})),ScholarSearchError);
 await assert.rejects(()=>searchScholarlyWorks('climate change',async()=>response({message:{items:'bad'}})),ScholarSearchError);
});
test('limits provider response size and source count',async()=>{
 await assert.rejects(()=>searchScholarlyWorks('renewable energy',async()=>response({message:{items:[]}},200,{'content-length':'250000'})),ScholarSearchError);
 const source=await searchScholarlyWorks('energy systems',async()=>fixture(Array.from({length:30},(_,i)=>({...hit,DOI:'10.1000/test-'+i}))));
 assert.equal(source.sources.length,6);
});
test('missing publication year and author metadata do not produce fake values',async()=>{
 const r=await searchScholarlyWorks('novel sensors',async()=>fixture([{DOI:'10.1000/other',title:['Sensor research'],type:'posted-content'}]));
 assert.equal(r.sources[0].year,null);
 assert.deepEqual(r.sources[0].authors,[]);
 assert.equal(r.sources[0].workType,'posted-content');
 assert.match(r.scope,/Not full text/);
});

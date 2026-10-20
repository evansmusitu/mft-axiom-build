// Public, unauthenticated source providers only. This is not an unrestricted search engine.
// Keep URLs pinned to explicit providers and never fetch user-controlled destinations.
const WIKI = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
const HN = 'https://hn.algolia.com/api/v1/search';
const USER_AGENT = 'MUSITU-Intelligence-Edge/1.0 (public web research; https://evansmusitu.github.io/)';

function plain(value,max=360){
 return String(value || '').replace(/<[^>]*>/g,' ').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,max);
}
async function getJson(url, fetcher) {
 const response=await fetcher(url,{
  headers:{ 'accept':'application/json', 'user-agent':USER_AGENT },
  signal: AbortSignal.timeout(9000)
 });
 if(!response.ok) throw new Error('Source provider unavailable');
 const raw=await response.text();
 if(raw.length>180000) throw new Error('Source response too large');
 return JSON.parse(raw);
}

export async function searchPublicSources(query,fetcher=fetch) {
 const term=typeof query==='string'?query.trim():'';
 if(term.length<5 || term.length>180) throw new Error('Research query length must be 5 to 180 characters');
 const wikiURL = WIKI+'?q='+encodeURIComponent(term)+'&limit=4';
 const hnURL = HN+'?query='+encodeURIComponent(term)+'&tags=story&hitsPerPage=3';
 const settled=await Promise.allSettled([getJson(wikiURL,fetcher),getJson(hnURL,fetcher)]);
 const sources=[];
 const providers=[];
 if(settled[0].status==='fulfilled') {
  providers.push('Wikipedia');
  for(const page of (Array.isArray(settled[0].value?.pages)?settled[0].value.pages:[]).slice(0,4)){
   const key=page?.key;
   if(typeof key!=='string'||!key||key.length>160)continue;
   const title=plain(page.title||key,140);
   if(!title)continue;
   const url='https://en.wikipedia.org/wiki/'+encodeURIComponent(key).replace(/%2F/g,'/');
   sources.push({title,url,source:'Wikipedia',snippet:plain(page.description||page.excerpt||'',330)});
  }
 }
 if(settled[1].status==='fulfilled'){
  providers.push('Hacker News');
  for(const item of (Array.isArray(settled[1].value?.hits)?settled[1].value.hits:[]).slice(0,3)){
   const id=String(item?.objectID||'');
   if(!/^\d{1,15}$/.test(id))continue;
   const title=plain(item.title,140);
   if(!title)continue;
   sources.push({title,url:'https://news.ycombinator.com/item?id='+id,source:'Hacker News',snippet:plain(item.story_text||'Public story discussion; open to inspect original reporting.',330)});
  }
 }
 return {query:term,sources:sources.slice(0,7),providers,scope:'English Wikipedia and Hacker News only; NOT general web search, news completeness, or live financial data',retrievedAt:new Date().toISOString()};
}

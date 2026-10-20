/**
 * MUSITU scholarly metadata retrieval (Crossref public REST v1).
 * Fixed upstream host, bounded output, no web crawling, no user-supplied URLs.
 * Crossref metadata records DOI registration, NOT peer review or paper validity.
 */
const BASE='https://api.crossref.org/v1/works';
const DOI_PATTERN=/^10\.\d{4,9}\/[a-z0-9\-._;()/:]+$/i;
const QUERY_MIN=5;
const QUERY_MAX=180;

export class ScholarSearchError extends Error {
  constructor(message) {super(message);this.name='ScholarSearchError';}
}
function safe(value,max=160) {
  return String(value ?? '').replace(/<[^>]*>/g,' ')
    .replace(/[\u0000-\u001f\u007f]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,max);
}
function person(person) {
  const given=safe(person?.given,45),family=safe(person?.family,55);
  return [given,family].filter(Boolean).join(' ');
}
function publicationYear(item) {
  for (const key of ['published','published-print','published-online','issued','created']) {
    const year=Number(item?.[key]?.['date-parts']?.[0]?.[0]);
    if(Number.isInteger(year)&&year>=1500&&year<=2100) return year;
  }
  return null;
}
function makeRecord(item) {
  if(!item || typeof item !== 'object') return null;
  const doi=safe(item.DOI,210).toLowerCase();
  if(!DOI_PATTERN.test(doi)||doi.length>195) return null;
  const title=safe(Array.isArray(item.title) ? item.title[0] : item.title,190);
  if(!title)return null;
  const people=Array.isArray(item.author)?item.author.slice(0,9).map(person).filter(Boolean):[];
  const authors=people.slice(0,6);
  const hasMoreAuthors=people.length>6 || (Array.isArray(item.author) && item.author.length>9);
  const year=publicationYear(item);
  const journal=safe(Array.isArray(item['container-title'])?item['container-title'][0]:item['container-title'],120);
  const publisher=safe(item.publisher,100);
  const type=safe(item.type,45);
  const references=Number.isInteger(item['is-referenced-by-count']) && item['is-referenced-by-count']>=0
    ? item['is-referenced-by-count'] : null;
  const url='https://doi.org/'+encodeURI(doi).replace(/#/g,'%23').replace(/\?/g,'%3F');
  return {
    title,url,doi,source:'Crossref',
    year,authors,hasMoreAuthors,journal,publisher,workType:type,
    referenceCount:references,
    snippet:[
      year ? 'Published '+year : 'Year unreported',
      journal||publisher||'Venue unreported',
      authors.length ? 'Authors: '+authors.join(', ')+(hasMoreAuthors?' et al.':'') : 'Authors unreported',
      'DOI '+doi
    ].join(' · ').slice(0,470)
  };
}
export async function searchScholarlyWorks(query,fetcher=fetch) {
  const term=typeof query === 'string' ? query.trim() : '';
  if(term.length<QUERY_MIN||term.length>QUERY_MAX) {
    throw new ScholarSearchError('Scholarly queries must contain 5–180 characters.');
  }
  if(/[\u0000-\u001f]/.test(term)) throw new ScholarSearchError('Invalid characters in scholarly query.');
  const endpoint=BASE+'?query.bibliographic='+encodeURIComponent(term)+
    '&rows=6&select=DOI,title,author,published,published-print,published-online,issued,created,container-title,publisher,type,is-referenced-by-count';
  const response=await fetcher(endpoint,{
    method:'GET',
    redirect:'error',
    headers:{accept:'application/json'},
    signal:AbortSignal.timeout(9000)
  });
  if(!response.ok) throw new ScholarSearchError('Scholarly index unavailable (HTTP '+response.status+').');
  const declared=Number(response.headers?.get?.('content-length')||0);
  if(declared>150000)throw new ScholarSearchError('Scholarly index response exceeded size limit.');
  const raw=await response.text();
  if(raw.length>150000)throw new ScholarSearchError('Scholarly index response exceeded size limit.');
  let payload;
  try{payload=JSON.parse(raw);}catch{throw new ScholarSearchError('Invalid scholarly index response.');}
  const items=payload?.message?.items;
  if(!Array.isArray(items))throw new ScholarSearchError('Unexpected scholarly index metadata shape.');
  const seen=new Set();
  const sources=[];
  for(const candidate of items.slice(0,6)) {
    const record=makeRecord(candidate);
    if(!record || seen.has(record.doi))continue;
    seen.add(record.doi);sources.push(record);
  }
  return {
    query:term,sources,
    providers:['Crossref'],
    scope:'Crossref DOI registration metadata only. Not full text, a complete literature review, or evidence of peer review or accuracy. Citation counts are metadata and may lag.',
    retrievedAt:new Date().toISOString()
  };
}

const WIKI = 'https://en.wikipedia.org';
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
export class ExternalToolError extends Error {
  constructor(code, message) { super(message); this.name='ExternalToolError'; this.code=code; }
}

function textOnly(input) {
  return String(input || '').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/\s+/g,' ').trim();
}

export async function wikipediaSearch(query, fetcher = fetch) {
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 120) {
    throw new ExternalToolError('QUERY_INVALID','Enter a search query of 3 to 120 characters.');
  }
  const endpoint = new URL('/w/rest.php/v1/search/page',WIKI);
  endpoint.searchParams.set('q',query.trim());
  endpoint.searchParams.set('limit','5');
  let result;
  try {
    const response = await fetcher(endpoint.toString(),{
      headers: {
        accept: 'application/json',
        'user-agent': 'MUSITU-Intelligence-Edge/1.0 (https://evansmusitu.github.io; support@mftintelligence.com)'
      },
      signal: AbortSignal.timeout(11000)
    });
    if(!response.ok) throw new ExternalToolError('SEARCH_UPSTREAM_UNAVAILABLE','The live encyclopedia service is unavailable.');
    result = await response.json();
  } catch(error) {
    if(error instanceof ExternalToolError) throw error;
    throw new ExternalToolError('SEARCH_UPSTREAM_UNAVAILABLE','The live encyclopedia service could not be reached.');
  }
  if(!Array.isArray(result?.pages)) throw new ExternalToolError('SEARCH_BAD_RESPONSE','Search returned an unsupported response.');
  const hits=result.pages.slice(0,5).filter(x=>x && typeof x.title==='string' && x.title.length>0).map(page=>{
    const title=page.title.slice(0,200);
    const key=typeof page.key==='string' ? page.key : title.replaceAll(' ','_');
    return {
      title,
      description:textOnly(page.description).slice(0,220),
      excerpt:textOnly(page.excerpt).slice(0,380),
      url:WIKI+'/wiki/'+encodeURIComponent(key).replace(/%2F/g,'%2F')
    };
  });
  return { tool:'encyclopedia-search',provider:'Wikimedia (Wikipedia)',query:query.trim(),
    generalWebSearch:false,fetchedAt:new Date().toISOString(),results:hits,
    limitation:'This is live Wikipedia search, not unrestricted internet search or a live news feed.' };
}

export async function generateImage(prompt, aiBinding) {
  if (typeof prompt !== 'string' || prompt.trim().length < 10 || prompt.length > 500) {
    throw new ExternalToolError('IMAGE_PROMPT_INVALID','Describe the image in 10–500 characters.');
  }
  let result;
  try {
    result=await aiBinding.run(IMAGE_MODEL,{prompt:prompt.trim(),steps:4});
  } catch {
    throw new ExternalToolError('IMAGE_PROVIDER_UNAVAILABLE','Image generation is temporarily unavailable or the AI allocation is exhausted.');
  }
  if (typeof result?.image !== 'string' || !/^[a-zA-Z0-9+/=]+$/.test(result.image) ||
    result.image.length<500 || result.image.length>5_000_000) {
    throw new ExternalToolError('IMAGE_BAD_RESPONSE','The image provider returned an invalid result.');
  }
  return {
    tool:'image-generator', model:IMAGE_MODEL, contentType:'image/jpeg',
    dataURI:'data:image/jpeg;base64,'+result.image,
    prompt:prompt.trim(), generatedAt:new Date().toISOString(),
    note:'AI-generated image. Check accuracy and model licensing before commercial use.'
  };
}

const HEADERS=Object.freeze({
  'cache-control':'public, max-age=30, stale-while-revalidate=120',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'permissions-policy':'camera=(), microphone=(), geolocation=(), payment=()'
});

function json(value,status=200){
  return new Response(JSON.stringify(value),{
    status,
    headers:{...HEADERS,'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'}
  });
}

function html(){
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow">
<title>MUSITU Axiom Service Status</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:32px 20px;line-height:1.5;background:#fff;color:#111}
header{border-bottom:1px solid #ddd;margin-bottom:28px}
h1{font-size:2rem}
.ok,.incident{padding:18px;border:1px solid #ddd;border-radius:12px}
.incident{margin:12px 0}
.fine{font-size:.9rem;color:#555}
</style>
</head>
<body>
<header><strong>MUSITU Axiom</strong><p class="fine">Service Status</p></header>
<main>
<h1>MUSITU Axiom Service Status</h1>
<p>Verified public incident metadata from MUSITU Support. Response objectives are operating targets, not contractual guarantees.</p>
<div id="status" class="ok">Loading status…</div>
</main>
<script>
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
(async()=>{
  const target=document.getElementById('status');
  try{
    const response=await fetch('/api/status',{headers:{accept:'application/json'}});
    const data=await response.json();
    if(!response.ok) throw new Error('Status unavailable');
    target.className='';
    target.innerHTML=(data.incidents||[]).length
      ? data.incidents.map(i=>'<section class="incident"><h2>'+esc(i.severity)+' · '+esc(i.title)+'</h2><p><strong>'+esc(i.state)+'</strong></p><p>'+esc(i.public_summary)+'</p><p class="fine">Updated '+esc(new Date(i.updated_at).toLocaleString())+'</p></section>').join('')
      : '<section class="incident"><h2>No active incidents</h2><p>No verified active incident is currently published.</p></section>';
  }catch{
    target.textContent='Status data is temporarily unavailable.';
  }
})();
</script>
</body>
</html>`;
}

async function source(env){
  if(!env?.SUPPORT_API||typeof env.SUPPORT_API.fetch!=='function') return json({error:'STATUS_SOURCE_UNAVAILABLE'},503);
  try{
    const response=await env.SUPPORT_API.fetch(new Request('https://support.internal/api/v1/status',{headers:{accept:'application/json'}}));
    if(!response.ok) return json({error:'STATUS_SOURCE_UNAVAILABLE'},503);
    const data=await response.json();
    const incidents=Array.isArray(data?.incidents)?data.incidents.map(i=>Object.freeze({
      incident_id:String(i?.incident_id||''),
      title:String(i?.title||''),
      severity:String(i?.severity||''),
      state:String(i?.state||''),
      public_summary:String(i?.public_summary||''),
      created_at:String(i?.created_at||''),
      updated_at:String(i?.updated_at||'')
    })):[];
    return json({schema:'musitu.axiom.public-status-edge.v1',incidents});
  }catch{
    return json({error:'STATUS_SOURCE_UNAVAILABLE'},503);
  }
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!['GET','HEAD'].includes(request.method)) return json({error:'METHOD_NOT_ALLOWED'},405);

    if(url.pathname==='/api/status'){
      if(request.method==='HEAD'){
        return new Response(null,{status:200,headers:{...HEADERS,'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'}});
      }
      return source(env);
    }

    if(url.pathname==='/'||url.pathname==='/index.html'){
      return new Response(request.method==='HEAD'?null:html(),{
        status:200,
        headers:{...HEADERS,'content-type':'text/html; charset=utf-8'}
      });
    }

    return json({error:'NOT_FOUND'},404);
  }
};

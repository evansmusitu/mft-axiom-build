// MFT EDUCATION NEXUS | WhatsApp 0781572008 | isolated business-service beta
const FOOTER='\n\nMFT EDUCATION NEXUS | WhatsApp: 0781572008';
const MENU='🎓 MFT EDUCATION NEXUS\nWelcome! Choose an option:\n1. A-Level Study Notes\n2. ZIMSEC Revision Predictions\n3. Past Examination Papers\n4. Marking Schemes\n5. Human Support\n0. Show Menu';
export function answer(input){
  const m=String(input||'').trim().toLowerCase().slice(0,1500);
  if(!m||/^(hi|hello|hey|start|help|menu|0)$/i.test(m))return MENU+FOOTER;
  if(/\b(price|prices|cost|buy|purchase|pay|payment|ecocash|usd|order|how much)\b/.test(m))return 'Ask our team to confirm current prices and official payment instructions. This chatbot does not collect payments or invent prices.'+FOOTER;
  if(m==='1'||/notes|study materials|syllabus/.test(m))return '📘 Tell us your A-Level subject and whether you are in Lower 6 or Upper 6. Our team will confirm availability.'+FOOTER;
  if(m==='2'||/predict/.test(m))return '📝 Predictions are practice materials, not guaranteed examination questions. Tell us the subject and exam session.'+FOOTER;
  if(m==='3'||/past (paper|exam)/.test(m))return '📚 Tell us your subject, level and paper number. We will confirm which papers may be shared.'+FOOTER;
  if(m==='4'||/marking|mark scheme/.test(m))return '✅ Specify subject, paper number and year or topic to enquire about marking schemes.'+FOOTER;
  if(m==='5'||/human|contact|agent|support|whatsapp/.test(m))return '💬 Contact MFT support on WhatsApp 0781572008. A human will reply when available.'+FOOTER;
  return 'I can help with MFT educational resources and customer support. Reply 0 for the menu or 5 for human support.'+FOOTER;
}
const PAGE='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MFT AI NEXUS</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(130deg,#06172b,#153b54);font:16px system-ui,sans-serif;color:#e9fcfa}main{max-width:850px;margin:auto;padding:30px 18px}h1{font-size:clamp(33px,7vw,58px);margin:12px 0}.brand{letter-spacing:3px;font-weight:800;color:#8be9c9}p,footer{color:#b9d7db}.panel{border:1px solid #497282;background:#112e43;border-radius:18px;overflow:hidden;box-shadow:0 25px 70px #0005}.bar{padding:15px;border-bottom:1px solid #365c6b}.chat{height:390px;overflow:auto;padding:18px}.bubble{padding:12px 15px;background:#225369;white-space:pre-wrap;border-radius:12px;width:fit-content;max-width:86%;margin:8px 0}.mine{background:#087c81;margin-left:auto}.controls{padding:10px;display:flex;gap:7px;flex-wrap:wrap}.controls button{background:#205269;color:#fff}button{background:#7cebc8;border:0;padding:11px 14px;border-radius:9px;cursor:pointer;font-weight:700}form{border-top:1px solid #365c6b;padding:13px;display:flex;gap:6px}input{flex:1;min-width:0;background:#071d2d;color:white;border:1px solid #507080;padding:12px;border-radius:9px;font-size:16px}footer{font-size:12px;padding-top:30px}.wm{font-size:10px;letter-spacing:3px;opacity:.55}a{color:#80efce}</style></head><body><main><div class="brand">MFT EDUCATION NEXUS</div><h1>MFT AI NEXUS</h1><p>Study materials, revision preparation and student support. Business chatbot beta. No payments collected.</p><div class="panel"><div class="bar">🤖 MFT Educational Assistant</div><div class="chat" id="chat" aria-live="polite"></div><div class="controls"><button data-v="1">Notes</button><button data-v="2">Predictions</button><button data-v="3">Past papers</button><button data-v="4">Marking schemes</button><button data-v="5">Support</button></div><form id="f"><input id="m" maxlength="1500" placeholder="Ask MFT a question..." aria-label="Your message" required><button id="b">Send</button></form></div><footer><div class="wm">MFT EDUCATION NEXUS</div><p>WhatsApp: <a href="https://wa.me/263781572008">0781572008</a> · Independent educational support, not affiliated with ZIMSEC.</p></footer></main><script>const c=document.getElementById("chat"),m=document.getElementById("m"),b=document.getElementById("b");function add(s,cl){let el=document.createElement("div");el.className="bubble "+cl;el.textContent=s;c.append(el);c.scrollTop=c.scrollHeight}async function ask(s){s=s.trim();if(!s)return;add(s,"mine");m.value="";b.disabled=true;try{const r=await fetch("/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:s})});const d=await r.json();add(d.reply||d.error||"Unavailable","")}catch{add("Connection unavailable. WhatsApp 0781572008","")}finally{b.disabled=false}}document.getElementById("f").addEventListener("submit",e=>{e.preventDefault();ask(m.value)});document.querySelectorAll("[data-v]").forEach(el=>el.addEventListener("click",()=>ask(el.dataset.v)));add("Welcome! Type Hi or select an option. WhatsApp: 0781572008","")</script></body></html>';
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export async function signed(raw,signature,secret){
  if(!secret||!/^sha256=[a-f0-9]{64}$/i.test(signature||''))return false;
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(raw)));
  let bad=0;for(let i=0;i<bytes.length;i++)bad|=bytes[i]^parseInt(signature.slice(7+i*2,9+i*2),16);
  return bad===0;
}
async function sendWhatsApp(env,to,body){
  if(!env.WHATSAPP_ACCESS_TOKEN||!env.WHATSAPP_PHONE_NUMBER_ID)return;
  const v=/^v\d+\.\d+$/.test(env.GRAPH_API_VERSION||'')?env.GRAPH_API_VERSION:'v23.0';
  const url='https://graph.facebook.com/'+v+'/'+encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)+'/messages';
  const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:body.slice(0,3800)}})});
  if(!r.ok)console.error('WhatsApp send status',r.status);
}
async function receiveWhatsApp(obj,env){
  if(obj?.object!=='whatsapp_business_account')return;
  for(const entry of obj.entry||[])for(const change of entry.changes||[])for(const msg of change.value?.messages||[]){
    if(msg?.type!=='text'||typeof msg.text?.body!=='string'||typeof msg.from!=='string')continue;
    if(env.DEDUPE&&msg.id){if(await env.DEDUPE.get(msg.id))continue;await env.DEDUPE.put(msg.id,'1',{expirationTtl:86400});}
    await sendWhatsApp(env,msg.from,await smartAnswer(msg.text.body,env));
  }
}

export class MftAiDailyQuota {
  constructor(state,env){this.state=state;this.env=env;}
  async fetch(req){
    if(new URL(req.url).pathname!=='/claim')return new Response('Not found',{status:404});
    try{
      const sql=this.state.storage.sql;
      sql.exec('CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, used INTEGER NOT NULL)');
      const today=new Date().toISOString().slice(0,10);
      const rows=[...sql.exec('INSERT INTO daily(day,used) VALUES (?1,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<20 RETURNING used',today)];
      return json({allowed:rows.length===1,used:rows[0]?.used||20});
    }catch{return json({allowed:false},503);}
  }
}
export async function smartAnswer(message,env={}){
  const text=String(message||'').trim().slice(0,1500),lower=text.toLowerCase();
  if(env.ENABLE_BUSINESS_AI!=='true'||!env.AI||!env.AI_BUDGET||text.length<6||text.length>500||
     /^(hi|hello|hey|help|menu|start|[0-5])$/i.test(text)||
     /\b(price|cost|buy|purchase|pay|payment|how much|ecocash|predict|guarantee)\b/.test(lower)||
     !/(mft|zimsec|a.level|alevel|upper|lower|study|notes|paper|exam|chemistry|physics|math|biology|geography|business|marking)/.test(lower))return answer(text);
  try{
    const budget=env.AI_BUDGET.get(env.AI_BUDGET.idFromName('mft-education-nexus-global'));
    const claim=await budget.fetch('https://internal/claim');
    const grant=await claim.json();
    if(!claim.ok||grant.allowed!==true)return answer(text);
    const instruction='You are a business-specific customer-service chatbot for MFT EDUCATION NEXUS, an independent Zimbabwean A-Level study-materials provider (not ZIMSEC). Assist only with enquiries about ZIMSEC-oriented study notes, past examination papers, revision predictions, marking schemes and contacting MFT. Do not offer general AI tutoring. Never invent availability, prices, payment instructions, delivery guarantees, exam questions or examination affiliation. If unknown, request subject and level and refer customers to WhatsApp 0781572008. Keep answer concise and clear.';
    const response=await env.AI.run(env.AI_MODEL||'@cf/zai-org/glm-4.7-flash',{model:env.AI_MODEL||'@cf/zai-org/glm-4.7-flash',messages:[{role:'system',content:instruction},{role:'user',content:text}],max_completion_tokens:1024,temperature:0});
    const content=response?.response||response?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||content.trim().length<18)return answer(text);
    return content.trim().slice(0,1500)+FOOTER;
  }catch{return answer(text);}
}

export default {async fetch(req,env={},ctx={waitUntil(){}}){
  const u=new URL(req.url);
  if(req.method==='GET'&&u.pathname==='/')return new Response(PAGE,{headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'",'x-content-type-options':'nosniff'}});
  if(req.method==='GET'&&u.pathname==='/health')return json({status:'ok',service:'MFT EDUCATION NEXUS',businessAI:env.ENABLE_BUSINESS_AI==='true'&&Boolean(env.AI)&&Boolean(env.AI_BUDGET),whatsappReady:Boolean(env.WHATSAPP_APP_SECRET&&env.WHATSAPP_VERIFY_TOKEN&&env.WHATSAPP_PHONE_NUMBER_ID&&env.WHATSAPP_ACCESS_TOKEN)});
  if(req.method==='POST'&&u.pathname==='/api/chat'){
    const raw=await req.text();if(raw.length>12000)return json({error:'Request too long'},413);
    let data;try{data=JSON.parse(raw)}catch{return json({error:'Invalid JSON'},400)}
    if(typeof data?.message!=='string'||data.message.length>1500)return json({error:'Message must have 1500 or fewer characters'},400);
    if(data.mode==='tutor')return json({reply:'AI web tutoring is not publicly enabled. WhatsApp: 0781572008'});
    return json({reply:await smartAnswer(data.message,env)});
  }
  if(req.method==='GET'&&u.pathname==='/webhook'){
    const ok=env.WHATSAPP_VERIFY_TOKEN&&u.searchParams.get('hub.mode')==='subscribe'&&u.searchParams.get('hub.verify_token')===env.WHATSAPP_VERIFY_TOKEN;
    return new Response(ok?u.searchParams.get('hub.challenge')||'':'Forbidden',{status:ok?200:403});
  }
  if(req.method==='POST'&&u.pathname==='/webhook'){
    const raw=await req.text();if(raw.length>1000000)return new Response('Too large',{status:413});
    if(!(await signed(raw,req.headers.get('x-hub-signature-256'),env.WHATSAPP_APP_SECRET)))return new Response('Unauthorized',{status:401});
    let obj;try{obj=JSON.parse(raw)}catch{return new Response('Invalid JSON',{status:400})}
    ctx.waitUntil(receiveWhatsApp(obj,env).catch(()=>console.error('WhatsApp webhook failure')));
    return new Response('EVENT_RECEIVED',{status:200});
  }
  return new Response('Not found',{status:404});
}};
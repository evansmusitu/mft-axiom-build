const ARTICLES=Object.freeze([
 Object.freeze({id:'recovery',title:'Protect and recover case access',summary:'Use a recovery code to protect a case with verified sign-in. A protected case can rotate a lost recovery code; an unprotected legacy case cannot be reset from a case ID alone.',keywords:['recovery','code','lost','protect','case','sign in'],public:true}),
 Object.freeze({id:'security',title:'Report a security issue safely',summary:'Open a security case without credentials, tokens, private keys or payment data. Sensitive actions require evidence and independent approval.',keywords:['security','vulnerability','incident','token','secret'],public:true}),
 Object.freeze({id:'results',title:'Challenge a quantitative result',summary:'Provide sanitized inputs, operation identity, expected result and reproducibility evidence. MUSITU Support preserves an auditable case thread.',keywords:['calculation','quantitative','result','evidence','reproduce'],public:true}),
 Object.freeze({id:'oauth',title:'OAuth and account access',summary:'For sign-in or OAuth failures, provide the public error, callback stage and sanitized request identifiers. Do not send authorization codes or tokens.',keywords:['oauth','login','sign in','account','callback'],public:true}),
 Object.freeze({id:'attachments',title:'Attach evidence safely',summary:'Only sanitized supported file types are accepted. Attachments remain unavailable to customers until the security scan marks them clean.',keywords:['attachment','file','logs','screenshot','pdf'],public:true}),
 Object.freeze({id:'status',title:'Service incidents and status',summary:'Public incident information is sourced from verified incident records. Response objectives are not contractual guarantees unless explicitly contracted.',keywords:['status','incident','outage','availability'],public:true}),
]);
const words=v=>String(v||'').toLowerCase().match(/[a-z0-9]+/g)||[];
export function searchKnowledge(query,{limit=5}={}){
 const q=words(query);if(!q.length)return Object.freeze([]);
 const scored=ARTICLES.map(a=>{const hay=words([a.title,a.summary,...a.keywords].join(' '));let score=0;for(const token of q){if(a.keywords.includes(token))score+=5;score+=hay.filter(x=>x===token).length;}return {a,score};}).filter(x=>x.score>0).sort((x,y)=>y.score-x.score||x.a.title.localeCompare(y.a.title)).slice(0,Math.max(1,Math.min(10,Number(limit)||5))).map(x=>x.a);
 return Object.freeze(scored);
}
export const KNOWLEDGE_ARTICLES=ARTICLES;

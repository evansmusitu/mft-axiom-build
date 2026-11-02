/** Deliberately synthetic GitHub boundary for offline contract tests, not provider evidence. */
import {createHash} from 'node:crypto';
export function githubFixture(namespace='ax-offline'){
  const pin={repository:'fixture/qualification',repository_id:123,namespace,target_commitish:'d'.repeat(40)};
  const token='synthetic_github_write_credential'.repeat(20),readToken='synthetic_github_read_credential'.repeat(20);
  const releases=new Map(),used=new Set(),tags=new Map();let next=100,calls=0,dropPublish=false,partition=false;
  const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  const fetchImpl=async(input,init)=>{
    calls++;const req=typeof input==='string'||input instanceof URL?new Request(input,init):input,url=new URL(req.url),root='/repos/'+pin.repository;
    if(partition)throw Error('synthetic partition');
    if(!['https://api.github.com','https://uploads.github.com'].includes(url.origin)||!url.pathname.startsWith(root))throw Error('unexpected outbound request');
    const credential=req.headers.get('authorization');
    if(credential!=='Bearer '+token&&!(credential==='Bearer '+readToken&&req.method==='GET'))return reply(403,{message:'denied'});
    if(req.method==='GET'&&url.pathname===root)return reply(200,{id:pin.repository_id,full_name:pin.repository,private:true,archived:false});
    if(req.method==='GET'&&url.pathname.startsWith(root+'/git/ref/tags/')){const tag=url.pathname.slice((root+'/git/ref/tags/').length);return tags.has(tag)?reply(200,{ref:'refs/tags/'+tag,object:{type:'commit',sha:tags.get(tag)}}):reply(404,{message:'missing'});}
    if(req.method==='POST'&&url.pathname===root+'/releases'){
      const body=await req.json(),r={...body,id:next++,immutable:false,assets:[]};releases.set(r.id,r);return reply(201,r);
    }
    const match=url.pathname.match(/\/releases\/(\d+)(\/assets)?$/),r=match?releases.get(Number(match[1])):null;
    if(!r)return reply(404,{message:'missing'});
    if(req.method==='GET')return reply(200,r);
    if(req.method==='POST'&&match[2]){
      const bytes=await req.text(),a={id:next++,name:url.searchParams.get('name'),state:'uploaded',size:Buffer.byteLength(bytes),digest:'sha256:'+createHash('sha256').update(bytes).digest('hex')};r.assets.push(a);return reply(201,a);
    }
    if(req.method==='PATCH'){
      if(used.has(r.tag_name))return reply(422,{message:'tag_name was used by an immutable release'});
      used.add(r.tag_name);r.draft=false;r.immutable=true;tags.set(r.tag_name,r.target_commitish);
      if(dropPublish){dropPublish=false;throw Error('synthetic lost publication acknowledgement');}
      return reply(200,r);
    }
    throw Error('unexpected fixture operation');
  };
  return {pin,token,readToken,fetchImpl,releases,tags,get calls(){return calls;},dropNextPublish(){dropPublish=true;},partition(value=true){partition=value;}};
}

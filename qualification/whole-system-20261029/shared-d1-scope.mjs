/** Qualification-only table namespace inside an owner-selected staging DB.
 * This is not a separately isolated database or an independent authority. */
export const SHARED_SCOPE='OWNER_SELECTED_STAGING_TABLE_NAMESPACE';
const fail=()=>{throw new DOMException('shared acceptance SQL outside owned namespace','NotAllowedError');};
function tokens(sql){
  const result=[];let i=0;
  while(i<sql.length){
    if(/\s/.test(sql[i])){i++;continue;}
    if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
    if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);if(end<0)fail();i=end+2;continue;}
    const quote=sql[i];
    if(["'",'"','`','['].includes(quote)){
      const close=quote==='['?']':quote;let value='',ended=false;i++;
      for(;i<sql.length;i++){if(sql[i]===close){if(close!==']'&&sql[i+1]===close){value+=close;i++;}else{i++;ended=true;break;}}else value+=sql[i];}
      if(!ended)fail();result.push({type:quote==="'"?'string':'id',value:value.toLowerCase()});continue;
    }
    const match=/^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i));
    if(match){result.push({type:'id',value:match[0].toLowerCase()});i+=match[0].length;}
    else result.push({type:'punct',value:sql[i++]});
  }
  return result;
}
export function sharedSql(sql,{prefix,legacyTables=[]}={}){
  if(!/^axiom_q[0-9]{2}_$/.test(prefix)||typeof sql!=='string'||sql.length>262144)fail();
  if(!Array.isArray(legacyTables)||legacyTables.length>1000||legacyTables.some(x=>typeof x!=='string'))fail();
  const rewritten=sql.replace(/\baxiom_(?:ec|lc|acceptance)_[A-Za-z0-9_]+\b/gi,name=>prefix+name.toLowerCase()),ts=tokens(rewritten),legacy=new Set(legacyTables.map(x=>x.toLowerCase()));
  const owned=name=>new RegExp('^'+prefix+'axiom_(?:ec|lc|acceptance)_[a-z0-9_]+$').test(name);
  const target=(index,{read=false}={})=>{
    const t=ts[index];if(!t)fail();if(read&&t.value==='(')return;
    if(!['id','string'].includes(t.type)||ts[index+1]?.value==='.')fail();
    if(read&&['sqlite_master','sqlite_schema','json_each'].includes(t.value))return;
    if(!owned(t.value))fail();
  };
  for(let i=0;i<ts.length;i++){
    const t=ts[i];if(t.type!=='id')continue;
    if(legacy.has(t.value))fail();
    if(['attach','detach','drop','alter','vacuum','reindex','virtual','load_extension','eval','with','temporary','temp'].includes(t.value))fail();
    if(t.value==='pragma'){
      const p=ts[i+1]?.value;
      if(p==='foreign_keys'){
        if(ts[i+2]?.value!=='='||ts[i+3]?.value!=='on'||![';',undefined].includes(ts[i+4]?.value))fail();
      }else if(p==='table_info'){
        if(ts[i+2]?.value!=='('||ts[i+4]?.value!==')')fail();target(i+3);
      }else fail();
    }
    if(['from','join','references'].includes(t.value))target(i+1,{read:true});
    if(t.value==='into')target(i+1);
    if(t.value==='update'&&ts[i-1]?.value!=='do'&&!(ts[i+1]?.value==='on'&&['before','after'].includes(ts[i-1]?.value))){
      let at=i+1;if(ts[at]?.value==='or')at+=2;target(at);
    }
    if(t.value==='create'){
      let at=i+1;if(ts[at]?.value==='unique')at++;
      const kind=ts[at++]?.value;if(!['table','index','trigger'].includes(kind))fail();
      if(ts[at]?.value==='if'){if(ts[at+1]?.value!=='not'||ts[at+2]?.value!=='exists')fail();at+=3;}
      target(at);
      if(kind!=='table'){
        const on=ts.findIndex((x,k)=>k>at&&x.type==='id'&&x.value==='on');if(on<0)fail();target(on+1);
      }
    }
  }
  return rewritten;
}
export function createSharedD1Scope(db,{prefix,databaseId,legacyTables}={}){
  if(!db?.prepare||!db?.batch||!db?.exec||!/^[a-f0-9-]{36}$/.test(databaseId??''))fail();
  sharedSql('SELECT 1',{prefix,legacyTables});const states=new WeakMap();
  const wrap=raw=>{const statement=Object.freeze({bind(...args){return wrap(raw.bind(...args));},first(column){return raw.first(column);},all(){return raw.all();},run(){return raw.run();}});states.set(statement,raw);return statement;};
  return Object.freeze({acceptance_scope:SHARED_SCOPE,namespace:prefix,database_id:databaseId,
    prepare(sql){return wrap(db.prepare(sharedSql(sql,{prefix,legacyTables})));},
    exec(sql){return db.exec(sharedSql(sql,{prefix,legacyTables}));},
    batch(statements){return db.batch(statements.map(s=>{if(!states.has(s))fail();return states.get(s);}));},
  });
}

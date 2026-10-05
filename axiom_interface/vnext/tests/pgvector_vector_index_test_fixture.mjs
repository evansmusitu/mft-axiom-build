export function fakePool({record=null,idempotency=null,searchRows=[],config=null,extensionVersion='0.8.6'}={}){
  const calls=[]; let configState=config;
  const client={
    async query(text,params=[]){
      const sql=String(text).replace(/\s+/g,' ').trim(); calls.push({sql,params:structuredClone(params)});
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[],rowCount:0};
      if(sql.includes("FROM pg_extension WHERE extname='vector'")) return {rows:extensionVersion===null?[]:[{extversion:extensionVersion}],rowCount:extensionVersion===null?0:1};
      if(sql.startsWith('INSERT INTO axiom_pi.vector_index_configs')){if(!configState) configState={metric:params[3],dimension:params[4]}; return {rows:[structuredClone(configState)],rowCount:1};}
      if(sql.includes('FROM axiom_pi.vector_index_configs')) return {rows:configState?[structuredClone(configState)]:[],rowCount:configState?1:0};
      if(sql.includes('FROM axiom_pi.vector_write_requests')) return {rows:idempotency?[idempotency]:[],rowCount:idempotency?1:0};
      if(sql.includes('FROM axiom_pi.vector_entries')&&sql.includes('FOR UPDATE')) return {rows:record?[record]:[],rowCount:record?1:0};
      if(sql.includes('FROM axiom_pi.vector_entries')&&(sql.includes('ORDER BY embedding')||sql.includes('ORDER BY record_id'))) return {rows:searchRows,rowCount:searchRows.length};
      return {rows:[],rowCount:1};
    },
    release(){calls.push({sql:'RELEASE',params:[]});},
  };
  return {pool:{async connect(){calls.push({sql:'CONNECT',params:[]}); return client;}},calls};
}
export const scope={projectId:'project_12345678',workId:'work_12345678',indexId:'index_product_knowledge'};
export const vector=[0.1,0.2,0.3];

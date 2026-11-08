/** Split migration statements without splitting quoted/dollar-quoted bodies. */
export function sqlStatements(s){
 let out=[],start=0,mode='',dollar='';
 for(let i=0;i<s.length;i++){
  const c=s[i],n=s[i+1];
  if(mode==='line'){if(c==='\n')mode='';continue;}
  if(mode==='block'){if(c==='*'&&n==='/'){mode='';i++;}continue;}
  if(mode==='quote'){if(c==="'"){if(n==="'")i++;else mode='';}continue;}
  if(mode==='double'){if(c==='"'){if(n==='"')i++;else mode='';}continue;}
  if(mode==='dollar'){if(s.slice(i,i+dollar.length)===dollar){i+=dollar.length-1;mode='';}continue;}
  if(c==='-'&&n==='-'){mode='line';i++;continue;}
  if(c==='/'&&n==='*'){mode='block';i++;continue;}
  if(c==="'"){mode='quote';continue;}if(c==='"'){mode='double';continue;}
  if(c==='$'){const m=s.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);if(m){dollar=m[0];mode='dollar';i+=dollar.length-1;continue;}}
  if(c===';'){const part=s.slice(start,i+1),clean=part.replace(/--[^\n]*(?:\n|$)/g,'').trim();if(clean&&!/^(BEGIN|COMMIT);$/i.test(clean))out.push(part);start=i+1;}
 }
 return out;
}

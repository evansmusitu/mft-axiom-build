/** Offline-only CPU 3D preview of the strict MUSITU Blender declarative scene.
 * No API calls, remote assets, WebGPU, eval, shaders, arbitrary scripts or server rendering.
 * The backend validateScene remains authoritative when jobs are submitted.
 */
const types=new Set(['cube','cylinder','sphere']);
const materials=Object.freeze({
  teal:[41,202,181], copper:[207,124,83], ivory:[222,229,217],
  graphite:[74,91,116], blueglass:[94,164,218], rubber:[55,70,84], wood:[168,129,91]
});
const id=/^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const keySet=(o,needed,extra=[])=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  needed.every(x=>Object.hasOwn(o,x))&&Object.keys(o).every(x=>needed.includes(x)||extra.includes(x));
const finite=(x,a,b)=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
const vec=(v,a,b,positive=false)=>Array.isArray(v)&&v.length===3&&
  v.every(x=>finite(x,a,b)&&(!positive||x>0));
export function parsePreviewScene(input){
  if(typeof input!=='string'||input.length>65536)throw Error('SCENE_PREVIEW_TOO_LARGE');
  let job;try{job=JSON.parse(input)}catch{throw Error('SCENE_PREVIEW_INVALID_JSON')}
  if(!keySet(job,['schema','job_id','objects'],['animations','frame_end'])||
      job.schema!=='musitu.blender.job.v1'||!id.test(job.job_id)||
      !Array.isArray(job.objects)||job.objects.length<1||job.objects.length>30)
    throw Error('SCENE_PREVIEW_INVALID_SCHEMA');
  const names=new Set();
  for(const o of job.objects){
    if(!keySet(o,['name','type','location','dimensions','material'])||!id.test(o.name)||
       names.has(o.name)||!types.has(o.type)||!Object.hasOwn(materials,o.material)||
       !vec(o.location,-20,20)||!vec(o.dimensions,0,12,true))
      throw Error('SCENE_PREVIEW_INVALID_OBJECT');
    names.add(o.name);
  }
  const end=job.frame_end??24;
  if(!Number.isInteger(end)||end<2||end>120||!Array.isArray(job.animations??[])||
     (job.animations??[]).length>16)throw Error('SCENE_PREVIEW_INVALID_TIMELINE');
  const seen=new Set();
  for(const a of job.animations??[]){
    if(!keySet(a,['object','axis','degrees','start','end'])||!names.has(a.object)||
       !['X','Y','Z'].includes(a.axis)||seen.has(a.object+':'+a.axis)||
       !finite(a.degrees,-720,720)||!Number.isInteger(a.start)||
       !Number.isInteger(a.end)||a.start<1||a.start>=a.end||a.end>end)
       throw Error('SCENE_PREVIEW_INVALID_ANIMATION');
    seen.add(a.object+':'+a.axis);
  }
  return job;
}
/** Pure, backend-compatible track operations. Invalid edits cannot escape into the scene. */
export function setRotationTrack(scene,track){
  const source=parsePreviewScene(JSON.stringify(scene));
  if(!track||typeof track!=='object')throw Error('TRACK_INVALID');
  const next=structuredClone(source);
  const candidate={object:track.object,axis:track.axis,degrees:track.degrees,
    start:track.start,end:track.end};
  const index=(next.animations??[]).findIndex(a=>a.object===candidate.object&&a.axis===candidate.axis);
  next.animations??=[];
  if(index<0)next.animations.push(candidate);
  else next.animations[index]=candidate;
  return parsePreviewScene(JSON.stringify(next));
}
export function removeRotationTrack(scene,{object,axis}={}){
  const source=parsePreviewScene(JSON.stringify(scene));
  const next=structuredClone(source);
  const before=next.animations?.length??0;
  next.animations=(next.animations??[]).filter(a=>!(a.object===object&&a.axis===axis));
  if(next.animations.length===before)throw Error('TRACK_NOT_FOUND');
  return parsePreviewScene(JSON.stringify(next));
}
/** Bounded browser-only snapshot history: never stores local secrets or server data. */
export function createSceneHistory(initial,capacity=25){
  if(!Number.isInteger(capacity)||capacity<2||capacity>50)throw Error('HISTORY_CAPACITY_INVALID');
  const snapshot=scene=>JSON.stringify(parsePreviewScene(JSON.stringify(scene)));
  let list=[snapshot(initial)],index=0;
  return {
    current(){return JSON.parse(list[index])},
    get canUndo(){return index>0},
    get canRedo(){return index<list.length-1},
    push(scene){
      const value=snapshot(scene);
      if(value===list[index])return false;
      list=list.slice(0,index+1);list.push(value);
      if(list.length>capacity)list.shift();
      index=list.length-1;return true;
    },
    undo(){if(index>0)index--;return JSON.parse(list[index])},
    redo(){if(index<list.length-1)index++;return JSON.parse(list[index])},
  };
}
export function poseAtFrame(scene,frame){
  const f=Math.max(1,Math.min(scene.frame_end??24,Number(frame)||1));
  return scene.objects.map(o=>{
    const rotations={X:0,Y:0,Z:0};
    for(const a of scene.animations??[]){if(a.object!==o.name)continue;
      const factor=Math.min(1,Math.max(0,(f-a.start)/(a.end-a.start)));
      rotations[a.axis]=a.degrees*factor*Math.PI/180;
    }
    return {...o,rotations};
  });
}
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(v,a)=>[v[0]*a,v[1]*a,v[2]*a];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v)=>{const n=Math.hypot(...v)||1;return mul(v,1/n)};
function rotate(v,{X=0,Y=0,Z=0}={}){
  let [x,y,z]=v;
  const cx=Math.cos(X),sx=Math.sin(X),cy=Math.cos(Y),sy=Math.sin(Y),cz=Math.cos(Z),sz=Math.sin(Z);
  [y,z]=[y*cx-z*sx,y*sx+z*cx];[x,z]=[x*cy+z*sy,-x*sy+z*cy];
  return [x*cz-y*sz,x*sz+y*cz,z];
}
export function previewCamera({yaw=.84,pitch=.48,distance=19,target=[0,0,1]}={}){
  const clamped=Math.max(.15,Math.min(1.4,pitch));
  const eye=add(target,[distance*Math.cos(yaw)*Math.cos(clamped),
    distance*Math.sin(yaw)*Math.cos(clamped),distance*Math.sin(clamped)]);
  const forward=norm(sub(target,eye)),right=norm(cross(forward,[0,0,1]));
  const up=norm(cross(right,forward));
  return {eye,forward,right,up,distance};
}
export function projectPreviewPoint(point,camera,width=800,height=480){
  const offset=sub(point,camera.eye),depth=dot(offset,camera.forward);
  if(depth<=.05)return null;
  const focal=Math.min(width/1.7,height/1.1);
  return {x:width/2+dot(offset,camera.right)*focal/depth,
    y:height/2-dot(offset,camera.up)*focal/depth,depth};
}
function vertices(type){
  if(type==='cube'){
    const a=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
      [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]];
    return [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
      [1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].map(face=>face.map(i=>a[i]));
  }
  const faces=[],N=type==='sphere'?16:16;
  if(type==='cylinder'){
    for(let i=0;i<N;i++){
      const a=i*2*Math.PI/N,b=(i+1)*2*Math.PI/N;
      const r=x=>[Math.cos(x)*.5,Math.sin(x)*.5];
      const u=r(a),v=r(b),bottom=[u[0],u[1],-.5],next=[v[0],v[1],-.5],
        top=[u[0],u[1],.5],topNext=[v[0],v[1],.5];
      faces.push([bottom,next,topNext],[bottom,topNext,top],[[0,0,.5],top,topNext],
        [[0,0,-.5],next,bottom]);
    }
    return faces;
  }
  const LAT=10;
  for(let l=0;l<LAT;l++)for(let i=0;i<N;i++){
    const theta=l*Math.PI/LAT,theta2=(l+1)*Math.PI/LAT;
    const a=i*2*Math.PI/N,b=(i+1)*2*Math.PI/N;
    const p=(t,u)=>[Math.sin(t)*Math.cos(u)*.5,Math.sin(t)*Math.sin(u)*.5,Math.cos(t)*.5];
    if(l>0)faces.push([p(theta,a),p(theta2,a),p(theta,b)]);
    if(l<LAT-1)faces.push([p(theta,b),p(theta2,a),p(theta2,b)]);
  }
  return faces;
}
const baseMeshes=Object.fromEntries(['cube','cylinder','sphere'].map(x=>[x,vertices(x)]));
export function previewMeshTriangles(object){
  if(!types.has(object?.type)||!vec(object.dimensions,0,12,true)||
    !vec(object.location,-20,20))throw Error('SCENE_PREVIEW_INVALID_MESH');
  const triangles=[];
  for(const triangle of baseMeshes[object.type]){
    triangles.push(triangle.map(vertex=>add(rotate([
      vertex[0]*object.dimensions[0],vertex[1]*object.dimensions[1],
      vertex[2]*object.dimensions[2]],object.rotations),object.location)));
  }
  return triangles;
}
function draw(ctx,scene,camera,frame,selected){
  const {width:w,height:h}=ctx.canvas;
  ctx.clearRect(0,0,w,h);
  const grad=ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,'#0c1d35');grad.addColorStop(1,'#050c17');
  ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
  const line=(a,b,color,width=1)=>{
    const p=projectPreviewPoint(a,camera,w,h),q=projectPreviewPoint(b,camera,w,h);
    if(!p||!q)return;
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
    ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  };
  for(let i=-10;i<=10;i++){
    line([i,-10,0],[i,10,0],i===0?'#257c85':'#19394a',i===0?2:1);
    line([-10,i,0],[10,i,0],i===0?'#ad6b5a':'#19394a',i===0?2:1);
  }
  line([0,0,0],[0,0,3],'#85a8fc',2);
  const triangles=[];
  for(const o of poseAtFrame(scene,frame)){
    const color=materials[o.material];
    for(const vertices of previewMeshTriangles(o)){
      const pts=vertices.map(v=>projectPreviewPoint(v,camera,w,h));
      if(pts.some(v=>!v))continue;
      const normal=norm(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])));
      const center=mul(add(add(vertices[0],vertices[1]),vertices[2]),1/3);
      if(dot(normal,sub(camera.eye,center))<=0)continue;
      const brightness=Math.max(.25,Math.min(1, .47+.53*dot(normal,norm([.35,-.45,1]))));
      triangles.push({points:pts,depth:pts.reduce((a,p)=>a+p.depth,0)/3,
        fill:`rgb(${color.map(n=>Math.round(n*brightness)).join(',')})`,
        isSelected:selected===o.name});
    }
  }
  triangles.sort((a,b)=>b.depth-a.depth);
  for(const t of triangles){
    ctx.beginPath();ctx.moveTo(t.points[0].x,t.points[0].y);
    for(const p of t.points.slice(1))ctx.lineTo(p.x,p.y);
    ctx.closePath();ctx.fillStyle=t.fill;ctx.fill();
    ctx.strokeStyle=t.isSelected?'rgba(164,251,226,.32)':'rgba(12,22,36,.25)';
    ctx.lineWidth=t.isSelected?1.4:.6;ctx.stroke();
  }
  const a=projectPreviewPoint([0,0,0],camera,w,h);
  if(a){ctx.fillStyle='#a8c1d7';ctx.font=`${Math.max(12,w*.018)}px system-ui`;
    ctx.fillText('0,0,0',a.x+9,a.y+16)}
}
function initScenePreview(){
  const canvas=document.getElementById('scene-preview-canvas');
  const textarea=document.getElementById('scene');
  const status=document.getElementById('scene-preview-status');
  const select=document.getElementById('scene-object-select');
  const timeline=document.getElementById('scene-frame');
  const frameLabel=document.getElementById('scene-frame-label');
  if(!canvas||!textarea||!status||!select||!timeline||!frameLabel)return;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx){status.textContent='This browser cannot display a local 3D preview.';return}
  let current=null,selected='',yaw=.84,pitch=.48,distance=13,play=false,history=null;
  const pointers=new Map();let touchedAt=0,raf=0,interval=null;
  const report=s=>{status.textContent=s};
  function refreshSelect(){
    const old=selected;select.replaceChildren();
    for(const o of current.objects)select.append(new Option(o.name,o.name));
    selected=current.objects.some(o=>o.name===old)?old:current.objects[0].name;
    select.value=selected;
    const obj=current.objects.find(o=>o.name===selected);
    for(const [i,axis]of ['x','y','z'].entries())document.getElementById('scene-pos-'+axis).value=obj.location[i];
    document.getElementById('scene-material').value=obj.material;
    refreshTrackFields();
  }
  function refreshTrackFields(){
    if(!current||!selected)return;
    const axis=document.getElementById('scene-track-axis').value;
    const track=(current.animations??[]).find(a=>a.object===selected&&a.axis===axis);
    document.getElementById('scene-track-degrees').value=track?.degrees??90;
    document.getElementById('scene-track-start').value=track?.start??1;
    document.getElementById('scene-track-end').value=track?.end??(current.frame_end??24);
    document.getElementById('scene-track-remove').disabled=!track;
    document.getElementById('scene-track-caption').textContent=track?
      `Rotation ${axis}: ${track.degrees}° from frame ${track.start} to ${track.end}`:
      `No ${axis} rotation track for ${selected}.`;
  }
  function refreshHistoryButtons(){
    document.getElementById('scene-undo').disabled=!history?.canUndo;
    document.getElementById('scene-redo').disabled=!history?.canRedo;
  }
  function canvasSize(){
    const rect=canvas.getBoundingClientRect();
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(300,Math.round(rect.width*ratio)),h=Math.max(190,Math.round(rect.height*ratio));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  }
  function paint(){raf=0;canvasSize();if(!current)return;
    draw(ctx,current,previewCamera({yaw,pitch,distance}),Number(timeline.value),selected)}
  function requestPaint(){if(!raf)raf=requestAnimationFrame(paint)}
  function reload(){
    try{
      current=parsePreviewScene(textarea.value);
      if(!history)history=createSceneHistory(current);
      else history.push(current);
      refreshHistoryButtons();
      timeline.max=String(current.frame_end??24);
      timeline.value=String(Math.min(Number(timeline.value),Number(timeline.max)));
      frameLabel.textContent=timeline.value+' / '+timeline.max;
      refreshSelect();requestPaint();
      report(current.objects.length+' primitive'+(current.objects.length===1?'':'s')+
        ' · Local 3D viewport · No server/GPU rendering or charges.');
      return true;
    }catch(error){current=null;selected='';select.replaceChildren();
      ctx.clearRect(0,0,canvas.width,canvas.height);
      report('Invalid scene: '+error.message+'. Nothing was submitted.');return false}
  }
  let timer=null;
  textarea.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(reload,260)});
  document.getElementById('preview-refresh').onclick=reload;
  document.getElementById('preview-reset').onclick=()=>{yaw=.84;pitch=.48;distance=13;timeline.value='1';frameLabel.textContent='1 / '+timeline.max;requestPaint()};
  select.onchange=()=>{selected=select.value;refreshSelect();requestPaint()};
  document.getElementById('scene-track-axis').onchange=refreshTrackFields;
  function readTrack(){
    const num=id=>{
      const input=document.getElementById(id);
      if(!input.value.trim())throw Error('Rotation values must not be empty');
      return Number(input.value);
    };
    return {object:selected,axis:document.getElementById('scene-track-axis').value,
      degrees:num('scene-track-degrees'),start:num('scene-track-start'),end:num('scene-track-end')};
  }
  document.getElementById('scene-track-set').onclick=()=>applyMutation(s=>{
    Object.assign(s,setRotationTrack(s,readTrack()));
  });
  document.getElementById('scene-track-remove').onclick=()=>applyMutation(s=>{
    const {object,axis}=readTrack();Object.assign(s,removeRotationTrack(s,{object,axis}));
  });
  function recall(next){
    const saved=history;
    textarea.value=JSON.stringify(next,null,2);
    history=null; // Do not record an undo/redo operation as a new state.
    reload();
    history=saved;
    refreshHistoryButtons();
  }
  for(const [button,method] of [['scene-undo','undo'],['scene-redo','redo']]){
    document.getElementById(button).onclick=()=>{
      if(!history||(method==='undo'&&!history.canUndo)||(method==='redo'&&!history.canRedo))return;
      recall(history[method]());
    };
  }
  timeline.oninput=()=>{frameLabel.textContent=timeline.value+' / '+timeline.max;requestPaint()};
  document.getElementById('preview-play').onclick=(event)=>{
    play=!play;event.currentTarget.textContent=play?'Pause animation':'Play animation';
    if(interval)clearInterval(interval);
    if(play)interval=setInterval(()=>{
      if(!current||document.hidden)return;
      timeline.value=String(Number(timeline.value)>=Number(timeline.max)?1:Number(timeline.value)+1);
      frameLabel.textContent=timeline.value+' / '+timeline.max;requestPaint();
    },125);
  };
  const applyMutation=mutate=>{
    if(!current&&!reload())return;
    const cloned=JSON.parse(JSON.stringify(current));
    try{mutate(cloned);const encoded=JSON.stringify(cloned,null,2);
      parsePreviewScene(encoded);textarea.value=encoded;reload()}
    catch(e){report('Scene was not changed: '+e.message)}
  };
  document.querySelectorAll('[data-add-primitive]').forEach(button=>{
    button.onclick=()=>applyMutation(s=>{
      if(s.objects.length>=30)throw Error('Maximum of 30 objects');
      const kind=button.dataset.addPrimitive;
      if(!types.has(kind))throw Error('Unsupported primitive');
      let n=1;while(s.objects.some(o=>o.name===kind[0].toUpperCase()+kind.slice(1)+n))n++;
      const name=kind[0].toUpperCase()+kind.slice(1)+n;
      s.objects.push({name,type:kind,location:[0,0,1],
        dimensions:kind==='cube'?[1.5,1.5,1.5]:[1.8,1.8,1.8],material:'teal'});
      selected=name;
    });
  });
  document.getElementById('scene-apply-inspector').onclick=()=>applyMutation(s=>{
    const o=s.objects.find(o=>o.name===selected);
    if(!o)throw Error('Select an object');
    const v=['x','y','z'].map(x=>Number(document.getElementById('scene-pos-'+x).value));
    if(!vec(v,-20,20))throw Error('Position must be between −20 and +20');
    o.location=v;o.material=document.getElementById('scene-material').value;
  });
  document.getElementById('scene-download-json').onclick=()=>{
    if(!current&&!reload())return;
    const url=URL.createObjectURL(new Blob([textarea.value],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='musitu-'+current.job_id+'.json';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),6000);
  };
  canvas.addEventListener('pointerdown',e=>{
    e.preventDefault();canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});touchedAt=Date.now();
  });
  canvas.addEventListener('pointermove',e=>{
    const p=pointers.get(e.pointerId);if(!p)return;
    e.preventDefault();const dx=e.clientX-p.x,dy=e.clientY-p.y;
    p.x=e.clientX;p.y=e.clientY;
    if(pointers.size===1){yaw-=dx*.008;pitch=Math.max(.15,Math.min(1.4,pitch+dy*.008))}
    else{const ps=[...pointers.values()];const size=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
      if(canvas._lastPinch>0)distance=Math.max(5,Math.min(60,distance*canvas._lastPinch/Math.max(1,size)));
      canvas._lastPinch=size;
    }
    requestPaint();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{
    pointers.delete(e.pointerId);if(pointers.size<2)canvas._lastPinch=0;
  });
  canvas.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(5,Math.min(60,distance*Math.exp(e.deltaY*.001)));requestPaint()},{passive:false});
  window.addEventListener('resize',requestPaint);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)requestPaint()});
  reload();
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initScenePreview);
  else initScenePreview();
}

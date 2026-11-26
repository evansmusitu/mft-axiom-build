"""THE LAST SIGNAL: original animated three-character lunar film. No render in build."""
import bpy,math,random,sys
from pathlib import Path
from mathutils import Vector
from math import sin,cos,pi
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build_awaken_2099 as studio
bpy.ops.wm.read_factory_settings(use_empty=True)
s=bpy.context.scene
rng=random.Random(261126)
def mat(name,c,metal=.4,rough=.35,emit=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
    return m
dark=mat('Carbon armor',(.035,.055,.09),.75)
ice=mat('Lunar ice',(.09,.15,.22),.4,.46)
silver=mat('Titanium',(.32,.38,.45),.8)
cyan=mat('Astra cyan',(.02,.65,1),.45,.2,3)
gold=mat('Kade amber',(1,.32,.015),.55,.24,2.7)
violet=mat('Mira ultraviolet',(.65,.08,1),.42,.2,3)
white=mat('Signal',(.3,.75,1),.25,.2,6)
def box(n,l,d,m,b=.06):return studio.cube(n,l,d,m,b)
def ball(n,l,r,m):return studio.sphere(n,l,r,m,20,12)
def ring(n,l,r,w,m,rot=(0,0,0)):return studio.ring(n,l,r,w,m,rot)
def empty(n,l=(0,0,0),p=None):
    o=bpy.data.objects.new(n,None);s.collection.objects.link(o);o.parent=p;o.location=l;return o
def parent(o,p):o.parent=p;return o
def limb(n,p,l,d,m):
    o=empty(n+' joint',l,p);parent(box(n,(0,0,-d[2]/2),d,m),o);return o
def character(n,accent,scale,kind):
    root=empty(n);root.scale=(scale,)*3
    parent(box(n+' chest',(0,0,1.53),(.83,.49,.72),silver if kind==2 else dark,.13),root)
    parent(box(n+' reactor',(0,-.265,1.54),(.36,.065,.28),accent,.06),root)
    parent(box(n+' waist',(0,0,1.05),(.55,.38,.28),silver),root)
    head=empty(n+' head',(0,0,2.05),root)
    if kind==1:
        parent(box(n+' heavy helmet',(0,0,0),(.72,.56,.57),dark,.1),head)
        parent(box(n+' wide visor',(0,-.30,.01),(.55,.06,.17),accent,.03),head)
        parent(box(n+' tool pack',(0,.32,1.48),(.76,.38,.67),gold,.08),root)
    elif kind==2:
        parent(ball(n+' rounded helmet',(0,0,0),.33,silver),head)
        for x in [-.11,.11]:parent(box(n+' optic',(x,-.32,.02),(.11,.035,.09),accent,.02),head)
        parent(box(n+' antenna',(0,.08,.39),(.045,.045,.46),accent,.01),head)
    else:
        parent(box(n+' angular helmet',(0,0,0),(.56,.51,.55),dark,.14),head)
        parent(box(n+' T visor',(0,-.27,.05),(.46,.045,.12),accent,.02),head)
        parent(box(n+' visor stem',(0,-.28,-.05),(.08,.045,.15),accent,.02),head)
    joints=[]
    for sign in [-1,1]:
        a=limb(n+' arm '+str(sign),root,(sign*(.55 if kind==1 else .47),0,1.76),(.24,.27,.46),silver)
        parent(ball(n+' shoulder '+str(sign),(0,0,0),.19,accent),a)
        f=limb(n+' forearm '+str(sign),a,(0,0,-.44),(.24,.28,.43),dark)
        parent(box(n+' gauntlet '+str(sign),(0,-.07,-.39),(.22,.3,.19),accent,.04),f)
        l=limb(n+' thigh '+str(sign),root,(sign*.22,0,.97),(.29,.32,.44),dark)
        sh=limb(n+' shin '+str(sign),l,(0,0,-.42),(.25,.27,.42),silver)
        parent(box(n+' boot '+str(sign),(0,-.105,-.40),(.31,.49,.16),dark),sh)
        joints.append((a,f,l,sh))
    return root,head,joints
chars=[character('ASTRA',cyan,1.02,0),character('KADE',gold,1.19,1),character('MIRA',violet,.90,2)]
box('Relay platform',(0,0,-.27),(36,58,.5),ice,.12)
box('Moon surface',(0,25,-1.2),(220,220,1.4),ice,.05)
for x in [-7,7]:box('Runway strip',(x,-6,.03),(.13,30,.07),white,.01)
for i in range(95):
    x=rng.uniform(-75,75);y=rng.uniform(-45,95)
    if abs(x)<20 and -25<y<30:continue
    o=ball('Ice ridge %03d'%i,(x,y,-.1),rng.uniform(.9,5.4),ice);o.scale=(rng.uniform(.8,2),rng.uniform(.8,2),rng.uniform(.35,1.5))
box('Relay pedestal',(0,13,.25),(9,9,.5),dark)
box('Relay monolith',(0,13,5),(2.6,2.6,10),silver,.22)
for x in [-1.32,1.32]:box('Relay emitter',(x,11.65,5),(.10,.10,9),cyan,.01)
core=ball('Archive core',(0,13,7.2),1.3,white)
for j in range(3):
    o=ring('Gyroscope %d'%j,(0,13,7.2),2.2+j*.66,.075,[cyan,gold,violet][j],(pi/2,j*.44,0))
    for f in range(1,5401,180):
        o.rotation_euler.z=j+f*.006*(1 if j%2 else -1);o.keyframe_insert('rotation_euler',frame=f)
for j,x in enumerate([-3.1,0,3.1]):
    box('Archive console',(x,8,.7),(1.35,.95,1.4),dark,.12)
    box('Console interface',(x,7.49,1.21),(1.12,.08,.36),[cyan,gold,violet][j],.03)
for sign in [-1,1]:
    box('Antenna tower',(sign*6,14,5),(.42,.42,10),dark,.04)
    ring('Antenna dish',(sign*6,14,10),1.8,.11,silver,(pi/4,sign*.45,0))
box('Escape shuttle hull',(8,-19,1.2),(5,9,2.1),dark,.35)
box('Shuttle cockpit',(8,-21,2.15),(2.75,2.3,.48),cyan,.17)
ball('Ringed planet',(37,63,30),13,mat('Planet',(.16,.24,.4),.1,.7))
ring('Planet ring',(37,63,30),19,.16,mat('Planet rings',(.3,.46,.62),.2,.5),(pi*.30,.25,0))
for i in range(36):
    x=rng.uniform(-18,18);y=rng.uniform(-12,30);z=rng.uniform(5,19)
    p=ball('Ion particle %02d'%i,(x,y,z),rng.uniform(.025,.07),violet)
    p.keyframe_insert('location',frame=1);p.location.x+=rng.uniform(12,27);p.location.z-=4;p.keyframe_insert('location',frame=5400)
def light(n,l,p,c,size,target):
    d=bpy.data.lights.new(n,'AREA');d.energy=p;d.color=c;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(n,d);s.collection.objects.link(o);o.location=l;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return d
light('Moonlight',(-12,-8,18),3200,(.4,.65,1),12,(0,4,0))
light('Warm shuttle',(6,-10,9),2200,(1,.45,.16),9,(0,-2,0))
light('Relay rim',(0,18,11),3900,(.4,.6,1),8,(0,7,1))
storm=light('Storm flicker',(15,10,14),300,(.55,.08,1),8,(0,8,1))
for f,e in [(1,300),(1800,400),(2500,4500),(3200,1800),(3800,5000),(4500,450),(5400,200)]:
    storm.energy=e;storm.keyframe_insert('energy',frame=f)
w=bpy.data.worlds.new('Lunar sky');w.use_nodes=True;s.world=w
w.node_tree.nodes['Background'].inputs[0].default_value=(.014,.026,.065,1);w.node_tree.nodes['Background'].inputs[1].default_value=.35
beats=[
((-18,-12),(5,-25,4.8),(0,-15,1.4),'Arrival'),
((-12,-5),(-5,-10,2.8),(0,-8,1.5),'Three explorers'),
((-5,3),(5,-3,3.5),(0,0,2.3),'Signal'),
((3,6),(-5,3,2.5),(0,6,1.5),'Archive'),
((6,7),(3,2,3.3),(0,8,2.6),'Power loss'),
((7,6),(-6,7,4.5),(0,9,3.6),'Storm'),
((6,7),(4,4,2.3),(0,7,1.4),'Kade repairs'),
((7,7),(-4,4,2.8),(0,7,1.7),'Mira decodes'),
((7,7),(3,4,2.6),(0,7,2),'Astra activates'),
((7,5),(7,2,6),(0,13,7),'Transmission'),
((5,-10),(-7,-4,3.3),(0,-2,1.5),'Escape'),
((-10,-18),(9,-22,6),(2,-14,2),'New destination')]
for index,((y0,y1),pos,look,title) in enumerate(beats):
    a=1+index*450;b=a+449
    marker=s.timeline_markers.new(title,frame=a)
    data=bpy.data.cameras.new(title);cam=bpy.data.objects.new(title,data);s.collection.objects.link(cam);marker.camera=cam
    data.lens=29 if index in (0,5,9,11) else 35
    target=empty('Look '+title,look)
    con=cam.constraints.new('TRACK_TO');con.target=target;con.track_axis='TRACK_NEGATIVE_Z';con.up_axis='UP_Y'
    cam.location=pos;cam.keyframe_insert('location',frame=a)
    cam.location=(pos[0]+(.9 if index%2==0 else -.9),pos[1]+.8,pos[2]+.3);cam.keyframe_insert('location',frame=b)
    target.keyframe_insert('location',frame=a);target.location.y+=(y1-y0)*.65;target.keyframe_insert('location',frame=b)
    if index==0:s.camera=cam
    for n,(root,head,joints) in enumerate(chars):
        for f,y in [(a,y0),(b,y1)]:
            root.location=([-2,0,2][n],y+(.35 if n==1 else 0),.045)
            root.rotation_euler.z=(pi if index>=10 else 0)+[.1,0,-.1][n]
            root.keyframe_insert('location',frame=f);root.keyframe_insert('rotation_euler',frame=f)
        for f in range(a,b+1,18):
            phase=(f-a)*2*pi/72+n*.8
            head.rotation_euler=(.055*sin(phase),0,.12*sin(phase*.55+n));head.keyframe_insert('rotation_euler',frame=f)
            for j,(arm,fore,leg,shin) in enumerate(joints):
                sw=sin(phase+j*pi)
                arm.rotation_euler.x=.30*sw if y0!=y1 else .04*sw
                fore.rotation_euler.x=.20
                if (index,n) in [(6,1),(7,2),(8,0)]:
                    arm.rotation_euler.x=1.05+.15*sin(phase);fore.rotation_euler.x=.72+.12*cos(phase)
                leg.rotation_euler.x=.24*sw if y0!=y1 else 0
                shin.rotation_euler.x=max(0,-.28*sw) if y0!=y1 else 0
                for o in [arm,fore,leg,shin]:o.keyframe_insert('rotation_euler',frame=f)
for f,v in [(1,.25),(1350,.32),(1800,.15),(2700,.1),(3600,.3),(4050,1.5),(4500,1.1),(5400,.4)]:
    core.scale=(v,)*3;core.keyframe_insert('scale',frame=f)
s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=32;s.cycles.use_adaptive_sampling=True;s.cycles.adaptive_threshold=.035;s.cycles.use_denoising=True
s.cycles.max_bounces=6;s.cycles.diffuse_bounces=3;s.cycles.glossy_bounces=3
s.render.resolution_x=1080;s.render.resolution_y=1920;s.render.resolution_percentage=100;s.render.fps=30;s.render.fps_base=1;s.frame_start=1;s.frame_end=5400
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGB';s.render.image_settings.color_depth='8'
s['film']='THE LAST SIGNAL';s['characters']='ASTRA, KADE, MIRA'
s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
print('LAST_SIGNAL_SCENE_SAVED',flush=True)

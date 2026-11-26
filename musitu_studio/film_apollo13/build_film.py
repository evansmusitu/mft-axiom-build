"""205,000 MILES FROM HOME — an original animated historical dramatization.
Historical basis: NASA Apollo 13 mission details, April 11–17 1970.
Procedural approximations of the crew, not exact likenesses; no archival footage."""
import bpy, math, random, sys
from mathutils import Vector
from math import sin,cos,pi
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build_awaken_2099 as studio
bpy.ops.wm.read_factory_settings(use_empty=True)
s=bpy.context.scene
rng=random.Random(1301970)
def mat(n,c,metal=0,rough=.45,emit=0):
    m=bpy.data.materials.new(n);m.use_nodes=True
    p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=(*c,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emit
    return m
ivory=mat('Woven white pressure garment',(.63,.66,.62),0,.68)
navy=mat('Dark blue flight garment',(.035,.075,.13),0,.7)
steel=mat('Brushed aluminum',(.29,.33,.34),.72,.31)
cream=mat('Cabin off-white composite',(.54,.57,.52),.15,.5)
black=mat('Charcoal instrument panel',(.018,.022,.027),.2,.47)
rubber=mat('Rubber',(.035,.037,.04),0,.7)
gold=mat('Lunar module multilayer gold foil',(.53,.31,.05),.8,.32)
red=mat('Red warning lamp',(.75,.035,.012),0,.35,4)
green=mat('Green indicator',(.08,.64,.19),0,.36,2.5)
white=mat('White indicator',(.8,.82,.7),0,.35,2)
blue=mat('Earth ocean',(.015,.105,.34),.05,.45)
earthgreen=mat('Earth land',(.12,.24,.10),0,.8)
moonmat=mat('Lunar grey',(.29,.27,.25),0,.9)
eye=mat('Eye white',(.72,.65,.57),0,.32)
iris=mat('Iris',(.06,.09,.10),0,.3)
textmat=mat('Typography',(.9,.94,1),0,.4,1.5)
def box(n,l,d,m,b=.025):return studio.cube(n,l,d,m,b)
def ball(n,l,r,m,scale=None):
    o=studio.sphere(n,l,r,m,24,16)
    if scale:o.scale=scale
    return o
def cyl(n,l,r,depth,m,rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=depth,location=l,rotation=rot);o=bpy.context.object;o.name=n;o.data.materials.append(m);return o
def cone(n,l,r1,r2,depth,m,rot=(0,0,0)):
    bpy.ops.mesh.primitive_cone_add(vertices=64,radius1=r1,radius2=r2,depth=depth,location=l,rotation=rot);o=bpy.context.object;o.name=n;o.data.materials.append(m);return o
def empty(n,l=(0,0,0),p=None):
    o=bpy.data.objects.new(n,None);s.collection.objects.link(o);o.parent=p;o.location=l;return o
def par(o,p):o.parent=p;return o
def pipe(n,pts,m,r=.035):
    return studio.curve_path(n,pts,m,r)
def label(n,body,loc,size,m=textmat,parent=None):
    c=bpy.data.curves.new(n,'FONT');c.body=body;c.size=size;c.align_x='CENTER';c.align_y='CENTER';c.space_line=1.15
    o=bpy.data.objects.new(n,c);s.collection.objects.link(o);o.location=loc;o.parent=parent;c.materials.append(m);return o
def skin(n,c):return mat(n,c,0,.56)
def person(name,skincolor,haircolor,shape):
    tone=skin(name+' skin',skincolor);hair=mat(name+' hair',haircolor,0,.76)
    lip=mat(name+' lips',tuple(v*.72 for v in skincolor),0,.58)
    root=empty(name)
    torso=par(ball(name+' torso',(0,0,1.20),1,ivory,(.39,.25,.50)),root)
    par(ball(name+' waist',(0,0,.79),1,navy,(.34,.23,.25)),root)
    par(cyl(name+' neck',(0,0,1.68),.11,.22,tone),root)
    head=empty(name+' head',(0,-.02,1.91),root)
    # Parametric human cranial mesh with nose bridge, eye socket and jaw shape.
    verts=[];faces=[];nu=64;nv=48
    for j in range(nv+1):
        v=-pi/2+pi*j/nv;z=.225*sin(v);w=cos(v)
        for i in range(nu+1):
            a=2*pi*i/nu;x=(.155+shape*.012)*w*sin(a);y=-.16*w*cos(a)
            front=max(0,cos(a))
            y-=front*(.047*math.exp(-(x/.032)**2-((z-.005)/.065)**2)+.016*math.exp(-(x/.07)**2-((z+.075)/.04)**2))
            y+=front*.013*(math.exp(-((x-.063)/.038)**2-((z-.055)/.023)**2)+math.exp(-((x+.063)/.038)**2-((z-.055)/.023)**2))
            verts.append((x,y,z))
    for j in range(nv):
        for i in range(nu):
            k=j*(nu+1)+i;faces.append((k,k+1,k+nu+2,k+nu+1))
    mesh=bpy.data.meshes.new(name+' facial topology');mesh.from_pydata(verts,[],faces);mesh.update()
    h=bpy.data.objects.new(name+' face',mesh);s.collection.objects.link(h);h.parent=head;h.data.materials.append(tone)
    for f in h.data.polygons:f.use_smooth=True
    # Short hair, ears, eyes, brows, lips and nose.
    par(ball(name+' hair cap',(0,.015,.126),1,hair,(.159,.156,.11)),head)
    for sign in [-1,1]:
        par(ball(name+' ear',(sign*.155,0,-.02),1,tone,(.035,.048,.071)),head)
        par(ball(name+' eye',(sign*.059,-.145,.046),1,eye,(.038,.022,.019)),head)
        par(ball(name+' iris',(sign*.059,-.163,.046),1,iris,(.013,.008,.013)),head)
        brow=par(box(name+' brow',(sign*.060,-.151,.081),(.068,.018,.012),hair,.005),head);brow.rotation_euler.y=sign*.13
    par(ball(name+' nose',(0,-.181,-.007),1,tone,(.030,.036,.052)),head)
    jaw=par(ball(name+' mouth',(0,-.151,-.083),1,lip,(.060,.014,.013)),head)
    par(ball(name+' lower lip',(0,-.150,-.095),1,tone,(.057,.013,.012)),head)
    arms=[]
    for sign in [-1,1]:
        a=empty(name+' shoulder '+str(sign),(sign*.35,0,1.43),root)
        par(ball(name+' sleeve',(0,0,-.21),1,ivory,(.13,.14,.24)),a)
        f=empty(name+' elbow '+str(sign),(0,0,-.42),a)
        par(ball(name+' forearm',(0,0,-.17),1,ivory,(.105,.11,.20)),f)
        par(ball(name+' hand',(0,-.01,-.34),1,tone,(.083,.048,.12)),f)
        l=empty(name+' hip '+str(sign),(sign*.17,0,.70),root)
        par(ball(name+' trouser leg',(0,0,-.28),1,navy,(.145,.15,.30)),l)
        par(box(name+' boot',(0,-.09,-.64),(.23,.38,.19),rubber,.04),l)
        arms.append((a,f,l))
    badge=label(name+' name patch',name.split()[1].upper(),(.16,-.246,1.38),.047,black,root);badge.rotation_euler.x=pi/2
    par(box(name+' suit fitting',(-.17,-.25,1.27),(.11,.055,.09),steel),root)
    return root,head,arms,jaw
crew=[person('Jim Lovell',(.57,.34,.23),(.15,.10,.065),1),person('Jack Swigert',(.65,.42,.29),(.22,.14,.075),0),person('Fred Haise',(.59,.37,.25),(.09,.065,.045),-1)]
# Cabin, an intentionally compressed set inspired by 1970 Apollo instrumentation.
box('Cabin floor',(0,0,-.08),(5.8,6.4,.16),steel)
box('Cabin rear wall',(0,2.6,1.8),(5.8,.15,3.6),cream)
for x in [-2.85,2.85]:box('Cabin side',(x,0,1.8),(.15,6.4,3.6),cream)
box('Cabin roof',(0,0,3.64),(5.8,6.4,.12),cream)
for x in [-2.55,2.55]:
    for z in [.6,1.6,2.6]:box('Cabin rib',(x,0,z),(.13,5.6,.10),steel)
for i in range(3):
    x=(i-1)*1.62
    panel=box('Flight instrument bay',(x,1.97,1.94),(1.47,.28,1.25),black,.07)
    for row in range(5):
        for col in range(7):
            xx=x-.57+col*.19;zz=1.46+row*.23
            box('Indicator housing',(xx,1.81,zz),(.13,.045,.13),steel,.01)
            box('Indicator',(xx,1.78,zz),(.08,.025,.07),[green,white,red][(row*7+col+i)%3],.008)
    box('Console work surface',(x,1.0,.96),(1.38,.80,.13),steel,.04)
    for j in range(4):
        box('Toggle switch',(x-.45+j*.28,.87,1.06),(.07,.05,.12),black,.008)
    box('Seat base',(x,-.1,.24),(.74,.65,.16),navy,.05)
    box('Seat back',(x,.23,.79),(.73,.13,.90),navy,.05)
for j in range(8):
    pipe('Cabin cable %d'%j,[(-2.5,-2.6+j*.55,3.25),(-2.2,-2.6+j*.55,3.38),(2.25,-2.6+j*.55,3.38),(2.5,-2.6+j*.55,3.25)],rubber,.025)
# Square cartridge and ducting: a symbolic reconstruction of the CO2 adapter.
adapter=empty('CO2 scrubber adapter',(0,1.0,1.11))
par(box('Square filter',(0,0,.18),(.46,.42,.36),cream,.03),adapter)
par(box('Grey tape seal',(0,0,.20),(.49,.17,.39),steel,.01),adapter)
par(pipe('Improvised hose',[(.1,0,.31),(.38,-.1,.45),(.52,-.25,.29),(.7,-.12,.10)],rubber,.09),adapter)
for f,sc in [(1,.001),(2400,.001),(2401,1),(4500,1),(4501,.001)]:
    adapter.scale=(sc,)*3;adapter.keyframe_insert('scale',frame=f)
# Exterior in separate coordinate area, allowing true camera cuts.
ext=empty('Spacecraft assembly',(30,0,0))
par(cyl('Odyssey service module',(0,0,0),1.05,2.65,steel),ext)
par(cone('Odyssey command module',(0,0,2.1),1.1,.32,1.55,cream),ext)
par(cyl('Service engine nozzle',(0,0,-1.67),.58,.66,black),ext)
for i in range(12):
    a=2*pi*i/12
    o=par(box('Service module panel',(1.06*cos(a),1.06*sin(a),0),(.075,.43,2.2),steel,.01),ext);o.rotation_euler.z=a
lm=empty('Aquarius lunar module',(0,0,3.38),ext)
par(box('LM ascent stage',(0,0,.63),(1.52,1.45,1.35),cream,.11),lm)
par(box('LM descent stage',(0,0,-.34),(1.94,1.94,.62),gold,.06),lm)
for sign in [-1,1]:
    for side in [-1,1]:
        par(pipe('LM landing strut',[(sign*.78,side*.78,-.3),(sign*1.35,side*1.35,-1.0)],steel,.035),lm)
        par(cyl('Footpad',(sign*1.35,side*1.35,-1.0),.19,.06,steel),lm)
for sign in [-1,1]:par(box('LM window',(sign*.37,-.75,.85),(.42,.04,.34),black,.03),lm)
flash=par(ball('Service module accident flash',(1.08,0,.1),1,red),ext)
for f,v in [(1,.001),(780,.001),(810,1.1),(845,.001),(5400,.001)]:flash.scale=(v,)*3;flash.keyframe_insert('scale',frame=f)
for j in range(35):
    o=par(ball('Vented particle %02d'%j,(1.1,0,.1),rng.uniform(.015,.045),white),ext)
    for f,sc in [(1,.001),(810,.001),(830,1),(1200,1),(1400,.001)]:
        o.scale=(sc,)*3;o.keyframe_insert('scale',frame=f)
    o.keyframe_insert('location',frame=830);o.location=(rng.uniform(2,9),rng.uniform(-3,3),rng.uniform(-3,3));o.keyframe_insert('location',frame=1400)
earth=ball('Earth',(46,27,-6),11,blue)
# Procedural continents and clouds, illustrative rather than mapped.
m=earth.data.materials[0];p=m.node_tree.nodes.get('Principled BSDF');n=m.node_tree.nodes.new('ShaderNodeTexNoise');n.inputs['Scale'].default_value=5;n.inputs['Detail'].default_value=4
r=m.node_tree.nodes.new('ShaderNodeValToRGB');r.color_ramp.elements[0].position=.42;r.color_ramp.elements[0].color=(.012,.08,.28,1);r.color_ramp.elements[1].position=.64;r.color_ramp.elements[1].color=(.19,.32,.13,1);e=r.color_ramp.elements.new(.76);e.color=(.75,.82,.89,1);m.node_tree.links.new(n.outputs['Fac'],r.inputs[0]);m.node_tree.links.new(r.outputs[0],p.inputs['Base Color'])
moon=ball('Moon',(13,18,2),6,moonmat)
for f,ang in [(1,.1),(2400,1.1),(4200,2.4),(5400,3.0)]:
    ext.rotation_euler=(.25,.55,ang);ext.keyframe_insert('rotation_euler',frame=f)
# Separate reentry/splashdown set.
sea=mat('Pacific water',(.018,.11,.19),.3,.17)
box('Pacific ocean',(60,0,-.16),(35,35,.3),sea,.02)
capsule=empty('Return capsule',(60,0,11))
par(cone('Return command module',(0,0,0),.94,.25,1.4,cream),capsule)
par(cyl('Heat shield',(0,0,-.73),.95,.12,black),capsule)
chutes=empty('Three parachutes',(0,0,0),capsule)
orange=mat('Parachute orange',(.86,.18,.025),0,.6)
for j in range(3):
    a=2*pi*j/3;cx=2.1*cos(a);cy=2.1*sin(a)
    # Open canopy as hemisphere mesh, alternating orange/white gores.
    verts=[];faces=[];nn=48;nr=12
    for row in range(nr+1):
        theta=(pi/2)*row/nr
        for k in range(nn+1):
            phi=2*pi*k/nn;verts.append((cx+1.45*sin(theta)*cos(phi),cy+1.45*sin(theta)*sin(phi),6+1.35*cos(theta)))
    for row in range(nr):
        for k in range(nn):
            v=row*(nn+1)+k;faces.append((v,v+1,v+nn+2,v+nn+1))
    mesh=bpy.data.meshes.new('Parachute canopy');mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new('Parachute '+str(j+1),mesh);s.collection.objects.link(o);o.parent=chutes;o.data.materials.append(orange);o.data.materials.append(ivory)
    for poly in mesh.polygons:poly.material_index=(poly.index%nn)//4%2;poly.use_smooth=True
    md=o.modifiers.new('Fabric thickness','SOLIDIFY');md.thickness=.012
    for k in range(8):
        phi=2*pi*k/8;par(pipe('Suspension line',[(cx+1.45*cos(phi),cy+1.45*sin(phi),6),(0,0,.6)],ivory,.012),chutes)
for f,z in [(1,11),(4650,11),(5100,4),(5360,.91),(5400,.91)]:
    capsule.location.z=z;capsule.keyframe_insert('location',frame=f)
for f,v in [(1,.001),(4750,.001),(4870,1),(5400,1)]:
    chutes.scale=(v,)*3;chutes.keyframe_insert('scale',frame=f)
def light(n,l,p,c,size,target):
    d=bpy.data.lights.new(n,'AREA');d.energy=p;d.color=c;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(n,d);s.collection.objects.link(o);o.location=l;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return d
main=light('Cabin fluorescent',(0,-.5,3.35),210,(.76,.87,1),3,(0,0,1))
warn=light('Cabin emergency lamp',(1.9,1.4,2.9),0,(1,.035,.012),.7,(0,0,1.2))
for f,v in [(1,210),(775,210),(820,36),(1600,24),(2700,32),(4200,85),(5400,160)]:main.energy=v;main.keyframe_insert('energy',frame=f)
for f,v in [(1,0),(780,0),(820,165),(1100,45),(1400,120),(2000,18),(5400,0)]:warn.energy=v;warn.keyframe_insert('energy',frame=f)
light('Sun over spacecraft',(23,-8,15),4200,(1,.88,.71),8,(30,0,1))
light('Earth fill',(40,-2,3),1800,(.27,.45,1),8,(30,0,1))
light('Pacific sun',(54,-6,16),2500,(1,.83,.65),10,(60,0,4))
world=bpy.data.worlds.new('Space background');world.use_nodes=True;s.world=world
world.node_tree.nodes['Background'].inputs[0].default_value=(.012,.02,.04,1);world.node_tree.nodes['Background'].inputs[1].default_value=.28
# 12 x 15-second shots. Camera titles give factual, condensed narration.
shots=[
('APRIL 1970','APOLLO 13 | THREE ASTRONAUTS',(0,-3.15,2.30),(0,.35,1.57),30),
('BOUND FOR THE MOON','11 APRIL 1970',(35,-7,3.5),(30,0,1.4),42),
('THE ACCIDENT','13 APRIL | OXYGEN TANK RUPTURE',(34,-5,1.2),(30,0,.4),45),
('MISSION ABORTED','ODYSSEY IS LOSING POWER',(-1.65,-2.4,1.95),(-.25,.55,1.6),36),
('AQUARIUS','THE LUNAR MODULE BECOMES A LIFEBOAT',(1.7,-2.1,1.95),(.35,.7,1.6),36),
('THE LONG WAY HOME','AROUND THE MOON',(26,-10,4),(30,0,1.6),35),
('LIMITED AIR','GROUND TEAMS DESIGN AN ADAPTER',(0,-1.7,2.4),(0,.95,1.2),42),
('WORKING TOGETHER','THE CREW BUILDS THE CO2 ADAPTER',(.75,-1.55,1.85),(0,.9,1.36),42),
('POWERING UP','PREPARING ODYSSEY FOR RETURN',(-1.8,-2.4,2.1),(0,.4,1.7),35),
('EARTH AHEAD','17 APRIL 1970',(34,-8,1.8),(39,8,0),35),
('REENTRY','THE COMMAND MODULE RETURNS ALONE',(64,-7,11),(60,0,9),45),
('SPLASHDOWN','ALL THREE SURVIVED',(65,-8,6),(60,0,4.2),30)]
for i,(title,subtitle,pos,look,lens) in enumerate(shots):
    a=1+i*450;b=a+449
    d=bpy.data.cameras.new(title);cam=bpy.data.objects.new(title,d);s.collection.objects.link(cam)
    d.lens=lens;d.sensor_fit='VERTICAL';d.clip_end=250
    target=empty('Camera aim '+title,look);c=cam.constraints.new('TRACK_TO');c.target=target;c.track_axis='TRACK_NEGATIVE_Z';c.up_axis='UP_Y'
    cam.location=pos;cam.keyframe_insert('location',frame=a);cam.location=(pos[0]+.30,pos[1]+.15,pos[2]+.10);cam.keyframe_insert('location',frame=b)
    if i>=10:target.keyframe_insert('location',frame=a);target.location.z-=3.1;target.keyframe_insert('location',frame=b)
    marker=s.timeline_markers.new(title,frame=a);marker.camera=cam
    # Parent text to camera, facing directly into its view; titles are original.
    # hide_render keyed to each shot to avoid other cameras' overlays.
    for k,body in enumerate([title,subtitle]):
        o=label(title+' caption '+str(k),body,(0,-.43-k*.065,-1.5),.045 if k==0 else .025,textmat,cam)
        o.hide_render=True;o.keyframe_insert('hide_render',frame=max(0,a-1))
        o.hide_render=False;o.keyframe_insert('hide_render',frame=a)
        o.hide_render=True;o.keyframe_insert('hide_render',frame=a+145)
    if i==0:s.camera=cam
    for j,(root,head,arms,jaw) in enumerate(crew):
        # All three crew members remain distinct human models. Gestures are dramatic approximations.
        x=(j-1)*1.56;y=-.23
        if i in (6,7):x=(j-1)*.83;y=.05
        for f in (a,b):
            root.location=(x,y,0);root.rotation_euler.z=([.15,0,-.15][j] if i not in (6,7) else [.35,pi,-.35][j])
            root.keyframe_insert('location',frame=f);root.keyframe_insert('rotation_euler',frame=f)
        for f in range(a,b+1,24):
            phase=(f-a)*2*pi/150+j
            head.rotation_euler=(.065*sin(phase),.025*cos(phase),.16*sin(phase*.7));head.keyframe_insert('rotation_euler',frame=f)
            for q,(arm,fore,leg) in enumerate(arms):
                arm.rotation_euler.x=.25+.16*sin(phase+q)
                fore.rotation_euler.x=.55+.19*cos(phase+q)
                if i in (6,7) or (i==8 and j==1):arm.rotation_euler.x=.9+.15*sin(phase);fore.rotation_euler.x=.8+.15*cos(phase)
                leg.rotation_euler.x=.08*sin(phase)
                for ob in (arm,fore,leg):ob.keyframe_insert('rotation_euler',frame=f)
            jaw.scale.z=.013*(1+.3*sin(phase));jaw.keyframe_insert('scale',frame=f)
# Original ending message, documentary title rather than claim of archival imagery.
s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=32;s.cycles.use_adaptive_sampling=True;s.cycles.adaptive_threshold=.035;s.cycles.use_denoising=True
s.cycles.max_bounces=6;s.cycles.diffuse_bounces=3;s.cycles.glossy_bounces=3
s.render.resolution_x=1080;s.render.resolution_y=1920;s.render.resolution_percentage=100;s.render.fps=30;s.render.fps_base=1;s.frame_start=1;s.frame_end=5400
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGB';s.render.image_settings.color_depth='8'
s['film']='205,000 MILES FROM HOME';s['characters']='Jim Lovell, Jack Swigert, Fred Haise';s['classification']='Original animated historical dramatization; approximate likenesses, not archival footage'
s.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=sys.argv[-1])
print('APOLLO13_SCENE_SAVED',flush=True)

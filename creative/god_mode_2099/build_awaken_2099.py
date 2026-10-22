"""GOD MODE — THE AWAKENING OF 2099.

Blender 4.x Python scene generator, exclusively offline; no private Studio data,
provider keys, external network, production deployment, or render dispatch.

Usage:
  blender -b -t 4 --python scripts/build_awaken_2099.py -- --mode final --output /tmp/2099.blend
  blender -b -t 4 --python scripts/build_awaken_2099.py -- --mode preview --output /tmp/2099.blend
  blender -b /tmp/2099.blend -f 1
"""
from __future__ import annotations
import bpy, math, random, argparse, sys, os
from mathutils import Vector
from math import sin, cos, pi

SEED=2099
FPS=30
FRAME_END=360
RNG=random.Random(SEED)


def arg_parse():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=['final','preview'],default='final')
    p.add_argument('--output',default='/tmp/GOD_MODE_AWAKENING_2099.blend')
    p.add_argument('--render-frame',type=int,default=None)
    opts=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    return p.parse_args(opts)


def value_key(data,path,frames):
    for f,val in frames:
        setattr(data,path,val)
        data.keyframe_insert(data_path=path,frame=f)


def mat(name,color=(.03,.08,.13,1),metallic=.8,roughness=.24,emission=None,emit_strength=0):
    m=bpy.data.materials.new(name);m.diffuse_color=color;m.use_nodes=True
    b=m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value=color
    b.inputs['Metallic'].default_value=metallic
    b.inputs['Roughness'].default_value=roughness
    if emission:
        b.inputs['Emission Color'].default_value=(*emission,1)
        b.inputs['Emission Strength'].default_value=emit_strength
        nodes=m.node_tree.nodes; links=m.node_tree.links
        noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=10.0
        pulse=nodes.new('ShaderNodeValue');pulse.name='KEYFRAMED_QUANTUM_EMISSIVITY'
        multiplier=nodes.new('ShaderNodeMath');multiplier.operation='MULTIPLY'
        modulator=nodes.new('ShaderNodeMapRange');modulator.inputs['From Min'].default_value=.12
        modulator.inputs['From Max'].default_value=.85
        modulator.inputs['To Min'].default_value=.8
        modulator.inputs['To Max'].default_value=1.3
        links.new(noise.outputs['Fac'],modulator.inputs['Value'])
        links.new(pulse.outputs[0],multiplier.inputs[0])
        links.new(modulator.outputs[0],multiplier.inputs[1])
        links.new(multiplier.outputs[0],b.inputs['Emission Strength'])
        for f,gain in [(1,1.0),(100,1.12),(180,.86),(250,1.28),(331,1.05),(332,1.0),(360,1.0)]:
            pulse.outputs[0].default_value=emit_strength*gain
            pulse.outputs[0].keyframe_insert(data_path='default_value',frame=f)
    return m


def curve_path(name,coords,material,bevel=.08,closed=False):
    cr=bpy.data.curves.new(name,'CURVE');cr.dimensions='3D';cr.resolution_u=24
    cr.bevel_resolution=2;cr.bevel_depth=bevel
    sp=cr.splines.new('BEZIER');sp.bezier_points.add(len(coords)-1)
    for bp,co in zip(sp.bezier_points,coords):
        bp.co=co;bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
    sp.use_cyclic_u=closed
    ob=bpy.data.objects.new(name,cr);bpy.context.collection.objects.link(ob)
    cr.materials.append(material)
    return ob


def cube(name, loc, scl, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    ob=bpy.context.object;ob.name=name
    ob.dimensions=scl
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if material:ob.data.materials.append(material)
    if bevel:
        m=ob.modifiers.new('machined_precision_edges','BEVEL');m.width=bevel;m.segments=2
    return ob


def sphere(name,location,radius,material,segments=32,rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=radius,location=location)
    ob=bpy.context.object;ob.name=name
    ob.data.materials.append(material)
    for p in ob.data.polygons:p.use_smooth=True
    return ob


def emissive_instancer(name,positions,shape_obj,scale=.15,variation=.6,material=None,motion=None):
    """Real mesh positions with optional shape-key motion, rendered by GN instances."""
    mesh=bpy.data.meshes.new(name+'_points')
    mesh.from_pydata(positions,[],[]);mesh.update()
    ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob)
    if motion:
        ob.shape_key_add(name='City',from_mix=False)
        target=ob.shape_key_add(name='Awakened',from_mix=False)
        for i,v in enumerate(motion):target.data[i].co=v
        target.value=0
        for f,val in [(1,0),(50,0),(82,.015),(125,.36),(168,.71),(215,1),(360,1)]:
            target.value=val;target.keyframe_insert(data_path='value',frame=f)
    g=bpy.data.node_groups.new(name+'_GN','GeometryNodeTree')
    if hasattr(g,'interface'):
        g.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
        g.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
    else:
        g.inputs.new('NodeSocketGeometry','Geometry');g.outputs.new('NodeSocketGeometry','Geometry')
    nd=g.nodes;ln=g.links
    inp=nd.new('NodeGroupInput');inp.location=(-550,100)
    rnd=nd.new('FunctionNodeRandomValue');rnd.data_type='FLOAT';rnd.inputs['Min'].default_value=variation;rnd.inputs['Max'].default_value=1.0;rnd.location=(-320,-90)
    inst=nd.new('GeometryNodeInstanceOnPoints');inst.location=(-100,120)
    geo=nd.new('GeometryNodeObjectInfo');geo.transform_space='ORIGINAL';geo.inputs['Object'].default_value=shape_obj;geo.inputs['As Instance'].default_value=True;geo.location=(-320,-260)
    mul=nd.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=scale;mul.location=(-130,-90)
    comb=nd.new('ShaderNodeCombineXYZ');comb.location=(60,-80)
    output=nd.new('NodeGroupOutput');output.location=(370,90)
    ln.new(inp.outputs['Geometry'],inst.inputs['Points'])
    ln.new(geo.outputs['Geometry'],inst.inputs['Instance'])
    ln.new(rnd.outputs['Value'],mul.inputs[0]);
    for comp in ('X','Y','Z'):ln.new(mul.outputs[0],comb.inputs[comp])
    ln.new(comb.outputs['Vector'],inst.inputs['Scale'])
    ln.new(inst.outputs['Instances'],output.inputs['Geometry'])
    md=ob.modifiers.new(name+'_geometry_nodes','NODES');md.node_group=g
    return ob


def hide_with_scale(obj,start,end):
    for f,scale in [(1,1.0),(start,1.0),(end,.0001),(331,.0001),(332,1.0),(360,1.0)]:
        obj.scale=(scale,)*3;obj.keyframe_insert(data_path='scale',frame=f)

def animate_visibility_scale(obj,start,end,fullscale=1):
    obj.scale=(.001,)*3;obj.keyframe_insert(data_path='scale',frame=start)
    obj.scale=(fullscale,)*3;obj.keyframe_insert(data_path='scale',frame=end)


def ring(name,origin,major,minor,material,rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=128,minor_segments=8,
       location=origin,rotation=rot,major_radius=major,minor_radius=minor)
    obj=bpy.context.object;obj.name=name;obj.data.materials.append(material)
    return obj


def build_2077(steel,ink,cyan,purple,gold,white):
    # Perspective-depth city, distant GN tower population (only 1 mesh object)
    cube_proto=cube('GEONODES_LIBRARY_black_chrome_tower',(10000,10000,0),(1,1,1),steel,bevel=.05)
    # Beveled geometry 1x1x1 is instanced, transformation stays isolated.
    positions=[]
    for ix in range(-23,24):
        for iy in range(-27,30):
            if RNG.random()<.12:continue
            x=ix*4.5+RNG.uniform(-.9,.9)
            y=iy*4.6+25+RNG.uniform(-.8,.8)
            positions.append((x,y,0))
    gridmesh=bpy.data.meshes.new('City_population_points')
    gridmesh.from_pydata(positions,[],[]);gridmesh.update()
    main=bpy.data.objects.new('CITY_GN_2700_instanced_towers',gridmesh);bpy.context.collection.objects.link(main)
    grp=bpy.data.node_groups.new('CITY_skyscrapers_random_scale_GN','GeometryNodeTree')
    if hasattr(grp,'interface'):
        grp.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
        grp.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
    else:
        grp.inputs.new('NodeSocketGeometry','Geometry');grp.outputs.new('NodeSocketGeometry','Geometry')
    ns=grp.nodes;ls=grp.links
    gi=ns.new('NodeGroupInput');oi=ns.new('GeometryNodeObjectInfo');oi.inputs['Object'].default_value=cube_proto;oi.inputs['As Instance'].default_value=True
    ins=ns.new('GeometryNodeInstanceOnPoints');rheight=ns.new('FunctionNodeRandomValue');rheight.data_type='FLOAT';rheight.inputs['Min'].default_value=7;rheight.inputs['Max'].default_value=51
    rxy=ns.new('FunctionNodeRandomValue');rxy.data_type='FLOAT';rxy.inputs['Min'].default_value=1.2;rxy.inputs['Max'].default_value=3.6
    com=ns.new('ShaderNodeCombineXYZ');setpos=ns.new('GeometryNodeSetPosition');vec=ns.new('ShaderNodeCombineXYZ')
    height_half=ns.new('ShaderNodeMath');height_half.operation='MULTIPLY';height_half.inputs[1].default_value=.5
    so=ns.new('NodeGroupOutput')
    ls.new(gi.outputs['Geometry'],setpos.inputs['Geometry']);ls.new(rheight.outputs['Value'],height_half.inputs[0]);ls.new(height_half.outputs[0],vec.inputs['Z']);ls.new(vec.outputs['Vector'],setpos.inputs['Offset'])
    ls.new(setpos.outputs['Geometry'],ins.inputs['Points']);ls.new(oi.outputs['Geometry'],ins.inputs['Instance'])
    ls.new(rxy.outputs['Value'],com.inputs['X']);ls.new(rxy.outputs['Value'],com.inputs['Y']);ls.new(rheight.outputs['Value'],com.inputs['Z'])
    ls.new(com.outputs['Vector'],ins.inputs['Scale']);ls.new(ins.outputs['Instances'],so.inputs['Geometry'])
    m=main.modifiers.new('procedural_city_population','NODES');m.node_group=grp
    hide_with_scale(main,113,192)
    # Texture on wet substrate and architectural foreground hero geometry.
    ground=cube('ELECTROMAGNETIC_WET_PLANET_SURFACE',(0,35,-3),(500,500,3),ink,bevel=0)
    ground.name='Planet_wet_black_chrome_reflection_field'
    hero=[(-24,-24,49,6),(-8,-16,71,5),(19,-21,52,6),(40,-6,80,7),(-46,1,81,8),(-26,28,73,7),(27,34,94,8),(-9,52,98,9),(44,64,74,6),(-56,79,90,7)]
    for n,(x,y,h,w) in enumerate(hero):
        b=cube(f'HERO_{n:02}_black_titanium_tower',(x,y,h/2),(w,w,h),steel,bevel=.4)
        # Dense vertical luminous architectural lanes, 3 colors, highly legible mobile scale.
        for j in range(4):
            dx=(j-1.5)*w*.22
            curve_path(f'HERO_{n:02}_circuit_lane_{j}',[(x+dx,y-w*.50-.025,2),(x+dx,y-w*.50-.025,h*.96)],cyan if j%3!=2 else purple,.035)
        for k in range(4):
            z=h*(.19+.17*k)
            ring(f'HERO_{n:02}_orbital_band_{k}',(x,y,z),w*.83,.028,gold if k==3 else cyan,rot=(pi/2,0,0))
        if n in (3,4,6,7):
            ring(f'ORBITAL_CLASS_HABITAT_{n}',(x,y,h*.8),w*2.0,.22,gold,rot=(pi/5,pi/3,0))
        hide_with_scale(b,72+(n%5)*5,160+(n%3)*9)
        # Scale visuals on heroes only; GN city remains static but dissolves in luminous cloud.
    # Hundreds of gracefully soaring airways.
    for i in range(15):
        x=RNG.uniform(-58,58);height=RNG.uniform(15,58)
        pts=[]
        for j in range(7):
            yy=-110+j*42
            xx=x+math.sin(j*.75+i)*11
            zz=height+sin(j*.72+i)*12
            pts.append((xx,yy,zz))
        curve_path(f'anti_gravity_transparent_guideline_{i:02}',pts,cyan if i%3 else purple,.045)
    # Flying transport points, animated by GN instancing / shape keys.
    ship_mesh=cube('LIBRARY_flying_vehicle_tetra',(10000,10000,0),(.7,1.65,.20),white,.12)
    craft=[];targets=[]
    for _ in range(1400):
        x=RNG.uniform(-130,130);y=RNG.uniform(-90,145);z=RNG.uniform(10,88)
        craft.append((x,y,z));targets.append((x+RNG.uniform(-60,80),y+RNG.uniform(90,270),z+RNG.uniform(-4,4)))
    fleet=emissive_instancer('GAUSSIAN_TRAFFIC_1400_flying_craft',craft,ship_mesh,scale=.22,variation=.6,motion=targets)
    # Don't wait until dramatic transition for traffic to move.
    if fleet.data.shape_keys:
        k=fleet.data.shape_keys.key_blocks[-1]
        k.value=0;k.keyframe_insert(data_path='value',frame=1)
        k.value=1;k.keyframe_insert(data_path='value',frame=330)
        k.value=0;k.keyframe_insert(data_path='value',frame=332)
        k.value=0;k.keyframe_insert(data_path='value',frame=360)
    return main


def build_face(steel,mercury,cyan,white,gold,ink):
    # Bordered half-ellipsoid parameterization with anatomical cheek, nose, eyebrow,
    # mouth, inner orbital basins, jaw; all purely shader/mesh authored.
    nx=120;nz=100
    vertices=[];faces=[]
    for j in range(nz+1):
        v=-1+2*j/nz
        width=24*math.sqrt(max(.02,1-.77*v*v))*(1-.16*max(0,-v))
        z=41+27*v
        for i in range(nx+1):
            ang=-pi+2*pi*i/nx
            x=width*sin(ang)
            front=74-9*cos(ang)*(1-0.18*max(0,-v))
            # Anatomical local feature fields in front direction (negative y)
            def gaussian(cx,cz,sx,sz):return math.exp(-((x-cx)/sx)**2-((z-cz)/sz)**2)
            depth=(-3.5*gaussian(0,38,3,9)  # nose bridge and tip
                   -1.6*gaussian(-12,34,7,6)-1.6*gaussian(12,34,7,6) # cheekbones
                   +1.8*gaussian(-8,45,5,3)+1.8*gaussian(8,45,5,3) # orbital recess
                   -1.2*gaussian(0,19,9,3) # lip plate
                   -2.3*gaussian(0,15,8,5)) # jaw
            y=front+max(0,cos(ang))*depth
            vertices.append((x,y,z))
    for j in range(nz):
        for i in range(nx):
            a=j*(nx+1)+i;b=a+nx+1;faces.append((a,a+1,b+1,b))
    mesh=bpy.data.meshes.new('AI_FACIAL_POLISHED_TITANIUM_TOPOLOGY');mesh.from_pydata(vertices,[],faces);mesh.update()
    head=bpy.data.objects.new('THE_COLOSSAL_AI_HEAD_120x100_parametric',mesh);bpy.context.collection.objects.link(head)
    head.data.materials.append(steel)
    for f in mesh.polygons:f.use_smooth=True
    animate_visibility_scale(head,146,220)
    # Profile sweeping golden cranial rings and circuitry-like reference curves.
    for j in range(17):
        coords=[]
        xx=-20+j*2.5
        for k in range(9):
            zz=20+k*5
            yy=62.2+math.sin(zz*.15+j)*.32
            coords.append((xx+2*sin(k*.3+j),yy,zz))
        ob=curve_path(f'FACIAL_QUANTUM_BLUE_CIRCUIT_{j:02}',coords,cyan,.053)
        animate_visibility_scale(ob,155+(j%5)*7,219+(j%7)*3)
    # Camera-facing eye sockets: normal points toward negative y.
    for sign in [-1,1]:
        xx=sign*9.1
        y=61.4;z=46
        iris=sphere('OCULAR_GALAXY_BLACK_VOID' if sign==-1 else 'OCULAR_DARK_COMPANION',(xx,y,z),1,ink if sign==1 else mercury)
        iris.scale=(5.8,.54,3.4)
        iris.keyframe_insert(data_path='scale',frame=170)
        # Golden orbit around each eye: ring torus initially XY normal Z, rotate X=90 -> normal -Y.
        outline=ring('CNC_ORBITAL_EYE_SOCKET_'+str(sign),(xx,60.7,z),4.1,.15,gold,(pi/2,0,0))
        outline.scale=(1.5,1,.91)
        lid=sphere('AI_EYELID_'+str(sign),(xx,59.6,z),1,steel)
        lid.scale=(5.8,.24,3.25)
        if sign<0:
            for fr,fac,offset in [(1,1,0),(238,1,0),(248,1,0),(283,.002,3.5),(307,.002,3.5)]:
                lid.scale=(5.9,.24,3.3*fac)
                lid.location.z=z+offset
                lid.keyframe_insert(data_path='scale',frame=fr)
                lid.keyframe_insert(data_path='location',frame=fr)
        else:
            lid.scale=(5.9,.24,3.25)
    # 3D galaxy embedded behind opening lid; twin arms, visible after 8s.
    points=[]
    for i in range(1850):
        r=RNG.random()**.57
        ang=RNG.uniform(-pi,pi)+r*12.6
        rr=r*(2.7 if i%2==0 else 2.5)
        x=-9.1+rr*cos(ang);z=46+rr*sin(ang)*.78
        y=58.6+RNG.uniform(-.12,.12)
        points.append((x,y,z))
    starproto=sphere('LIBRARY_nano_galaxy_star',(10000,10000,0),1,white,8,4)
    galaxy=emissive_instancer('IRIS_GALAXY_1850_stars_GN',points,starproto,scale=.032,variation=.30)
    animate_visibility_scale(galaxy,242,275)
    for i in range(5):
        ringobj=ring('GALACTIC_EYE_ORBITAL_RING_'+str(i),(-9.1,58.75,46),.7+i*.51,.022,gold if i%2==0 else cyan,(pi/2,0,0))
        animate_visibility_scale(ringobj,247+i*2,273+i*2)
    return head


def build_fragment_transformation(cyan,purple,steel):
    gem=cube('LIBRARY_nano_billionfold_crystal',(10000,10000,0),(.35,.42,.52),cyan,bevel=.04)
    # The simulation uses *samples* of the billion-particle field, not billions
    # of realized objects. GPU/CPU cost is proportional to ~10k point instances.
    origin=[];dest=[]
    for i in range(10000):
        x=RNG.uniform(-115,115);y=RNG.uniform(-100,175)
        z=RNG.uniform(3,63)
        origin.append((x,y,z))
        z2=41+RNG.uniform(-27,27)
        f=(z2-41)/27
        w=23*math.sqrt(max(.02,1-.77*f*f))*(1-.16*max(0,-f))
        x2=RNG.uniform(-1,1)*w
        # Surface galaxy filaments around silhouette (front or rear of face)
        ang=RNG.uniform(-pi,pi)
        y2=74-RNG.uniform(1,12)*math.cos(ang)
        dest.append((x2,y2,z2))
    o=emissive_instancer('NEURAL_STREAM_10000_geometry_nodes_fragments',origin,gem,.45,.2,motion=dest)
    for f,sc in [(1,.0001),(48,.0001),(79,1),(331,1),(332,.0001),(360,.0001)]:
        o.scale=(sc,)*3;o.keyframe_insert(data_path='scale',frame=f)
    if o.data.shape_keys:
        kb=o.data.shape_keys.key_blocks[-1]
        kb.value=1;kb.keyframe_insert(data_path='value',frame=331)
        kb.value=0;kb.keyframe_insert(data_path='value',frame=332)
        kb.value=0;kb.keyframe_insert(data_path='value',frame=360)
    # DNA-like glowing corkscrew streams, present as the cities lift.
    for j in range(10):
        side=(-1 if j%2 else 1)
        coords=[]
        for k in range(24):
            t=k/23
            angle=t*2*pi*(2.5+j*.07)
            x=side*(18+9*sin(angle+j))*(1-t)+side*4*t
            y=-45+110*t+7*cos(angle+j)
            z=6+64*t+6*sin(angle+j)
            coords.append((x,y,z))
        c=curve_path(f'SUPERPOSITION_DNA_MATTER_STREAM_{j:02}',coords,cyan if j%3 else purple,.12)
        animate_visibility_scale(c,64+(j%6)*4,146+(j%4)*7)
        for frame,sc in [(331,1.0),(332,.0001),(360,.0001)]:
            c.scale=(sc,)*3;c.keyframe_insert(data_path='scale',frame=frame)
    return o


def build_blackhole(gold,cyan,ink):
    core=sphere('ARTIFICIAL_BLACK_HOLE_SINGULARITY',(0,168,126),20,ink,64,32)
    for i in range(9):
        r=24+i*2.0
        tor=ring(f'GOLD_ACC_RETION_ORBIT_{i:02}',(0,168,126),r,.19 if i%2 else .35,gold,(pi/5+i*.07,pi/10+i*.05,0))
        tor.rotation_euler.z=0;tor.keyframe_insert(data_path='rotation_euler',frame=1)
        tor.rotation_euler.z=(i+1)*.25;tor.keyframe_insert(data_path='rotation_euler',frame=330)
        tor.rotation_euler.z=0;tor.keyframe_insert(data_path='rotation_euler',frame=332)
        tor.rotation_euler.z=0;tor.keyframe_insert(data_path='rotation_euler',frame=360)
    # Blackhole quantum-lensing ambience, no actual physical GR lensing claim.
    sphere('EVENT_HORIZON_BLUE_THIN_PLASMA',(0,168,126),20.35,mat('Event_horizon_teal',(.002,.02,.023,1),.1,.5,emission=(.02,.12,.2),emit_strength=.05),48,24)


def build_holograms(cyan,purple,gold):
    for i in range(19):
        x=RNG.uniform(-84,84);y=RNG.uniform(-25,150);z=RNG.uniform(17,77)
        ringobj=ring(f'Hologram_quantum_interface_{i:02}',(x,y,z),RNG.uniform(2,6),.06,cyan if i%2 else purple,(RNG.random()*pi,RNG.random()*pi,0))
        for f,rz in [(1,0),(330,2*pi*(1+(i%3))),(332,0),(360,0)]:
            ringobj.rotation_euler.z=rz;ringobj.keyframe_insert(data_path='rotation_euler',frame=f)
        if i<8:
            c=curve_path(f'Holographic_data_trajectory_{i}',[(x+6*sin(t),y-2*cos(t),z+4*cos(t*.8)) for t in range(0,10)],gold,.025)
    # Ionized electrical arcs, physically interpreted as energy filaments.
    for i in range(7):
        x=RNG.uniform(-88,88);y=RNG.uniform(-40,160);z=RNG.uniform(70,140)
        coords=[(x+RNG.uniform(-5,5),y+RNG.uniform(-5,5),z-k*5) for k in range(14)]
        c=curve_path(f'EM_STORM_LIGHTNING_{i}',coords,cyan,.11)
        animate_visibility_scale(c,38+i*7,39+i*7)
        for f,sc in [(331,1),(332,.0001),(360,.0001)]:
            c.scale=(sc,)*3;c.keyframe_insert(data_path='scale',frame=f)


def make_camera():
    cam=bpy.data.cameras.new('CINEMATIC_ANAMORPHIC_CAMERA');obj=bpy.data.objects.new('CINEMATIC_ANAMORPHIC_CAMERA',cam)
    bpy.context.collection.objects.link(obj);bpy.context.scene.camera=obj
    cam.type='PERSP';cam.lens=27;cam.sensor_fit='VERTICAL';cam.clip_end=3000
    cam.dof.use_dof=True;cam.dof.aperture_fstop=10
    target=bpy.data.objects.new('CAMERA_BEZIER_LOOK_AT_TARGET',None);bpy.context.collection.objects.link(target)
    constraint=obj.constraints.new(type='TRACK_TO');constraint.target=target;constraint.track_axis='TRACK_NEGATIVE_Z';constraint.up_axis='UP_Y'
    moves=[
       (1,(0,-146,78),(0,40,40),27),
       (60,(0,-118,54),(0,60,40),28),
       (110,(-17,-40,38),(0,88,48),24),
       (150,(18,14,45),(0,84,47),27),
       (205,(4,-73,76),(0,73,41),45),
       (240,(0,-93,77),(0,73,41),52),
       (282,(-9.1,30,47),(-9.1,72,46),75),
       (310,(-9.1,46,46),(-9.1,73,46),86),
       (326,(-9.1,56,46),(-9.1,85,46),58),
       (331,(-9.1,59,46),(-9.1,130,46),18),
       (332,(0,-146,78),(0,40,40),27),
       (360,(0,-146,78),(0,40,40),27)
    ]
    for f,loc,look,lens in moves:
        obj.location=loc;obj.keyframe_insert('location',frame=f)
        target.location=look;target.keyframe_insert('location',frame=f)
        cam.lens=lens;cam.keyframe_insert('lens',frame=f)
    # Seam is a clear portal flash (f331) followed by the same camera as f1.
    for ob in [obj,target]:
        if ob.animation_data and ob.animation_data.action:
            try:
                for fc in ob.animation_data.action.fcurves:
                    for key in fc.keyframe_points:key.interpolation='BEZIER'
            except AttributeError:pass
    focus=bpy.data.objects.new('FOCUS_GALAXY_BEHIND_SINGULARITY',None);bpy.context.collection.objects.link(focus)
    focus.location=(0,50,39);cam.dof.focus_object=focus
    return obj


def lights_atmosphere(preview=False):
    world=bpy.data.worlds.new('2099_dark_alien_atmosphere');bpy.context.scene.world=world;world.use_nodes=True
    world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.004,.011,.025,1)
    world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.22
    lights=[('Cyan_blue_city_sun',(0,-70,130),(0.01,.65,1.0),26000,65),('Ultraviolet_storm_ambient',(85,20,105),(.39,.1,1),21000,80),('Golden_backlit_blackhole',(0,130,180),(1,.38,.055),42000,75),('Silver_eye_keylight',(-60,-80,125),(.43,.85,1.0),16000,60)]
    for name,loc,col,power,size in lights:
        ld=bpy.data.lights.new(name,'AREA');ld.energy=power;ld.color=col;ld.shape='DISK';ld.size=size
        o=bpy.data.objects.new(name,ld);bpy.context.collection.objects.link(o);o.location=loc
        direction=Vector((0,50,36))-o.location;o.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
    if not preview:
        # Cycles volume, moderate density: cost carefully controlled.
        fog=bpy.data.materials.new('VOLUMETRIC_SCATTER_THIN_FILM');fog.use_nodes=True
        nd=fog.node_tree.nodes;nd.clear();vo=nd.new('ShaderNodeVolumePrincipled')
        vo.inputs['Color'].default_value=(.13,.22,.44,1)
        vo.inputs['Density'].default_value=.0025
        vo.inputs['Anisotropy'].default_value=.42
        out=nd.new('ShaderNodeOutputMaterial');fog.node_tree.links.new(vo.outputs['Volume'],out.inputs['Volume'])
        cube('CYCLES_ATMOSPHERIC_VOLUME',(0,36,55),(380,390,135),fog)


def make_compositor(preview=False):
    scene=bpy.context.scene;scene.use_nodes=True
    ns=scene.node_tree.nodes;ns.clear();ls=scene.node_tree.links
    layer=ns.new('CompositorNodeRLayers');out=ns.new('CompositorNodeComposite')
    if preview:ls.new(layer.outputs['Image'],out.inputs['Image']);return
    # Fine film look without blown highlights or low-res excessive bloom.
    glare=ns.new('CompositorNodeGlare');glare.glare_type='FOG_GLOW';glare.threshold=2.0;glare.quality='MEDIUM';glare.mix=-.92
    ld=ns.new('CompositorNodeLensdist');ld.inputs['Distort'].default_value=.012;ld.inputs['Dispersion'].default_value=.004
    ls.new(layer.outputs['Image'],glare.inputs['Image'])
    ls.new(glare.outputs['Image'],ld.inputs['Image']);ls.new(ld.outputs['Image'],out.inputs['Image'])


def configure(preview):
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=FRAME_END;scene.render.fps=FPS
    scene.render.engine='CYCLES';scene.cycles.samples=6 if preview else 96
    # The Ubuntu 24.04 distro Blender 4.0.2 was built without OIDN.
    # The inexpensive preview must run without unavailable denoisers; the
    # full production preset remains Cycles + denoising on a qualified build.
    scene.cycles.use_denoising=not preview
    for view_layer in scene.view_layers:
        if hasattr(view_layer,'cycles') and hasattr(view_layer.cycles,'use_denoising'):
            view_layer.cycles.use_denoising=not preview
    scene.render.resolution_x=360 if preview else 1080
    scene.render.resolution_y=640 if preview else 1920
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.render.image_settings.color_mode='RGB'
    scene.render.filepath='/tmp/god_mode_2099/frames/'
    scene.render.film_transparent=False
    if hasattr(scene.render,'use_motion_blur'):
        scene.render.use_motion_blur=False if preview else True
    try:scene.cycles.use_adaptive_sampling=True
    except AttributeError:pass
    try:scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    except Exception:pass
    scene.render.image_settings.color_depth='8'
    scene.render.use_file_extension=True
    scene.camera.data.lens=35 if scene.camera else 35
    make_compositor(preview)


def main():
    args=arg_parse();preview=args.mode=='preview'
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for matdata in list(bpy.data.materials):
        if matdata.users==0:bpy.data.materials.remove(matdata)
    # Tight, physically-based palette.
    steel=mat('BLACK_TITANIUM_chrome',(.009,.017,.031,1),metallic=.96,roughness=.19)
    ink=mat('WET_OBSIDIAN_WORLD',(.002,.004,.008,1),metallic=.76,roughness=.15)
    mercury=mat('LIQUID_SILVER_IRIS',(.15,.3,.36,1),metallic=.90,roughness=.11)
    cyan=mat('ELECTRIC_CYAN_PHOTONICS',(.011,.13,.21,1),metallic=.1,roughness=.2,emission=(.015,.77,1.0),emit_strength=5)
    purple=mat('ULTRAVIOLET_QUANTUM_POWER',(.11,.009,.18,1),metallic=.1,roughness=.2,emission=(.52,.03,1),emit_strength=4)
    gold=mat('MOLTEN_GOLD_RING_PLASMA',(.34,.12,.004,1),metallic=.6,roughness=.2,emission=(1,.32,.014),emit_strength=3.3)
    white=mat('MICRO_SILVER_STELLAR_LIGHT',(.7,.88,1,1),metallic=.2,roughness=.26,emission=(.55,.88,1.0),emit_strength=4)
    build_2077(steel,ink,cyan,purple,gold,white)
    build_blackhole(gold,cyan,ink)
    build_fragment_transformation(cyan,purple,steel)
    face_before={o.name for o in bpy.data.objects}
    build_face(steel,mercury,cyan,white,gold,ink)
    face_root=bpy.data.objects.new('AI_FACE_MATCHCUT_MASTER_VISIBILITY',None)
    bpy.context.collection.objects.link(face_root);face_root.location=(0,74,41)
    bpy.context.view_layer.update()
    for o in list(bpy.data.objects):
        if o.name not in face_before and o is not face_root:
            o.parent=face_root
            o.matrix_parent_inverse=face_root.matrix_world.inverted()
    for f,sc in [(1,.0001),(165,.0001),(218,1.0),(331,1.0),(332,.0001),(360,.0001)]:
        face_root.scale=(sc,)*3;face_root.keyframe_insert('scale',frame=f)
    build_holograms(cyan,purple,gold)
    make_camera()
    lights_atmosphere(preview)
    configure(preview)
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.output),check_existing=False)
    print('AWAKENING_2099_SCENE_SAVED',os.path.abspath(args.output))
    print('AWAKENING_2099_VALIDATED_PRESET',{'engine':bpy.context.scene.render.engine,'fps':FPS,'frames':FRAME_END,'resolution':[bpy.context.scene.render.resolution_x,bpy.context.scene.render.resolution_y],'samples':bpy.context.scene.cycles.samples})
    if args.render_frame:
        assert 1<=args.render_frame<=360
        bpy.context.scene.frame_set(args.render_frame)
        bpy.context.scene.render.filepath=os.path.join(os.path.dirname(os.path.abspath(args.output)),f'AWAKENING_2099_f{args.render_frame:03d}.png')
        bpy.ops.render.render(write_still=True)
        print('AWAKENING_2099_FRAME_RENDERED',args.render_frame)

if __name__=='__main__':main()
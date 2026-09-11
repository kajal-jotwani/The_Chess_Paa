"""
Chess Wonderland — Blender modelling helpers.

Every asset in public/models/*.glb is built by the scripts in this folder,
run headless:  blender --background --python blender/build_pieces.py

The helpers here turn simple descriptions (a lathe profile, a loft of
cross-sections, a tube along points) into clean quad meshes with UVs and
marked sharp edges, so the glTF exporter produces split normals exactly
where a real turned wooden piece has a crisp ring.
"""
import bpy
import bmesh
import math
from mathutils import Vector, Matrix


# --------------------------------------------------------------------------
# scene / object plumbing
# --------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    scn.unit_settings.system = "METRIC"
    scn.unit_settings.scale_length = 1.0


def link(ob, collection=None):
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def mesh_from_bm(name, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    ob = bpy.data.objects.new(name, me)
    link(ob)
    return ob


def world_location(ob):
    """World position by walking the parent chain. Valid while parents are
    unrotated/unscaled (true during building; poses are applied last)."""
    loc = Vector(ob.location)
    p = ob.parent
    while p:
        loc = loc + Vector(p.location)
        p = p.parent
    return loc


def set_parent(child, parent, keep_world=True):
    """Parent without matrix_parent_inverse (headless Blender does not refresh
    matrix_world until a depsgraph update, so the inverse trick is unsafe).
    keep_world=True treats child.location as a world position and converts it."""
    if keep_world:
        child.location = Vector(child.location) - world_location(parent)
    child.parent = parent
    child.matrix_parent_inverse.identity()


def empty(name, location=(0, 0, 0), parent=None, world=True):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.05
    ob.location = location
    link(ob)
    if parent:
        set_parent(ob, parent, keep_world=world)
    return ob


def select_only(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_modifiers(ob):
    select_only(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def join(objects, name):
    """Join meshes into one object (first object's transform is kept)."""
    objects = [o for o in objects if o and o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def subdivide(ob, levels=1):
    m = ob.modifiers.new("subd", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    return m


def boolean_cut(ob, cutter):
    m = ob.modifiers.new("cut", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.object = cutter
    m.solver = "EXACT"
    apply_modifiers(ob)
    bpy.data.objects.remove(cutter, do_unlink=True)


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------

def material(name, color=(0.8, 0.8, 0.8), roughness=0.5, metallic=0.0,
             emission=None, emission_strength=1.0, alpha=1.0, image=None,
             coat=0.0, subsurface=0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    if "Subsurface Weight" in bsdf.inputs and subsurface:
        bsdf.inputs["Subsurface Weight"].default_value = subsurface
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        else:
            mat.blend_method = "BLEND"
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def image_from_pixels(name, width, height, rgba_rows, filepath=None):
    """rgba_rows: flat list of floats (r,g,b,a) row-major bottom-up."""
    img = bpy.data.images.new(name, width, height, alpha=True)
    img.pixels = rgba_rows
    if filepath:
        img.filepath_raw = filepath
        img.file_format = "PNG"
        img.save()
    img.pack()
    return img


# --------------------------------------------------------------------------
# lathe (turned pieces)
# --------------------------------------------------------------------------

def _catmull(p0, p1, p2, p3, t):
    t2 = t * t
    t3 = t2 * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t
                  + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def sample_profile(profile, subdiv=6):
    """profile: [(r, z, kind)] with kind 's' (smooth) or 'k' (crisp corner).
    Returns [(r, z, is_sharp_ring)] densely sampled."""
    pts = [Vector((p[0], p[1])) for p in profile]
    kinds = [p[2] for p in profile]
    n = len(pts)
    out = []
    for i in range(n - 1):
        a, b = pts[i], pts[i + 1]
        out.append((a.x, a.y, kinds[i] == "k"))
        linear = kinds[i] == "k" and kinds[i + 1] == "k"
        if linear:
            steps = 2
            for s in range(1, steps):
                q = a.lerp(b, s / steps)
                out.append((q.x, q.y, False))
        else:
            p0 = pts[i - 1] if i > 0 else a + (a - b)
            p3 = pts[i + 2] if i + 2 < n else b + (b - a)
            # a corner end-point still gets a smooth run-in on the smooth side
            if kinds[i] == "k":
                p0 = a + (a - b) * 0.001
            if kinds[i + 1] == "k":
                p3 = b + (b - a) * 0.001
            for s in range(1, subdiv):
                q = _catmull(p0, a, b, p3, s / subdiv)
                out.append((max(q.x, 0.0), q.y, False))
    last = pts[-1]
    out.append((last.x, last.y, kinds[-1] == "k"))
    return out


def lathe(name, profile, segments=64, subdiv=6, scale=1.0, uv_repeat_v=1.0):
    samples = sample_profile(profile, subdiv)
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    lengths = [0.0]
    for i in range(1, len(samples)):
        r0, z0, _ = samples[i - 1]
        r1, z1, _ = samples[i]
        lengths.append(lengths[-1] + math.hypot(r1 - r0, z1 - z0))
    total = lengths[-1] or 1.0
    rings = []
    for (r, z, sharp), L in zip(samples, lengths):
        v = (L / total) * uv_repeat_v
        if r < 1e-6:
            rings.append(([bm.verts.new((0.0, 0.0, z * scale))], True, sharp, v))
        else:
            ring = []
            for s in range(segments):
                a = 2 * math.pi * s / segments
                ring.append(bm.verts.new((r * math.cos(a) * scale, r * math.sin(a) * scale, z * scale)))
            rings.append((ring, False, sharp, v))
    bm.verts.ensure_lookup_table()
    first_pole = True
    for i in range(len(rings) - 1):
        A, Apole, _, Av = rings[i]
        B, Bpole, _, Bv = rings[i + 1]
        if Apole and Bpole:
            continue
        for s in range(segments):
            s2 = (s + 1) % segments
            u0 = s / segments
            u1 = (s + 1) / segments
            try:
                if Apole:
                    if i == 0:
                        f = bm.faces.new((A[0], B[s2], B[s]))
                        uvs = [((u0 + u1) / 2, Av), (u1, Bv), (u0, Bv)]
                    else:
                        f = bm.faces.new((A[0], B[s], B[s2]))
                        uvs = [((u0 + u1) / 2, Av), (u0, Bv), (u1, Bv)]
                elif Bpole:
                    f = bm.faces.new((A[s], A[s2], B[0]))
                    uvs = [(u0, Av), (u1, Av), ((u0 + u1) / 2, Bv)]
                else:
                    f = bm.faces.new((A[s], A[s2], B[s2], B[s]))
                    uvs = [(u0, Av), (u1, Av), (u1, Bv), (u0, Bv)]
            except ValueError:
                continue
            for loop, uv in zip(f.loops, uvs):
                loop[uv_layer].uv = uv
    for ring, pole, sharp, _ in rings:
        if sharp and not pole:
            for s in range(segments):
                e = bm.edges.get((ring[s], ring[(s + 1) % segments]))
                if e:
                    e.smooth = False
    bm.normal_update()
    return mesh_from_bm(name, bm)


# --------------------------------------------------------------------------
# loft (organic shapes: the knight's head, beards, bodies)
# --------------------------------------------------------------------------

def ellipse_ring(center, u, v, a, b, count=32, egg=0.0, phase=0.0):
    """Points of an ellipse (a along u, b along v). egg>0 widens the +v side."""
    pts = []
    for s in range(count):
        t = 2 * math.pi * s / count + phase
        w = 1.0 + egg * math.sin(t)
        pts.append(center + u * (a * math.cos(t) * w) + v * (b * math.sin(t)))
    return pts


def loft(name, rings, cap_start=True, cap_end=True, sharp_rings=()):
    """rings: list of point-lists (equal length). Builds quads between rings."""
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    count = len(rings[0])
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings)
    for i in range(n - 1):
        A, B = verts[i], verts[i + 1]
        for s in range(count):
            s2 = (s + 1) % count
            try:
                f = bm.faces.new((A[s], A[s2], B[s2], B[s]))
            except ValueError:
                continue
            u0, u1 = s / count, (s + 1) / count
            v0, v1 = i / (n - 1), (i + 1) / (n - 1)
            for loop, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
                loop[uv_layer].uv = uv
    if cap_start:
        f = bm.faces.new(list(reversed(verts[0])))
        for loop in f.loops:
            loop[uv_layer].uv = (0.5, 0.0)
    if cap_end:
        f = bm.faces.new(verts[-1])
        for loop in f.loops:
            loop[uv_layer].uv = (0.5, 1.0)
    for ri in sharp_rings:
        ring = verts[ri]
        for s in range(count):
            e = bm.edges.get((ring[s], ring[(s + 1) % count]))
            if e:
                e.smooth = False
    bm.normal_update()
    # make sure normals point outward
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm)


def frame_along(points, up_hint=Vector((0, 0, 1))):
    """Tangent/normal/binormal frames along a polyline (parallel transport)."""
    pts = [Vector(p) for p in points]
    tangents = []
    for i in range(len(pts)):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tangents.append(t.normalized())
    normals = []
    n = up_hint - tangents[0] * up_hint.dot(tangents[0])
    if n.length < 1e-6:
        n = Vector((1, 0, 0))
    n.normalize()
    for i, t in enumerate(tangents):
        n = n - t * n.dot(t)
        n.normalize()
        normals.append(n.copy())
    binormals = [t.cross(nrm).normalized() for t, nrm in zip(tangents, normals)]
    return pts, tangents, normals, binormals


def tube(name, points, radius, count=16, radii=None, cap=True):
    """A smooth tube along a polyline; radii may vary per point."""
    pts, T, N, B = frame_along(points)
    rings = []
    for i, p in enumerate(pts):
        r = radii[i] if radii else radius
        rings.append(ellipse_ring(p, N[i], B[i], r, r, count))
    return loft(name, rings, cap_start=cap, cap_end=cap)


def smooth_points(points, iterations=2, subdiv=3):
    """Catmull-Rom subdivision of a polyline for nicer tubes."""
    pts = [Vector(p) for p in points]
    for _ in range(iterations):
        out = []
        for i in range(len(pts) - 1):
            p0 = pts[i - 1] if i > 0 else pts[i]
            p1, p2 = pts[i], pts[i + 1]
            p3 = pts[i + 2] if i + 2 < len(pts) else pts[i + 1]
            for s in range(subdiv):
                out.append(_catmull(p0, p1, p2, p3, s / subdiv))
        out.append(pts[-1])
        pts = out
    return pts


# --------------------------------------------------------------------------
# primitives (return objects, with pivots we control)
# --------------------------------------------------------------------------

def uv_sphere(name, radius=1.0, location=(0, 0, 0), scale=(1, 1, 1), segments=32, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            u = 0.5 + math.atan2(co.y, co.x) / (2 * math.pi)
            v = 0.5 + math.asin(max(-1, min(1, co.z / radius))) / math.pi
            loop[uv_layer].uv = (u, v)
    ob = mesh_from_bm(name, bm)
    ob.location = location
    ob.scale = scale
    return ob


def cylinder(name, radius=1.0, depth=1.0, location=(0, 0, 0), segments=32, rotation=(0, 0, 0), scale=(1, 1, 1), radius2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (0.5 + math.atan2(co.y, co.x) / (2 * math.pi), co.z / depth + 0.5)
    ob = mesh_from_bm(name, bm)
    ob.location = location
    ob.rotation_euler = rotation
    ob.scale = scale
    return ob


def cone(name, radius=1.0, depth=1.0, location=(0, 0, 0), segments=32, rotation=(0, 0, 0), tip_radius=0.0):
    return cylinder(name, radius=radius, depth=depth, location=location, segments=segments, rotation=rotation, radius2=tip_radius)


def torus(name, major=1.0, minor=0.2, location=(0, 0, 0), rotation=(0, 0, 0), segments=48, rings=16, arc=2 * math.pi):
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    ringsv = []
    steps = segments if arc >= 2 * math.pi - 1e-6 else segments + 1
    for s in range(steps):
        a = arc * s / segments
        c = Vector((major * math.cos(a), major * math.sin(a), 0))
        radial = Vector((math.cos(a), math.sin(a), 0))
        ring = []
        for r in range(rings):
            b = 2 * math.pi * r / rings
            p = c + radial * (minor * math.cos(b)) + Vector((0, 0, minor * math.sin(b)))
            ring.append(bm.verts.new(p))
        ringsv.append(ring)
    closed = arc >= 2 * math.pi - 1e-6
    n = len(ringsv)
    for i in range(n if closed else n - 1):
        A, B = ringsv[i], ringsv[(i + 1) % n]
        for r in range(rings):
            r2 = (r + 1) % rings
            f = bm.faces.new((A[r], B[r], B[r2], A[r2]))
            for loop, uv in zip(f.loops, [(i / n, r / rings), ((i + 1) / n, r / rings), ((i + 1) / n, (r + 1) / rings), (i / n, (r + 1) / rings)]):
                loop[uv_layer].uv = uv
    if not closed:
        bm.faces.new(list(reversed(ringsv[0])))
        bm.faces.new(ringsv[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_from_bm(name, bm)
    ob.location = location
    ob.rotation_euler = rotation
    return ob


def rounded_box(name, size=(1, 1, 1), radius=0.1, location=(0, 0, 0), segments=4, rotation=(0, 0, 0)):
    """A box with bevelled edges (via bevel modifier, applied)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (co.x + 0.5, co.z + 0.5)
    ob = mesh_from_bm(name, bm, smooth=False)
    ob.scale = size
    ob.location = location
    ob.rotation_euler = rotation
    select_only(ob)
    bpy.ops.object.transform_apply(scale=True)
    if radius > 0:
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = min(radius, min(size) * 0.49)
        m.segments = segments
        m.limit_method = "NONE"
        apply_modifiers(ob)
        ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
        ob.data.update()
        # keep big flats crisp
        m2 = ob.modifiers.new("smooth_by_angle", "NODES")
        try:
            bpy.ops.object.modifier_remove(modifier=m2.name)
        except Exception:
            pass
    return ob


def arc_block(name, r_in, r_out, z0, z1, a0, a1, segments=12):
    """A curved block (for rook merlons) spanning angles a0..a1."""
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    inner_b, outer_b, inner_t, outer_t = [], [], [], []
    for s in range(segments + 1):
        a = a0 + (a1 - a0) * s / segments
        c, sn = math.cos(a), math.sin(a)
        inner_b.append(bm.verts.new((r_in * c, r_in * sn, z0)))
        outer_b.append(bm.verts.new((r_out * c, r_out * sn, z0)))
        inner_t.append(bm.verts.new((r_in * c, r_in * sn, z1)))
        outer_t.append(bm.verts.new((r_out * c, r_out * sn, z1)))
    for s in range(segments):
        bm.faces.new((outer_b[s], outer_b[s + 1], outer_t[s + 1], outer_t[s]))
        bm.faces.new((inner_b[s + 1], inner_b[s], inner_t[s], inner_t[s + 1]))
        bm.faces.new((outer_t[s], outer_t[s + 1], inner_t[s + 1], inner_t[s]))
        bm.faces.new((outer_b[s + 1], outer_b[s], inner_b[s], inner_b[s + 1]))
    bm.faces.new((outer_b[0], outer_t[0], inner_t[0], inner_b[0]))
    bm.faces.new((outer_t[-1], outer_b[-1], inner_b[-1], inner_t[-1]))
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (0.5 + math.atan2(co.y, co.x) / (2 * math.pi), (co.z - z0) / max(1e-6, (z1 - z0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for e in bm.edges:
        e.smooth = False
    ob = mesh_from_bm(name, bm)
    m = ob.modifiers.new("bevel", "BEVEL")
    m.width = (r_out - r_in) * 0.12
    m.segments = 2
    m.limit_method = "ANGLE"
    apply_modifiers(ob)
    return ob


# --------------------------------------------------------------------------
# export / preview
# --------------------------------------------------------------------------

def export_glb(filepath, objects=None):
    if objects is not None:
        bpy.ops.object.select_all(action="DESELECT")
        for o in objects:
            o.select_set(True)
            for c in o.children_recursive:
                c.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=objects is not None,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )
    print("exported", filepath)


def preview_render(filepath, look_at=(0, 0, 0.5), distance=4.0, elevation=0.35, azimuth=-0.9,
                   size=(900, 600), engine="BLENDER_EEVEE", samples=32, ortho=False):
    scn = bpy.context.scene
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    link(cam)
    scn.camera = cam
    target = Vector(look_at)
    pos = target + Vector((math.cos(azimuth) * math.cos(elevation), math.sin(azimuth) * math.cos(elevation), math.sin(elevation))) * distance
    cam.location = pos
    direction = target - pos
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 50
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = distance
    # three-point light
    for nm, loc, energy in (("Key", (3, -4, 5), 1500), ("Fill", (-4, -2, 3), 500), ("Rim", (0, 4, 4), 700)):
        ld = bpy.data.lights.new(nm, "POINT")
        ld.energy = energy
        ld.shadow_soft_size = 1.0
        lo = bpy.data.objects.new(nm, ld)
        lo.location = loc
        link(lo)
    world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.75, 0.82, 0.9, 1)
        bg.inputs[1].default_value = 0.6
    scn.render.resolution_x, scn.render.resolution_y = size
    scn.render.resolution_percentage = 100
    scn.render.filepath = filepath
    scn.render.image_settings.file_format = "PNG"
    try:
        scn.render.engine = engine
    except Exception:
        scn.render.engine = "BLENDER_EEVEE_NEXT"
    if hasattr(scn, "eevee"):
        scn.eevee.taa_render_samples = samples
    scn.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scn.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    bpy.ops.render.render(write_still=True)
    print("rendered", filepath)


def bake_vertex_colour(ob):
    """Write the object's material base colour into a COLOR_0 attribute."""
    me = ob.data
    col = (0.8, 0.8, 0.8, 1.0)
    if me.materials and me.materials[0] and me.materials[0].use_nodes:
        bsdf = me.materials[0].node_tree.nodes.get("Principled BSDF")
        if bsdf:
            col = tuple(bsdf.inputs["Base Color"].default_value)
    attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    n = len(me.loops)
    attr.data.foreach_set("color", list(col) * n)
    me.color_attributes.active_color = attr


def join_vertex_coloured(objects, name, material):
    """Bake each part's colour to vertex colours, join into one mesh with one material."""
    objects = [o for o in objects if o and o.type == "MESH"]
    for o in objects:
        bake_vertex_colour(o)
    ob = join(objects, name)
    ob.data.materials.clear()
    ob.data.materials.append(material)
    return ob


def vc_material(name="vertex_colour", roughness=0.5, coat=0.3):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    return mat

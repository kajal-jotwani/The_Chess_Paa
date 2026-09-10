"""
Build the six Staunton chess pieces on a virtual lathe and export them as
public/models/pieces.glb.  Units: the king is 1.0 tall; a board square is 0.6
(real tournament proportions: 95 mm king on a 57 mm square).

Run:  blender --background --python blender/build_pieces.py
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import bmesh
from mathutils import Vector
import lib
from lib import lathe, loft, ellipse_ring, uv_sphere, cylinder, cone, torus, arc_block, material, assign, join

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "models")
PREVIEW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".blender_work")
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

S = 0.01  # profile units (king = 100) -> metres-ish (king = 1.0)
K, SM = "k", "s"

# --------------------------------------------------------------------------
# lathe profiles  (r, z, kind)   kind: 'k' crisp ring, 's' smooth
# --------------------------------------------------------------------------

def base(rb, h_edge, h_bulge, r_neck, z_neck):
    """The classic Staunton foot: flat bottom, a small vertical edge, a soft
    bulge, then a crisp step down to the stem."""
    return [
        (0, 0, K), (rb, 0, K), (rb, h_edge, K),
        (rb - 0.4, h_edge + 1.4, SM), (rb * 0.86, h_bulge * 0.7, SM), (rb * 0.72, h_bulge, SM),
        (r_neck + 1.2, z_neck - 0.8, SM), (r_neck, z_neck, K),
    ]


PAWN = base(14, 1.8, 6.5, 8.0, 9.5) + [
    (7.2, 11.5, SM), (5.6, 19, SM), (5.0, 26, SM), (6.2, 30.5, SM), (8.8, 33, K), (8.8, 34.6, K),
    (6.2, 36.2, SM), (4.6, 37.2, SM), (6.8, 39.5, SM), (7.6, 43.5, SM), (5.8, 48, SM), (2.6, 50.4, SM), (0, 51, K),
]

ROOK = base(16, 2.0, 7.0, 10.2, 10.5) + [
    (9.6, 12.5, SM), (8.9, 18, SM), (8.6, 28, SM), (9.0, 36, SM), (9.8, 41, SM), (11.2, 44, SM), (12.8, 45.6, K), (12.8, 49.5, K),
    (10.6, 49.5, K), (10.6, 47.4, SM), (0, 47, K),
]

BISHOP = base(15, 2.0, 7.0, 9.2, 10.5) + [
    (8.2, 12.5, SM), (6.4, 20, SM), (5.2, 30, SM), (5.6, 37, SM), (7.2, 41.5, SM), (9.6, 44.2, K), (9.6, 45.8, K),
    (6.8, 47.5, SM), (5.6, 48.5, SM), (7.3, 52.5, SM), (8.2, 58, SM), (7.0, 63.5, SM), (4.4, 67, SM), (2.4, 68.6, K),
    (2.0, 69.2, SM), (3.3, 70.6, SM), (3.4, 72.6, SM), (2.2, 74.2, SM), (0, 74.8, K),
]

KNIGHT_BASE = base(15.5, 2.0, 7.0, 9.6, 10.5) + [
    (8.8, 12.5, SM), (8.0, 20, SM), (7.8, 30, SM), (8.6, 37, SM), (10.4, 41.5, SM), (12.0, 43.6, K), (12.0, 45.4, K), (0, 45.4, K),
]

QUEEN = base(18, 2.2, 8.0, 11.0, 11.5) + [
    (10.0, 13.5, SM), (7.6, 25, SM), (6.6, 40, SM), (7.0, 52, SM), (8.8, 60, SM), (11.8, 65.6, K), (11.8, 67.4, K),
    (8.6, 69.2, SM), (6.8, 70.4, SM), (8.2, 74.5, SM), (11.2, 80.5, SM), (13.0, 84.4, K), (11.4, 84.4, K), (10.0, 80.5, SM), (0, 79.5, K),
]

KING = base(19, 2.4, 8.4, 11.4, 12.5) + [
    (10.4, 14.5, SM), (8.2, 28, SM), (7.0, 44, SM), (7.6, 58, SM), (9.8, 67, SM), (12.8, 72.8, K), (12.8, 74.8, K),
    (9.6, 76.6, SM), (7.6, 78.2, SM), (8.8, 82.5, SM), (11.2, 88, SM), (12.0, 91.2, K), (10.6, 91.2, K), (9.2, 88, SM), (0, 87, K),
]


def build_lathe(name, profile):
    ob = lathe(name, profile, segments=72, subdiv=7, scale=S)
    return ob


PROFILES = {"pawn": PAWN, "rook": ROOK, "bishop": BISHOP, "knight": KNIGHT_BASE, "queen": QUEEN, "king": KING}


def radius_at(kind, z):
    """Outer lathe radius (metres) of a piece at height z (metres)."""
    prof = PROFILES[kind]
    zz = z / S
    best = 0.0
    for (r0, z0, _), (r1, z1, _) in zip(prof, prof[1:]):
        if z0 != z1 and (z0 - zz) * (z1 - zz) <= 0:
            t = (zz - z0) / (z1 - z0)
            best = max(best, r0 + (r1 - r0) * t)
    return best * S


def knight_head(name):
    """A Staunton knight: the classic side silhouette, extruded with a width
    that narrows toward the muzzle, then bevelled and subdivided.  Faces -Y."""
    sil = [(9.5, 45.4), (10.2, 52), (9.4, 60), (7.6, 68), (4.6, 76), (0.8, 83), (-3.0, 88), (-7.5, 90.2), (-11.5, 89.6),
           (-15.0, 87.6), (-18.2, 84.2), (-20.6, 80), (-21.8, 75.5), (-21.6, 71.2), (-19.8, 68.6), (-15.5, 68.8),
           (-11.5, 70.6), (-8.0, 73.6), (-6.0, 76.2), (-7.0, 71.5), (-8.6, 64), (-10.0, 54), (-11.0, 45.4)]
    # smooth the polygon a little (keeps corners at the base)
    pts = [Vector((y, z)) for y, z in sil]
    dense = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        if i >= n - 1:  # base edge stays straight
            dense.append(p1)
            continue
        for s in range(3):
            dense.append(lib._catmull(p0, p1, p2, p3, s / 3))

    def half_width(y, z):
        w = 8.5 - 3.3 * max(0.0, min(1.0, (-6.0 - y) / 15.8))
        if z > 86:
            w *= 0.92
        return w * S

    # Sweep the silhouette across X: each layer k in (-1, 1) is the outline
    # shrunk toward the head's spine by a super-ellipse factor, so the cross
    # section is rounded like a carved piece rather than a flat slab.
    spine = [Vector((y, z)) for y, z in [(0, 45), (0.5, 52), (1.5, 60), (2.0, 68), (0.5, 76), (-3.5, 83), (-10, 87.5), (-17, 85), (-21, 76)]]
    spine = [Vector((p.x, p.y)) for p in lib.smooth_points([Vector((q.x, q.y, 0)) for q in spine], 1, 6)]

    def nearest_spine(q):
        return min(spine, key=lambda sp: (sp - q).length_squared)

    M = 15
    rings = []
    for i in range(M):
        k = -0.999 * math.cos(math.pi * i / (M - 1))
        f = (1.0 - abs(k) ** 2.6) ** 0.42
        ring = []
        for q in dense:
            c = nearest_spine(q)
            p = c + (q - c) * f
            w = half_width(q.x, q.y)
            ring.append(Vector((k * w, p.x * S, p.y * S)))
        rings.append(ring)
    head = loft(name, rings, cap_start=True, cap_end=True)
    lib.subdivide(head, 1)
    lib.apply_modifiers(head)
    me = head.data
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = ((co.y / S + 25) / 50, (co.z / S - 45) / 55)
    parts = [head]
    # cheek/jowl bulges where the head meets the neck
    for sx in (-1, 1):
        jowl = uv_sphere(name + "_jowl", radius=4.6 * S, location=(sx * 5.4 * S, -8.5 * S, 78.0 * S), scale=(0.7, 1.15, 1.0), segments=20, rings=14)
        parts.append(jowl)
    # ears
    for sx in (-1, 1):
        ear = cone(name + "_ear", radius=3.0 * S, depth=10.0 * S, location=(sx * 3.8 * S, -6.0 * S, 92.5 * S), segments=16)
        ear.rotation_euler = (math.radians(-22), math.radians(sx * 12), 0)
        parts.append(ear)
    # eyes + nostrils
    for sx in (-1, 1):
        eye = uv_sphere(name + "_eye", radius=2.0 * S, location=(sx * 6.2 * S, -12.8 * S, 85.2 * S), segments=16, rings=12)
        parts.append(eye)
        n = uv_sphere(name + "_nostril", radius=1.2 * S, location=(sx * 2.4 * S, -21.6 * S, 74.4 * S), segments=12, rings=8)
        parts.append(n)
    # mane crest along the back of the neck
    crest_pts = [Vector((0, (y + 1.6) * S, z * S)) for y, z in [(9.5, 47), (10.4, 53), (9.6, 60), (7.8, 68), (4.8, 76), (1.0, 83), (-3.0, 88.5)]]
    crest_pts = lib.smooth_points(crest_pts, iterations=1, subdiv=4)
    _, T2, N2, B2 = lib.frame_along(crest_pts, up_hint=Vector((0, 1, 0)))
    crest = []
    for i, p in enumerate(crest_pts):
        k = i / (len(crest_pts) - 1)
        wobble = 1.0 + 0.45 * math.sin(i * 2.1)
        w = (2.0 + 0.8 * math.sin(k * math.pi)) * S
        d = (4.2 * math.sin(k * math.pi) + 1.5) * S * wobble
        u = Vector((1, 0, 0))
        v = T2[i].cross(u).normalized()
        crest.append(ellipse_ring(p, u, v, w, d, count=14))
    mane = loft(name + "_mane", crest, cap_start=True, cap_end=True)
    lib.subdivide(mane, 1)
    lib.apply_modifiers(mane)
    parts.append(mane)
    return join(parts, name)


def build_piece(kind):
    if kind == "pawn":
        ob = build_lathe("pawn", PAWN)
    elif kind == "rook":
        body = build_lathe("rook_body", ROOK)
        merlons = []
        n = 6
        for i in range(n):
            a0 = 2 * math.pi * i / n + 0.12
            a1 = 2 * math.pi * (i + 1) / n - 0.12
            merlons.append(arc_block(f"rook_merlon{i}", 10.6 * S, 12.8 * S, 49.4 * S, 57.5 * S, a0, a1, segments=10))
        ob = join([body] + merlons, "rook")
    elif kind == "bishop":
        body = build_lathe("bishop_body", BISHOP)
        cutter = lib.rounded_box("cutter", size=(30 * S, 1.6 * S, 14 * S), radius=0, location=(0, -6.5 * S, 60.5 * S))
        cutter.rotation_euler = (math.radians(38), 0, 0)
        lib.select_only(cutter)
        bpy.ops.object.transform_apply(rotation=True)
        lib.boolean_cut(body, cutter)
        ob = body
        ob.name = "bishop"
    elif kind == "knight":
        body = build_lathe("knight_body", KNIGHT_BASE)
        head = knight_head("knight_head")
        ob = join([body, head], "knight")
    elif kind == "queen":
        body = build_lathe("queen_body", QUEEN)
        parts = [body, uv_sphere("queen_ball", radius=3.6 * S, location=(0, 0, 87.6 * S))]
        for i in range(8):
            a = 2 * math.pi * i / 8
            parts.append(uv_sphere(f"queen_pt{i}", radius=1.9 * S, location=(math.cos(a) * 12.2 * S, math.sin(a) * 12.2 * S, 85.6 * S), segments=16, rings=10))
        ob = join(parts, "queen")
    elif kind == "king":
        body = build_lathe("king_body", KING)
        neck = cylinder("king_neck", radius=2.6 * S, depth=3 * S, location=(0, 0, 92.6 * S))
        v = lib.rounded_box("king_cross_v", size=(2.6 * S, 2.6 * S, 12.5 * S), radius=0.5 * S, location=(0, 0, 99.5 * S))
        h = lib.rounded_box("king_cross_h", size=(8.6 * S, 2.6 * S, 2.6 * S), radius=0.5 * S, location=(0, 0, 101.2 * S))
        ob = join([body, neck, v, h], "king")
    ob.location = (0, 0, 0)
    return ob


def main():
    lib.reset_scene()
    white = material("piece_white", color=(0.86, 0.78, 0.62), roughness=0.35, coat=0.4)
    black = material("piece_black", color=(0.10, 0.07, 0.05), roughness=0.3, coat=0.5)
    pieces = {}
    for i, kind in enumerate(["king", "queen", "bishop", "knight", "rook", "pawn"]):
        ob = build_piece(kind)
        assign(ob, white)
        lib.select_only(ob)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.location = (i * 0.5 - 1.25, 0, 0)
        pieces[kind] = ob
    # sanity: heights
    for kind, ob in pieces.items():
        zs = [v.co.z for v in ob.data.vertices]
        print(f"{kind:7s} height={max(zs):.3f} base_r={max(math.hypot(v.co.x-ob.location.x, v.co.y) for v in ob.data.vertices if v.co.z<0.002):.3f} verts={len(ob.data.vertices)}")
    lib.preview_render(os.path.join(PREVIEW, "pieces_preview.png"), look_at=(0, 0, 0.45), distance=3.6, elevation=0.28, azimuth=-1.35, size=(1200, 600))
    for ob in pieces.values():
        ob.location = (0, 0, 0)
    lib.export_glb(os.path.join(OUT, "pieces.glb"), list(pieces.values()))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(PREVIEW, "pieces.blend"))
    # low-detail set for the scenery boards, carousel and physics props
    for ob in pieces.values():
        m = ob.modifiers.new("lod", "DECIMATE")
        m.ratio = 0.18
        lib.apply_modifiers(ob)
        print(f"lod {ob.name}: {len(ob.data.polygons)} faces")
    lib.export_glb(os.path.join(OUT, "pieces_lod.glb"), list(pieces.values()))


if __name__ == "__main__":
    main()

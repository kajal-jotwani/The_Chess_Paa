"""
Piece-folk: the chess pieces as little characters (eyes, brows, smiles, cheeks,
arms with mitten hands, stick legs with shoes) for the coaster riders and the
park wanderers.  Exports public/models/piecefolk.glb with one root per piece:
  <kind>_folk > body, armL, armR, legs
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Euler
import lib
from lib import uv_sphere, tube, cylinder, material, assign, empty, set_parent, rounded_box, join
import build_pieces as bp

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "models")
WORK = os.path.join(HERE, "..", ".blender_work")

# per piece: (face z, face radius at that z, arm z, arm radius, base radius)
FACE = {
    "pawn":   (0.435, 0.076, 0.30, 0.058, 0.14),
    "rook":   (0.385, 0.095, 0.30, 0.088, 0.16),
    "bishop": (0.565, 0.082, 0.40, 0.060, 0.15),
    "knight": (None, None, 0.36, 0.088, 0.155),
    "queen":  (0.585, 0.090, 0.45, 0.070, 0.18),
    "king":   (0.640, 0.088, 0.50, 0.074, 0.19),
}


def face(parent, kind, z, scale=1.0):
    r = bp.radius_at(kind, z + 0.01)
    white = material("eye_white", color=(0.97, 0.97, 0.95), roughness=0.3)
    pupil = material("pupil", color=(0.08, 0.05, 0.04), roughness=0.25)
    brow_m = material("brow_dark", color=(0.15, 0.10, 0.08), roughness=0.7)
    mouth_m = material("mouth", color=(0.55, 0.08, 0.08), roughness=0.5)
    pink = material("cheek", color=(0.95, 0.55, 0.55), roughness=0.6)
    parts = []
    er = 0.024 * scale
    for sx in (-1, 1):
        a = math.radians(sx * 22)
        ex, ey = r * math.sin(a), -r * math.cos(a)
        eye = uv_sphere(f"eye{sx}", radius=er, location=(ex, ey, z + 0.01), segments=18, rings=12)
        assign(eye, white)
        pup = uv_sphere(f"pupil{sx}", radius=er * 0.55, location=(ex * 1.0, ey - er * 0.75, z + 0.011), segments=12, rings=10)
        assign(pup, pupil)
        glint = uv_sphere(f"glint{sx}", radius=er * 0.18, location=(ex - sx * er * 0.25, ey - er * 1.1, z + 0.02), segments=8, rings=6)
        assign(glint, white)
        zb = z + 0.01 + er * 1.8
        rb = bp.radius_at(kind, zb)
        brow = rounded_box(f"brow{sx}", size=(er * 2.2, 0.012, er * 0.55), radius=0.004, location=(rb * math.sin(a), -rb * math.cos(a) - 0.003, zb))
        brow.rotation_euler = (0, math.radians(sx * -14), math.radians(sx * -22))
        assign(brow, brow_m)
        zc = z - er * 1.4
        rc = bp.radius_at(kind, zc)
        cheek = uv_sphere(f"cheek{sx}", radius=er * 0.8, location=(rc * math.sin(math.radians(sx * 40)), -rc * math.cos(math.radians(sx * 40)) - 0.002, zc), scale=(1, 0.45, 0.8), segments=12, rings=8)
        cheek.rotation_euler = (0, 0, math.radians(sx * 40))
        assign(cheek, pink)
        parts += [eye, pup, glint, brow, cheek]
    arc = []
    for i in range(13):
        a = math.radians(205 + 130 * i / 12)
        px = 0.032 * scale * math.cos(a)
        pz = z - 0.028 * scale + 0.022 * scale * math.sin(a)
        rz = bp.radius_at(kind, pz)
        py = -math.sqrt(max(0.0, rz * rz - px * px)) - 0.004
        arc.append((px, py, pz))
    smile = tube("smile", arc, 0.0045 * scale, count=8)
    assign(smile, mouth_m)
    parts.append(smile)
    for p in parts:
        set_parent(p, parent)
    return parts


def build_folk(kind, colour):
    z_face, r_face, z_arm, r_arm, r_base = FACE[kind]
    root = empty(f"{kind}_folk")
    body = bp.build_piece(kind)
    lib.select_only(body)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    body.name = "body"
    assign(body, colour)
    set_parent(body, root)
    skin = colour
    if z_face is not None:
        face(root, kind, z_face)
    # arms
    mitten = material("mitten", color=(0.98, 0.98, 0.96), roughness=0.5)
    for sx, side in ((-1, "L"), (1, "R")):
        shoulder = empty(f"arm{side}", location=(sx * (r_arm - 0.005), 0, z_arm), parent=root)
        pts = lib.smooth_points([(0, 0, 0), (sx * 0.05, -0.01, -0.03), (sx * 0.10, -0.03, -0.055), (sx * 0.14, -0.05, -0.07)], 1, 4)
        arm = tube(f"arm{side}_mesh", pts, 0.016, count=10, radii=[0.018 - 0.004 * i / (len(pts) - 1) for i in range(len(pts))])
        assign(arm, colour)
        set_parent(arm, shoulder, keep_world=False)
        hand = uv_sphere(f"hand{side}", radius=0.026, location=(sx * 0.15, -0.055, -0.075), segments=16, rings=12)
        assign(hand, mitten)
        set_parent(hand, shoulder, keep_world=False)
    # legs (hidden when seated): stick legs from under the base
    legs = empty("legs", location=(0, 0, 0), parent=root)
    shoe_m = material("folk_shoe", color=(0.72, 0.13, 0.10), roughness=0.4, coat=0.5)
    for sx in (-1, 1):
        leg = cylinder(f"leg{sx}", radius=0.012, depth=0.09, location=(sx * r_base * 0.45, 0.0, -0.045), segments=10)
        assign(leg, colour)
        set_parent(leg, legs, keep_world=False)
        shoe = uv_sphere(f"shoe{sx}", radius=0.03, location=(sx * r_base * 0.45, -0.015, -0.095), scale=(0.9, 1.6, 0.55), segments=16, rings=10)
        assign(shoe, shoe_m)
        set_parent(shoe, legs, keep_world=False)
    return root


def main():
    lib.reset_scene()
    cream = material("folk_cream", color=(0.92, 0.86, 0.72), roughness=0.4, coat=0.4)
    brown = material("folk_brown", color=(0.36, 0.22, 0.12), roughness=0.4, coat=0.4)
    roots = []
    kinds = ["king", "queen", "bishop", "knight", "rook", "pawn"]
    for i, kind in enumerate(kinds):
        r = build_folk(kind, cream if i % 2 == 0 else brown)
        r.location = (i * 0.5 - 1.25, 0, 0)
        roots.append(r)
    lib.preview_render(os.path.join(WORK, "piecefolk_preview.png"), look_at=(0, 0, 0.45), distance=3.4, elevation=0.2, azimuth=-1.5, size=(1200, 600))
    for r in roots:
        r.location = (0, 0, 0)
    lib.export_glb(os.path.join(OUT, "piecefolk.glb"), roots)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "piecefolk.blend"))


if __name__ == "__main__":
    main()

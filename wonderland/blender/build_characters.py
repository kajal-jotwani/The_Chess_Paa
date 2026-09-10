"""
ChessPaa (the grandfather) and his two grandchildren.
Exports public/models/chesspaa.glb and public/models/kids.glb.
Hierarchies keep the joints as named nodes so Three.js can animate them:
  ChessPaa > head, armL > forearmL > handL, armR > forearmR > handR > megaphone, legL, legR

Run:  blender --background --python blender/build_characters.py
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import numpy as np
from mathutils import Vector, Euler
import lib
from lib import lathe, loft, ellipse_ring, uv_sphere, cylinder, cone, torus, tube, material, assign, join, empty, set_parent, rounded_box

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "models")
WORK = os.path.join(HERE, "..", ".blender_work")
os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)
K, SM = "k", "s"


def plaid_image(name, base=(0.82, 0.90, 0.62), line=(0.42, 0.66, 0.30), size=256, period=40, width=5):
    img = np.zeros((size, size, 4), dtype=np.float32)
    img[..., :3] = base
    img[..., 3] = 1.0
    for i in range(0, size, period):
        img[i:i + width, :, :3] = line
        img[:, i:i + width, :3] = line
        j = i + period // 2
        img[j:j + 2, :, :3] = (0.95, 0.98, 0.9)
        img[:, j:j + 2, :3] = (0.95, 0.98, 0.9)
    return lib.image_from_pixels(name, size, size, img.reshape(-1).tolist())


def capsule(name, radius, length, location=(0, 0, 0), segments=24):
    """A capsule whose origin is at its TOP end, extending down -Z (a limb)."""
    n = 6
    prof = [(0, -length, K)]
    for i in range(1, n + 1):  # bottom hemisphere, pole -> equator
        a = (math.pi / 2) * i / n
        prof.append((radius * math.sin(a), -length + radius * (1 - math.cos(a)), SM))
    prof.append((radius, -radius, SM))
    for i in range(1, n + 1):  # top hemisphere, equator -> pole
        a = (math.pi / 2) * i / n
        prof.append((radius * math.cos(a), -radius + radius * math.sin(a), SM))
    prof[-1] = (0, 0, K)
    ob = lathe(name, prof, segments=segments, subdiv=3, scale=1.0)
    ob.location = location
    return ob


# --------------------------------------------------------------------------
# ChessPaa
# --------------------------------------------------------------------------

def build_chesspaa():
    skin = material("skin", color=(0.93, 0.76, 0.62), roughness=0.55, subsurface=0.1)
    hair = material("hair", color=(0.36, 0.20, 0.10), roughness=0.75)
    beard_m = material("beard", color=(0.40, 0.24, 0.13), roughness=0.85)
    teal = material("overalls", color=(0.10, 0.62, 0.64), roughness=0.7)
    shirt = material("shirt", color=(0.82, 0.9, 0.62), roughness=0.8, image=plaid_image("plaid"))
    white = material("eye_white", color=(0.97, 0.97, 0.95), roughness=0.3)
    pupil = material("pupil", color=(0.08, 0.05, 0.04), roughness=0.25)
    red = material("shoe_red", color=(0.72, 0.13, 0.10), roughness=0.4, coat=0.6)
    mouth_m = material("mouth", color=(0.55, 0.08, 0.08), roughness=0.5)
    tongue_m = material("tongue", color=(0.85, 0.35, 0.40), roughness=0.5)
    yellow = material("megaphone_yellow", color=(0.95, 0.72, 0.10), roughness=0.35, metallic=0.1, coat=0.5)
    gold = material("gold", color=(0.85, 0.65, 0.2), roughness=0.3, metallic=0.9)
    glass = material("glass", color=(0.8, 0.9, 1.0), roughness=0.05, alpha=0.25)
    pink = material("cheek", color=(0.95, 0.55, 0.55), roughness=0.6)
    button_m = material("button", color=(0.98, 0.82, 0.2), roughness=0.3, metallic=0.3)

    root = empty("ChessPaa")
    parts = []

    # ---- torso: overalls (lower) + shirt (upper), one lathe each
    body_profile = [(0, 0.60, K), (0.17, 0.60, K), (0.235, 0.66, SM), (0.275, 0.80, SM), (0.29, 0.92, SM), (0.285, 1.02, SM)]
    overalls = lathe("overalls", body_profile + [(0.283, 1.06, SM), (0, 1.06, K)], segments=48, subdiv=5)
    assign(overalls, teal)
    shirt_profile = [(0, 1.0, K), (0.283, 1.0, K), (0.27, 1.12, SM), (0.235, 1.24, SM), (0.17, 1.31, SM), (0.09, 1.35, SM), (0, 1.36, K)]
    shirt_ob = lathe("shirt", shirt_profile, segments=48, subdiv=5)
    assign(shirt_ob, shirt)
    bib = rounded_box("bib", size=(0.30, 0.05, 0.24), radius=0.02, location=(0, -0.255, 1.13))
    assign(bib, teal)
    for sx in (-1, 1):
        strap_pts = lib.smooth_points([(sx * 0.11, -0.27, 1.20), (sx * 0.13, -0.22, 1.30), (sx * 0.15, -0.05, 1.335), (sx * 0.15, 0.12, 1.31), (sx * 0.13, 0.24, 1.15)], 1, 4)
        strap = tube(f"strap{sx}", strap_pts, 0.022, count=10)
        assign(strap, teal)
        parts.append(strap)
        btn = uv_sphere(f"button{sx}", radius=0.022, location=(sx * 0.11, -0.283, 1.21), segments=16, rings=10)
        assign(btn, button_m)
        parts.append(btn)
    parts += [overalls, shirt_ob, bib]

    # ---- neck + head
    neck = cylinder("neck", radius=0.075, depth=0.12, location=(0, 0, 1.36))
    assign(neck, skin)
    head = uv_sphere("head_mesh", radius=0.27, location=(0, 0, 1.63), scale=(1, 0.96, 1.06), segments=48, rings=32)
    assign(head, skin)
    nose = uv_sphere("nose", radius=0.058, location=(0, -0.265, 1.585), scale=(1, 0.9, 0.85), segments=24, rings=16)
    assign(nose, skin)
    head_parts = [head, nose]
    for sx in (-1, 1):
        ear = uv_sphere(f"ear{sx}", radius=0.052, location=(sx * 0.265, 0.01, 1.61), scale=(0.6, 1, 1), segments=16, rings=12)
        assign(ear, skin)
        eye = uv_sphere(f"eye{sx}", radius=0.054, location=(sx * 0.105, -0.228, 1.67), segments=24, rings=16)
        assign(eye, white)
        pup = uv_sphere(f"pupil{sx}", radius=0.028, location=(sx * 0.105, -0.272, 1.672), segments=16, rings=12)
        assign(pup, pupil)
        glint = uv_sphere(f"glint{sx}", radius=0.009, location=(sx * 0.095, -0.296, 1.688), segments=10, rings=8)
        assign(glint, white)
        brow = rounded_box(f"brow{sx}", size=(0.105, 0.03, 0.028), radius=0.012, location=(sx * 0.105, -0.222, 1.745))
        brow.rotation_euler = (0, math.radians(sx * -12), 0)
        assign(brow, hair)
        cheek = uv_sphere(f"cheek{sx}", radius=0.04, location=(sx * 0.19, -0.19, 1.57), scale=(1, 0.5, 0.8), segments=16, rings=12)
        assign(cheek, pink)
        head_parts += [ear, eye, pup, glint, brow, cheek]
    # monocle on the +X eye
    mono = torus("monocle", major=0.072, minor=0.011, location=(0.105, -0.29, 1.67), rotation=(math.pi / 2, 0, 0), segments=40, rings=12)
    assign(mono, gold)
    lens = cylinder("lens", radius=0.066, depth=0.006, location=(0.105, -0.29, 1.67), rotation=(math.pi / 2, 0, 0), segments=32)
    assign(lens, glass)
    chain_pts = lib.smooth_points([(0.17, -0.27, 1.64), (0.23, -0.25, 1.52), (0.28, -0.22, 1.40), (0.27, -0.2, 1.30)], 1, 4)
    chain = tube("monocle_chain", chain_pts, 0.004, count=8)
    assign(chain, gold)
    head_parts += [mono, lens, chain]
    # hair: back cap + bun
    cap = uv_sphere("hair_cap", radius=0.268, location=(0, 0.055, 1.665), scale=(1, 1, 0.92), segments=40, rings=24)
    assign(cap, hair)
    bun = uv_sphere("bun", radius=0.1, location=(0, 0.03, 1.94), scale=(1, 1, 0.85), segments=24, rings=16)
    assign(bun, hair)
    knot = torus("bun_knot", major=0.075, minor=0.02, location=(0, 0.03, 1.885), segments=24, rings=10)
    assign(knot, hair)
    head_parts += [cap, bun, knot]
    # beard: lofted blob, fluffed with a displace texture
    rings = []
    spec = [(1.62, 0.29, 0.22, -0.06, 0.0), (1.55, 0.31, 0.25, -0.08, 0.15), (1.46, 0.30, 0.23, -0.11, 0.25), (1.34, 0.245, 0.18, -0.16, 0.3),
            (1.22, 0.17, 0.12, -0.21, 0.3), (1.12, 0.09, 0.07, -0.245, 0.2), (1.06, 0.03, 0.03, -0.25, 0.0)]
    for z, a, b, yc, egg in spec:
        rings.append(ellipse_ring(Vector((0, yc, z)), Vector((1, 0, 0)), Vector((0, -1, 0)), a, b, count=36, egg=egg))
    beard = loft("beard", rings, cap_start=True, cap_end=True)
    lib.subdivide(beard, 1)
    tex = bpy.data.textures.new("fluff", "CLOUDS")
    tex.noise_scale = 0.06
    tex.noise_depth = 2
    disp = beard.modifiers.new("fluff", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.035
    disp.mid_level = 0.5
    lib.apply_modifiers(beard)
    assign(beard, beard_m)
    head_parts.append(beard)
    # moustache
    for sx in (-1, 1):
        mp = lib.smooth_points([(0, -0.285, 1.535), (sx * 0.06, -0.30, 1.52), (sx * 0.13, -0.295, 1.53), (sx * 0.19, -0.265, 1.565)], 1, 4)
        radii = [0.024 * (1 - 0.6 * (i / (len(mp) - 1))) for i in range(len(mp))]
        m = tube(f"moustache{sx}", mp, 0.02, count=10, radii=radii)
        assign(m, beard_m)
        head_parts.append(m)
    # open smiling mouth
    mouth = uv_sphere("mouth", radius=0.075, location=(0, -0.29, 1.465), scale=(1.15, 0.5, 0.8), segments=24, rings=16)
    assign(mouth, mouth_m)
    teeth = rounded_box("teeth", size=(0.11, 0.03, 0.028), radius=0.008, location=(0, -0.325, 1.50))
    assign(teeth, white)
    tongue = uv_sphere("tongue", radius=0.04, location=(0, -0.31, 1.44), scale=(1, 0.8, 0.5), segments=16, rings=10)
    assign(tongue, tongue_m)
    head_parts += [mouth, teeth, tongue]

    head_node = empty("head", location=(0, 0, 1.40), parent=root)
    for p in head_parts:
        set_parent(p, head_node)
    set_parent(neck, root)
    for p in parts:
        set_parent(p, root)

    # ---- arms (pivot at the shoulder, limb hangs down -Z in local space)
    for sx, side in ((-1, "L"), (1, "R")):
        shoulder = empty(f"arm{side}", location=(sx * 0.27, 0.0, 1.25), parent=root)
        upper = capsule(f"upperarm{side}", 0.078, 0.30)
        assign(upper, shirt)
        set_parent(upper, shoulder, keep_world=False)
        elbow = empty(f"forearm{side}", location=(0, 0, -0.28), parent=shoulder, world=False)
        fore = capsule(f"forearm{side}_mesh", 0.068, 0.27)
        assign(fore, shirt)
        set_parent(fore, elbow, keep_world=False)
        hand_node = empty(f"hand{side}", location=(0, 0, -0.27), parent=elbow, world=False)
        hand = uv_sphere(f"hand{side}_mesh", radius=0.072, location=(0, 0, -0.02), segments=20, rings=14)
        assign(hand, skin)
        set_parent(hand, hand_node, keep_world=False)
        if side == "R":
            # megaphone in the right hand: bell points along local -Y (forward), handle in the hand
            mega = empty("megaphone", location=(0, -0.05, -0.02), parent=hand_node, world=False)
            bell = cone("mega_bell", radius=0.06, depth=0.34, location=(0, -0.24, 0.0), rotation=(math.pi / 2, 0, 0), tip_radius=0.17, segments=40)
            assign(bell, yellow)
            mouthpiece = cylinder("mega_mouth", radius=0.045, depth=0.09, location=(0, -0.03, 0.0), rotation=(math.pi / 2, 0, 0), segments=24)
            assign(mouthpiece, yellow)
            handle = rounded_box("mega_handle", size=(0.03, 0.12, 0.05), radius=0.01, location=(0, -0.11, -0.055))
            assign(handle, gold)
            rim = torus("mega_rim", major=0.17, minor=0.012, location=(0, -0.41, 0.0), rotation=(math.pi / 2, 0, 0), segments=40, rings=10)
            assign(rim, gold)
            for m in (bell, mouthpiece, handle, rim):
                set_parent(m, mega, keep_world=False)

    # rest pose (applied after all parenting)
    for sx, side in ((-1, "L"), (1, "R")):
        bpy.data.objects[f"arm{side}"].rotation_euler = Euler((math.radians(-10), math.radians(-sx * 22), 0), "XYZ")
        bpy.data.objects[f"forearm{side}"].rotation_euler = Euler((math.radians(-35), 0, 0), "XYZ")

    # ---- legs + shoes
    for sx, side in ((-1, "L"), (1, "R")):
        hip = empty(f"leg{side}", location=(sx * 0.12, 0.0, 0.66), parent=root)
        leg = capsule(f"leg{side}_mesh", 0.095, 0.56)
        assign(leg, teal)
        set_parent(leg, hip, keep_world=False)
        shoe = uv_sphere(f"shoe{side}", radius=0.1, location=(0, -0.05, -0.58), scale=(0.85, 1.5, 0.62), segments=24, rings=16)
        assign(shoe, red)
        set_parent(shoe, hip, keep_world=False)
    return root


# --------------------------------------------------------------------------
# grandchildren
# --------------------------------------------------------------------------

def build_kid(name, skin_c, hair_c, shirt_c, shorts_c, curly, x=0.0):
    skin = material(f"{name}_skin", color=skin_c, roughness=0.55, subsurface=0.1)
    hair = material(f"{name}_hair", color=hair_c, roughness=0.8)
    shirt = material(f"{name}_shirt", color=shirt_c, roughness=0.8)
    shorts = material(f"{name}_shorts", color=shorts_c, roughness=0.75)
    white = material("eye_white", color=(0.97, 0.97, 0.95), roughness=0.3)
    pupil = material("pupil", color=(0.08, 0.05, 0.04), roughness=0.25)
    mouth_m = material("mouth", color=(0.55, 0.08, 0.08), roughness=0.5)
    shoe_m = material(f"{name}_shoe", color=(0.95, 0.95, 0.92), roughness=0.5)
    pink = material("cheek", color=(0.95, 0.55, 0.55), roughness=0.6)
    H = 0.62  # scale of a 1.0-unit adult layout -> child ~1.0 m tall
    root = empty(name, location=(0, 0, 0))
    torso = lathe("torso", [(0, 0.34, K), (0.13, 0.34, K), (0.155, 0.40, SM), (0.165, 0.52, SM), (0.15, 0.64, SM), (0.11, 0.70, SM), (0.05, 0.725, SM), (0, 0.73, K)], segments=36, subdiv=5)
    assign(torso, shirt)
    pants = lathe("shorts", [(0, 0.24, K), (0.14, 0.24, K), (0.15, 0.30, SM), (0.145, 0.36, SM), (0, 0.36, K)], segments=36, subdiv=4)
    assign(pants, shorts)
    neck = cylinder("neck", radius=0.045, depth=0.08, location=(0, 0, 0.74))
    assign(neck, skin)
    head_node = empty("head", location=(0, 0, 0.76), parent=root)
    head = uv_sphere("head_mesh", radius=0.165, location=(0, 0, 0.92), scale=(1, 0.96, 1.05), segments=40, rings=28)
    assign(head, skin)
    nose = uv_sphere("nose", radius=0.028, location=(0, -0.165, 0.90), segments=16, rings=12)
    assign(nose, skin)
    hp = [head, nose]
    for sx in (-1, 1):
        eye = uv_sphere(f"eye{sx}", radius=0.032, location=(sx * 0.062, -0.142, 0.945), segments=20, rings=14)
        assign(eye, white)
        pup = uv_sphere(f"pupil{sx}", radius=0.017, location=(sx * 0.062, -0.168, 0.946), segments=14, rings=10)
        assign(pup, pupil)
        cheek = uv_sphere(f"cheek{sx}", radius=0.028, location=(sx * 0.115, -0.115, 0.875), scale=(1, 0.5, 0.8), segments=14, rings=10)
        assign(cheek, pink)
        ear = uv_sphere(f"ear{sx}", radius=0.032, location=(sx * 0.16, 0.0, 0.905), scale=(0.6, 1, 1), segments=14, rings=10)
        assign(ear, skin)
        hp += [eye, pup, cheek, ear]
    # smile: tube along an arc on the face surface
    arc = []
    for i in range(13):
        a = math.radians(200 + 140 * i / 12)
        px, pz = 0.055 * math.cos(a), 0.86 + 0.045 * math.sin(a) + 0.02
        py = -math.sqrt(max(0.0, 0.16 ** 2 - px ** 2 - (pz - 0.92) ** 2)) - 0.006
        arc.append((px, py, pz))
    smile = tube("smile", arc, 0.007, count=8)
    assign(smile, mouth_m)
    hp.append(smile)
    if curly:
        rng = np.random.default_rng(7)
        for i in range(22):
            a = rng.uniform(0, 2 * math.pi)
            e = rng.uniform(0.15, 1.35)
            r = 0.165
            loc = (r * math.cos(e) * math.cos(a) * 0.98, r * math.cos(e) * math.sin(a) * 0.98 + 0.02, 0.92 + r * math.sin(e))
            if loc[1] < -0.09 and loc[2] < 0.99:
                continue
            curl = uv_sphere(f"curl{i}", radius=rng.uniform(0.045, 0.065), location=loc, segments=14, rings=10)
            assign(curl, hair)
            hp.append(curl)
    else:
        cap = uv_sphere("hair_cap", radius=0.172, location=(0, 0.025, 0.95), scale=(1, 1, 0.8), segments=32, rings=20)
        assign(cap, hair)
        fringe = uv_sphere("fringe", radius=0.09, location=(0, -0.11, 1.03), scale=(1.4, 0.7, 0.5), segments=20, rings=12)
        assign(fringe, hair)
        hp += [cap, fringe]
    for p in hp:
        set_parent(p, head_node)
    for p in (torso, pants, neck):
        set_parent(p, root)
    for sx, side in ((-1, "L"), (1, "R")):
        shoulder = empty(f"arm{side}", location=(sx * 0.155, 0, 0.66), parent=root)
        upper = capsule(f"upperarm{side}", 0.042, 0.17)
        assign(upper, shirt)
        set_parent(upper, shoulder, keep_world=False)
        elbow = empty(f"forearm{side}", location=(0, 0, -0.16), parent=shoulder, world=False)
        fore = capsule(f"forearm{side}_mesh", 0.038, 0.16)
        assign(fore, skin)
        set_parent(fore, elbow, keep_world=False)
        hand = uv_sphere(f"hand{side}", radius=0.042, location=(0, 0, -0.17), segments=16, rings=12)
        assign(hand, skin)
        set_parent(hand, elbow, keep_world=False)
        hip = empty(f"leg{side}", location=(sx * 0.07, 0, 0.28), parent=root)
        leg = capsule(f"leg{side}_mesh", 0.05, 0.25)
        assign(leg, skin)
        set_parent(leg, hip, keep_world=False)
        shoe = uv_sphere(f"shoe{side}", radius=0.055, location=(0, -0.02, -0.255), scale=(0.9, 1.5, 0.6), segments=20, rings=12)
        assign(shoe, shoe_m)
        set_parent(shoe, hip, keep_world=False)
    for sx, side in ((-1, "L"), (1, "R")):
        for o in root.children_recursive:
            if o.name.startswith(f"arm{side}") and o.type == "EMPTY":
                o.rotation_euler = Euler((math.radians(-8), math.radians(-sx * 18), 0), "XYZ")
            if o.name.startswith(f"forearm{side}") and o.type == "EMPTY":
                o.rotation_euler = Euler((math.radians(-30), 0, 0), "XYZ")
    root.location = (x, 0, 0)
    return root


def main():
    lib.reset_scene()
    paa = build_chesspaa()
    lib.preview_render(os.path.join(WORK, "chesspaa_preview.png"), look_at=(0, 0, 1.05), distance=4.2, elevation=0.12, azimuth=-1.35, size=(700, 900))
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o)
    lib.preview_render(os.path.join(WORK, "chesspaa_side.png"), look_at=(0, 0, 1.05), distance=4.2, elevation=0.15, azimuth=-0.6, size=(700, 900))
    lib.export_glb(os.path.join(OUT, "chesspaa.glb"), [paa])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "chesspaa.blend"))

    lib.reset_scene()
    kids = [
        build_kid("kid_a", (0.55, 0.33, 0.20), (0.08, 0.05, 0.04), (0.88, 0.30, 0.25), (0.20, 0.35, 0.62), True, x=-0.5),
        build_kid("kid_b", (0.66, 0.42, 0.26), (0.10, 0.06, 0.04), (0.22, 0.48, 0.85), (0.80, 0.68, 0.45), False, x=0.5),
    ]
    lib.preview_render(os.path.join(WORK, "kids_preview.png"), look_at=(0, 0, 0.55), distance=3.0, elevation=0.12, azimuth=-1.45, size=(800, 700))
    for k in kids:
        k.location = (0, 0, 0)
    lib.export_glb(os.path.join(OUT, "kids.glb"), kids)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "kids.blend"))


if __name__ == "__main__":
    main()

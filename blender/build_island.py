"""
Builds the island, stools, studio backdrop, lights and cameras in a scene called "Island".

Dimensions from Daniel Bruce's construction drawing (references/island-rev-B-for-construction.pdf,
summarised in references/island-measurements.md), with the same names and values as
src/scene/island.ts. Values are written in three.js axes (x along the island, y up, z towards the
stools) and converted to Blender axes (z up) by V(), so a glTF export lands where the site expects it.

Build in an open Blender (Scripting tab, or over MCP):
    exec(open("<project>/blender/build_island.py").read())
Render the saved file's test cameras in the background:
    Blender -b blender/island.blend -P blender/build_island.py -- --render blender/renders [--preview]
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector


def mm(v):
    return v / 1000


DIM = {
    "topY": mm(918),
    "topThick": mm(12),
    "topX": (mm(-1000), mm(1000)),
    "topZ": (mm(-375), mm(375)),
    "cornerRadius": mm(80),  # stool side, knee-well end only
    "carcassY": (mm(245), mm(906)),
    "bodyX": mm(995),  # carcass and leg frame stop 5 short of the worktop at each end
    "bodyZ": mm(370),
    "endPanel": mm(22),
    "front": mm(18),
    "gap": mm(3),
    "divider": (mm(-17.5), mm(27.5)),  # 45 between knee well and bookshelf, blue side + oak lining
    "kneeBackZ": mm(375 - 230),
    "lining": mm(18),
    "shelfX": (mm(27.5), mm(955)),  # 927.5 clear
    "shelfBackZ": mm(370 - 271),
    "shelfThick": mm(19),
    "bottomShelfTop": mm(267),
    "midShelfTop": mm(586.5),
    "topBoardUnder": mm(887),
    "leg": mm(45),
    "railY": (mm(200), mm(245)),
    "rail": mm(22),
    "stoolSeatY": mm(680),
}


def V(x, y, z):
    """three.js axes to Blender axes."""
    return Vector((x, -z, y))


# ---------- scene ----------

def island_scene():
    if bpy.app.background:
        scn = bpy.context.scene
    else:
        scn = bpy.data.scenes.get("Island") or bpy.data.scenes.new("Island")
        bpy.context.window.scene = scn
    for o in list(scn.objects):
        bpy.data.objects.remove(o)
    scn.name = "Island"
    return scn


def collection(scn, name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
    if c.name not in scn.collection.children:
        scn.collection.children.link(c)
    return c


def finish(obj, coll, bevel=mm(1.5), segments=3, angle=30):
    coll.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    if bevel:
        m = obj.modifiers.new("Bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(angle)
        m.harden_normals = True
    return obj


class Grain:
    """A wood material plus the local axis ('X', 'Y' or 'Z') its grain runs along."""

    def __init__(self, mat, axis):
        self.mat, self.axis = mat, axis


VENEER_SIZE = 1.83  # metres covered by one tile of the oak veneer scan


def grain_uv(obj, axis):
    """Planar UVs per face, with the texture's V (its grain) along the given axis.
    A random offset per object keeps neighbouring boards from repeating."""
    g = "XYZ".index(axis)
    h = sum(map(ord, obj.name))
    off = ((h * 0.37) % 1, (h * 0.61) % 1)
    me = obj.data
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        k = max(range(3), key=lambda i: abs(poly.normal[i]))
        across = next(i for i in range(3) if i not in (k, g)) if k != g else (g + 1) % 3
        along = g if k != g else (g + 2) % 3
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (co[across] / VENEER_SIZE + off[0], co[along] / VENEER_SIZE + off[1])


def assign(obj, mat):
    if isinstance(mat, Grain):
        grain_uv(obj, mat.axis)
        mat = mat.mat
    obj.data.materials.append(mat)


def mesh_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return bpy.data.objects.new(name, me)


def box(coll, name, x, y, z, mat, **kw):
    """Axis-aligned box from three.js ranges, origin at its centre."""
    a = V(x[0], y[0], z[0])
    b = V(x[1], y[1], z[1])
    lo = Vector(map(min, a, b))
    hi = Vector(map(max, a, b))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * (hi.x - lo.x), v.co.y * (hi.y - lo.y), v.co.z * (hi.z - lo.z)))
    o = mesh_object(name, bm)
    o.location = (lo + hi) / 2
    assign(o, mat)
    return finish(o, coll, **kw)


def extrude_outline(name, pts, z0, height):
    bm = bmesh.new()
    verts = [bm.verts.new((x, y, z0)) for x, y in pts]
    face = bm.faces.new(verts)
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=(0, 0, height))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm)


def rounded_rect(w, d, r, seg=12):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def rod(coll, name, a, b, r0, r1, mat):
    """Tapered round rod from point a (radius r0) to b (radius r1), Blender axes."""
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r0, radius2=r1, depth=d.length)
    o = mesh_object(name, bm)
    o.location = (a + b) / 2
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    assign(o, mat)
    return finish(o, coll, bevel=mm(1), segments=2, angle=60)


# ---------- materials ----------

def nodes_for(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (-300, 0)
    out.location = (0, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return nt, bsdf


def new_mat(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    return m


def noise(nt, vec_socket, scale, detail=4.0, rough=0.55, loc=(0, 0)):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = loc
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(vec_socket, n.inputs["Vector"])
    return n


def ramp(nt, fac_socket, stops, loc=(0, 0)):
    r = nt.nodes.new("ShaderNodeValToRGB")
    r.location = loc
    els = r.color_ramp.elements
    while len(els) > len(stops):
        els.remove(els[-1])
    while len(els) < len(stops):
        els.new(0.5)
    for el, (pos, col) in zip(els, stops):
        el.position = pos
        el.color = (*col, 1)
    nt.links.new(fac_socket, r.inputs["Fac"])
    return r


def mat_blue():
    # Little Greene Mazarine 256, PU spray, low sheen. Colour matched by eye to IMG_8504/8505
    # after the AgX view transform. To be checked against a photo with a grey card.
    m = new_mat("Blue_Mazarine256")
    nt, b = nodes_for(m)
    b.inputs["Base Color"].default_value = (0.010, 0.046, 0.25, 1)
    b.inputs["Roughness"].default_value = 0.42
    coord = nt.nodes.new("ShaderNodeTexCoord")
    peel = noise(nt, coord.outputs["Object"], 900, detail=2, loc=(-900, -300))
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-500, -300)
    bump.inputs["Strength"].default_value = 0.015
    nt.links.new(peel.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


HERE = os.path.dirname(os.path.abspath(__file__))


def image_node(nt, path, colour, loc):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.location = loc
    n.image = bpy.data.images.load(path, check_existing=True)
    n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    # Named, so a second UV map (the lightmap's) never changes what the texture reads.
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.location = (loc[0] - 250, loc[1])
    uv.uv_map = "UVMap"
    nt.links.new(uv.outputs["UV"], n.inputs["Vector"])
    return n


def mat_oak():
    """Oak veneer with whitened oil: Poly Haven's Oak Veneer 01 scan (CC0, 1.83 m tile),
    desaturated and lifted towards the pale finish in IMG_8504/8505. Needs grain UVs (Grain)."""
    m = new_mat("Oak_Veneer")
    nt, b = nodes_for(m)
    tex = os.path.join(HERE, "textures", "oak_veneer_01")
    diff = image_node(nt, os.path.join(tex, "oak_veneer_01_diff_4k.jpg"), True, (-1100, 250))
    rough = image_node(nt, os.path.join(tex, "oak_veneer_01_rough_4k.jpg"), False, (-1100, -100))
    nor = image_node(nt, os.path.join(tex, "oak_veneer_01_nor_gl_4k.jpg"), False, (-1100, -450))

    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.location = (-750, 250)
    hsv.inputs["Saturation"].default_value = 0.85
    hsv.inputs["Value"].default_value = 1.05
    nt.links.new(diff.outputs["Color"], hsv.inputs["Color"])
    oil = nt.nodes.new("ShaderNodeMix")
    oil.data_type = "RGBA"
    oil.location = (-500, 250)
    oil.inputs["Factor"].default_value = 0.2
    oil.inputs["B"].default_value = (0.70, 0.60, 0.45, 1)
    nt.links.new(hsv.outputs["Color"], oil.inputs["A"])
    nt.links.new(oil.outputs["Result"], b.inputs["Base Color"])

    # Oiled veneer is smoother than the raw scan.
    rmap = nt.nodes.new("ShaderNodeMapRange")
    rmap.location = (-750, -100)
    rmap.inputs["To Min"].default_value = 0.38
    rmap.inputs["To Max"].default_value = 0.62
    nt.links.new(rough.outputs["Color"], rmap.inputs["Value"])
    nt.links.new(rmap.outputs["Result"], b.inputs["Roughness"])

    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.location = (-750, -450)
    nmap.inputs["Strength"].default_value = 0.5
    nt.links.new(nor.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], b.inputs["Normal"])
    return m


def mat_worktop():
    # Hi-Macs Urban Concrete, matte: light warm grey, soft clouding, fine dark and light flecks.
    m = new_mat("Worktop_UrbanConcrete")
    nt, b = nodes_for(m)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    cloud = noise(nt, coord.outputs["Object"], 4, detail=6, rough=0.6, loc=(-1000, 200))
    cloud_r = ramp(nt, cloud.outputs["Fac"], [(0.35, (0.25, 0.245, 0.24)), (0.65, (0.31, 0.305, 0.295))], loc=(-750, 200))
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.location = (-1000, -150)
    vor.inputs["Scale"].default_value = 700
    nt.links.new(coord.outputs["Object"], vor.inputs["Vector"])
    fleck = ramp(nt, vor.outputs["Distance"], [(0.0, (0.12, 0.12, 0.12)), (0.12, (1, 1, 1))], loc=(-750, -150))
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.location = (-450, 50)
    mix.inputs["Factor"].default_value = 0.6
    nt.links.new(cloud_r.outputs["Color"], mix.inputs["A"])
    nt.links.new(fleck.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.62
    return m


def mat_backdrop():
    m = new_mat("Backdrop")
    nt, b = nodes_for(m)
    b.inputs["Base Color"].default_value = (0.78, 0.765, 0.74, 1)
    b.inputs["Roughness"].default_value = 0.9
    return m


# ---------- island ----------

WORKTOP_PX = (4096, 1536)  # 2000 x 750 mm at about 2 px/mm


def build_island(coll, M):
    D = DIM
    blue, oakX, oakY, oakZ = M["blue"], M["oakX"], M["oakY"], M["oakZ"]

    # Worktop: 12 Hi-Macs, R80 on the stool-side corner at the knee-well end.
    x0, x1 = D["topX"]
    z0, z1 = D["topZ"]
    R = D["cornerRadius"]
    yb0, yb1 = -z1, -z0  # Blender y: stool side is negative
    pts = [(x0 + R, yb0), (x1, yb0), (x1, yb1), (x0, yb1), (x0, yb0 + R)]
    for i in range(1, 24):
        a = math.radians(180 + 90 * i / 24)
        pts.append((x0 + R + R * math.cos(a), yb0 + R + R * math.sin(a)))
    top = extrude_outline("Worktop", pts, D["topY"] - D["topThick"], D["topThick"])
    top.data.materials.append(M["worktop"])
    # Top-down UVs over the whole worktop, for baking its colour to a WORKTOP_PX image.
    uv = top.data.uv_layers.new(name="UVMap")
    for loop in top.data.loops:
        co = top.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - x0) / (x1 - x0), (co.y - yb0) / (yb1 - yb0))
    finish(top, coll, bevel=mm(1.2), segments=3, angle=30)

    # Blue carcass: kitchen-side fronts, end panels, knee-well lining, divider.
    y0, y1 = D["carcassY"]
    X, Z, E = D["bodyX"], D["bodyZ"], D["endPanel"]
    d0, d1 = D["divider"]
    zFronts = -Z + D["front"]
    dividerBlue = d1 - D["lining"]
    box(coll, "Carcass_Cupboards", (-X + E, d0), (y0, y1), (zFronts, D["kneeBackZ"]), blue)
    box(coll, "Carcass_Drawers", (d0, X - E), (y0, y1), (zFronts, D["shelfBackZ"] - D["lining"]), blue)
    box(coll, "Divider", (d0, dividerBlue), (y0, y1), (D["shelfBackZ"] - D["lining"], Z), blue)
    box(coll, "EndPanel_Bookshelf", (X - E, X), (y0, y1), (-Z, Z), blue)
    box(coll, "EndPanel_KneeWell", (-X, -X + E), (y0, y1), (-Z, D["kneeBackZ"]), blue)

    widths = [587, 587, 378, 378]
    gap = D["gap"]
    span = 2 * (X - E) - gap * (len(widths) + 1)
    scale = span / mm(sum(widths))
    drawer_heights = [mm(h) for h in (194, 227.5, 227.5)]
    x = X - E - gap
    for i, w in enumerate(widths):
        width = mm(w) * scale
        xs = (x - width, x)
        if i < 2:
            y = y1 - gap
            for j, h in enumerate(drawer_heights):
                box(coll, f"Drawer_{i + 1}{j + 1}", xs, (y - h, y), (-Z, zFronts), blue, bevel=mm(1))
                y -= h + gap
        else:
            box(coll, f"Door_{i - 1}", xs, (y0 + gap, y1 - gap), (-Z, zFronts), blue, bevel=mm(1))
        x -= width + gap

    # Oak-veneered bookshelf, open to the stool side.
    sx0, sx1 = D["shelfX"]
    T = D["shelfThick"]
    zs = (D["shelfBackZ"], D["bodyZ"])
    bottom = y0 + mm(3)
    box(coll, "Shelf_Back", (sx0, sx1), (bottom, y1), (D["shelfBackZ"] - D["lining"], D["shelfBackZ"]), oakX)
    box(coll, "Shelf_Bottom", (sx0, sx1), (D["bottomShelfTop"] - T, D["bottomShelfTop"]), zs, oakX)
    box(coll, "Shelf_Middle", (sx0, sx1), (D["midShelfTop"] - T, D["midShelfTop"]), zs, oakX)
    box(coll, "Shelf_TopBoard", (sx0, sx1), (D["topBoardUnder"], y1), zs, oakX)
    box(coll, "Shelf_Lining_Left", (sx0 - D["lining"], sx0), (bottom, y1), zs, oakZ)
    box(coll, "Shelf_Lining_Right", (sx1, sx1 + D["lining"]), (bottom, y1), zs, oakZ)

    # Solid oak leg frame (see frame() in src/scene/island.ts).
    L = D["leg"]
    joint = X - L - mm(1136.5)
    mid = (d0 + d1 - L) / 2
    knee = D["kneeBackZ"]
    legs = [(X - L, -Z), (joint - L, -Z), (-X, -Z), (X - L, Z - L), (mid, Z - L), (-X, knee - L)]
    for i, (lx, lz) in enumerate(legs):
        box(coll, f"Leg_{i + 1}", (lx, lx + L), (0, y0), (lz, lz + L), oakZ, bevel=mm(2))
    Rl = D["rail"]
    ry = D["railY"]
    box(coll, "Rail_Kitchen", (-X + L, X - L), ry, (-Z, -Z + Rl), oakX, bevel=mm(2))
    box(coll, "Rail_Stools", (mid + L, X - L), ry, (Z - Rl, Z), oakX, bevel=mm(2))
    box(coll, "Rail_KneeWell", (-X + L, mid), ry, (knee - Rl, knee), oakX, bevel=mm(2))
    box(coll, "Rail_End_Bookshelf", (X - Rl, X), ry, (-Z + L, Z - L), oakY, bevel=mm(2))
    box(coll, "Rail_End_KneeWell", (-X, -X + Rl), ry, (-Z + L, knee - L), oakY, bevel=mm(2))
    box(coll, "Rail_Divider", (mid, mid + L), ry, (knee, Z - L), oakY, bevel=mm(2))


def build_stool(coll, M, name, x, z):
    """Seat height measured (680). Seat, legs and rungs estimated from IMG_8504/8505."""
    oak = M["oakX"]
    seat_t = mm(42)
    top = DIM["stoolSeatY"]
    c = V(x, 0, z)
    seat = extrude_outline(f"{name}_Seat", [(c.x + px, c.y + py) for px, py in rounded_rect(0.40, 0.29, 0.11)], top - seat_t, seat_t)
    assign(seat, oak)
    finish(seat, coll, bevel=mm(9), segments=5, angle=50)
    under = top - seat_t
    corners = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    leg_top = [V(x + sx * 0.135, under + 0.01, z + sz * 0.085) for sx, sz in corners]
    leg_bot = [V(x + sx * 0.185, 0, z + sz * 0.145) for sx, sz in corners]
    for i in range(4):
        rod(coll, f"{name}_Leg{i + 1}", leg_bot[i], leg_top[i], 0.0145, 0.0175, M["oakZ"])

    def at(i, h):
        return leg_bot[i].lerp(leg_top[i], h / under)

    # Footrest rungs: front and back lower, the two sides higher.
    for a, b_, h, tag in ((0, 2, 0.22, "Front"), (1, 3, 0.22, "Back"), (0, 1, 0.36, "SideR"), (2, 3, 0.36, "SideL")):
        rod(coll, f"{name}_Rung{tag}", at(a, h), at(b_, h), 0.011, 0.011, M["oakZ"])


# ---------- studio ----------

def build_studio(scn, coll, M):
    # Seamless sweep: floor, a 1.5 m radius cove behind the island (kitchen side), then a wall.
    back_y, r, wall_h, half_w, front_y = 2.6, 1.5, 6.0, 9.0, -9.0
    profile = [(front_y, 0.0), (back_y - r, 0.0)]
    for i in range(1, 16):
        a = math.radians(90 * i / 16)
        profile.append((back_y - r + r * math.sin(a), r - r * math.cos(a)))
    profile.append((back_y, wall_h))
    bm = bmesh.new()
    rows = [[bm.verts.new((sx, py, pz)) for py, pz in profile] for sx in (-half_w, half_w)]
    for i in range(len(profile) - 1):
        bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
    sweep = mesh_object("Backdrop", bm)
    sweep.data.materials.append(M["backdrop"])
    finish(sweep, coll, bevel=0)

    def area(name, loc, size, power, target, colour=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.shape = "RECTANGLE"
        ld.size, ld.size_y = size
        ld.energy = power
        ld.color = colour
        o = bpy.data.objects.new(name, ld)
        o.location = loc
        o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        coll.objects.link(o)
        return o

    aim = (0, 0, 0.5)
    area("Key_Softbox", (-2.6, -3.0, 3.2), (1.4, 1.0), 520, aim, (1.0, 0.98, 0.95))
    area("Fill", (3.4, -2.6, 1.4), (2.0, 2.0), 80, aim)
    area("Top", (0.3, 0.6, 3.6), (3.0, 1.6), 190, aim)

    world = bpy.data.worlds.get("Studio") or bpy.data.worlds.new("Studio")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.8, 0.8, 0.8, 1)
    bg.inputs["Strength"].default_value = 0.08
    scn.world = world


def camera(coll, name, loc, rot_deg, lens=None, vfov=None, shift=(0, 0)):
    cd = bpy.data.cameras.new(name)
    if vfov:
        cd.sensor_fit = "VERTICAL"
        cd.angle = math.radians(vfov)
    else:
        cd.lens = lens
    cd.shift_x, cd.shift_y = shift
    cd.clip_start = 0.05
    o = bpy.data.objects.new(name, cd)
    o.location = loc
    o.rotation_euler = [math.radians(a) for a in rot_deg]
    coll.objects.link(o)
    return o


def build_cameras(scn, coll):
    # A: the site's opening shot. 8 degree downward tilt, no yaw, 32 degree vertical FOV,
    # raised by a 24 degree viewing angle, lens shift instead of turning (src/camera.ts).
    tilt, elev, d = 8, 24, 4.2
    target = Vector((0, 0, DIM["topY"] / 2))
    fwd = Vector((0, math.cos(math.radians(tilt)), -math.sin(math.radians(tilt))))
    loc = target - fwd * d + Vector((0, 0, d * math.tan(math.radians(elev))))
    a = camera(coll, "Cam_Site_Start", loc, (90 - tilt, 0, 0), vfov=32)
    # Lens shift so the island's centre sits slightly below the middle of the frame.
    scn.camera = a
    from bpy_extras.object_utils import world_to_camera_view
    bpy.context.view_layer.update()
    for _ in range(8):
        p = world_to_camera_view(scn, a, target)
        a.data.shift_y += (p.y - 0.42) * (scn.render.resolution_y / scn.render.resolution_x)
        bpy.context.view_layer.update()

    # B: three-quarter view of the bookshelf end, standing height, like IMG_8504.
    camera(coll, "Cam_Shelf_ThreeQuarter", (2.35, -2.45, 1.32), (74, 0, 44), lens=45)


def render_settings(scn, preview=False):
    scn.render.engine = "CYCLES"
    scn.render.resolution_x = 1920
    scn.render.resolution_y = 1200
    scn.render.resolution_percentage = 50 if preview else 100
    scn.cycles.samples = 64 if preview else 384
    scn.cycles.use_denoising = True
    scn.cycles.use_adaptive_sampling = True
    scn.render.film_transparent = False
    scn.view_settings.view_transform = "AgX"
    # No look: three.js's AgXToneMapping is the base transform, so the renders and the site match.
    scn.view_settings.look = "None"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        scn.cycles.device = "GPU"
    except Exception:
        scn.cycles.device = "CPU"


def build():
    scn = island_scene()
    scn.unit_settings.system = "METRIC"
    render_settings(scn)
    M = {
        "blue": mat_blue(),
        "oak": mat_oak(),
        "worktop": mat_worktop(),
        "backdrop": mat_backdrop(),
    }
    M.update({f"oak{a}": Grain(M["oak"], a) for a in "XYZ"})
    island = collection(scn, "Island")
    stools = collection(scn, "Stools")
    studio = collection(scn, "Studio")
    build_island(island, M)
    k0, k1 = DIM["topX"][0], DIM["divider"][0]
    step = (k1 - k0) / 4
    build_stool(stools, M, "Stool_L", k0 + step, 0.40)
    build_stool(stools, M, "Stool_R", k0 + 3 * step, 0.40)
    build_studio(scn, studio, M)
    build_cameras(scn, studio)
    return scn


def render(out_dir, preview=False):
    scn = bpy.context.scene
    render_settings(scn, preview)
    os.makedirs(out_dir, exist_ok=True)
    for cam in ("Cam_Site_Start", "Cam_Shelf_ThreeQuarter"):
        scn.camera = scn.objects[cam]
        scn.render.filepath = os.path.join(out_dir, f"{cam}{'_preview' if preview else ''}.png")
        bpy.ops.render.render(write_still=True)
        print("rendered", scn.render.filepath)


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--render" in argv:
    render(argv[argv.index("--render") + 1], preview="--preview" in argv)
else:
    build()

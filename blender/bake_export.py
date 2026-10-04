"""
Bakes the island's lighting in Cycles and exports everything the site loads, into public/island/.

    npm run bake            (or: Blender -b --factory-startup -P blender/bake_export.py [-- --quick])

Builds the scene fresh with build_island.py, so island.blend is never touched. Writes:
  oak_color.jpg, oak_rough.jpg, oak_normal.jpg   one tile of the tinted oak veneer (VENEER_SIZE metres)
  worktop.jpg     the worktop's colour, top-down
  lightmap.jpg    diffuse light without surface colour (direct + indirect) on the "Lightmap" UVs,
                  divided by bake.json's lightmapScale and sRGB-encoded
  ao.jpg          ambient occlusion within 25 cm, same UVs, linear
  shadow.png      how much the island and stools darken the floor (0 = not at all)
  studio.hdr      the studio seen from above the worktop, lights included, for reflections
  island.glb      island and stools, one mesh per material; UVMap -> uv, Lightmap -> uv1
  bake.json       the numbers the site needs to decode the above
Linear EXR copies of the light bakes go to blender/bake/. --quick bakes small and noisy, to test the pipeline.

The site multiplies each material's colour by the lightmap (src/scene/island.ts), so a colour change
needs only a new texture or colour value, not a new bake. Geometry and lighting changes need a new bake.
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "island")
SRC = os.path.join(HERE, "bake")
os.makedirs(OUT, exist_ok=True)
os.makedirs(SRC, exist_ok=True)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
QUICK = "--quick" in argv

LIGHTMAP_BAKE = 1024 if QUICK else 4096  # baked at this size, then halved, which also halves the noise
LIGHTMAP_SAMPLES = 64 if QUICK else 256  # x4 after halving
SHADOW_PX = 1024 if QUICK else 2048
SHADOW_SAMPLES = 64 if QUICK else 256
TILE_PX = 512 if QUICK else 2048
# The browser decodes the HDR on its main thread, so 1024 x 512 loads in a quarter of the time of 2048 x 1024.
# Reflections on these rough surfaces look the same at either size.
HDR_PX = 512 if QUICK else 1024
# Floor shadow area in Blender axes: the island plus room for the key light's shadow, behind and to the right.
SHADOW_X = (-2.8, 2.8)
SHADOW_Y = (-1.4, 2.4)

# ---------- build ----------

build_path = os.path.join(HERE, "build_island.py")
B = {"__file__": build_path, "__name__": "build_island"}
exec(compile(open(build_path).read(), build_path, "exec"), B)  # builds the scene
scn = bpy.context.scene
vl = bpy.context.view_layer
started = time.time()
print(f"[bake] Cycles on {scn.cycles.device}, {'quick' if QUICK else 'full'}", flush=True)


def log(*a):
    print(f"[bake {time.time() - started:6.0f}s]", *a, flush=True)


def select(objs):
    for o in scn.objects:
        o.select_set(o in objs)
    vl.objects.active = objs[0]


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save(img, path, fmt, quality=90):
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == "JPEG":
        scn.render.image_settings.quality = quality
    img.save(quality=quality) if fmt == "JPEG" else img.save()
    log("wrote", os.path.relpath(path, ROOT))


def write_bytes(name, rgb, path, fmt, quality=90):
    """rgb: (h, w, 3) or (h, w) already encoded 0..1, top row last (Blender order)."""
    if rgb.ndim == 2:
        rgb = np.repeat(rgb[..., None], 3, axis=2)
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"  # values are written as given
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], axis=2).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    save(img, path, fmt, quality)


def bake(objs, img, kind, passes, uv, samples, margin=16):
    """Bake into img through a temporary image node in each of the objects' materials."""
    added = []
    for m in {s.material for o in objs for s in o.material_slots if s.material}:
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = img
        m.node_tree.nodes.active = n
        added.append((m, n))
    select(objs)
    scn.cycles.samples = samples
    rb = scn.render.bake
    rb.margin = margin
    rb.margin_type = "EXTEND"
    rb.use_selected_to_active = False
    t = time.time()
    bpy.ops.object.bake(type=kind, pass_filter=passes, uv_layer=uv, margin=margin, use_clear=True, target="IMAGE_TEXTURES")
    for m, n in added:
        m.node_tree.nodes.remove(n)
    log(f"baked {img.name} {img.size[0]}x{img.size[1]} {kind} {sorted(passes)} in {time.time() - t:.0f}s")


def float_image(name, w, h):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    return img


def byte_image(name, w, h, colour):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return img


def plane(name, x, y, z, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x[0], y[0], z), (x[1], y[0], z), (x[1], y[1], z), (x[0], y[1], z)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for loop, co in zip(me.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[loop.index].uv = co
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    scn.collection.objects.link(o)
    return o


island = list(bpy.data.collections["Island"].objects)
stools = list(bpy.data.collections["Stools"].objects)
furniture = [o for o in island + stools if o.type == "MESH"]
mats = {m.name: m for m in bpy.data.materials}
oak, worktop = mats["Oak_Veneer"], mats["Worktop_UrbanConcrete"]

# ---------- material textures (colour only, no light) ----------

tile = plane("OakTile", (0, B["VENEER_SIZE"]), (0, B["VENEER_SIZE"]), -20, oak)
img = byte_image("oak_color", TILE_PX, TILE_PX, colour=True)
bake([tile], img, "DIFFUSE", {"COLOR"}, "UVMap", 1, margin=0)
save(img, os.path.join(OUT, "oak_color.jpg"), "JPEG", 88)
img = byte_image("oak_rough", TILE_PX, TILE_PX, colour=False)
bake([tile], img, "ROUGHNESS", {"NONE"}, "UVMap", 1, margin=0)
save(img, os.path.join(OUT, "oak_rough.jpg"), "JPEG", 85)
bpy.data.objects.remove(tile)
nor = bpy.data.images.load(os.path.join(HERE, "textures", "oak_veneer_01", "oak_veneer_01_nor_gl_4k.jpg"))
nor.colorspace_settings.name = "Non-Color"
nor.scale(TILE_PX, TILE_PX)
save(nor, os.path.join(OUT, "oak_normal.jpg"), "JPEG", 88)

top = scn.objects["Worktop"]
w, h = B["WORKTOP_PX"]
if QUICK:
    w, h = w // 4, h // 4
img = byte_image("worktop", w, h, colour=True)
bake([top], img, "DIFFUSE", {"COLOR"}, "UVMap", 1, margin=4)
save(img, os.path.join(OUT, "worktop.jpg"), "JPEG", 88)

# ---------- one mesh per collection and material, bevels applied ----------

dg = bpy.context.evaluated_depsgraph_get()
for o in furniture:
    if "UVMap" not in o.data.uv_layers:
        o.data.uv_layers.new(name="UVMap")  # flat-coloured parts, so every mesh has the same UV layers
dg.update()
for o in furniture:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    o.modifiers.clear()
    o.data = me

parts = []
for coll, objs in (("Island", island), ("Stools", stools)):
    by_mat = {}
    for o in objs:
        if o.type == "MESH":
            by_mat.setdefault(o.data.materials[0].name, []).append(o)
    for mname, group in by_mat.items():
        short = {"Blue_Mazarine256": "Blue", "Oak_Veneer": "Oak", "Worktop_UrbanConcrete": "Worktop"}[mname]
        with bpy.context.temp_override(active_object=group[0], selected_objects=group, selected_editable_objects=group):
            bpy.ops.object.join()
        group[0].name = f"{coll}_{short}"
        parts.append(group[0])
log("meshes:", ", ".join(f"{p.name} ({len(p.data.polygons)} faces)" for p in parts))

# ---------- lightmap UVs: one atlas for everything ----------

for p in parts:
    p.data.uv_layers.new(name="Lightmap")
    p.data.uv_layers.active = p.data.uv_layers["Lightmap"]
    p.data.uv_layers["UVMap"].active_render = True
select(parts)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(rotate=True, margin=8 / LIGHTMAP_BAKE * 2)
bpy.ops.object.mode_set(mode="OBJECT")

# ---------- lightmap ----------

lm = float_image("lightmap", LIGHTMAP_BAKE, LIGHTMAP_BAKE)
bake(parts, lm, "DIFFUSE", {"DIRECT", "INDIRECT"}, "Lightmap", LIGHTMAP_SAMPLES, margin=16)
save(lm, os.path.join(SRC, "lightmap.exr"), "OPEN_EXR")
px = pixels(lm)[..., :3]
px = px.reshape(px.shape[0] // 2, 2, px.shape[1] // 2, 2, 3).mean(axis=(1, 3))  # halve: 2x2 average
peak = px.max(axis=2)
lightmap_scale = float(np.percentile(peak[peak > 1e-4], 99.9))
write_bytes("lightmap_out", srgb(px / lightmap_scale), os.path.join(OUT, "lightmap.jpg"), "JPEG", 92)

# Ambient occlusion within 25 cm, on the same UVs. The site uses it only to stop the studio's
# reflections showing on surfaces the softboxes cannot reach, such as inside the shelf.
scn.world.light_settings.distance = 0.25
ao = float_image("ao", LIGHTMAP_BAKE, LIGHTMAP_BAKE)
bake(parts, ao, "AO", {"NONE"}, "Lightmap", 32 if QUICK else 64, margin=16)
px = pixels(ao)[..., 0]
px = px.reshape(px.shape[0] // 2, 2, px.shape[1] // 2, 2).mean(axis=(1, 3))
write_bytes("ao_out", px, os.path.join(OUT, "ao.jpg"), "JPEG", 90)

# ---------- floor shadow ----------

catcher_mat = bpy.data.materials.new("ShadowCatcher")
catcher_mat.use_nodes = True
catcher_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1)
catcher = plane("ShadowCatcher", SHADOW_X, SHADOW_Y, 0.0005, catcher_mat)
sw = SHADOW_PX
sh = round(SHADOW_PX * (SHADOW_Y[1] - SHADOW_Y[0]) / (SHADOW_X[1] - SHADOW_X[0]))
lit = float_image("floor_lit", sw, sh)
# The site's floor is flat page colour with no cove, so the backdrop moves back 1.5 m: the long key-light
# shadow behind the island stays on flat floor, and the backdrop still bounces light into the shadows.
backdrop = scn.objects["Backdrop"]
backdrop.location.y += 1.5
bake([catcher], lit, "DIFFUSE", {"DIRECT", "INDIRECT"}, "UVMap", SHADOW_SAMPLES, margin=0)
for p in parts:
    p.hide_render = True
bare = float_image("floor_bare", sw, sh)
bake([catcher], bare, "DIFFUSE", {"DIRECT", "INDIRECT"}, "UVMap", SHADOW_SAMPLES, margin=0)
save(lit, os.path.join(SRC, "floor_lit.exr"), "OPEN_EXR")
save(bare, os.path.join(SRC, "floor_bare.exr"), "OPEN_EXR")
lum = np.array([0.2126, 0.7152, 0.0722])
ratio = (pixels(lit)[..., :3] @ lum) / np.maximum(pixels(bare)[..., :3] @ lum, 1e-6)
shadow = np.clip(1 - ratio, 0, 1)
# The bare floor is smooth, so the noise is all in the lit bake: a light 3x3 blur takes it out.
padded = np.pad(shadow, 1, mode="edge")
shadow = sum(padded[i:i + sh, j:j + sw] for i in range(3) for j in range(3)) / 9
shadow = np.clip((shadow - 0.015) / 0.985, 0, 1)  # what is left of the noise far from the island
# Fade to nothing over the outer 15% on every side, so the plane has no visible edge.
fx = np.clip(np.minimum(np.linspace(0, 1, sw), np.linspace(1, 0, sw)) / 0.15, 0, 1)
fy = np.clip(np.minimum(np.linspace(0, 1, sh), np.linspace(1, 0, sh)) / 0.15, 0, 1)
shadow *= np.outer(fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx))
write_bytes("shadow_out", shadow, os.path.join(OUT, "shadow.png"), "PNG")
bpy.data.objects.remove(catcher)
backdrop.location.y -= 1.5

# ---------- studio environment for reflections ----------

for o in scn.objects:
    if o.type == "LIGHT":
        o.visible_camera = True  # the softboxes show up in reflections, as in a studio
cd = bpy.data.cameras.new("Env")
cd.type = "PANO"
cd.panorama_type = "EQUIRECTANGULAR"
cam = bpy.data.objects.new("Env", cd)
# Centre of the image looks along +x, image up is +z: three.js's equirectangular layout.
cam.matrix_world = Matrix(((0, 0, -1, 0), (-1, 0, 0, 0), (0, 1, 0, 1.25), (0, 0, 0, 1)))
scn.collection.objects.link(cam)
scn.camera = cam
r = scn.render
r.resolution_x, r.resolution_y, r.resolution_percentage = HDR_PX, HDR_PX // 2, 100
scn.cycles.samples = 64 if QUICK else 512
scn.cycles.use_denoising = True
r.image_settings.file_format = "HDR"
r.filepath = os.path.join(OUT, "studio.hdr")
bpy.ops.render.render(write_still=True)
log("wrote public/island/studio.hdr")
for p in parts:
    p.hide_render = False

# ---------- export ----------

select(parts)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "island.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="NONE",  # the site builds the materials from the object names (src/scene/island.ts)
    export_image_format="NONE",
    export_extras=False,
    export_animations=False,
)
log("wrote public/island/island.glb")

meta = {
    "lightmapScale": lightmap_scale,
    # three.js axes: x along the island, z towards the stools (Blender's -y).
    "shadow": {"x": list(SHADOW_X), "z": [-SHADOW_Y[1], -SHADOW_Y[0]], "y": 0.0005},
    "quick": QUICK,
}
json.dump(meta, open(os.path.join(OUT, "bake.json"), "w"), indent=2)
log("wrote public/island/bake.json", meta)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SRC, "island_baked.blend"))
log("done")

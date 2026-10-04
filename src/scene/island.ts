import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// The island and stools are modelled, lit and baked in Blender (blender/build_island.py, blender/bake_export.py)
// and loaded from public/island/. The dimensions below are the same as the Blender script's; the books,
// polaroids and camera are placed with them.
//
// Dimensions from Daniel Bruce's construction drawing (references/island-rev-B-for-construction.pdf,
// summarised in references/island-measurements.md). Written in mm as on the drawing, used in metres.
// Origin: floor, centre of the worktop. x runs along the long side, z+ faces the stools.
// Seen from the stools: knee well on the left (x-), oak bookshelf on the right (x+).
// The kitchen side (z-) has six drawers behind the bookshelf and two cupboard doors behind the knee well.
const mm = (v: number) => v / 1000;

export const DIM = {
  topY: mm(918),
  topThick: mm(12),
  topX: [mm(-1000), mm(1000)] as const,
  topZ: [mm(-375), mm(375)] as const,
  cornerRadius: mm(80), // stool side, knee-well end only
  carcassY: [mm(245), mm(906)] as const, // sits on the oak frame, worktop on top
  bodyX: mm(995), // carcass and leg frame stop 5 short of the worktop at each end
  bodyZ: mm(370), // and on each long side
  endPanel: mm(22),
  front: mm(18),
  gap: mm(3),
  divider: [mm(-17.5), mm(27.5)] as const, // 45 between knee well and bookshelf, blue side + oak lining
  kneeBackZ: mm(375 - 230), // blue lining behind the stools
  lining: mm(18),
  shelfX: [mm(27.5), mm(955)] as const, // 927.5 clear
  shelfBackZ: mm(370 - 271),
  shelfThick: mm(19),
  bottomShelfTop: mm(267),
  midShelfTop: mm(586.5),
  topBoardUnder: mm(887),
  leg: mm(45),
  railY: [mm(200), mm(245)] as const,
  rail: mm(22),
  stoolSeatY: mm(680),
};

export const SHELF = {
  x0: DIM.shelfX[0],
  x1: DIM.shelfX[1],
  frontZ: DIM.bodyZ,
  backZ: DIM.shelfBackZ,
  rows: {
    top: { y: DIM.midShelfTop, clear: DIM.topBoardUnder - DIM.midShelfTop },
    bottom: { y: DIM.bottomShelfTop, clear: DIM.midShelfTop - DIM.shelfThick - DIM.bottomShelfTop },
  },
};

export const ISLAND_BOX = new THREE.Box3(
  new THREE.Vector3(DIM.topX[0], 0, DIM.topZ[0]),
  new THREE.Vector3(DIM.topX[1], DIM.topY, DIM.topZ[1]),
);

export const SHELF_BOX = new THREE.Box3(
  new THREE.Vector3(DIM.divider[0], SHELF.rows.bottom.y - 0.04, DIM.bodyZ),
  new THREE.Vector3(DIM.bodyX, DIM.topY, DIM.bodyZ),
);

const BASE = `${import.meta.env.BASE_URL}island/`;

type BakeMeta = {
  lightmapScale: number;
  shadow: { x: [number, number]; z: [number, number]; y: number };
};

const textures = new THREE.TextureLoader();

function texture(name: string, colour: boolean, opts: { repeat?: boolean; channel?: number; flipY?: boolean } = {}) {
  const t = textures.load(BASE + name);
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = opts.flipY ?? false; // glTF UVs start at the top of the image
  t.channel = opts.channel ?? 0;
  t.anisotropy = 8;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Diffuse light comes only from the Cycles bake, so the island looks as it does in the render. three.js
// adds only the studio's reflections, which move with the camera. Live lights do not touch the island.
// The bake has no surface colour in it, so a new colour or texture needs no new bake.
function baked(params: THREE.MeshStandardMaterialParameters, lightMap: THREE.Texture, aoMap: THREE.Texture, scale: number) {
  const m = new THREE.MeshStandardMaterial({ ...params, lightMap, lightMapIntensity: scale, aoMap });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace(
        'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
        'vec3 totalDiffuse = material.diffuseColor * texture2D( lightMap, vLightMapUv ).rgb * lightMapIntensity;',
      )
      .replace(
        'vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;',
        'vec3 totalSpecular = reflectedLight.indirectSpecular;',
      );
  };
  m.customProgramCacheKey = () => 'baked';
  return m;
}

function islandMaterials(meta: BakeMeta) {
  const lightMap = texture('lightmap.jpg', true, { channel: 1 });
  const aoMap = texture('ao.jpg', false, { channel: 1 });
  const s = meta.lightmapScale;
  return {
    // Little Greene Mazarine 256, same linear value as the Blender material.
    Blue: baked({ color: new THREE.Color().setRGB(0.01, 0.046, 0.25, THREE.LinearSRGBColorSpace), roughness: 0.42 }, lightMap, aoMap, s),
    Oak: baked({
      map: texture('oak_color.jpg', true, { repeat: true }),
      roughnessMap: texture('oak_rough.jpg', false, { repeat: true }),
      normalMap: texture('oak_normal.jpg', false, { repeat: true }),
      normalScale: new THREE.Vector2(0.5, -0.5), // glTF flips V, so the normal map's green flips too
    }, lightMap, aoMap, s),
    Worktop: baked({ map: texture('worktop.jpg', true), roughness: 0.62 }, lightMap, aoMap, s),
  };
}

// The island and stools' shadow on the floor, from the bake: black, with the shadow as opacity, so it
// darkens whatever page colour is behind the canvas.
function floorShadow(meta: BakeMeta) {
  const { x, z, y } = meta.shadow;
  const g = new THREE.PlaneGeometry(x[1] - x[0], z[1] - z[0]);
  g.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: texture('shadow.png', false, { flipY: true }), transparent: true, depthWrite: false });
  // The bake is a ratio of linear light, but the browser blends the canvas over the page in sRGB, where
  // the same alpha darkens about twice as much. Converted here, the shadow is as light as in Cycles.
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      '#include <alphamap_fragment>',
      '#include <alphamap_fragment>\n\tdiffuseColor.a = 1.0 - pow( 1.0 - diffuseColor.a, 1.0 / 2.2 );',
    );
  };
  const m = new THREE.Mesh(g, mat);
  m.position.set((x[0] + x[1]) / 2, y, (z[0] + z[1]) / 2);
  m.name = 'FloorShadow';
  return m;
}

export async function loadIsland(renderer: THREE.WebGLRenderer) {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [meta, model, hdr] = await Promise.all([
    fetch(BASE + 'bake.json').then((r) => r.json() as Promise<BakeMeta>),
    gltf.loadAsync(BASE + 'island.glb'),
    new HDRLoader().loadAsync(BASE + 'studio.hdr'),
  ]);

  const mats = islandMaterials(meta);
  model.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const kind = mesh.name.split('_')[1] as keyof typeof mats; // Island_Blue, Stools_Oak, ...
    mesh.material = mats[kind];
    mesh.castShadow = true; // onto the books
  });

  const group = new THREE.Group();
  group.name = 'Island';
  const shadow = floorShadow(meta);
  group.add(model.scene, shadow);

  // The studio as Cycles sees it, softboxes included: reflections on the island, and light for the books.
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  pmrem.dispose();

  // Set on each material, because three.js ignores envMapIntensity for scene.environment. At full
  // strength the studio's reflections lay a grey film over the blue; 0.4 matches the renders. The
  // panorama is taken without the island in it, so every surface reflects the bright studio, even
  // inside the knee well, where Cycles sees the worktop's underside and the stools.
  for (const m of Object.values(mats)) {
    m.envMap = environment;
    m.envMapIntensity = 0.4;
  }

  return { group, shadow, environment };
}

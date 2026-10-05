import * as THREE from 'three';
import { config } from './config';
import { ISLAND_BOX } from './scene/island';
import type { Rig } from './camera';

// Dev only: open the site with ?poster to render the opening frame into public/poster/ and its placement into
// src/poster.css (saved through vite.config.ts). The page shows these stills until the 3D scene is ready.
// Run it again after a change to the island, the books, the polaroids or the opening camera.
//
// Two views: wide screens, where the screen height sets the island's size on the first screen, and tall ones,
// where the width does and the camera stands further back. Each view has two layers: the island with the books
// and polaroids, and the floor shadow, which is soft (so saved small) and left out in dark mode.

const VIEWS = [
  { name: 'wide', w: 1600, h: 1000 },
  { name: 'tall', w: 390, h: 844 },
];
// scale: image px per CSS px. margin: how much wider and taller than the screen to render, so a screen of
// another shape still finds the shadow and stools there.
const LAYERS = [
  { name: 'island', scale: 2, margin: 1.6 },
  { name: 'shadow', scale: 0.5, margin: 3 },
];

type Placed = { x: number; y: number; w: number };

async function save(path: string, body: Blob | string) {
  const res = await fetch(`/__save/${path}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`could not save ${path}`);
}

/** Renders the camera's view `margin` times wider and taller around its centre, into a 2D canvas. */
function render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, view: { w: number; h: number }, scale: number, margin: number) {
  const W = Math.round(view.w * margin);
  const H = Math.round(view.h * margin);
  renderer.setPixelRatio(scale);
  renderer.setSize(W, H, false);
  const projection = cam.projectionMatrix.clone();
  cam.projectionMatrix.premultiply(new THREE.Matrix4().makeScale(1 / margin, 1 / margin, 1));
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  renderer.render(scene, cam);
  cam.projectionMatrix.copy(projection);
  cam.projectionMatrixInverse.copy(projection).invert();

  const src = renderer.domElement;
  const full = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
  full.getContext('2d')!.drawImage(src, 0, 0);
  return { full, W, H };
}

/** The bounds of what is drawn on a canvas, in its px. */
function drawn(canvas: HTMLCanvasElement) {
  const alpha = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let [x0, y0, x1, y1] = [canvas.width, canvas.height, 0, 0];
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (alpha[(y * canvas.width + x) * 4 + 3] > 2) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y + 1);
      }
  return { x0, y0, x1, y1 };
}

/** Renders the camera's view `margin` times wider and taller around its centre; returns it cropped to what is drawn. */
async function layer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, view: (typeof VIEWS)[number], scale: number, margin: number, file: string): Promise<Placed> {
  const { full, W, H } = render(renderer, scene, cam, view, scale, margin);
  const { x0, y0, x1, y1 } = drawn(full);
  const crop = Object.assign(document.createElement('canvas'), { width: x1 - x0, height: y1 - y0 });
  crop.getContext('2d')!.drawImage(full, -x0, -y0);
  const blob = await new Promise<Blob>((resolve) => crop.toBlob((b) => resolve(b!), 'image/webp', 0.86));
  await save(`public/poster/${file}.webp`, blob);
  // in the screen's CSS px, from its top left corner
  return { x: x0 / scale - (W - view.w) / 2, y: y0 / scale - (H - view.h) / 2, w: crop.width / scale };
}

export async function makePosters(renderer: THREE.WebGLRenderer, scene: THREE.Scene, rig: Rig, shadow: THREE.Object3D) {
  const css: string[] = [];
  const meshes: THREE.Object3D[] = [];
  scene.traverse((o) => (o as THREE.Mesh).isMesh && o !== shadow && o.visible && meshes.push(o));

  for (const view of VIEWS) {
    rig.resize(view.w, view.h);
    rig.progress = 0;
    rig.update(0);
    const cam = rig.camera;

    // Where the island's box lands on this screen: the page scales and places the layers by it, as Rig fits the box.
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      new THREE.Vector3(i & 1 ? ISLAND_BOX.max.x : ISLAND_BOX.min.x, i & 2 ? ISLAND_BOX.max.y : ISLAND_BOX.min.y, i & 4 ? ISLAND_BOX.max.z : ISLAND_BOX.min.z)
        .project(cam),
    );
    const xs = corners.map((p) => ((p.x + 1) / 2) * view.w);
    const ys = corners.map((p) => ((1 - p.y) / 2) * view.h);
    const centre = ISLAND_BOX.getCenter(new THREE.Vector3()).project(cam);
    const box = { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x: ((centre.x + 1) / 2) * view.w, bottom: Math.max(...ys) };

    shadow.visible = false;
    const island = await layer(renderer, scene, cam, view, LAYERS[0].scale, LAYERS[0].margin, `${view.name}-island`);
    shadow.visible = true;
    meshes.forEach((m) => (m.visible = false));
    const floor = await layer(renderer, scene, cam, view, LAYERS[1].scale, LAYERS[1].margin, `${view.name}-shadow`);
    meshes.forEach((m) => (m.visible = true));

    const r = (v: number) => +v.toFixed(2);
    const rule = (sel: string, p: Placed) => `  ${sel} { --x: ${r(p.x - box.x)}; --y: ${r(p.y - box.bottom)}; --w: ${r(p.w)}; }`;
    const block = [
      `  .poster { --bw: ${r(box.w)}; --bh: ${r(box.h)}; }`,
      rule('.poster-island', island),
      rule('.poster-shadow', floor),
    ].join('\n');
    css.push(view.name === 'tall' ? `@media (max-aspect-ratio: 1/1) {\n${block}\n}` : block.replace(/^ {2}/gm, ''));
  }

  await save(
    'src/poster.css',
    [
      '/* Written by src/poster.ts (open the site with ?poster in dev). Where the poster layers sit, in CSS px of the',
      '   screen they were rendered for, from the island box\'s bottom centre; --bw and --bh are the box\'s size there. */',
      `.poster { --fill: ${config.startFill}; --fill-h: ${config.startFillHeight}; --bottom: ${config.startBottom}; }`,
      ...css,
      '',
    ].join('\n'),
  );
  console.log('Posters saved. Reload the page.');
}

// Dev only: open the site with ?social to render the link preview that chat apps and social sites show
// (public/poster/social.jpg, see the og:image tags in index.html): the opening view of the island, books,
// polaroids and floor shadow, centred on the page's light backdrop. Run it again when you run ?poster.

const SOCIAL = { w: 1200, h: 630, pad: 0.07, scale: 2, margin: 2, bg: '#f5f4f0' }; // bg: --bg in style.css, light mode

export async function makeSocial(renderer: THREE.WebGLRenderer, scene: THREE.Scene, rig: Rig, shadow: THREE.Object3D) {
  const { w, h, pad, scale, margin, bg } = SOCIAL;
  rig.resize(w, h);
  rig.progress = 0;
  rig.update(0);

  // The island alone gives the framing; the shadow is drawn with it but may run past the edges.
  shadow.visible = false;
  const bounds = drawn(render(renderer, scene, rig.camera, { w, h }, scale, margin).full);
  shadow.visible = true;
  const { full } = render(renderer, scene, rig.camera, { w, h }, scale, margin);

  const out = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  const k = Math.min((w * (1 - 2 * pad)) / bw, (h * (1 - 2 * pad)) / bh);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(w / 2 - k * (bounds.x0 + bw / 2), h / 2 - k * (bounds.y0 + bh / 2));
  ctx.scale(k, k);
  ctx.drawImage(full, 0, 0);

  const blob = await new Promise<Blob>((resolve) => out.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
  await save('public/poster/social.jpg', blob);
  console.log('Social image saved. Reload the page.');
}

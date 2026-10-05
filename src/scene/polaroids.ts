import * as THREE from 'three';
import { DIM } from './island';
import { look } from './books';

// Classic Polaroid print: 88 × 107 mm, photo area 79 × 79 mm.
export const W = 0.088;
const H = 0.107;
const PHOTO = 0.079;
const THICK = 0.0015;

// What lies at each spot on the worktop, left to right: one print or a small pile, top print first.
// Photos are square crops in public/polaroids/: {photo}-sm.jpg (256 px) for the print on the worktop,
// {photo}.jpg (1000 px) for the open view. Dates are year-month.
export type Print = { photo?: string; date?: string };
export const SPOTS: Print[][] = [
  [
    { photo: 'island-1', date: '2024-11' },
    { photo: 'island-2', date: '2026-04' },
    { photo: 'island-3', date: '2024-10' },
  ],
  [
    { photo: 'isabel-linda-1', date: '2023-10' },
    { photo: 'isabel-linda-2', date: '2023-10' },
    { photo: 'isabel-linda-3', date: '2023-06' },
  ],
];

export const photoUrl = (photo: string, small = false) =>
  `${import.meta.env.BASE_URL}polaroids/${photo}${small ? '-sm' : ''}.jpg`;

// How the prints under the top one lie in a pile: x and z offset (m), turn (rad). They fan out on hover.
const PILE: [number, number, number][] = [
  [0, 0, 0],
  [-0.007, 0.004, -0.17],
  [0.008, -0.003, 0.12],
];

// Same tone mapping as the books (see shelfLook in books.ts), so the photos keep their colours.
function neutral<M extends THREE.MeshStandardMaterial>(m: M) {
  m.onBeforeCompile = (s) => {
    s.uniforms.bookExposure = look.exposure;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float bookExposure;')
      .replace(
        '#include <tonemapping_fragment>',
        '#if defined( TONE_MAPPING )\n\tgl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb * bookExposure );\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'polaroidLook';
  return m;
}

const frameGeo = new THREE.BoxGeometry(W, THICK, H);
const photoGeo = new THREE.PlaneGeometry(PHOTO, PHOTO);
const frameMat = neutral(new THREE.MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.5 }));
const blanks = ['#9a8f80', '#a08b86'];

// Hover and taps hit an invisible box that stays where the print rests. Hitting the print itself made it
// flicker: lifted and tilted, it could move out from under the pointer, drop, and lift again. The box is
// wide enough for a fanned-out pile and tall enough for a lifted print, with a margin around both.
const hitGeo = new THREE.BoxGeometry(0.16, 0.06, 0.17).translate(0, 0.03, 0);
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const loader = new THREE.TextureLoader();

function photoMat(print: Print, spot: number) {
  if (!print.photo) return neutral(new THREE.MeshStandardMaterial({ color: blanks[spot], roughness: 0.4 }));
  const map = loader.load(photoUrl(print.photo, true));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return neutral(new THREE.MeshStandardMaterial({ map, roughness: 0.3 }));
}

// held: its prints are up in the open view (see polaroidView.ts), so they are hidden here.
export type Polaroid = { group: THREE.Group; prints: THREE.Group[]; index: number; lift: number; hover: boolean; held: boolean };

export class Polaroids {
  group = new THREE.Group();
  items: Polaroid[] = [];
  private hits: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();

  constructor() {
    const spots: [number, number, number][] = [
      [-0.7, 0.14, 0.12],
      [-0.3, 0.1, 0.07],
    ];
    spots.forEach(([x, z, rot], index) => {
      const g = new THREE.Group();
      const prints = SPOTS[index].map((print) => {
        const p = new THREE.Group();
        const frame = new THREE.Mesh(frameGeo, frameMat);
        const photo = new THREE.Mesh(photoGeo, photoMat(print, index));
        photo.rotation.x = -Math.PI / 2;
        photo.position.set(0, THICK / 2 + 0.00005, -(H - PHOTO) / 2 + 0.0045);
        frame.castShadow = true;
        p.add(frame, photo);
        g.add(p);
        return p;
      });
      g.position.set(x, DIM.topY + 0.0008, z);
      g.rotation.y = rot;
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.position.set(x, DIM.topY, z);
      hit.rotation.y = rot;
      hit.userData.polaroid = index;
      this.hits.push(hit);
      this.group.add(g, hit);
      this.items.push({ group: g, prints, index, lift: 0, hover: false, held: false });
    });
    this.update(0);
  }

  pick(ray: THREE.Ray) {
    this.raycaster.ray.copy(ray);
    const hit = this.raycaster.intersectObjects(this.hits, false)[0];
    return hit ? this.items[hit.object.userData.polaroid as number] : null;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 12);
    for (const p of this.items) {
      p.group.visible = !p.held;
      p.lift += ((p.hover ? 1 : 0) - p.lift) * k;
      p.group.position.y = DIM.topY + 0.0008 + p.lift * 0.03;
      p.group.rotation.x = -p.lift * 0.35;
      const fan = 1 + p.lift * 1.5;
      p.prints.forEach((print, i) => {
        const [x, z, turn] = PILE[i];
        print.position.set(x * fan, (p.prints.length - 1 - i) * (THICK + 0.0001), z * fan);
        print.rotation.y = turn * fan;
      });
    }
  }
}

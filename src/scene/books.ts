import * as THREE from 'three';
import type { Book } from '../data';
import { SHELF } from './island';
import { config } from '../config';

export type RowName = 'top' | 'bottom';

export type ShelfBook = {
  book: Book;
  mesh: THREE.Mesh;
  row: RowName;
  index: number;
  base: THREE.Vector3;
  pull: number;
  turn: number;
  lift: number;
  x: number; // where the spread has moved it along the row
  squash: number; // thickness scale from the spread
  held: boolean; // its cover is up in the open view (see bookView.ts), so it is hidden here
  lid: THREE.Object3D | null; // a box set's lid, hinged at the back (see boxMesh)
};

// Upright books stand first in `books`, packed from `start` with `gap` between them; flat ones follow.
export type Row = { name: RowName; books: ShelfBook[]; upright: number; start: number; end: number; gap: number };

// The books are lit live by the studio environment, which reached them inside the shelf as if they stood
// in the open, and AgX turned their saturated colours pastel. So they get their own look:
// - the environment's light is shaded inside the shelf, darker toward the back and right under the
//   shelf above, and the shade lifts as a book slides out;
// - Khronos PBR Neutral tone mapping, which keeps a colour as it is up to the highlights, at an exposure
//   that matches the island's AgX.
export const look = { exposure: { value: config.bookExposure }, shade: { value: config.shelfShade } };
const glsl = (v: number) => v.toFixed(4);
const ceilings = {
  bottom: SHELF.rows.bottom.y + SHELF.rows.bottom.clear,
  top: SHELF.rows.top.y + SHELF.rows.top.clear,
};

function shelfLook<M extends THREE.MeshStandardMaterial>(m: M) {
  m.onBeforeCompile = (s) => {
    s.uniforms.bookExposure = look.exposure;
    s.uniforms.shelfShade = look.shade;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShelfPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvShelfPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShelfPos;\nuniform float bookExposure;\nuniform float shelfShade;')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
	{
		float depth = ${glsl(SHELF.frontZ)} - vShelfPos.z;
		float ceiling = vShelfPos.y < ${glsl(SHELF.rows.top.y - 0.01)} ? ${glsl(ceilings.bottom)} : ${glsl(ceilings.top)};
		float shade = shelfShade
			* mix( 1.0, 0.6, smoothstep( 0.02, 0.25, depth ) )
			* mix( 0.55, 1.0, smoothstep( 0.0, 0.08, ceiling - vShelfPos.y ) );
		shade = mix( 1.0, shade, smoothstep( -0.03, 0.01, depth ) );
		reflectedLight.indirectDiffuse *= shade;
		reflectedLight.indirectSpecular *= shade;
	}`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        '#if defined( TONE_MAPPING )\n\tgl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb * bookExposure );\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'shelfLook';
  return m;
}

const pagesMat = shelfLook(new THREE.MeshStandardMaterial({ color: '#f2ede2', roughness: 0.9 }));

function textColour(bg: string) {
  const c = new THREE.Color(bg);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return lum > 0.55 ? '#1d1d1f' : '#ffffff';
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function spineTexture(book: Book, horizontal: boolean) {
  const long = 512;
  const short = Math.max(24, Math.round((long * book.t) / (horizontal ? book.h : book.h)));
  const [w, h] = horizontal ? [long, short] : [short, long];
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = book.color;
    ctx.fillRect(0, 0, w, h);
    if (!book.title) return;
    ctx.fillStyle = textColour(book.color);
    const size = Math.min(short * 0.55, 22);
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    if (!horizontal) {
      ctx.translate(w / 2, 16);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(book.title, 0, 0, long - 32);
    } else {
      ctx.fillText(book.title, 16, h / 2, long - 32);
    }
  });
}

function coverTexture(book: Book) {
  const w = 320;
  const h = Math.round((w * book.h) / book.w);
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = book.color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = textColour(book.color);
    ctx.textAlign = 'center';
    const title = book.title || '?';
    ctx.font = '700 30px Inter, system-ui, sans-serif';
    const words = title.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > w - 48 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, w / 2, 70 + i * 36));
    ctx.font = '500 18px Inter, system-ui, sans-serif';
    ctx.globalAlpha = 0.8;
    ctx.fillText(book.author, w / 2, h - 36, w - 40);
  });
}

const loader = new THREE.TextureLoader();

function photo(path: string) {
  const tex = loader.load(import.meta.env.BASE_URL + path);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Covers load when a book is first pulled out (they add up to ~9 MB); until then the cover is drawn. A flat
// book's cover faces up, so it loads with the mesh.
const coverMats = new Map<Book, THREE.MeshStandardMaterial>();

function loadCover(book: Book) {
  const mat = coverMats.get(book);
  if (!book.cover || !mat || mat.userData.photo) return;
  mat.userData.photo = true;
  const tex = photo(book.cover);
  if (book.flat) {
    // the cover lies with the book's head to the left
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
  }
  mat.map = tex;
}

// A box set shows its front, so it never turns; its lid tilts open instead. The lid is the top of the box
// down to the seam across its front photo, as a share of its height.
const LID = 0.55;

function boxMesh(book: Book) {
  const { t, h, w } = book;
  const board = shelfLook(new THREE.MeshStandardMaterial({ color: book.color, roughness: 0.6 }));
  const front = (from: number, share: number) => {
    if (!book.spine) return board;
    const map = photo(book.spine);
    map.repeat.y = share;
    map.offset.y = from;
    return shelfLook(new THREE.MeshStandardMaterial({ map, roughness: 0.6 }));
  };
  const hb = h * (1 - LID);
  const hl = h * LID;
  // the base, with the books inside showing on top when the lid opens
  const g = new THREE.BoxGeometry(t, hb, w).translate(0, (hb - h) / 2, 0);
  const box = new THREE.Mesh(g, [board, board, pagesMat, board, front(0, 1 - LID), board]);
  // the lid turns about its back edge, at the seam
  const hinge = new THREE.Object3D();
  hinge.name = 'lid';
  hinge.position.set(0, hb - h / 2, -w / 2);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(t, hl, w).translate(0, hl / 2, w / 2), [board, board, board, board, front(1 - LID, LID), board]);
  lid.castShadow = true;
  lid.receiveShadow = true;
  hinge.add(lid);
  box.add(hinge);
  return box;
}

function makeMesh(book: Book) {
  if (book.boxSet) return boxMesh(book);
  const map = book.spine ? photo(book.spine) : spineTexture(book, book.flat);
  const spine = shelfLook(new THREE.MeshStandardMaterial({ map, roughness: 0.6 }));
  const cover = shelfLook(new THREE.MeshStandardMaterial({ map: coverTexture(book), roughness: 0.55 }));
  coverMats.set(book, cover);
  const board = shelfLook(new THREE.MeshStandardMaterial({ color: book.color, roughness: 0.6 }));
  if (book.flat) {
    // lying flat: length along x, thickness along y, cover facing up, so its photo is in view from the start
    loadCover(book);
    const g = new THREE.BoxGeometry(book.h, book.t, book.w);
    return new THREE.Mesh(g, [pagesMat, pagesMat, cover, board, spine, pagesMat]);
  }
  // upright: thickness along x, spine facing the viewer (+z), front cover on +x
  const g = new THREE.BoxGeometry(book.t, book.h, book.w);
  return new THREE.Mesh(g, [cover, board, pagesMat, pagesMat, spine, pagesMat]);
}

/**
 * The front cover as makeMesh lays it out, for the open view's flight (see flight.ts): takes an element `px`
 * wide (px from its centre: x right, y down, z out of its face) to the book's own coordinates.
 */
export function coverFace(book: Book, px: number) {
  // a box set's front: x → +x, y → -y, z → +z. The element has the box's real proportions, but the row may
  // have squeezed the box thinner, so its width and height scale apart.
  if (book.boxSet) {
    const mx = book.t / px;
    const my = book.h / ((px * book.mm.h) / book.mm.t);
    return new THREE.Matrix4().set(mx, 0, 0, 0, 0, -my, 0, 0, 0, 0, mx, book.w / 2, 0, 0, 0, 1);
  }
  const m = book.w / px; // metres per px of cover
  // flat: x → -z (away from the spine), y → +x (the head lies to the left), z → +y
  // upright: x → -z (away from the spine), y → -y, z → +x
  return book.flat
    ? new THREE.Matrix4().set(0, m, 0, 0, 0, 0, m, book.t / 2, -m, 0, 0, 0, 0, 0, 0, 1)
    : new THREE.Matrix4().set(0, 0, m, book.t / 2, 0, -m, 0, 0, -m, 0, 0, 0, 0, 0, 0, 1);
}

// Books taller or deeper than the shelf are scaled down, keeping the cover's proportions.
function fit(book: Book, clear: number) {
  const tall = book.flat ? 1 : (clear - 0.012) / book.h;
  const deep = (SHELF.frontZ - SHELF.backZ - 0.02) / book.w;
  const s = Math.min(1, tall, deep);
  book.h *= s;
  book.w *= s;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Shelf {
  group = new THREE.Group();
  rows: Record<RowName, Row>;
  selected: ShelfBook | null = null;
  pinned = false;
  private focusRow: RowName | null = null;
  private focus = 0; // fractional index driving the bulge
  private touch = false;
  private raycaster = new THREE.Raycaster();

  constructor(es: Book[], en: Book[]) {
    this.rows = { top: this.layout('top', es), bottom: this.layout('bottom', en) };
  }

  private layout(name: RowName, books: Book[]): Row {
    const { y, clear } = SHELF.rows[name];
    books.forEach((b) => fit(b, clear));
    const flats = books.filter((b) => b.flat);
    const upright = books.filter((b) => !b.flat);
    const flatSpan = flats.length ? Math.max(...flats.map((b) => b.h)) + 0.02 : 0;
    const x1 = SHELF.x1 - flatSpan;
    const gap = 0.0015;
    const total = upright.reduce((s, b) => s + b.t + gap, 0);
    const squeeze = Math.min(1, (x1 - SHELF.x0) / total);
    const row: Row = { name, books: [], upright: upright.length, start: SHELF.x0, end: x1, gap: gap * squeeze };
    let x = SHELF.x0;
    upright.forEach((b) => {
      b.t *= squeeze;
      const mesh = makeMesh(b);
      const base = new THREE.Vector3(x + b.t / 2, y + b.h / 2, SHELF.frontZ - 0.015 - b.w / 2);
      x += b.t + gap * squeeze;
      row.books.push(this.add(b, mesh, base, name, row.books.length));
    });
    let stack = y;
    flats.forEach((b) => {
      const mesh = makeMesh(b);
      const base = new THREE.Vector3(SHELF.x1 - b.h / 2 - 0.005, stack + b.t / 2, SHELF.frontZ + 0.03 - b.w / 2);
      stack += b.t + 0.001;
      row.books.push(this.add(b, mesh, base, name, row.books.length));
    });
    return row;
  }

  private add(book: Book, mesh: THREE.Mesh, base: THREE.Vector3, row: RowName, index: number): ShelfBook {
    mesh.position.copy(base);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const sb: ShelfBook = { book, mesh, row, index, base, pull: 0, turn: 0, lift: 0, x: base.x, squash: 1, held: false, lid: mesh.getObjectByName('lid') ?? null };
    mesh.userData.shelfBook = sb;
    return sb;
  }

  all() {
    return [...this.rows.top.books, ...this.rows.bottom.books];
  }

  /**
   * Row and index under a ray, from where it crosses the shelf front plane and where each book stands when
   * nothing is pulled out. Like the Dock, the pointer moves through the books at their resting size, whatever
   * the spread and the pulled-out cover are drawing under it. `f` is the fractional index, for the bulge.
   * `reach` (m) leaves out a book further than that from the ray, so empty shelf is not a book.
   */
  pick(ray: THREE.Ray, reach = Infinity): { row: RowName; index: number; f: number } | null {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -SHELF.frontZ);
    const p = ray.intersectPlane(plane, new THREE.Vector3());
    if (!p || p.x < SHELF.x0 - 0.03 || p.x > SHELF.x1 + 0.03) return null;
    // A pulled-out cover can reach up past its row; while the pointer is on it, it stays in that row.
    let name = (['top', 'bottom'] as RowName[]).find((n) => p.y >= SHELF.rows[n].y - 0.02 && p.y <= SHELF.rows[n].y + SHELF.rows[n].clear);
    if (this.selected && this.selected.pull > 0.5) {
      this.raycaster.ray.copy(ray);
      if (this.raycaster.intersectObject(this.selected.mesh).length) name = this.selected.row;
    }
    if (!name) return null;
    const books = this.rows[name].books;
    let best = 0;
    let bestD = Infinity;
    books.forEach((b, i) => {
      const halfX = b.book.flat ? b.book.h / 2 : b.book.t / 2;
      const d = Math.max(0, Math.abs(p.x - b.base.x) - halfX);
      const yOk = !b.book.flat || Math.abs(p.y - b.base.y) < 0.05;
      if (yOk && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (bestD > reach) return null;
    const b = books[best];
    const along = b.book.flat ? 0 : THREE.MathUtils.clamp((p.x - b.base.x) / (b.book.t + this.rows[name].gap), -0.49, 0.49);
    return { row: name, index: best, f: best + along };
  }

  /** The book drawn under a ray (a tap or click lands on what is shown, spread and all), else pick(). */
  hit(ray: THREE.Ray, reach = Infinity): { row: RowName; index: number } | null {
    this.raycaster.ray.copy(ray);
    const first = this.raycaster.intersectObjects(this.group.children, false)[0];
    const sb = first?.object.userData.shelfBook as ShelfBook | undefined;
    return sb ? { row: sb.row, index: sb.index } : this.pick(ray, reach);
  }


  focusOn(row: RowName, f: number, touch: boolean) {
    const books = this.rows[row].books;
    f = Math.max(0, Math.min(books.length - 1, f));
    this.focusRow = row;
    this.focus = f;
    this.touch = touch;
    const next = books[Math.round(f)];
    const changed = next !== this.selected;
    if (changed) {
      this.pinned = false;
      for (let i = next.index - 2; i <= next.index + 2; i++) if (books[i]) loadCover(books[i].book);
    }
    this.selected = next;
    return changed;
  }

  clear() {
    this.selected = null;
    this.focusRow = null;
    this.pinned = false;
  }

  /** The next book in shelf order (top row left to right, then the bottom row), wrapping at the ends. */
  neighbour(sb: ShelfBook, step: number) {
    const all = this.all();
    return all[(all.indexOf(sb) + step + all.length) % all.length];
  }

  /** Arrows: pull out the next book in shelf order, or the first (or last) one if none is out. */
  step(dir: 1 | -1, touch: boolean) {
    const all = this.all();
    const next = this.selected ? this.neighbour(this.selected, dir) : all[dir > 0 ? 0 : all.length - 1];
    this.focusOn(next.row, next.index, touch);
    this.pinned = true;
    return next;
  }

  /**
   * The Dock's magnification, on a shelf that cannot grow: the selected book's neighbours slide apart to
   * open a gap as wide as its turned cover looks from the camera, so the cover hides no spines. The room
   * comes first from any free space at the end of the row, then from making spines thinner, least so next
   * to the gap. The cover stays where the book stands, under the pointer, until a side runs out of room;
   * then it moves inward, which keeps it inside the shelf at the ends.
   * Returns where each upright book goes and its thickness scale, or null to leave the row as it stands.
   */
  private spread(row: Row, sel: ShelfBook, camera: THREE.Camera) {
    if (sel.book.flat || sel.book.boxSet || config.dockGap <= 0) return null;
    const ups = row.books.slice(0, row.upright);
    const i = sel.index;
    const { start, end, gap: g } = row;
    const { t, w } = sel.book;

    // What the turned book hides on the shelf front: its corners, pulled out at x, projected onto the front
    // plane along their rays from the camera.
    const turn = THREE.MathUtils.degToRad(config.coverTurnDeg);
    const out = this.touch ? config.pullOutTouch : config.pullOut;
    const cam = camera.position;
    const depth = cam.z - SHELF.frontZ;
    const z = sel.base.z + out;
    const hides = (x: number) => {
      let a = Infinity;
      let b = -Infinity;
      for (const lx of [-t / 2, t / 2]) {
        for (const lz of [-w / 2, w / 2]) {
          const cx = x + lx * Math.cos(turn) - lz * Math.sin(turn);
          const cz = z + lx * Math.sin(turn) + lz * Math.cos(turn);
          const px = cam.x + ((cx - cam.x) * depth) / Math.max(0.05, cam.z - cz);
          a = Math.min(a, px);
          b = Math.max(b, px);
        }
      }
      return { a, b, mid: (a + b) / 2 };
    };
    const shown = hides(sel.base.x);
    const width = shown.b - shown.a + 2 * config.dockMargin;

    // Each side: its width as it stands, and how much its spines can give, weighted away from the gap.
    const sigma = Math.max(0.1, config.dockSigma);
    const give = (j: number) => 1 - Math.exp(-((j - i) ** 2) / (2 * sigma * sigma));
    const maxSquash = 1 - config.dockMinScale;
    const measure = (books: ShelfBook[]) => {
      let natural = 0;
      let slack = 0;
      for (const o of books) {
        natural += o.book.t + g;
        slack += o.book.t * give(o.index);
      }
      return { natural, slack, least: natural - maxSquash * slack };
    };
    const left = ups.slice(0, i);
    const right = ups.slice(i + 1);
    const L = measure(left);
    const R = measure(right);

    const extra = Math.min(Math.max(0, width - t) * config.dockGap, Math.max(0, end - start - t - L.least - R.least));
    const half = t / 2 + extra / 2;
    // Centred on the book's own place; free room on one side is used before the other side is squeezed.
    const roomL = sel.base.x - half - start - L.natural;
    const roomR = end - sel.base.x - half - R.natural;
    let x = sel.base.x + Math.min(Math.max(0, roomR), Math.max(0, -roomL)) - Math.min(Math.max(0, roomL), Math.max(0, -roomR));
    x = THREE.MathUtils.clamp(x, start + L.least + half, end - R.least - half);

    const xs: number[] = [];
    const squash: number[] = [];
    const amount = (m: { natural: number; slack: number }, room: number) =>
      m.slack > 0 ? THREE.MathUtils.clamp((m.natural - room) / m.slack, 0, maxSquash) : 0;
    let c = amount(L, x - half - start);
    let cur = start;
    for (const o of left) {
      squash[o.index] = 1 - c * give(o.index);
      xs[o.index] = cur + (o.book.t * squash[o.index]) / 2;
      cur += o.book.t * squash[o.index] + g;
    }
    xs[i] = x;
    squash[i] = 1;
    // A book nearer the camera looks further from the middle of the screen, so the pulled-out book stands a
    // little inward of the gap for its cover to land in it. `lens` is that offset at full pull.
    const slope = depth / Math.max(0.05, cam.z - z);
    let lens = 0;
    for (let n = 0; n < 2; n++) lens += (x - hides(x + lens).mid) / slope;
    c = amount(R, end - x - half);
    cur = x + half;
    for (const o of right) {
      squash[o.index] = 1 - c * give(o.index);
      cur += g;
      xs[o.index] = cur + (o.book.t * squash[o.index]) / 2;
      cur += o.book.t * squash[o.index];
    }
    return { xs, squash, lens };
  }

  /**
   * A flat book stands up as wide as its cover, centred where its longer body lay, so on a phone its cover can
   * hang off the side of the screen. Returns how far it moves sideways (m), once stood up, to be all on screen.
   */
  private onScreen(b: ShelfBook, camera: THREE.Camera) {
    const { h, t, w } = b.book;
    const out = this.touch ? config.pullOutTouch : config.pullOut;
    const lift = this.touch ? config.thumbLift : config.hoverLift;
    const at = new THREE.Vector3(b.base.x, b.base.y + lift + 0.06, b.base.z + out * 0.8);
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(config.flatTiltDeg), -Math.PI / 2, 0));
    const pose = new THREE.Matrix4().compose(at, turn, new THREE.Vector3(1, 1, 1));
    let a = Infinity;
    let c = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? h / 2 : -h / 2, i & 2 ? t / 2 : -t / 2, i & 4 ? w / 2 : -w / 2);
      p.applyMatrix4(pose).project(camera);
      a = Math.min(a, p.x);
      c = Math.max(c, p.x);
    }
    // screen width per metre at the book's distance (NDC spans 2)
    const perMetre = at.clone().setX(at.x + 1).project(camera).x - at.clone().project(camera).x;
    const edge = 1 - 2 * config.coverMargin;
    const move = c - a > 2 * edge ? -(a + c) / 2 : Math.max(0, -edge - a) - Math.max(0, c - edge);
    return move / perMetre;
  }

  update(dt: number, camera: THREE.Camera) {
    look.exposure.value = config.bookExposure;
    look.shade.value = config.shelfShade;
    const k = 1 - Math.exp(-dt * 14);
    const sigma = config.neighbourSigma;
    for (const name of ['top', 'bottom'] as RowName[]) {
      const spread = this.focusRow === name && this.selected ? this.spread(this.rows[name], this.selected, camera) : null;
      for (const b of this.rows[name].books) {
        let pull = 0;
        let turn = 0;
        let lift = 0;
        if (this.focusRow === name && this.selected) {
          if (b === this.selected) {
            pull = 1;
            turn = 1;
            lift = this.touch ? config.thumbLift : config.hoverLift;
          } else if (!b.book.flat) {
            const d = b.index - this.focus;
            pull = Math.exp(-(d * d) / (2 * sigma * sigma)) * config.neighbourPull;
          }
        }
        b.pull += (pull - b.pull) * k;
        b.turn += (turn - b.turn) * k;
        b.lift += (lift - b.lift) * k;
        const lens = spread && b === this.selected ? spread.lens * b.pull : 0;
        const shift = b.book.flat && b === this.selected ? this.onScreen(b, camera) : 0;
        b.x += ((spread?.xs[b.index] ?? b.base.x) + lens + shift - b.x) * k;
        b.squash += ((spread?.squash[b.index] ?? 1) - b.squash) * k;
        const turnAmt = b.turn * smooth(0.35, 0.85, b.pull);
        const out = this.touch ? config.pullOutTouch : config.pullOut;
        const m = b.mesh;
        m.visible = !b.held;
        if (b.book.flat) {
          // it moves sideways (onScreen) only as it stands up, so it does not sweep through its neighbours lying flat
          m.position.set(b.base.x + (b.x - b.base.x) * turnAmt, b.base.y + b.lift + b.pull * 0.06, b.base.z + b.pull * out * 0.8);
          // a quarter turn about the cover's normal puts the head (lying left) away from the viewer, then the
          // tilt toward the viewer stands the cover upright
          m.rotation.set(turnAmt * THREE.MathUtils.degToRad(config.flatTiltDeg), -turnAmt * (Math.PI / 2), 0);
        } else {
          // a box set already shows its front, so it slides out only far enough to clear the shelf for its lid
          m.position.set(b.x, b.base.y + b.lift, b.base.z + b.pull * out * (b.lid ? 0.4 : 1));
          if (b.lid) b.lid.rotation.x = -turnAmt * THREE.MathUtils.degToRad(config.lidOpenDeg);
          else m.rotation.set(0, -turnAmt * THREE.MathUtils.degToRad(config.coverTurnDeg), 0);
          m.scale.x = b.squash;
        }
      }
    }
  }
}

import * as THREE from 'three';
import { coverFace, type ShelfBook } from './scene/books';
import { inScene, onPage, onBox } from './flight';
import type { Home } from './bookView';
import { config } from './config';

// View all: every cover flies off the shelf onto a wall of covers over the open views' scrim, and back onto the
// shelf on close (see flight.ts). The wall is bigger than the screen both ways, in proportion to it, and pans
// both ways: drag with momentum and a rubber band at the edges, trackpad, wheel, arrow keys. The covers keep their
// real sizes, at one scale for every book, and stand on the baseline of their row, in shelf order. A cover opens
// its book (main.ts), whose cover flies off the wall and back onto it.

const FLY = 900; // ms, .all-book's transition in style.css
const LAND = 700; // ms, .all.closing .all-book
const STAGGER = 8; // ms between books leaving the shelf, or landing on it, in shelf order
const PAD = { x: 32, top: 72, bottom: 40 }; // px the wall stops short of the screen's edges, clear of the close button
const DECAY = 325; // ms, momentum's time constant (as on iOS); the arrow keys glide by the same rule
const RUBBER = 0.55; // past an edge the wall moves less and less (iOS's rubber band)

type Tile = { sb: ShelfBook; li: HTMLLIElement; a: HTMLAnchorElement; full?: string; img?: HTMLImageElement; x: number; y: number; w: number; h: number };

const view = document.querySelector<HTMLElement>('#all')!;
const wall = view.querySelector<HTMLElement>('.all-wall')!;
const base = import.meta.env.BASE_URL;
let tiles: Tile[] = [];
let camera: THREE.PerspectiveCamera;
let state: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
let timers: number[] = [];
let raf = 0;
let last = 0;
const pos = { x: 0, y: 0 }; // the wall's top left corner on screen
const vel = { x: 0, y: 0 }; // px/ms
const size = { x: 0, y: 0 };
let drag: { id: number; x: number; y: number; from: { x: number; y: number }; moved: boolean; trail: { x: number; y: number; t: number }[] } | null = null;
let stopped = false; // the press that stopped a gliding wall does not open a book

const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
const small = (sb: ShelfBook) => (sb.book.boxSet ? sb.book.spine : sb.book.cover?.replace('covers/', 'covers/small/'));
let preloaded: HTMLImageElement[] | null = null;
const fromShelf = (t: Tile) => inScene(t.a, t.sb.mesh, coverFace(t.sb.book, t.a.offsetWidth), camera);

/** Builds the wall, once. `open` opens a book from it. */
export function initAll(books: ShelfBook[], open: (sb: ShelfBook) => void) {
  tiles = books.map((sb) => {
    const b = sb.book;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'all-book';
    a.href = `#${b.id}`;
    a.draggable = false;
    a.setAttribute('aria-label', [b.title, b.author].filter(Boolean).join(', '));
    // A box set shows its front, the photo on its spine side. Covers show their small copy until the full one is
    // loaded, once the cover is near the screen (see frame).
    const image = small(sb);
    a.style.background = image ? `${b.color} url(${base}${image}) center / cover` : b.color;
    if (!image) a.textContent = b.title;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      // a click from the keyboard has no press (detail 0)
      if (state === 'open' && (e.detail === 0 || !stopped)) open(sb);
    });
    li.append(a);
    return { sb, li, a, full: b.cover && !b.boxSet ? base + b.cover : undefined, x: 0, y: 0, w: 0, h: 0 };
  });
  wall.replaceChildren(...tiles.map((t) => t.li));
}

/**
 * Rows of covers, as long as makes the wall's proportions the screen's. The scale is set by the screen's shorter
 * side, so a phone shows three or four covers across.
 */
function layOut() {
  const vw = Math.max(1, innerWidth); // a hidden window can measure 0; it lays out again on resize
  const vh = Math.max(1, innerHeight);
  const k = THREE.MathUtils.clamp(Math.min(vw, vh) / 750, 0.45, 0.8); // px per mm
  const gx = 36 * k;
  const gy = 64 * k;
  for (const t of tiles) {
    const mm = t.sb.book.mm;
    t.w = (t.sb.book.boxSet ? mm.t : mm.w) * k;
    t.h = mm.h * k;
  }
  const length = tiles.reduce((s, t) => s + t.w + gx, 0);
  const rowH = (1.25 * tiles.reduce((s, t) => s + t.h, 0)) / tiles.length + gy; // a row is as tall as its tallest
  const target = Math.sqrt((length * rowH * vw) / vh);
  const rows: Tile[][] = [[]];
  let run = 0;
  for (const t of tiles) {
    if (run + t.w > target && rows[rows.length - 1].length) {
      rows.push([]);
      run = 0;
    }
    rows[rows.length - 1].push(t);
    run += t.w + gx;
  }
  const widths = rows.map((r) => r.reduce((s, t) => s + t.w, 0) + gx * (r.length - 1));
  size.x = Math.max(...widths);
  let y = 0;
  rows.forEach((r, i) => {
    const h = Math.max(...r.map((t) => t.h));
    let x = (size.x - widths[i]) / 2;
    for (const t of r) {
      t.x = x;
      t.y = y + h - t.h;
      x += t.w + gx;
      Object.assign(t.li.style, { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px` });
    }
    y += h + gy;
  });
  size.y = y - gy;
}

/** The wall's furthest positions along an axis; a wall that fits the screen sits in its middle. */
function range(axis: 'x' | 'y'): [number, number] {
  const screen = axis === 'x' ? innerWidth : innerHeight;
  const [a, b] = axis === 'x' ? [PAD.x, PAD.x] : [PAD.top, PAD.bottom];
  if (size[axis] + a + b <= screen) {
    const mid = a + (screen - a - b - size[axis]) / 2;
    return [mid, mid];
  }
  return [screen - b - size[axis], a];
}

const band = (over: number, d: number) => (1 - 1 / ((over * RUBBER) / d + 1)) * d;
const unband = (over: number, d: number) => over / (RUBBER * (1 - Math.min(0.99, over / d)));

/** Where a drag that wants the wall at `raw` puts it: past an edge, it gives less and less. */
function rubber(raw: number, axis: 'x' | 'y', invert = false) {
  const [lo, hi] = range(axis);
  const d = axis === 'x' ? innerWidth : innerHeight;
  const f = invert ? unband : band;
  return raw < lo ? lo - f(lo - raw, d) : raw > hi ? hi + f(raw - hi, d) : raw;
}

function clampAxis(v: number, axis: 'x' | 'y') {
  const [lo, hi] = range(axis);
  return THREE.MathUtils.clamp(v, lo, hi);
}

function place() {
  wall.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
}

function frame(now: number) {
  const dt = Math.min(50, now - last);
  last = now;
  if (!drag?.moved) {
    for (const axis of ['x', 'y'] as const) {
      const [lo, hi] = range(axis);
      pos[axis] += vel[axis] * dt;
      vel[axis] *= Math.exp(-dt / DECAY);
      // past an edge: the glide stops quickly and the wall springs back
      const back = pos[axis] < lo ? lo - pos[axis] : pos[axis] > hi ? hi - pos[axis] : 0;
      if (back) {
        vel[axis] *= Math.exp(-dt / 40);
        pos[axis] += back * (1 - Math.exp(-dt / 90));
        if (Math.abs(back) < 0.3) pos[axis] += back;
      }
      if (Math.abs(vel[axis]) < 0.003) vel[axis] = 0;
    }
  }
  place();
  // Full covers load once they are near the screen, after the flight (during it they are all on screen).
  if (state === 'open') {
    for (const t of tiles) {
      if (!t.full || t.img) continue;
      const x = pos.x + t.x;
      const y = pos.y + t.y;
      if (x + t.w < -innerWidth / 2 || x > innerWidth * 1.5 || y + t.h < -innerHeight / 2 || y > innerHeight * 1.5) continue;
      const img = (t.img = new Image());
      img.alt = '';
      img.draggable = false;
      img.src = t.full;
      img.decode().then(() => img.classList.add('loaded'), () => {});
      t.a.append(img);
    }
  }
  raf = requestAnimationFrame(frame);
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

export const isAllOpen = () => state === 'opening' || state === 'open';

/** The wall is up and still: nothing behind the scrim changes, so the scene need not be drawn (main.ts). */
export const isAllLanded = () => state === 'open';

/**
 * The covers' small copies (~1.1 MB), loaded and decoded ahead, once the camera is at the shelf: arriving during the
 * flight, they would cost it its first frames and pop in late.
 */
export function preloadWall() {
  preloaded ??= tiles.flatMap((t) => {
    const image = small(t.sb);
    if (!image) return [];
    const img = new Image();
    img.src = base + image;
    img.decode().catch(() => {});
    return [img];
  });
}

/** The covers fly off the shelf onto the wall, in shelf order, which starts in its middle. */
export function openAll(cam: THREE.PerspectiveCamera) {
  if (isAllOpen()) return;
  camera = cam;
  clearTimers();
  state = 'opening';
  view.hidden = false;
  view.classList.remove('closing', 'shown');
  layOut();
  pos.x = clampAxis((innerWidth - size.x) / 2, 'x');
  pos.y = clampAxis((innerHeight - size.y) / 2, 'y');
  vel.x = vel.y = 0;
  place();
  preloadWall();
  // Measuring a cover gives it a style, so without .still it would transition onto the shelf too. All the
  // measuring comes first: a transform set between two measurements makes the next one lay out the page again.
  view.classList.add('still', 'flying');
  const from = tiles.map(fromShelf);
  const to = tiles.map((t) => onPage(t.a, camera));
  tiles.forEach((t, i) => {
    t.a.style.transitionDelay = '';
    t.a.style.transform = from[i];
  });
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(frame);
  // The covers are drawn once where they start, edge-on over their books, before they move: the browser makes
  // their layers in that frame, which would otherwise be the flight's first frames, and the ones it moves most in.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (state !== 'opening') return;
      view.classList.remove('still');
      view.classList.add('shown');
      tiles.forEach((t, i) => {
        t.a.style.transitionDelay = `${i * STAGGER}ms`;
        t.a.style.transform = to[i];
        later(i * STAGGER, () => (t.sb.held = true));
      });
      later(FLY + tiles.length * STAGGER, () => {
        state = 'open';
        view.classList.remove('flying');
        for (const t of tiles) t.a.style.transitionDelay = '';
      });
    }),
  );
}

/** The covers fly back onto the shelf from wherever the wall is, and the books show again as each one lands. */
export function closeAll() {
  if (!isAllOpen()) return;
  clearTimers();
  state = 'closing';
  drag = null;
  view.classList.remove('panning', 'shown', 'still');
  view.classList.add('closing', 'flying');
  tiles.forEach((t, i) => {
    t.a.style.transitionDelay = `${i * STAGGER}ms`;
    t.a.style.transform = fromShelf(t);
    later(i * STAGGER + LAND, () => (t.sb.held = false));
  });
  later(LAND + tiles.length * STAGGER, () => {
    state = 'closed';
    cancelAnimationFrame(raf);
    view.hidden = true;
    view.classList.remove('closing', 'flying');
  });
}

const tileOf = (sb: ShelfBook) => tiles.find((t) => t.sb === sb)!;

/** A book's place on the wall, for its open view to fly from and back to (see bookView.ts). */
export function onWall(sb: ShelfBook): Home {
  const t = tileOf(sb);
  return {
    at: (cover) => onBox(cover, t.a.getBoundingClientRect(), camera),
    hold: (held) => t.a.classList.toggle('lent', held),
  };
}

/** Brings a book on the wall onto the screen, at once (the open view's arrow keys, so its cover lands in view). */
export function revealOnWall(sb: ShelfBook) {
  const t = tileOf(sb);
  vel.x = vel.y = 0;
  pos.x = clampAxis(innerWidth / 2 - t.x - t.w / 2, 'x');
  pos.y = clampAxis(innerHeight / 2 - t.y - t.h / 2, 'y');
  place();
}

/** Arrow keys: the wall glides `dx`, `dy` px. */
export function glideWall(dx: number, dy: number) {
  vel.x = dx / DECAY;
  vel.y = dy / DECAY;
}

// ---------- panning ----------

view.addEventListener('pointerdown', (e) => {
  if (!isAllOpen() || e.button !== 0 || (e.target as Element).closest('.all-close')) return;
  stopped = Math.hypot(vel.x, vel.y) > 0.05;
  vel.x = vel.y = 0;
  // a press on a wall still springing back from an edge carries on from where it is
  const from = { x: rubber(pos.x, 'x', true), y: rubber(pos.y, 'y', true) };
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from, moved: false, trail: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
});

view.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > config.slopPx) {
    // Captured only now: a captured press would click the wall, not the cover under it.
    drag.moved = true;
    stopped = true;
    view.classList.add('panning');
    try {
      view.setPointerCapture(e.pointerId);
    } catch {} // the pointer is already gone
  }
  if (!drag.moved) return;
  pos.x = rubber(drag.from.x + dx, 'x');
  pos.y = rubber(drag.from.y + dy, 'y');
  drag.trail.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  while (drag.trail.length > 2 && drag.trail[0].t < e.timeStamp - 100) drag.trail.shift();
});

function release(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved) {
    const a = drag.trail[0];
    const b = drag.trail[drag.trail.length - 1];
    const dt = b.t - a.t;
    // a finger that stopped before letting go leaves no glide
    if (dt > 0 && e.timeStamp - b.t < 60) {
      vel.x = (b.x - a.x) / dt;
      vel.y = (b.y - a.y) / dt;
    }
  }
  drag = null;
  view.classList.remove('panning');
}
view.addEventListener('pointerup', release);
view.addEventListener('pointercancel', release);

view.addEventListener('wheel', (e) => {
  e.preventDefault(); // the page behind never scrolls
  if (!isAllOpen() || e.ctrlKey) return;
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;
  if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
  vel.x = vel.y = 0;
  pos.x = clampAxis(pos.x - dx, 'x');
  pos.y = clampAxis(pos.y - dy, 'y');
}, { passive: false });

// Tabbing onto a cover off the screen brings it on.
view.addEventListener('focusin', (e) => {
  const t = tiles.find((t) => t.a === e.target);
  if (!t) return;
  const r = t.a.getBoundingClientRect();
  if (r.left < PAD.x || r.right > innerWidth - PAD.x || r.top < PAD.top || r.bottom > innerHeight - PAD.bottom) revealOnWall(t.sb);
});

window.addEventListener('resize', () => {
  if (!isAllOpen()) return;
  layOut();
  pos.x = clampAxis(pos.x, 'x');
  pos.y = clampAxis(pos.y, 'y');
});

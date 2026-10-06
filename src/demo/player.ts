import * as THREE from 'three';
import type { Rig } from '../camera';
import type { Shelf, RowName } from '../scene/books';
import type { Polaroids } from '../scene/polaroids';
import { SHELF } from '../scene/island';

/**
 * The demo player (?demo, dev only): plays a script of finger gestures (script.ts) on the live site, as touches the
 * site's own handlers take, so everything on screen is the site's real behaviour. What a phone's browser would do
 * by itself with those touches (scroll the page, coast after a flick, snap the row of prints, click on a tap) is done
 * here, since synthetic touches get none of it. A grey dot shows the finger, like iOS's "show touches".
 * demo.html shows it in an iPhone-sized frame.
 */

export type App = { canvas: HTMLCanvasElement; rig: Rig; shelf: Shelf; polaroids: Polaroids };
type Point = { x: number; y: number };
/** A place on screen (CSS px), fixed or found in the scene when the gesture starts. */
export type Target = Point | ((app: App) => Point);

// ---------- script vocabulary ----------

const eases = {
  linear: (u: number) => u,
  // minimum jerk: how a hand moves from one rest to another
  smooth: (u: number) => u * u * u * (10 - 15 * u + 6 * u * u),
  // moving at once, settling gently: a thumb that already knows where it is going
  prompt: (u: number) => 0.4 * (1 - (1 - u) ** 2) + 0.6 * eases.smooth(u),
  // speeding up to the lift: the end of a flick
  launch: (u: number) => 0.45 * u + 0.55 * u * u,
  accel: (u: number) => u * u,
};
export type Ease = keyof typeof eases;

/** One leg of a finger's path: to a target, or by an offset, in `ms`, then a pause with the finger still down. */
export type Move = { to?: Target; by?: [number, number]; ms: number; ease?: Ease; bow?: number; pause?: number };

type Step = { label: string; ms: number; plan?: (app: App) => (ms: number) => Point };
export type Section = { name: string; start: 'top' | 'shelf'; steps: Step[] };

/** A part of the script, which demo.html can start from: the page is put at the top or at the shelf first. */
export const section = (name: string, start: Section['start'], steps: Step[]): Section => ({ name, start, steps });

/** No finger on the screen. */
export const wait = (ms: number, label = 'wait'): Step => ({ label, ms });

/** A finger lands on `from`, rests `land` ms, follows the moves, and lifts at the end of the last one. */
export function path(from: Target, moves: Move[], { land = 70, label = 'path' } = {}): Step {
  const ms = land + moves.reduce((sum, m) => sum + m.ms + (m.pause ?? 0), 0);
  return { label, ms, plan: (app) => plan(app, from, moves, land) };
}

/** Down and up in place. A short tap, or a press as long as `hold`. */
export const tap = (target: Target, { hold = 90, label = 'tap' } = {}) =>
  path(target, [{ by: [0.6, 0.4], ms: hold, ease: 'linear' }], { land: 0, label });

/** A drag that stops before the finger lifts, so nothing coasts. */
export const drag = (from: Target, move: Omit<Move, 'ease'> & { ease?: Ease }, { land = 70, label = 'drag' } = {}) =>
  path(from, [{ ease: 'smooth', ...move }], { land, label });

/** A flick: the finger speeds up and lifts while still moving, so what it moved coasts on. */
export const flick = (from: Target, move: Omit<Move, 'ease'> & { ease?: Ease }, { land = 40, label = 'flick' } = {}) =>
  path(from, [{ ease: 'launch', ...move }], { land, label });

// ---------- targets ----------

export const at = (x: number, y: number): Target => ({ x, y });

/** A target moved by a few px. */
export const off = (t: Target, dx: number, dy: number): Target => (app) => {
  const p = resolve(app, t);
  return { x: p.x + dx, y: p.y + dy };
};

/** A photo pile on the worktop (0: the island, 1: Isabel & Linda). */
export const pile = (index: number): Target => (app) =>
  project(app, app.polaroids.items[index].group.getWorldPosition(new THREE.Vector3()));

/** A point on a row of the shelf, `share` of the way across the screen, at the books' middle height. */
export const row = (name: RowName, share: number): Target => (app) => {
  const r = SHELF.rows[name];
  const p = project(app, new THREE.Vector3(app.rig.camera.position.x, r.y + r.clear * 0.4, SHELF.frontZ));
  return { x: share * innerWidth, y: p.y };
};

/** A book's spine on the shelf, by its id in books.json. */
export const book = (id: string): Target => (app) => {
  const sb = app.shelf.all().find((b) => b.book.id === id);
  if (!sb) throw new Error(`demo: no book ${id}`);
  return project(app, new THREE.Box3().setFromObject(sb.mesh).getCenter(new THREE.Vector3()));
};

/** The middle of an element. */
export const el = (selector: string): Target => () => {
  const e = document.querySelector(selector);
  if (!e) throw new Error(`demo: nothing matches ${selector}`);
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * A book's cover on the View all wall, by its id in books.json, wherever the wall lies when the tap starts: the
 * middle of the part of it on screen. The wall's glide decides where it is, so it may be off screen; the console says so.
 */
export const cover = (id: string): Target => () => {
  const a = document.querySelector(`.all-book[href="#${id}"]`);
  if (!a) throw new Error(`demo: no cover ${id} on the wall`);
  const r = a.getBoundingClientRect();
  const left = Math.max(r.left, 0), right = Math.min(r.right, innerWidth);
  const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
  if (right <= left || bottom <= top) console.warn(`demo: the cover of ${id} is off screen; change the pans before it`);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
};

/** The cover on the View all wall nearest to a point, as the wall lies when the tap starts. */
export const coverNear = (x: number, y: number): Target => () => {
  let best = { x, y };
  let distance = Infinity;
  for (const a of document.querySelectorAll('.all-book')) {
    const r = a.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < distance) [best, distance] = [c, d];
  }
  return best;
};

function project(app: App, v: THREE.Vector3): Point {
  const p = v.clone().project(app.rig.camera);
  const r = app.canvas.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
}

const resolve = (app: App, t: Target) => (typeof t === 'function' ? t(app) : t);

// ---------- finger paths ----------

// A seeded tremor: a resting finger is never perfectly still, and a straight line drawn by a thumb wavers.
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function plan(app: App, from: Target, moves: Move[], land: number) {
  const start = resolve(app, from);
  let p0 = start;
  let t0 = land;
  const legs = moves.map((m) => {
    const p1 = m.to ? resolve(app, m.to) : { x: p0.x + (m.by?.[0] ?? 0), y: p0.y + (m.by?.[1] ?? 0) };
    const leg = { p0, p1, t0, ...m };
    p0 = p1;
    t0 += m.ms + (m.pause ?? 0);
    return leg;
  });
  const phase = [rand(), rand(), rand(), rand()].map((r) => r * Math.PI * 2);
  return (ms: number): Point => {
    const s = ms / 1000;
    const tremor = {
      x: 0.35 * Math.sin(s * 9.1 + phase[0]) + 0.2 * Math.sin(s * 23.7 + phase[1]),
      y: 0.35 * Math.sin(s * 7.3 + phase[2]) + 0.2 * Math.sin(s * 19.3 + phase[3]),
    };
    let p = start;
    for (const leg of legs) {
      if (ms < leg.t0) break;
      const u = Math.min(1, (ms - leg.t0) / leg.ms);
      const e = eases[leg.ease ?? 'smooth'](u);
      const dx = leg.p1.x - leg.p0.x;
      const dy = leg.p1.y - leg.p0.y;
      const len = Math.hypot(dx, dy) || 1;
      // a thumb pivots at its base, so its paths bow a little to one side
      const bow = Math.sin(Math.PI * e) * (leg.bow ?? 0);
      p = { x: leg.p0.x + dx * e - (dy / len) * bow, y: leg.p0.y + dy * e + (dx / len) * bow };
    }
    return { x: p.x + tremor.x, y: p.y + tremor.y };
  };
}

// ---------- the browser's part ----------

const SLOP = 10; // px a finger moves before the browser decides it is a scroll (the site's own slop is 8)
const DECELERATION = 0.998; // per ms, iOS's normal scroll deceleration

type Axis = 'x' | 'y';

/** Something that scrolls: an element, or the page. */
class Scroller {
  constructor(private el: Element, public axis: Axis) {}
  get pos() {
    return this.axis === 'x' ? this.el.scrollLeft : this.el.scrollTop;
  }
  set pos(v: number) {
    if (this.axis === 'x') this.el.scrollLeft = v;
    else this.el.scrollTop = v;
  }
  get max() {
    return this.axis === 'x' ? this.el.scrollWidth - this.el.clientWidth : this.el.scrollHeight - this.el.clientHeight;
  }
  /** Snap positions of a row with scroll-snap-type, for children that snap to the centre. */
  snaps() {
    const el = this.el as HTMLElement;
    const s = getComputedStyle(el).scrollSnapType;
    if (!el.dataset.demoSnaps && (!s || s === 'none')) return null;
    const box = this.el.getBoundingClientRect();
    return [...this.el.children]
      .filter((c) => getComputedStyle(c).scrollSnapAlign.includes('center'))
      .map((c) => {
        const r = c.getBoundingClientRect();
        return this.axis === 'x'
          ? this.el.scrollLeft + r.left + r.width / 2 - (box.left + this.el.clientWidth / 2)
          : this.el.scrollTop + r.top + r.height / 2 - (box.top + this.el.clientHeight / 2);
      });
  }
  /**
   * A row with mandatory snapping snaps at once when it is scrolled from code, and fights a finger driving it. Once
   * the demo has driven it, it does the snapping itself (Coast), so the row's own snapping stays off.
   */
  lift() {
    const el = this.el as HTMLElement;
    if (getComputedStyle(el).scrollSnapType !== 'none') el.dataset.demoSnaps = '1';
    el.style.scrollSnapType = 'none';
  }
}

/** What a touch on `el` may pan natively, by the touch-action of it and everything above it. */
function panAxes(el: Element | null) {
  const axes = { x: true, y: true };
  for (; el; el = el.parentElement) {
    const t = getComputedStyle(el).touchAction;
    if (t === 'none') return { x: false, y: false };
    if (t.includes('pan-x') && !t.includes('pan-y')) axes.y = false;
    if (t.includes('pan-y') && !t.includes('pan-x')) axes.x = false;
  }
  return axes;
}

function scrollerFor(el: Element | null, axis: Axis): Scroller | null {
  if (!panAxes(el)[axis]) return null;
  for (let e = el; e && e !== document.documentElement && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    const overflow = axis === 'x' ? s.overflowX : s.overflowY;
    const room = axis === 'x' ? e.scrollWidth - e.clientWidth : e.scrollHeight - e.clientHeight;
    if ((overflow === 'auto' || overflow === 'scroll') && room > 1) return new Scroller(e, axis);
  }
  return axis === 'y' ? new Scroller(document.scrollingElement!, 'y') : null;
}

/** After the finger lifts: coasting to a stop, or springing onto a snap position. */
class Coast {
  private from: number;
  private rate = -Math.log(DECELERATION);
  constructor(private s: Scroller, private v: number, private start: number, private target: number | null = null) {
    this.from = s.pos;
    // A coast that would run past an end slows down sooner and comes to rest on it, rather than hitting it.
    const room = v > 0 ? s.max - this.from : -this.from;
    if (target !== null) return;
    if (Math.abs(room) < 0.5) this.v = 0;
    else if (v / this.rate / room > 1) this.rate = v / room;
  }
  /** False once it has stopped. */
  frame(now: number) {
    const t = Math.max(0, now - this.start);
    if (this.target !== null) {
      // a critically damped spring that starts at the flick's speed
      const w = 0.012; // per ms
      const d = this.from - this.target;
      const x = this.target + (d + (this.v + w * d) * t) * Math.exp(-w * t);
      this.s.pos = x;
      if (Math.abs(x - this.target) < 0.3 && t > 100) return this.stop(this.target);
      return true;
    }
    const decay = Math.exp(-this.rate * t);
    this.s.pos = THREE.MathUtils.clamp(this.from + (this.v / this.rate) * (1 - decay), 0, this.s.max);
    return Math.abs(this.v * decay) > 0.02 || this.stop();
  }
  stop(at?: number) {
    if (at !== undefined) this.s.pos = at;
    return false;
  }
}

/** One finger: turns the script's finger positions into pointer and touch events, and the browser's reactions. */
class Finger {
  private target: Element = document.body;
  private start: Point = { x: 0, y: 0 };
  private last: Point = { x: 0, y: 0 };
  private samples: { x: number; y: number; t: number }[] = [];
  private travel = 0;
  private prevented = false; // the site cancelled a touch before the browser decided, so it never scrolls
  private owner: 'site' | Scroller | null = null;
  private scrollFrom = 0; // where the scroller was when the browser took the touch
  private coast: Coast | null = null;
  private dot = makeDot();

  set(p: Point | null, now: number) {
    const down = this.dot.classList.contains('down');
    if (p && !down) this.down(p, now);
    else if (p) this.move(p, now);
    else if (down) this.up(now);
    if (this.coast && !this.coast.frame(now)) this.coast = null;
  }

  private down(p: Point, now: number) {
    this.coast?.stop(); // a finger landing stops a coasting scroll
    this.coast = null;
    this.target = document.elementFromPoint(p.x, p.y) ?? document.body;
    this.start = this.last = p;
    this.samples = [{ ...p, t: now }];
    this.travel = 0;
    this.prevented = false;
    this.owner = null;
    this.pointer('pointerdown', p);
    this.prevented = this.touch('touchstart', p);
    this.dot.style.translate = `${p.x}px ${p.y}px`;
    this.dot.classList.add('down');
  }

  private move(p: Point, now: number) {
    this.travel = Math.max(this.travel, Math.hypot(p.x - this.start.x, p.y - this.start.y));
    this.samples.push({ ...p, t: now });
    while (this.samples.length > 2 && this.samples[0].t < now - 100) this.samples.shift();
    if (!(this.owner instanceof Scroller)) this.pointer('pointermove', p);
    if (this.touch('touchmove', p) && !this.owner) this.prevented = true;
    if (!this.owner && this.travel > SLOP) {
      const dx = p.x - this.start.x;
      const dy = p.y - this.start.y;
      const s = this.prevented ? null : scrollerFor(this.target, Math.abs(dx) > Math.abs(dy) ? 'x' : 'y');
      this.owner = s ?? 'site';
      if (s) {
        // the browser takes the touch: the page gets a pointercancel, and from now on cannot stop the scroll
        this.pointer('pointercancel', p);
        s.lift();
        this.scrollFrom = s.pos;
      }
    }
    if (this.owner instanceof Scroller) {
      const d = this.owner.axis === 'x' ? p.x - this.last.x : p.y - this.last.y;
      this.owner.pos = THREE.MathUtils.clamp(this.owner.pos - d, 0, this.owner.max);
    }
    this.last = p;
    this.dot.style.translate = `${p.x}px ${p.y}px`;
  }

  private up(now: number) {
    const p = this.last;
    this.dot.classList.remove('down');
    if (!(this.owner instanceof Scroller)) this.pointer('pointerup', p);
    const cancelled = this.touch('touchend', null);
    if (this.owner instanceof Scroller) this.release(this.owner, now);
    else if (this.travel < SLOP && !cancelled) {
      // a tap clicks what it landed on
      this.target.dispatchEvent(new PointerEvent('click', { ...this.at(p), pointerType: 'touch', detail: 1, bubbles: true, cancelable: true, composed: true }));
    }
  }

  private release(s: Scroller, now: number) {
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = b.t - a.t;
    const v = dt > 0 && now - b.t < 60 ? -((s.axis === 'x' ? b.x - a.x : b.y - a.y) / dt) : 0;
    const snaps = s.snaps();
    if (!snaps?.length) {
      this.coast = new Coast(s, v, now);
      return;
    }
    // A row that snaps goes to the next item when flicked, otherwise to the nearest one, never further than one away
    // from the item it showed when the finger landed.
    const pos = s.pos;
    const nearest = (x: number) => snaps.reduce((best, c, i) => (Math.abs(c - x) < Math.abs(snaps[best] - x) ? i : best), 0);
    const was = nearest(this.scrollFrom);
    const i = THREE.MathUtils.clamp(nearest(pos + v * 180), was - 1, was + 1);
    this.coast = new Coast(s, v, now, snaps[i]);
  }

  private at(p: Point) {
    return { clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y };
  }

  private pointer(type: string, p: Point) {
    this.target.dispatchEvent(
      new PointerEvent(type, {
        ...this.at(p),
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
        width: 22,
        height: 22,
        pressure: type === 'pointerup' || type === 'pointercancel' ? 0 : 0.5,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }

  /** Dispatches a touch event shaped like the real one (the site reads touches and their client positions). Returns whether it was cancelled. */
  private touch(type: string, p: Point | null) {
    const q = p ?? this.last;
    const t = { identifier: 1, target: this.target, ...this.at(q), pageX: q.x + scrollX, pageY: q.y + scrollY, radiusX: 11, radiusY: 11, rotationAngle: 0, force: 0.5 };
    const list = p ? [t] : [];
    const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(e, { touches: { value: list }, targetTouches: { value: list }, changedTouches: { value: [t] } });
    this.target.dispatchEvent(e);
    return e.defaultPrevented;
  }
}

function makeDot() {
  const style = document.createElement('style');
  style.textContent = `
    .demo-touch {
      position: fixed; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      background: rgba(120, 120, 128, 0.42); box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.75), 0 1px 6px rgba(0, 0, 0, 0.18);
      pointer-events: none; z-index: 2147483647; opacity: 0; scale: 1.35;
      transition: opacity 0.22s ease-out, scale 0.22s ease-out;
    }
    .demo-touch.down { opacity: 1; scale: 1; transition: opacity 0.1s ease-out, scale 0.14s cubic-bezier(0.2, 0.9, 0.3, 1.3); }
  `;
  const dot = document.createElement('div');
  dot.className = 'demo-touch';
  document.head.append(style);
  document.documentElement.append(dot);
  return dot;
}

// ---------- playing ----------

/** Plays the script, from the start or from one of its sections, and tells demo.html (the parent frame) where it is. */
export function play(app: App, script: Section[], from?: string | null) {
  const first = Math.max(0, script.findIndex((s) => s.name === from));
  const sections = script.slice(first);
  const steps = sections.flatMap((s) => s.steps.map((step) => ({ ...step, section: s.name })));
  const total = steps.reduce((sum, s) => sum + s.ms, 0);
  const post = (msg: object) => parent !== window && parent.postMessage({ demo: true, ...msg }, location.origin);
  post({ outline: script.map((s) => s.name), from: sections[0].name, total });

  const finger = new Finger();
  // The page starts where the section does; the camera follows the scroll for a moment before it plays.
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollTo(0, sections[0].start === 'top' ? 0 : max);
  const settle = sections[0].start === 'top' ? 400 : 1800;

  let t0 = 0;
  let i = 0;
  let stepStart = 0;
  let pos: ((ms: number) => Point) | null = null;
  const loop = (now: number) => {
    if (!t0) t0 = now + settle;
    const t = now - t0;
    if (t < 0) return requestAnimationFrame(loop);
    // one step boundary a frame: a tap is never skipped
    if (i < steps.length && t >= stepStart + steps[i].ms) {
      stepStart += steps[i].ms;
      i++;
      pos = null;
    }
    const step = steps[i];
    if (step?.plan && !pos) pos = step.plan(app);
    finger.set(pos ? pos(t - stepStart) : null, now);
    post({ t: Math.min(t, total), section: step?.section ?? 'end', label: step?.label ?? '' });
    if (i < steps.length || t < total + 1500) requestAnimationFrame(loop);
    else post({ done: true });
  };
  requestAnimationFrame(loop);
}

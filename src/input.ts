import * as THREE from 'three';
import { config } from './config';
import { tick } from './haptics';
import type { Rig } from './camera';
import type { Shelf, RowName, ShelfBook } from './scene/books';
import type { Polaroids } from './scene/polaroids';
import { SHELF } from './scene/island';

type UI = {
  openBook: (sb: ShelfBook) => void;
  openPolaroid: (index: number) => void;
  isOpen: () => boolean;
  // swipe down on an open view: follow the finger, then close it or put it back
  dragOpen: (dy: number) => void;
  settleOpen: () => void;
  closeOpen: () => void;
};

type Mode = 'idle' | 'pending' | 'scroll' | 'pan' | 'scrub' | 'orbit';

/**
 * Gestures:
 * - vertical scroll: the page and the camera story (never captured)
 * - touch, sideways slide on a row, over books or empty shelf: magnifier. The row is laid across the screen in
 *   slots, one per book; the finger's slot picks the book, and the shelf moves against the finger to keep that book
 *   under it, so one slide reaches every book in the row (see layOut); a flick up at the end opens the book
 * - touch, press without sliding, however long: the spine under the finger comes out, like a tap
 * - touch, sideways swipe off the rows / trackpad swipe / Shift+wheel: pan the shelf
 * - mouse hover: magnifier, Dock-style (the pointer's place along the row picks the book; see Shelf.pick). On a row
 *   too long for the screen (a narrow window), the pointer works the touch slide's slots instead, and the shelf moves
 *   against it the same way, so every book is in reach without panning (see hover)
 * - arrow keys and the ‹ › buttons: step through the books (main.ts)
 * - Space+drag (mouse) or two-finger drag (touch): free orbit
 */
export class Input {
  mode: Mode = 'idle';
  private start = { x: 0, y: 0, t: 0 };
  private last = { x: 0, y: 0 };
  private samples: { x: number; y: number; t: number }[] = [];
  private travel = 0; // furthest the finger has been from where it landed, px
  private pressRow: RowName | null = null; // the row the finger landed on
  private scrubRow: RowName = 'bottom';
  private scrubF = 0;
  private slots = { c: [0], x: [0] }; // the scrub's slot centres on screen (px) and the books' places (m), see layOut
  private fingerX = 0;
  private lift: { x: number; y: number } | null = null; // where the finger turned upward during a slide, see watchLift
  private twoFinger = { x: 0, y: 0, dist: 0 };
  private spaceHeld = false;
  private pointerOver = false;
  private mouseOrbit = false;
  private mouse = { x: 0, y: 0 };
  private hoverHeld: { x: number; y: number } | null = null;
  private mouseRow: RowName | null = null; // the row the pointer slides along through the slots, see hover
  private ray = new THREE.Raycaster();

  constructor(
    private canvas: HTMLCanvasElement,
    private rig: Rig,
    private shelf: Shelf,
    private polaroids: Polaroids,
    private ui: UI,
  ) {
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener('touchstart', (e) => this.touchStart(e), opts);
    canvas.addEventListener('touchmove', (e) => this.touchMove(e), opts);
    canvas.addEventListener('touchend', (e) => this.touchEnd(e), opts);
    canvas.addEventListener('touchcancel', () => this.reset(), opts);

    canvas.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && this.mouseMove(e));
    canvas.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && this.mouseDown(e));
    canvas.addEventListener('pointerup', (e) => e.pointerType === 'mouse' && this.mouseUp(e));
    canvas.addEventListener('pointerenter', () => (this.pointerOver = true));
    canvas.addEventListener('pointerleave', () => {
      this.pointerOver = false;
      if (!this.mouseOrbit) this.hover(null);
    });
    canvas.addEventListener('click', (e) => this.click(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), opts);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('scroll', () => this.rig.orbiting && this.mode !== 'orbit' && !this.mouseOrbit && this.rig.returnHome(), { passive: true });

    for (const view of document.querySelectorAll<HTMLElement>('.detail')) this.watchView(view, opts);
  }

  /**
   * The open views lie over the page, and a swipe on one would scroll the page under it, which moves the camera off
   * the shelf. A swipe goes through only to something inside the view that scrolls its way: the book's details up
   * and down, the row of prints sideways. Anywhere else a swipe down closes the view, which follows the finger.
   */
  private watchView(view: HTMLElement, opts: AddEventListenerOptions) {
    let from = { x: 0, y: 0 };
    let gesture: 'pending' | 'scroll' | 'close' | 'none' = 'none';
    let inScroller = false;
    let trail: { y: number; t: number }[] = [];
    view.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      from = { x: t.clientX, y: t.clientY };
      gesture = e.touches.length > 1 ? 'none' : 'pending';
      inScroller = scrollsWithin(e.target as Element, view, 'x') || scrollsWithin(e.target as Element, view, 'y');
      trail = [{ y: t.clientY, t: performance.now() }];
    }, { passive: true });
    view.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (gesture === 'pending' && Math.hypot(dx, dy) > config.slopPx) {
        const sideways = Math.abs(dx) > Math.abs(dy);
        if (scrollsWithin(e.target as Element, view, sideways ? 'x' : 'y', sideways ? dx : dy)) gesture = 'scroll';
        else gesture = !sideways && dy > 0 ? 'close' : 'none';
      }
      if (gesture === 'scroll' || (gesture === 'pending' && inScroller)) return;
      e.preventDefault();
      if (gesture !== 'close') return;
      trail.push({ y: t.clientY, t: performance.now() });
      if (trail.length > 8) trail.shift();
      this.ui.dragOpen(Math.max(0, dy));
    }, opts);
    view.addEventListener('touchend', () => {
      if (gesture === 'close') {
        // Far enough, or flicked down: it closes. Otherwise it goes back up.
        const now = performance.now();
        const recent = trail.filter((p) => p.t >= now - 100);
        const a = recent[0], b = recent[recent.length - 1];
        const speed = recent.length > 1 ? (b.y - a.y) / Math.max(1, b.t - a.t) : 0;
        const dy = trail[trail.length - 1].y - from.y;
        if (dy > config.closeSwipePx || (speed > config.flickVelocity && dy > 2 * config.slopPx)) this.ui.closeOpen();
        else this.ui.settleOpen();
      }
      gesture = 'none';
    });
    view.addEventListener('touchcancel', () => {
      if (gesture === 'close') this.ui.settleOpen();
      gesture = 'none';
    });
  }

  private rayAt(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.rig.camera);
    return this.ray.ray;
  }

  private pxPerMetre() {
    return this.rig.pxPerMetre(this.canvas.clientWidth);
  }

  /** The book a finger lands on: the one drawn there, or the nearest one within touchReachPx of it. */
  private bookAt(x: number, y: number) {
    return this.shelf.hit(this.rayAt(x, y), config.touchReachPx / this.pxPerMetre());
  }

  // ---------- touch ----------

  private touchStart(e: TouchEvent) {
    if (this.ui.isOpen()) return;
    if (e.touches.length >= 2) {
      e.preventDefault();
      if (this.mode === 'scrub') this.shelf.clear();
      this.rig.panHeld = false;
      this.mode = 'orbit';
      this.rig.startOrbit();
      this.twoFinger = this.twoFingerState(e.touches);
      return;
    }
    const t = e.touches[0];
    this.start = { x: t.clientX, y: t.clientY, t: performance.now() };
    this.last = { x: t.clientX, y: t.clientY };
    this.samples = [{ ...this.last, t: this.start.t }];
    this.travel = 0;
    this.mode = 'pending';
    this.rig.panVelocity = 0;
    this.pressRow = this.rig.inShelf() && !this.rig.orbiting ? (this.shelf.pick(this.rayAt(t.clientX, t.clientY))?.row ?? null) : null;
  }

  private twoFingerState(touches: TouchList) {
    const a = touches[0], b = touches[1];
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    };
  }

  private touchMove(e: TouchEvent) {
    if (this.mode === 'orbit') {
      if (e.touches.length < 2) return;
      e.preventDefault();
      const s = this.twoFingerState(e.touches);
      this.orbitBy(s.x - this.twoFinger.x, s.y - this.twoFinger.y);
      if (this.twoFinger.dist > 0) this.rig.zoom = THREE.MathUtils.clamp(this.rig.zoom * (this.twoFinger.dist / s.dist), 0.4, 3);
      this.twoFinger = s;
      return;
    }
    const t = e.touches[0];
    const now = performance.now();
    const dx = t.clientX - this.last.x;
    this.samples.push({ x: t.clientX, y: t.clientY, t: now });
    if (this.samples.length > 24) this.samples.shift(); // 150 ms at 120 Hz, for watchLift
    const mx = t.clientX - this.start.x;
    const my = t.clientY - this.start.y;
    this.travel = Math.max(this.travel, Math.hypot(mx, my));

    // iOS Safari settles whether a touch may scroll the page from its first moves; a preventDefault after that is
    // ignored. So a touch on a row that leans sideways takes the touch at once, before the slop decides it is a slide:
    // otherwise the flick up at the end of the slide scrolls the page instead of keeping the book out. The page does
    // not scroll sideways, so nothing else is lost. (The canvas has no touch-action for the same reason, see style.css.)
    if (this.mode === 'pending' && this.pressRow && Math.abs(mx) > Math.abs(my)) e.preventDefault();

    if (this.mode === 'pending' && this.travel > config.slopPx) {
      const sideways = Math.abs(mx) > Math.abs(my);
      // Sideways on a row starts the magnifier; sideways anywhere else on the shelf pans it.
      if (sideways && this.pressRow) this.startScrub(this.pressRow);
      else if (sideways && this.rig.inShelf()) {
        this.mode = 'pan';
        this.rig.panHeld = true;
      } else this.mode = 'scroll';
    }
    if (this.mode === 'pan') {
      e.preventDefault();
      this.rig.pan -= dx / this.pxPerMetre();
    } else if (this.mode === 'scrub') {
      e.preventDefault();
      this.watchLift(t.clientX, t.clientY);
      if (!this.lift) {
        this.fingerX = t.clientX;
        this.scrubTo(this.slotAt(t.clientX));
      }
    }
    this.last = { x: t.clientX, y: t.clientY };
  }

  private touchEnd(e: TouchEvent) {
    if (e.touches.length > 0) return;
    const v = this.velocity();
    if (this.mode === 'scrub') {
      // Up far enough, or flicked up: the book opens, its cover flying up off the shelf. Otherwise it slides back.
      const up = this.lift ? this.lift.y - this.last.y : 0;
      const open = !!this.lift && !!this.shelf.selected && (up > config.flickLiftPx || -v.y > config.flickVelocity);
      if (open) {
        this.shelf.pinned = true; // still out when the view closes, for the cover to land back on
        tick();
        this.ui.openBook(this.shelf.selected!);
      } else this.shelf.clear();
    } else if (this.mode === 'pan') {
      this.rig.panVelocity = -(v.x * 1000) / this.pxPerMetre();
    } else if (this.mode === 'pending') {
      e.preventDefault();
      this.tap(this.start.x, this.start.y);
    }
    this.reset();
  }

  private velocity() {
    const end = this.samples[this.samples.length - 1];
    const s = this.samples.filter((p) => end && p.t >= end.t - 80);
    if (s.length < 2) return { x: 0, y: 0 };
    const a = s[0], b = s[s.length - 1];
    const dt = Math.max(1, b.t - a.t);
    if (performance.now() - b.t > 100) return { x: 0, y: 0 };
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }

  private reset() {
    this.rig.panHeld = false;
    this.pressRow = null;
    this.lift = null;
    this.mode = 'idle';
  }

  private startScrub(row: RowName) {
    this.mode = 'scrub';
    this.scrubRow = row;
    this.rig.panHeld = true;
    this.layOut();
  }

  /** Whether the row is too long to fit between the margins, so the shelf has to move to reach all of it. */
  private overflows(row: RowName) {
    this.scrubRow = row;
    return this.layOut();
  }

  /**
   * Lays the scrubbed row across the screen, one slot per book, whatever is drawn under the finger: the slots run
   * between margins of slotMarginPx, which belong to the first and last books so a thumb can reach them. Each book
   * gets an equal share of that width (500 px and 10 books: 50 px each), except a book that looks narrower on screen
   * than its share: it keeps its own width, and the shelf stands still over it instead of moving with the thumb. So
   * the shelf only ever moves against the thumb. A row that fits between the margins (a phone held sideways) keeps
   * every book where it is, and the shelf does not move at all.
   * The shelf follows where the books stand, not their covers: the spread puts a cover a little to one side or the
   * other of its book, by a different amount for each, and following that made the shelf zigzag.
   */
  private layOut() {
    const books = this.shelf.rows[this.scrubRow].books;
    // never going back: the two flat books lie stacked at the end of the top row
    const x: number[] = [];
    books.forEach((b, i) => x.push(i ? Math.max(b.base.x, x[i - 1]) : b.base.x));
    const w = this.canvas.clientWidth;
    const m = config.slotMarginPx;
    const scale = this.onScreen(1) - this.onScreen(0);
    const gaps = x.slice(1).map((v, i) => (v - x[i]) * scale);
    const span = w - 2 * m;
    const total = gaps.reduce((a, b) => a + b, 0);
    let share = Infinity;
    let first = m;
    if (total <= span) {
      // fits: where the books are now, moved inside the margins if the row hangs off an edge
      first = THREE.MathUtils.clamp(this.onScreen(x[0]), m, w - m - total);
    } else {
      // the equal share that fills the span once the narrower books have kept their own widths
      const sorted = [...gaps].sort((a, b) => a - b);
      let rest = span;
      for (let i = 0; i < sorted.length; i++) {
        share = rest / (sorted.length - i);
        if (sorted[i] >= share) break;
        rest -= sorted[i];
      }
    }
    const c = [first];
    gaps.forEach((g, i) => c.push(c[i] + Math.min(g, share)));
    this.slots = { c, x };
    return total > span;
  }

  /** The book a finger x picks, as a fractional index: how far it is from one slot centre to the next. */
  private slotAt(px: number) {
    const { c } = this.slots;
    if (px <= c[0]) return 0;
    for (let i = 0; i < c.length - 1; i++) {
      if (px < c[i + 1]) return i + (px - c[i]) / (c[i + 1] - c[i]);
    }
    return c.length - 1;
  }

  /**
   * Where a point of the shelf front is on screen (px), at the scrubbed row's height. The camera looks down a little,
   * so the shelf's scale on screen changes with height; the slots and the shelf's motion both use this one.
   */
  private onScreen(x: number) {
    const { y, clear } = SHELF.rows[this.scrubRow];
    const p = new THREE.Vector3(x, y + clear / 2, SHELF.frontZ).project(this.rig.camera);
    return (p.x * 0.5 + 0.5) * this.canvas.clientWidth;
  }

  /** Where a fractional index stands along the shelf front. */
  private placeAt(f: number) {
    const { x } = this.slots;
    const i = Math.min(x.length - 1, Math.floor(f));
    return THREE.MathUtils.lerp(x[i], x[Math.min(x.length - 1, i + 1)], f - i);
  }

  /**
   * Once the finger turns upward during a slide, the book it was on stays picked and the shelf stops. A thumb drifts
   * sideways as it flicks up, and on a row whose slots are a few px wide that drift would pick another book, or keep
   * the shelf moving under the book being flicked. Coming back down to where it turned, or going sideways more than
   * up, resumes the slide: a thumb arcs upward as it slides across the screen, and that arc is not a flick.
   */
  private watchLift(x: number, y: number) {
    if (this.lift) {
      const up = this.lift.y - y;
      if (y >= this.lift.y - 2 || Math.abs(x - this.lift.x) > Math.max(config.slopPx, up)) this.lift = null;
      return;
    }
    // the lowest point on screen in the last moment: where the finger turned upward
    const now = this.samples[this.samples.length - 1].t;
    const low = this.samples.filter((p) => p.t >= now - 150).reduce((a, b) => (b.y > a.y ? b : a));
    const up = low.y - y;
    if (up > config.slopPx && up > 2 * Math.abs(x - low.x)) {
      this.lift = { x: low.x, y: low.y };
      this.fingerX = low.x;
      this.scrubTo(this.slotAt(low.x));
    }
  }

  private scrubTo(f: number, touch = true) {
    this.scrubF = f;
    if (this.shelf.focusOn(this.scrubRow, f, touch) && touch) tick();
  }

  private tap(x: number, y: number) {
    const ray = this.rayAt(x, y);
    const p = this.polaroids.pick(ray);
    if (p) return this.ui.openPolaroid(p.index);
    if (!this.rig.inShelf()) return;
    const hit = this.bookAt(x, y);
    if (!hit) return this.shelf.clear();
    const sb = this.shelf.rows[hit.row].books[hit.index];
    if (sb === this.shelf.selected && sb.pull > 0.5) return this.ui.openBook(sb);
    // first tap behaves like hover: the book comes out with its label
    this.shelf.focusOn(hit.row, hit.index, true);
    this.shelf.pinned = true;
    tick();
  }

  /** Called every frame while scrubbing: the shelf moves to keep the picked book under the finger (or pointer). */
  frame(dt: number) {
    if (this.mouseRow && (this.ui.isOpen() || !this.rig.inShelf() || this.rig.orbiting)) this.endMouseSlide();
    if (this.mode !== 'scrub' && !this.mouseRow) return;
    const { c } = this.slots;
    const scale = this.onScreen(1) - this.onScreen(0);
    // In a margin the first or last book stays where its slot is, rather than being dragged along under the finger.
    const at = THREE.MathUtils.clamp(this.fingerX, c[0], c[c.length - 1]);
    const target = this.rig.pan + (this.onScreen(this.placeAt(this.scrubF)) - at) / scale;
    // A little past the pan limit, which the top row's 17 standing books need to reach the right side of the screen;
    // the shelf eases back inside it when the finger lifts (Rig.update).
    const reach = this.rig.panLimit + 0.1;
    const clamped = THREE.MathUtils.clamp(target, -reach, reach);
    // No faster than shelfGlide: when a slide starts away from where the shelf was left, or crosses empty shelf, the
    // shelf glides to the finger instead of jumping.
    const step = (clamped - this.rig.pan) * (1 - Math.exp(-dt * 18));
    this.rig.pan += THREE.MathUtils.clamp(step, -config.shelfGlide * dt, config.shelfGlide * dt);
  }

  // ---------- mouse ----------

  private mouseMove(e: PointerEvent) {
    if (this.mouseOrbit) {
      this.orbitBy(e.movementX, e.movementY);
      return;
    }
    if (this.ui.isOpen()) return;
    this.mouse = { x: e.clientX, y: e.clientY };
    if (this.hoverHeld) {
      if (Math.hypot(e.clientX - this.hoverHeld.x, e.clientY - this.hoverHeld.y) < 6) return;
      this.hoverHeld = null;
    }
    this.hover(this.rayAt(e.clientX, e.clientY));
  }

  /** After an arrow key, the stepped-to book stays out until the mouse really moves. */
  holdHover() {
    this.hoverHeld = { ...this.mouse };
    this.endMouseSlide(); // the arrow key pans the shelf to the book instead
  }

  private endMouseSlide() {
    if (!this.mouseRow) return;
    this.mouseRow = null;
    this.rig.panHeld = false; // the shelf eases back inside the pan limit
  }

  private hover(ray: THREE.Ray | null) {
    let cursor = this.spaceHeld ? 'grab' : '';
    let polaroid = ray ? this.polaroids.pick(ray) : null;
    this.polaroids.items.forEach((p) => (p.hover = p === polaroid));
    if (polaroid) cursor = 'pointer';
    if (!this.rig.inShelf() || this.rig.orbiting) this.shelf.clear();
    else if (ray && !polaroid) {
      // Off the rows (the shelf boards, the sides, the ‹ › buttons) the last book stays out.
      const hit = this.shelf.pick(ray);
      if (hit && this.overflows(hit.row)) {
        // A row too long for the screen is worked like the touch slide: the pointer's slot picks the book and the
        // shelf moves against the pointer to bring that book under it (frame).
        this.mouseRow = hit.row;
        this.rig.panHeld = true;
        this.rig.panVelocity = 0;
        this.fingerX = this.mouse.x;
        this.scrubTo(this.slotAt(this.mouse.x), false);
        cursor = 'pointer';
      } else if (hit) {
        this.endMouseSlide();
        this.shelf.focusOn(hit.row, hit.f, false);
        cursor = 'pointer';
      } else this.endMouseSlide();
    } else this.endMouseSlide();
    this.canvas.className = cursor;
  }

  private mouseDown(e: PointerEvent) {
    if (!this.spaceHeld) return;
    this.mouseOrbit = true;
    this.rig.startOrbit();
    this.shelf.clear();
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.className = 'grabbing';
  }

  private mouseUp(e: PointerEvent) {
    if (!this.mouseOrbit) return;
    this.mouseOrbit = false;
    this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.className = this.spaceHeld ? 'grab' : '';
  }

  private click(e: MouseEvent) {
    if (this.spaceHeld || (e as PointerEvent).pointerType === 'touch') return;
    const p = this.polaroids.items.find((p) => p.hover);
    if (p) return this.ui.openPolaroid(p.index);
    // The book that is out opens, from anywhere on the rows or its cover, but not from the rest of the island.
    if (this.rig.inShelf() && this.shelf.selected && this.shelf.hit(this.rayAt(e.clientX, e.clientY))) this.ui.openBook(this.shelf.selected);
  }

  private wheel(e: WheelEvent) {
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    if (horizontal && this.rig.inShelf()) {
      e.preventDefault();
      const delta = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      this.rig.pan += delta / this.pxPerMetre();
      this.rig.panVelocity = 0;
      this.rig.panTarget = null;
    }
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (e.code !== 'Space' || this.ui.isOpen()) return;
    if (down && !this.pointerOver) return;
    e.preventDefault();
    this.spaceHeld = down;
    if (!this.mouseOrbit) this.canvas.className = down ? 'grab' : '';
  }

  private orbitBy(dx: number, dy: number) {
    this.rig.yaw -= dx * 0.006;
    this.rig.pitch = THREE.MathUtils.clamp(this.rig.pitch - dy * 0.006, -1.2, 0.5);
  }
}

/**
 * Whether something from `el` up to `view` can scroll along `axis`, so a swipe that way is its own. Up and down, with
 * the finger moving `delta` px, it must also have room that way: a swipe down on details already at their top
 * closes the view instead.
 */
function scrollsWithin(el: Element | null, view: HTMLElement, axis: 'x' | 'y', delta = 0) {
  for (; el && el !== view.parentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    const overflow = axis === 'x' ? s.overflowX : s.overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const room = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
    if (room <= 1) continue;
    if (axis === 'x' || delta === 0) return true;
    if (delta > 0 ? el.scrollTop > 0 : el.scrollTop < room - 1) return true;
  }
  return false;
}

import './style.css';
import './poster.css';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { config } from './config';
import { warmUp } from './warmup';
import { Rig } from './camera';
import { loadIsland } from './scene/island';
import { Shelf, type ShelfBook } from './scene/books';
import { Polaroids } from './scene/polaroids';
import { Input } from './input';
import { tick } from './haptics';
import { openPolaroids, closePolaroids, dragPolaroids, settlePolaroids } from './polaroidView';
import { openBookView, swapBookView, closeBookView, dragBookView, settleBookView, onShelf } from './bookView';
import { initAll, openAll, closeAll, isAllOpen, isAllLanded, onWall, revealOnWall, glideWall, preloadWall } from './allView';
import { loadBooks } from './data';
import { apply as applyI18n, lang, setLang, t } from './i18n';

gsap.registerPlugin(ScrollTrigger);

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.AgXToneMapping; // Blender's view transform, look None

const scene = new THREE.Scene();

// Key light at the Blender key softbox, for the books' shadows. The island ignores it: its light is baked.
const sun = new THREE.DirectionalLight('#fffaf2', 1.2);
sun.position.set(-2.6, 3.2, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -2;
sun.shadow.camera.right = 2;
sun.shadow.camera.top = 2;
sun.shadow.camera.bottom = -2;
sun.shadow.radius = 6;
sun.shadow.bias = -0.0004;
scene.add(sun);

const island = loadIsland(renderer).then(({ group, shadow, environment }) => {
  scene.environment = environment;
  // Dark mode drops the floor shadow; the island and its lighting stay the same.
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => (shadow.visible = !dark.matches);
  dark.addEventListener('change', theme);
  theme();
  scene.add(group);
  return shadow;
});
const books = loadBooks();
const shelf = new Shelf(books.es, books.en);
scene.add(shelf.group);
const polaroids = new Polaroids();
scene.add(polaroids.group);

const rig = new Rig();

// ---------- UI ----------

const label = document.querySelector<HTMLElement>('#label')!;
const detail = document.querySelector<HTMLElement>('#detail')!;
// The biggest cover sets the scale of the open view, see .detail in style.css.
detail.style.setProperty('--max-w', `${Math.max(...shelf.all().map((sb) => sb.book.mm.w))}`);
detail.style.setProperty('--max-h', `${Math.max(...shelf.all().map((sb) => sb.book.mm.h))}`);
const polaroidView = document.querySelector<HTMLElement>('#polaroid')!;
const langButton = document.querySelector<HTMLButtonElement>('#lang')!;
const recentre = document.querySelector<HTMLButtonElement>('#recentre')!;
const hero = document.querySelector<HTMLElement>('#hero')!;
const poster = document.querySelector<HTMLElement>('#poster')!;
const footer = document.querySelector<HTMLElement>('#footer')!;
let openBook: ShelfBook | null = null;

function renderText() {
  applyI18n();
  langButton.textContent = t().langButton;
  if (openBook) fillDetail(openBook);
}

function fillDetail(sb: ShelfBook) {
  const b = sb.book;
  const cover = detail.querySelector<HTMLElement>('.detail-cover')!;
  // A box set shows its front, the photo on its spine side, which is as wide as the box is thick.
  const image = b.boxSet ? b.spine : b.cover;
  const url = (path: string) => `url(${import.meta.env.BASE_URL}${path}) center / cover`;
  // the small copy, loaded for the View all wall, shows until the full cover is in
  const layers = image ? [url(image), ...(image === b.cover ? [url(image.replace('covers/', 'covers/small/'))] : [])] : [];
  cover.style.background = [...layers, b.color].join(', ');
  // At its real size: style.css turns mm into px at one scale for every book.
  cover.style.setProperty('--w', `${b.boxSet ? b.mm.t : b.mm.w}`);
  cover.style.setProperty('--h', `${b.mm.h}`);
  cover.textContent = image ? '' : b.title || '?';
  const s = t();
  const names = (list: string[]) => new Intl.ListFormat(lang(), { type: 'conjunction' }).format(list);
  const text = (sel: string, value: string) => {
    const el = detail.querySelector<HTMLElement>(sel)!;
    el.textContent = value;
    el.hidden = !value;
  };
  detail.querySelector<HTMLElement>('.detail-note')!.hidden = !b.placeholder;
  text('.detail-lang', `${b.lang === 'es' ? s.spanish : s.english} · ${s.binding[b.binding]}`);
  text('.detail-title', b.title || (lang() === 'es' ? 'Sin identificar' : 'Not identified yet'));
  text('.detail-author', b.authors.length ? names(b.authors) : b.author);
  // Illustrators already stand in for the author when a book credits no author.
  const credits = [
    b.authors.length && b.illustrators.length ? `${s.illustratedBy} ${names(b.illustrators)}` : '',
    b.translators.length ? `${s.translatedBy} ${names(b.translators)}` : '',
  ];
  text('.detail-credits', credits.filter(Boolean).join('\n'));
  text('.detail-about', b.about?.[lang()] ?? '');

  const o = b.original;
  const facts: [string, string | undefined][] = [
    [s.original, o && `${o.title} (${[s.langName[o.lang] ?? o.lang, o.year].filter(Boolean).join(', ')})`],
    [s.firstPublished, !o && b.firstPublished && (!b.year || b.firstPublished < b.year) ? `${b.firstPublished}` : undefined],
    [s.series, b.series],
    [s.contents, b.contents?.[lang()]],
    [s.edition, [[b.publisher, b.year].filter(Boolean).join(', '), b.pages && !b.boxSet && s.pages(b.pages)].filter(Boolean).join(' · ')],
  ];
  const list = detail.querySelector('.detail-facts')!;
  list.replaceChildren(
    ...facts
      .filter(([, value]) => value)
      .map(([term, value]) => {
        const row = document.createElement('div');
        row.append(Object.assign(document.createElement('dt'), { textContent: term }));
        row.append(Object.assign(document.createElement('dd'), { textContent: value }));
        return row;
      }),
  );
}

// An open view has its own history entry, so the phone's Back gesture closes it instead of leaving the site. Closing
// it any other way (the scrim, a swipe down, Esc) goes back past that entry too, and popstate does the closing.
let leaving = 0; // a history.back() on its way, see closeDetail

function showBook(sb: ShelfBook, fly = true) {
  fillDetail(sb);
  // Over the View all wall, the cover flies off the wall and back onto it.
  const home = isAllOpen() ? onWall(sb) : onShelf(sb, rig.camera);
  if (openBook) swapBookView(home);
  else openBookView(sb, rig.camera, fly, home);
  openBook = sb;
  // Stepping to another book in the open view replaces its entry: Back still closes the view.
  const state = { view: 'book', id: sb.book.id };
  const url = sb.book.placeholder ? location.pathname + location.search : `#${sb.book.id}`;
  if (history.state?.view === 'book') history.replaceState(state, '', url);
  else history.pushState(state, '', url);
}

function showPolaroids(index: number) {
  openPolaroids(polaroids.items[index], rig.camera);
  history.pushState({ view: 'polaroid', index }, '');
}

function showAll() {
  if (isAllOpen()) return;
  shelf.clear();
  openAll(rig.camera);
  history.pushState({ view: 'all' }, '');
}

function closeViews() {
  closeBookView();
  closePolaroids();
  closeAll();
  openBook = null;
}

/** The view on top: an open book over the View all wall closes on its own. */
function closeTop() {
  if (openBook && isAllOpen()) {
    closeBookView();
    openBook = null;
  } else closeViews();
}

function closeDetail() {
  if (leaving) return;
  if (!isOpen() || !history.state?.view) return closeViews();
  history.back();
  leaving = window.setTimeout(() => {
    // popstate never came
    leaving = 0;
    closeTop();
  }, 400);
}

window.addEventListener('popstate', (e) => {
  clearTimeout(leaving);
  leaving = 0;
  // Forward onto a book opens it again; anything else closes what is open.
  const state = e.state as { view?: string; id?: string } | null;
  const sb = state?.view === 'book' ? shelf.all().find((b) => b.book.id === state.id) : undefined;
  if (state?.view === 'all') {
    // Back from a book opened on the wall, or forward onto the wall
    if (openBook) closeTop();
    else openAll(rig.camera);
  } else if (!sb) closeViews();
  else if (sb !== openBook) {
    if (!isAllOpen()) shelf.focusOn(sb.row, sb.index, false);
    showBook(sb);
  }
});

const isOpen = () => !detail.hidden || !polaroidView.hidden || isAllOpen();
const atShelf = () => rig.inShelf() && !rig.orbiting && !isOpen();

// Arrow keys and the ‹ › buttons step through the books in shelf order, across both rows.
function stepBook(dir: 1 | -1, touch = false) {
  const next = shelf.step(dir, touch);
  rig.panTo(next.base.x);
  input.holdHover();
  if (touch) tick();
}

detail.addEventListener('click', (e) => e.target === detail && closeDetail());
polaroidView.addEventListener('click', closeDetail);
window.addEventListener('keydown', (e) => {
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (e.key === 'Escape') {
    if (atShelf()) shelf.clear();
    closeDetail();
  }
  if (dir && openBook) {
    const next = shelf.neighbour(openBook, dir);
    // so the cover lands on screen when the view closes
    if (isAllOpen()) revealOnWall(next);
    else {
      shelf.focusOn(next.row, next.index, false);
      rig.panTo(next.base.x);
    }
    showBook(next);
  } else if (isAllOpen() && !openBook && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = 240;
    glideWall(e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
  } else if (dir && atShelf()) {
    e.preventDefault();
    stepBook(dir);
  } else if (e.key === 'Enter' && e.target === document.body && atShelf() && shelf.selected) {
    showBook(shelf.selected);
  }
});
const steps = document.querySelector<HTMLElement>('#steps')!;
for (const [id, dir] of [['#prev', -1], ['#next', 1]] as const) {
  document.querySelector(id)!.addEventListener('click', (e) => stepBook(dir, (e as PointerEvent).pointerType === 'touch'));
}
langButton.addEventListener('click', () => {
  setLang(lang() === 'es' ? 'en' : 'es');
  renderText();
});
recentre.addEventListener('click', () => rig.returnHome());
initAll(shelf.all(), (sb) => showBook(sb));
for (const link of document.querySelectorAll<HTMLElement>('[data-view-all]')) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    showAll();
  });
}
document.querySelector('#all-close')!.addEventListener('click', closeDetail);

const input = new Input(canvas, rig, shelf, polaroids, {
  openBook: showBook,
  openPolaroid: showPolaroids,
  isOpen,
  dragOpen: (dy) => (openBook ? dragBookView(dy) : dragPolaroids(dy)),
  settleOpen: () => (openBook ? settleBookView() : settlePolaroids()),
  closeOpen: closeDetail,
});

// ---------- scroll ----------

const scroll = { p: 0 };
gsap.to(scroll, {
  p: 1,
  ease: 'none',
  scrollTrigger: { trigger: '#story', start: 'top top', end: 'bottom bottom', scrub: 0.7 },
});

// ---------- loop ----------

let redraw = true; // a resize clears the canvas, so it is drawn even under the landed wall
function resize() {
  redraw = true;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  rig.resize(w, h);
}
window.addEventListener('resize', resize);
resize();
renderText();

// The scene is drawn only once it is ready, and fades in over the poster (see warmup.ts).
let ready = false;
const warm = warmUp(renderer, scene, rig.camera, island).then(() => {
  ready = true;
  document.body.classList.add('ready');
});

const clock = new THREE.Clock();
function frame(dt: number) {
  rig.progress = scroll.p;
  input.frame(dt);
  rig.update(dt);
  shelf.update(dt, rig.camera);
  polaroids.update(dt);

  const fade = Math.min(1, scroll.p / (config.descendEnd * 0.6));
  hero.style.opacity = String(1 - fade);
  hero.style.transform = `translateY(${-fade * 40}px)`;
  // The poster shows the camera at rest, so it goes as soon as a scroll moves the camera.
  if (!ready) poster.style.opacity = String(1 - Math.min(1, scroll.p / 0.05));
  recentre.hidden = !rig.orbiting;
  // A book stays out after the pointer leaves it, but not once the camera leaves the shelf.
  if (!rig.inShelf() && shelf.selected && !openBook) shelf.clear();
  // The ‹ › buttons step aside while a finger slides along the shelf: they would sit on the label.
  steps.classList.toggle('on', atShelf() && input.mode !== 'scrub');
  footer.classList.toggle('on', atShelf());

  const sb = shelf.selected;
  if (sb && sb.pull > 0.3 && detail.hidden) {
    label.hidden = false;
    // The label holds still while the selection moves along the shelf, so it can be read during a slide.
    label.style.top = `${config.labelTop * canvas.clientHeight}px`;
    label.querySelector('.label-title')!.textContent = sb.book.title || (lang() === 'es' ? 'Sin identificar' : 'Not identified yet');
    label.querySelector('.label-author')!.textContent = sb.book.author;
  } else label.hidden = true;

  if (rig.inShelf() && ready) preloadWall();
  // Under the landed wall nothing in the scene moves; the blurred scrim over it is costly enough while panning.
  if (ready && (redraw || !isAllLanded())) renderer.render(scene, rig.camera);
  redraw = false;
}
renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.05)));

if (import.meta.env.DEV) Object.assign(window, {
    __lib: { scene, renderer, rig, shelf, input, scroll, step: (n = 1) => { for (let i = 0; i < n; i++) frame(1 / 60); } },
  });

// ---------- deep link ----------

const fromHash = shelf.all().find((b) => `#${b.book.id}` === location.hash);
if (fromHash) {
  poster.hidden = true; // it shows the opening frame, not the shelf
  // The book gets its own entry over the bare page, so Back from a shared link shows the shelf before leaving.
  history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo(0, document.documentElement.scrollHeight);
  shelf.focusOn(fromHash.row, fromHash.index, false);
  showBook(fromHash, false); // the camera is still on its way to the shelf
} else if (history.state?.view) {
  history.replaceState(null, ''); // a view that was open before a reload
}

// ---------- poster and link preview (?poster, ?social, dev only) ----------

if (import.meta.env.DEV && new URLSearchParams(location.search).has('poster')) {
  Promise.all([island, warm, import('./poster')]).then(([shadow, , { makePosters }]) => makePosters(renderer, scene, rig, shadow));
}
if (import.meta.env.DEV && new URLSearchParams(location.search).has('social')) {
  Promise.all([island, warm, import('./poster')]).then(([shadow, , { makeSocial }]) => makeSocial(renderer, scene, rig, shadow));
}

// ---------- tuning (?tune) ----------

if (new URLSearchParams(location.search).has('tune')) {
  import('lil-gui').then(({ default: GUI }) => {
    const gui = new GUI({ title: 'Tune' });
    const recompute = () => rig.computeFrames();
    const cam = gui.addFolder('Camera');
    cam.add(config, 'fov', 15, 60, 1).onChange(recompute);
    cam.add(config, 'tiltDeg', 0, 20, 0.5).onChange(recompute);
    cam.add(config, 'startElevationDeg', 0, 60, 1).onChange(recompute);
    cam.add(config, 'startBottom', 0, 0.4, 0.01).onChange(recompute);
    cam.add(config, 'startFill', 0.3, 1, 0.01).onChange(recompute);
    cam.add(config, 'shelfFill', 0.5, 1.2, 0.01).onChange(recompute);
    cam.add(config, 'descendEnd', 0.2, 0.8, 0.01);
    cam.add(config, 'zoomEnd', 0.6, 1, 0.01);
    const lk = gui.addFolder('Books look');
    lk.add(config, 'bookExposure', 0.2, 1.2, 0.01);
    lk.add(config, 'shelfShade', 0.1, 1, 0.01);
    const sh = gui.addFolder('Shelf');
    sh.add(config, 'slotMarginPx', 0, 80, 1);
    sh.add(config, 'slopPx', 3, 20, 1);
    sh.add(config, 'shelfGlide', 0.2, 5, 0.1);
    sh.add(config, 'touchReachPx', 0, 60, 1);
    sh.add(config, 'closeSwipePx', 30, 250, 5);
    sh.add(config, 'pullOut', 0.05, 0.5, 0.01);
    sh.add(config, 'pullOutTouch', 0.05, 0.5, 0.01);
    sh.add(config, 'coverTurnDeg', 0, 90, 1);
    sh.add(config, 'flatTiltDeg', 0, 90, 1);
    sh.add(config, 'lidOpenDeg', 0, 90, 1);
    sh.add(config, 'thumbLift', 0, 0.3, 0.01);
    sh.add(config, 'hoverLift', 0, 0.2, 0.01);
    sh.add(config, 'neighbourSigma', 0.3, 4, 0.1);
    sh.add(config, 'neighbourPull', 0, 1, 0.01);
    sh.add(config, 'dockGap', 0, 1.2, 0.05);
    sh.add(config, 'dockSigma', 0.1, 10, 0.1);
    sh.add(config, 'dockMinScale', 0.2, 1, 0.05);
    sh.add(config, 'dockMargin', 0, 0.03, 0.001);
    sh.add(config, 'flickVelocity', 0.1, 2, 0.05);
    sh.add(config, 'flickLiftPx', 8, 80, 1);
    sh.add(config, 'labelTop', 0.05, 0.6, 0.01);
    gui.add({ copy: () => navigator.clipboard.writeText(JSON.stringify(config, null, 2)) }, 'copy').name('Copy values');
    gui.close();
  });
}

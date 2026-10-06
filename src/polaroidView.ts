import * as THREE from 'three';
import { SPOTS, W as PRINT_W, photoUrl, type Polaroid } from './scene/polaroids';
import { inScene, onPage } from './flight';
import { lang, t } from './i18n';

// The open view of a spot on the worktop. Its prints fly up off the worktop into a row (see flight.ts): side
// by side on a wide screen, swiped through on a phone, slightly tilted. Closing puts them back on the pile.

const TILT = [-2, 1.5, -1]; // degrees, once in the row
const STAGGER = 50; // ms between prints leaving the pile, or landing on it
const LAND = 500; // ms, the closing transition in style.css (.detail.closing .polaroid-card)
// The Isabel & Linda pile. Its title is the page title's names, which stay sharp over the scrim (.names-up in
// style.css). The other piles show theirs in the view's heading. The prints carry only their dates.
const NAMED = 1;

const view = document.querySelector<HTMLElement>('#polaroid')!;
const row = view.querySelector<HTMLElement>('.polaroid-row')!;
const heading = view.querySelector<HTMLElement>('.polaroid-heading')!;
const note = view.querySelector<HTMLElement>('.polaroid-note')!;
const hero = document.querySelector<HTMLElement>('#hero')!;
let current: { pile: Polaroid; camera: THREE.PerspectiveCamera; cards: HTMLElement[] } | null = null;
let landing = 0;

function month(date: string) {
  const [y, m] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(lang(), { month: 'long', year: 'numeric' }).format(new Date(y, m - 1));
}

function caption(date?: string) {
  const p = document.createElement('p');
  p.className = 'polaroid-caption';
  if (date) {
    const when = document.createElement('time');
    when.dateTime = date;
    when.textContent = month(date);
    p.append(when);
  }
  return p;
}

function card(spot: number, i: number) {
  const print = SPOTS[spot][i];
  const el = document.createElement('figure');
  el.className = 'polaroid-card';
  el.style.zIndex = String(SPOTS[spot].length - i);
  const photo = document.createElement('div');
  photo.className = 'polaroid-photo';
  const text = caption(print.date);
  if (print.photo) {
    // the small copy is already loaded for the print on the worktop, so it shows while the large one loads
    photo.style.backgroundImage = `url(${photoUrl(print.photo, true)})`;
    const img = new Image();
    img.src = photoUrl(print.photo);
    img.alt = [t().polaroid[spot], print.date && month(print.date)].filter(Boolean).join(', ');
    img.decoding = 'async';
    photo.append(img);
  }
  el.append(photo, text);
  return el;
}

/** Where `print` lies on the worktop. */
function onWorktop(card: HTMLElement, print: THREE.Object3D, camera: THREE.PerspectiveCamera) {
  const m = PRINT_W / card.offsetWidth; // metres per px of card
  // card x (right), y (down), z (out of the face) → print x, z (toward its caption), y (up)
  return inScene(card, print, new THREE.Matrix4().set(m, 0, 0, 0, 0, 0, m, 0, 0, m, 0, 0, 0, 0, 0, 1), camera);
}

function putBack() {
  clearTimeout(landing);
  if (current) current.pile.held = false;
  current = null;
  hero.classList.remove('names-up', 'names-alone', 'gone');
}

export function openPolaroids(pile: Polaroid, camera: THREE.PerspectiveCamera) {
  putBack();
  const cards = SPOTS[pile.index].map((_, i) => card(pile.index, i));
  row.replaceChildren(...cards);
  row.setAttribute('aria-label', t().polaroid[pile.index]);
  heading.textContent = t().polaroid[pile.index];
  heading.hidden = pile.index === NAMED;
  note.hidden = pile.index !== NAMED;
  view.classList.remove('closing', 'shown', 'dragging');
  view.style.removeProperty('--drag');
  view.hidden = false;
  view.classList.toggle('named', pile.index === NAMED);
  if (pile.index === NAMED) view.style.setProperty('--note-end', `${note.offsetTop + note.offsetHeight}px`);
  row.scrollLeft = 0;
  // Measuring a card gives it a style, so without .still it would transition onto the worktop too.
  row.classList.add('still');
  row.style.transform = ''; // left down by a swipe that closed the view
  cards.forEach((c, i) => (c.style.transform = onWorktop(c, pile.prints[i], camera)));
  row.getBoundingClientRect(); // the flight starts from the worktop
  row.classList.remove('still');
  view.classList.add('shown');
  cards.forEach((c, i) => {
    c.style.transitionDelay = `${i * STAGGER}ms`;
    c.style.transform = onPage(c, camera, TILT[i]);
  });
  hero.classList.toggle('names-up', pile.index === NAMED);
  hero.classList.toggle('names-alone', pile.index === NAMED);
  hero.classList.toggle('gone', pile.index !== NAMED);
  pile.held = true;
  current = { pile, camera, cards };
}

/**
 * Swipe down (see Input): the row of prints follows the finger `dy` px down and the scrim fades with it. The row is
 * the prints' offset parent, so closing from here flies them from where they are.
 */
export function dragPolaroids(dy: number) {
  view.classList.add('dragging');
  view.style.setProperty('--drag', String(Math.min(0.7, dy / 400)));
  row.style.transform = `translateY(${dy}px)`;
}

/** The swipe let go without closing: the prints go back up. */
export function settlePolaroids() {
  view.classList.remove('dragging');
  view.style.removeProperty('--drag');
  row.style.transform = '';
}

export function closePolaroids() {
  if (!current || view.classList.contains('closing')) return;
  const { pile, camera, cards } = current;
  view.classList.add('closing');
  view.classList.remove('shown', 'dragging');
  // the rest of the hero comes back as the scrim goes; the names stay over it until the prints have landed
  hero.classList.remove('names-alone', 'gone');
  // the bottom print lands first, the top one last
  cards.forEach((c, i) => {
    c.style.transitionDelay = `${(cards.length - 1 - i) * STAGGER}ms`;
    c.style.transform = onWorktop(c, pile.prints[i], camera);
  });
  landing = window.setTimeout(() => {
    putBack();
    view.hidden = true;
  }, LAND + (cards.length - 1) * STAGGER);
}

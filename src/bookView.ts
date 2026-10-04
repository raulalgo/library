import * as THREE from 'three';
import { coverFace, type ShelfBook } from './scene/books';
import { inScene, onPage } from './flight';

// The open view of a book. Its cover flies off the shelf to its place beside the details (above them on a
// phone), see flight.ts. Closing puts it back on the book.

const LAND = 500; // ms, the closing transition in style.css (.detail.closing .detail-cover)

const view = document.querySelector<HTMLElement>('#detail')!;
const card = view.querySelector<HTMLElement>('.detail-card')!;
const cover = view.querySelector<HTMLElement>('.detail-cover')!;
let current: { book: ShelfBook; camera: THREE.PerspectiveCamera } | null = null;
let landing = 0;

const onShelf = (sb: ShelfBook, camera: THREE.PerspectiveCamera) =>
  inScene(cover, sb.mesh, coverFace(sb.book, cover.offsetWidth), camera);

function putBack() {
  clearTimeout(landing);
  if (current) current.book.held = false;
  current = null;
}

/** Fill the view for `sb` first: the cover's size sets where the flight starts. `fly: false` opens it in place. */
export function openBookView(sb: ShelfBook, camera: THREE.PerspectiveCamera, fly = true) {
  putBack();
  view.classList.remove('closing', 'shown', 'dragging');
  view.style.removeProperty('--drag');
  view.hidden = false;
  // Measuring the cover gives it a style, so without .still it would transition onto the shelf too.
  card.classList.add('still');
  card.style.transform = ''; // left down by a swipe that closed the view
  cover.style.transform = fly ? onShelf(sb, camera) : onPage(cover, camera);
  card.getBoundingClientRect(); // the flight starts from the shelf
  card.classList.remove('still');
  view.classList.add('shown');
  cover.style.transform = onPage(cover, camera);
  sb.held = true;
  current = { book: sb, camera };
}

/** Another book in the open view, with no flight: the arrow keys step through them. */
export function swapBookView(sb: ShelfBook) {
  if (!current) return;
  current.book.held = false;
  sb.held = true;
  current.book = sb;
}

/**
 * Swipe down (see Input): the card follows the finger `dy` px down and the scrim fades with it. The card is the
 * cover's offset parent, so closing from here flies the cover from where it is.
 */
export function dragBookView(dy: number) {
  view.classList.add('dragging');
  view.style.setProperty('--drag', String(Math.min(0.7, dy / 400)));
  card.style.transform = `translateY(${dy}px)`;
}

/** The swipe let go without closing: the card goes back up. */
export function settleBookView() {
  view.classList.remove('dragging');
  view.style.removeProperty('--drag');
  card.style.transform = '';
}

export function closeBookView() {
  if (!current || view.classList.contains('closing')) return;
  view.classList.add('closing');
  view.classList.remove('shown', 'dragging');
  cover.style.transform = onShelf(current.book, current.camera);
  landing = window.setTimeout(() => {
    putBack();
    view.hidden = true;
  }, LAND);
}

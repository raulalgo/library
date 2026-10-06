import { section, wait, tap, drag, flick, path, at, pile, row, el, cover } from './player';

/**
 * The demo's script: what the finger does, in order. Open /demo.html on the dev server to watch it; saving this
 * file plays it again from the top (or from the section picked there).
 *
 * Times are in ms. Places are CSS px on a 393 × 798 screen (an iPhone 15's, under the status bar), or targets found
 * in the scene when the gesture starts: pile(i), row(name, share of the screen width), book(id), el(selector),
 * cover(id) on the View all wall, coverNear(x, y). A move goes `to` a target or `by` [dx, dy], with an ease
 * ('smooth', 'prompt', 'launch' for flicks, 'accel', 'linear'), a `bow` to one side in px, and a `pause` after it
 * with the finger still down.
 */
export const script = [
  section('opening', 'top', [wait(1400)]),

  // The island's photo pile: the prints fly up, two swipes go through them, a swipe down puts them back.
  section('prints', 'top', [
    tap(pile(0), { hold: 85 }),
    wait(1900),
    flick(at(290, 430), { by: [-175, 6], ms: 220, bow: 5 }),
    wait(1300),
    flick(at(285, 440), { by: [-180, 4], ms: 210, bow: 6 }),
    wait(1400),
    flick(at(196, 330), { by: [12, 230], ms: 360, bow: 7 }, { land: 70 }),
    wait(1300),
  ]),

  // Down the page: the camera comes down from above the island and moves in to the shelves.
  section('scroll', 'top', [
    drag(at(205, 640), { by: [9, -220], ms: 900, bow: 5 }, { land: 80 }),
    wait(650),
    flick(at(210, 690), { by: [12, -330], ms: 210, bow: 6 }),
    wait(500),
    flick(at(206, 700), { by: [15, -360], ms: 190, bow: 6 }),
    wait(900),
  ]),

  // The magnifier: a slide along the bottom row, back a little, and a flick up opens the book under the thumb.
  section('magnifier', 'shelf', [
    path(row('bottom', 0.845), [
      { to: row('bottom', 0.21), ms: 2500, ease: 'prompt', bow: 9, pause: 280 },
      { by: [92, -7], ms: 1150, bow: -4, pause: 420 },
      { by: [7, -89], ms: 150, ease: 'accel' },
    ], { land: 110, label: 'slide, flick up' }),
    wait(2600),
    flick(at(200, 210), { by: [14, 260], ms: 400, bow: 8 }, { land: 80, label: 'swipe down' }),
    wait(1400),
  ]),

  // A press on a spine of the top row takes it out.
  section('press', 'shelf', [
    tap(row('top', 0.21), { hold: 140, label: 'press' }),
    wait(1900),
  ]),

  // View all: the covers fly onto the wall, a flick and a drag pan it, a cover opens, and both views close.
  section('view all', 'shelf', [
    tap(el('[data-view-all]')),
    wait(2200),
    // A Visitor for Bear starts off the left edge: a flick brings it on, then a drag pulls it to the middle. The drag
    // stops before the lift, so the wall does not glide and the tap finds the cover where the drag left it.
    flick(at(110, 560), { by: [140, -150], ms: 330, bow: -12 }, { land: 60 }),
    wait(1500),
    drag(cover('a-visitor-for-bear'), { to: at(200, 420), ms: 650, bow: 8, pause: 120 }, { land: 80 }),
    wait(700),
    tap(cover('a-visitor-for-bear')),
    wait(2400),
    flick(at(196, 220), { by: [10, 260], ms: 390, bow: 6 }, { land: 70, label: 'swipe down' }),
    wait(1500),
    tap(el('#all-close')),
    wait(2200),
  ]),
];
